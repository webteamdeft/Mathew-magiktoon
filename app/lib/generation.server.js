/**
 * AI artwork generation (Milestone 4).
 *
 * One customer photo in, one generated artwork out, using the prompt, model and
 * resolution configured for the design the customer is looking at.
 *
 * Responsibilities beyond calling the model:
 *   - queue and rate limit, so concurrent shoppers all finish inside the
 *     agreed ceiling instead of collectively blowing it (NFR-10);
 *   - time every run and record it, because that ceiling is a hard pass-or-fail
 *     at Milestones 4 and 5 (AC-04, NFR-04);
 *   - price every run from the configured per-image rate (NFR-06, AC-10);
 *   - turn every failure into one sentence a customer can act on, never an API
 *     error (AC-06).
 *
 * SERVER ONLY.
 */

import prisma from "../db.server.js";
import {
  composeArtworkText,
  generationTextCompositingEnabled,
} from "./print-file.server.js";
import { getGeminiConfig } from "./env.server.js";
import sharp from "sharp";

import { generatePersonalisedArtwork } from "./gemini.server.js";
import { describeUpscale, normalizeAspectRatio } from "./image-shape.js";
import { resolvePrintGeometry } from "./print-geometry.js";
import { decodeDataUrl, storeImage } from "./customizations.server.js";
import { toTrimmedString } from "./normalize.js";
import {
  createLimiter,
  createRateLimiter,
  withTimeout,
} from "./concurrency.js";
import {
  GENERATION_ERRORS,
  estimateGenerationCost,
  normalizeSeed,
  normalizeTemperature,
  resolveGenerationConfig,
} from "./generation-config.js";

function envNumber(name, fallback) {
  const parsed = Number(process.env[name]);

  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Server-side budget for one model call.
 *
 * Deliberately under the ceiling in `generation-stats.js`: the ceiling is
 * measured end to end from the customer's upload, so the upload, the response
 * and the browser's own rendering have to fit as well. Failing early with a
 * retry beats returning just over and failing the gate.
 *
 * 84s against the 90s ceiling. The margin is the point: the ceiling covers the
 * upload, the model call, the response and the browser's rendering, and only
 * the middle one is budgeted here.
 *
 * Six seconds is thinner than it looks. gemini-3-pro-image was measured at up
 * to 81s, so a slow run has very little room left before the ceiling. It is
 * sized this way on purpose — failing just inside the agreed limit, with a
 * retry offered, beats returning just outside it and failing the gate.
 *
 * Override with GENERATION_TIMEOUT_MS when running a model with different
 * latency; the default follows the ceiling in generation-stats.js.
 */
const GENERATION_TIMEOUT_MS = envNumber("GENERATION_TIMEOUT_MS", 84000);

/**
 * Module-level so every request shares one queue.
 *
 * This is per process. A multi-instance deployment needs a shared queue
 * (Redis or the database) to hold a global limit; until then the limit is per
 * instance, which is honest but worth knowing before scaling out.
 */
const limiter = createLimiter({
  concurrency: envNumber("GENERATION_CONCURRENCY", 3),
  maxQueue: envNumber("GENERATION_MAX_QUEUE", 40),
});

const rateLimiter = createRateLimiter({
  points: envNumber("GENERATION_RATE_POINTS", 12),
  windowMs: envNumber("GENERATION_RATE_WINDOW_MS", 60000),
});

/** Exposed for the admin health view and for tests. */
export function generationQueueStats() {
  return limiter.stats;
}

/**
 * Ask the model for the configured resolution.
 *
 * The image models take no explicit size argument through this SDK, so the
 * request is expressed in the prompt. The configured value is recorded on the
 * log either way, so a run can always be traced back to what was asked for.
 */
export function buildGenerationPrompt(promptText, resolution) {
  const base = toTrimmedString(promptText);
  const target = toTrimmedString(resolution);

  if (!target) return base;

  return `${base}\n\nRender the result at ${target} resolution, filling the frame, with no added text, borders or watermarks.`;
}

/**
 * Map a thrown error onto a customer-facing code and message.
 *
 * Everything that is not specifically recognised becomes a generic "try again":
 * a customer must never be shown a model name, a quota message or a stack.
 */
export function classifyGenerationError(error) {
  const code = toTrimmedString(error?.code);
  const message = toTrimmedString(error?.message);

  if (code === "TIMED_OUT") {
    return { code: "TIMED_OUT", error: GENERATION_ERRORS.TIMED_OUT };
  }

  if (code === "QUEUE_FULL") {
    return { code: "RATE_LIMITED", error: GENERATION_ERRORS.RATE_LIMITED };
  }

  if (/429|quota|rate.?limit|RESOURCE_EXHAUSTED/i.test(message)) {
    return { code: "RATE_LIMITED", error: GENERATION_ERRORS.RATE_LIMITED };
  }

  // The model declining an image is a *clean* failure under AC-05: nothing
  // broken proceeds, and the customer is told to try another photo.
  if (/safety|blocked|policy|did not return an image/i.test(message)) {
    return {
      code: "UNPROCESSABLE_IMAGE",
      error: GENERATION_ERRORS.UNPROCESSABLE_IMAGE,
    };
  }

  return { code: "GENERATION_FAILED", error: GENERATION_ERRORS.GENERATION_FAILED };
}

/**
 * Generate artwork for one customer photo.
 *
 * @param {object} params
 * @param {string} params.shop
 * @param {object} params.mapping        Loaded with its `prompt` and `aiModel`.
 * @param {string} params.imageDataUrl   The customer's photo, as a data URL.
 * @param {string} [params.generationType] "INITIAL" or "REGENERATION" (FR-05).
 * @param {string} [params.rateKey]      Who to rate limit; defaults to the shop.
 * @param {object} [deps]                Injection seam for tests.
 * @returns {Promise<object>}
 */
export async function generateArtwork(
  {
    shop,
    mapping,
    imageDataUrl,
    // What the customer typed in Step 2. Printed into the artwork below.
    textValues,
    generationType = "INITIAL",
    rateKey = "",
  },
  deps = {},
) {
  const {
    db = prisma,
    composeText = composeArtworkText,
    generate = generatePersonalisedArtwork,
    queue = limiter,
    rates = rateLimiter,
    timeoutMs = GENERATION_TIMEOUT_MS,
    now = () => Date.now(),
    fallbackModelKey = safeDefaultModel(),
  } = deps;

  const startedAt = now();

  const config = resolveGenerationConfig(mapping, { fallbackModelKey });

  if (!config.ok) {
    // Not logged as a generation: nothing was attempted, and burying
    // misconfiguration among model failures makes the reliability numbers lie.
    console.warn("[generation] refused:", config.code, config.detail || "");

    return { ok: false, code: config.code, error: config.error };
  }

  // Rate limiting comes after configuration so a misconfigured product cannot
  // burn a customer's allowance on a request that was never going to run.
  const allowance = rates.take(toTrimmedString(rateKey) || shop, startedAt);

  if (!allowance.ok) {
    return {
      ok: false,
      code: "RATE_LIMITED",
      error: GENERATION_ERRORS.RATE_LIMITED,
      retryAfterMs: allowance.retryAfterMs,
    };
  }

  const decoded = decodeDataUrl(imageDataUrl);

  if (!decoded.ok) {
    return {
      ok: false,
      code: "UNPROCESSABLE_IMAGE",
      error: GENERATION_ERRORS.UNPROCESSABLE_IMAGE,
      detail: decoded.error,
    };
  }

  const logBase = {
    shop,
    productMappingId: toTrimmedString(mapping?.id) || null,
    aiModelId: config.aiModelId || null,
    // Kept on the row itself so a report stays truthful after a mapping is
    // reconfigured or a model row is deleted.
    modelKey: config.modelKey,
    resolution: config.resolution,
    generationType,
  };

  // The shape the merchant configured for this design. Never derived.
  //
  // An earlier version calculated it from the print area, and the Client was
  // right to reject that: the AI image is often only part of the template. A
  // 200 x 96 mm mug can carry 3:4 artwork inside a fixed layout of text and
  // graphics, and no arithmetic on the print dimensions reveals that.
  //
  // Empty means send no aspect ratio, and the model follows the customer's
  // photo — the behaviour every design had before this field existed. That is a
  // worse default but an honest one; it is visibly unset rather than quietly
  // guessed.
  const aspectRatio = normalizeAspectRatio(mapping?.aspectRatio);

  let result;

  try {
    result = await queue.run(() =>
      withTimeout(
        generate({
          prompt: buildGenerationPrompt(config.promptText, config.resolution),
          imageBase64: decoded.buffer.toString("base64"),
          mimeType: decoded.mimeType,
          model: config.modelKey,
          aspectRatio: aspectRatio || "",
          // How literally to follow the prompt, and whether to repeat. Null on
          // both keeps the model default, which is what every design had.
          temperature: normalizeTemperature(mapping?.temperature),
          seed: normalizeSeed(mapping?.seed),
          // Honoured by gemini-3-pro-image only; dropped for any other model
          // so the log never records a size the run did not use.
          imageSize: config.resolution,
        }),
        timeoutMs,
        "Generation timed out",
      ),
    );
  } catch (error) {
    const classified = classifyGenerationError(error);

    console.error("[generation] failed:", classified.code, error?.message);

    await writeLog(db, {
      ...logBase,
      status: classified.code,
      durationMs: now() - startedAt,
      errorMessage: toTrimmedString(error?.message).slice(0, 500),
    });

    return { ok: false, ...classified };
  }

  // The wording goes in before the asset is stored.
  //
  // The stored asset is what Gelato is given to print, so compositing after
  // this point would put the text in the preview and leave it off the parcel.
  //
  // A failure here is not worth losing a generation over: the artwork without
  // its wording is still the customer's picture, and the reason is logged.
  let artworkBuffer = Buffer.from(result.base64, "base64");
  let artworkType = result.mimeType || "image/png";

  // Say so when the artwork is too small for the print area.
  //
  // Upscaling is silent by construction: sharp enlarges without complaint and
  // returns a file of exactly the right dimensions, so the only symptom is a
  // soft print that nobody sees until the parcel arrives. Reported here, where
  // the model and its settings are still in scope and the cause is actionable,
  // rather than at fulfilment where it is too late to regenerate.
  try {
    const geometry = resolvePrintGeometry(mapping);
    const meta = await sharp(artworkBuffer).metadata();
    const upscale = describeUpscale(meta, geometry);

    if (upscale.upscaled) {
      console.warn(`[generation] ${upscale.detail} (model ${config.modelKey})`);
    }
  } catch {
    // A diagnostic must never cost a generation the customer is waiting for.
  }

  try {
    // Separate from PRINT_FILE_COMPOSITE_TEXT, and off by default, because the
    // two are not two switches for one feature — they are two places the SAME
    // wording gets drawn, and turning both on prints everything twice. That is
    // not theoretical: it was measured on this design, every field appearing at
    // two different sizes in one file.
    //
    // The print file is the right place, and this is the wrong one, for a
    // reason that survives the doubling being fixed. Layer positions are
    // fractions of the PRINT AREA — 204 x 100 mm, roughly 2:1. The artwork is
    // whatever shape the model returned, here 1883 x 2400 portrait, and it is
    // later cropped to fill that 2:1 area. Text drawn now is therefore drawn
    // against the wrong shape and then cropped through, so it cannot land where
    // the design intends however carefully it was positioned.
    //
    // Kept behind a flag rather than deleted: drawing on the artwork is still
    // the only way to show the wording on the generated image itself, before
    // Gelato has rendered a mockup. If that is wanted, it needs its own
    // geometry, not the print file's.
    const withText = generationTextCompositingEnabled()
      ? await composeText(artworkBuffer, mapping, textValues)
      : artworkBuffer;

    if (withText !== artworkBuffer) {
      artworkBuffer = withText;
      artworkType = "image/png";
    }
  } catch (error) {
    console.error("[generation] text could not be printed in:", error.message);
  }

  const artworkDataUrl = `data:${artworkType};base64,${artworkBuffer.toString("base64")}`;

  // Stored before returning, so a generation the customer never approves is
  // still auditable and still falls under the retention sweep.
  // `storeImage` appends the shop slug to the prefix itself.
  const stored = await storeImage(artworkDataUrl, { shop, prefix: "generated" });

  const durationMs = now() - startedAt;

  const log = await writeLog(db, {
    ...logBase,
    status: "SUCCESS",
    durationMs,
    estimatedCost: estimateGenerationCost(config.pricePerImage, 1),
    outputAssetId: stored.ok ? stored.key : null,
  });

  return {
    ok: true,
    // A data URL rather than a link: the customizer draws this onto a canvas
    // and reads it back with `toDataURL`, and an image fetched from the app's
    // own origin would taint that canvas — the page itself is served from the
    // shop's domain through the app proxy.
    artwork: artworkDataUrl,
    artworkKey: stored.ok ? stored.key : "",
    generationId: log?.id || "",
    durationMs,
    model: config.modelKey,
    resolution: config.resolution,
    usingFallbackModel: config.usingFallbackModel,
  };
}

/**
 * The app-wide default model.
 *
 * Read lazily and defensively: a missing `GEMINI_API_KEY` must surface as a
 * refused generation, not as a crash while merely resolving configuration.
 */
function safeDefaultModel() {
  try {
    return getGeminiConfig().model;
  } catch {
    return "";
  }
}

/** Record one generation attempt. Never lets logging break a good response. */
async function writeLog(db, data) {
  try {
    return await db.generationLog.create({ data });
  } catch (error) {
    console.error("[generation] could not write the log:", error);

    return null;
  }
}
