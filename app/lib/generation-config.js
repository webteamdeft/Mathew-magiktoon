/**
 * Which prompt, model and resolution a design generates with (Milestone 4).
 *
 * Client-safe: pure functions, no server-only imports, so the admin form and
 * the storefront endpoint agree on the rules without duplicating them.
 *
 * Background: prompts, models and resolution used to live only on
 * `ProductConfiguration`, but the storefront resolves a `ProductMapping` when a
 * customer opens a product page, and the two were never linked — so nothing on
 * the storefront could tell which prompt a product should use. Milestone 4 puts
 * the three settings on the mapping itself, and this module is the single place
 * that reads them.
 */

import { toTrimmedString } from "./normalize.js";

/**
 * Output resolutions the admin may pick.
 *
 * Capped at 4K by the agreed assumptions (SOW section 8). The pixel figure is
 * the long edge requested of the model.
 */
export const OUTPUT_RESOLUTIONS = ["1K", "2K", "4K"];

export const DEFAULT_OUTPUT_RESOLUTION = "2K";

export const RESOLUTION_OPTIONS = [
  { label: "1K — fastest", value: "1K" },
  { label: "2K — balanced", value: "2K" },
  { label: "4K — highest detail", value: "4K" },
];

export const RESOLUTION_LONG_EDGE = {
  "1K": 1024,
  "2K": 2048,
  "4K": 4096,
};

/**
 * Customer-facing failure messages (AC-06, SOW section 7).
 *
 * A customer must never see an API error or a prompt id. Each code maps to one
 * sentence they can act on; the operational detail goes to `GenerationLog`.
 */
export const GENERATION_ERRORS = {
  NOT_CONFIGURED:
    "This product is not ready for personalisation yet. Please try again later.",
  NO_PROMPT:
    "This product is not ready for personalisation yet. Please try again later.",
  UNPROCESSABLE_IMAGE:
    "That photo could not be used. Please try another one — a clear, well-lit photo works best.",
  GENERATION_FAILED:
    "AI generation failed. Please try again.",
  TIMED_OUT:
    "The preview took too long to generate. Please try again.",
  RATE_LIMITED:
    "We are handling a lot of designs right now. Please try again in a moment.",
};

/**
 * Roughly how long each model takes, for the customer-facing progress bar.
 *
 * Measured on this shop's own prompts rather than published anywhere:
 *
 *   gemini-2.5-flash-image   38 runs, average 16.1s, slowest 35.5s
 *   gemini-3-pro-image       34.6-49.1s one morning, 60.7-81.0s that evening,
 *                            69.5s through the app on the current settings
 *
 * The Pro figure sits inside its observed range rather than at either end. Too
 * low and the bar reaches its slow creep while most of the wait remains, which
 * is the stalled-looking thing this replaced; too high and it barely moves
 * through a wait that is already over.
 *
 * Only ever used to pace an animation. Nothing depends on it being right.
 */
export const EXPECTED_GENERATION_MS = {
  "gemini-2.5-flash-image": 18000,
  "gemini-3.1-flash-image": 20000,
  "gemini-3-pro-image": 65000,
};

export const DEFAULT_EXPECTED_GENERATION_MS = 25000;

export function expectedGenerationMs(modelKey) {
  return (
    EXPECTED_GENERATION_MS[toTrimmedString(modelKey)] ||
    DEFAULT_EXPECTED_GENERATION_MS
  );
}

/**
 * How literally the model should follow the prompt.
 *
 * Google defaults this to 1.0 and every request ran at that until now, so this
 * exposes a control that was simply unavailable.
 *
 * MEASURED, and weaker than expected. The hypothesis was that a low value
 * would make gemini-3-pro-image respect "the cabin fills roughly the right
 * 45-50% of the frame" and leave the left half clear for template text. Tested
 * at 1.0 against 0.2 on the same photo and seed: left-half detail moved 70.2
 * to 67.6, under 4% and within noise, and the 0.2 run dropped one of the two
 * required subjects — arguably worse adherence, not better.
 *
 * So this is a knob worth having and not a fix for composition. Do not present
 * it as one. Lower still means more literal in principle; the effect on this
 * prompt was not demonstrable.
 *
 * Range enforced because the API rejects anything outside 0-2 and a rejected
 * request costs a customer their generation.
 */
export const MIN_TEMPERATURE = 0;
export const MAX_TEMPERATURE = 2;

export function normalizeTemperature(value) {
  if (value === null || value === undefined || value === "") return null;

  const parsed = Number(value);

  if (!Number.isFinite(parsed)) return null;

  return Math.min(MAX_TEMPERATURE, Math.max(MIN_TEMPERATURE, parsed));
}

/**
 * A fixed seed, so the same photo and prompt reproduce the same image.
 *
 * The intent is reproducibility while refining a prompt: change one line and
 * see only that change.
 *
 * MEASURED, and it does NOT deliver that. Two runs with seed 12345, identical
 * photo, prompt, model and temperature produced different images — sha1
 * 47d785d1b4ee against d9a8a7646b64. The API accepts the parameter without
 * complaint and does not honour it as a determinism guarantee on this model.
 *
 * Kept because it is a real API field the Client asked about, and it may bind
 * on other models or later versions. It must not be described as giving
 * repeatable output.
 *
 * Null means send nothing, which is the right default for a live shop anyway:
 * two customers uploading the same photo should not receive identical artwork.
 */
export function normalizeSeed(value) {
  if (value === null || value === undefined || value === "") return null;

  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed < 0) return null;

  return parsed;
}

/** Normalize an admin-supplied resolution, falling back to the default. */
export function normalizeResolution(value) {
  const resolution = toTrimmedString(value).toUpperCase();

  return OUTPUT_RESOLUTIONS.includes(resolution)
    ? resolution
    : DEFAULT_OUTPUT_RESOLUTION;
}

/** Long edge in pixels for a resolution label. */
export function resolutionLongEdge(value) {
  return RESOLUTION_LONG_EDGE[normalizeResolution(value)];
}

/**
 * Resolve everything a generation needs from a mapping.
 *
 * The mapping must be loaded with its `prompt` and `aiModel` relations.
 *
 * A prompt is required and must be ACTIVE: a draft is work in progress, and
 * running one against real customers is exactly what the Draft/Active lifecycle
 * exists to prevent. A model is *not* required — without one the app falls back
 * to the configured default so an un-migrated design keeps working, and says so
 * via `usingFallbackModel` rather than failing silently.
 *
 * @param {object} mapping
 * @param {object} [options]
 * @param {string} [options.fallbackModelKey] Default model, from env.
 * @returns {{ ok: boolean, code?: string, error?: string,
 *             promptId?: string, promptText?: string, promptName?: string,
 *             aiModelId?: string|null, modelKey?: string,
 *             usingFallbackModel?: boolean, resolution?: string,
 *             longEdge?: number, pricePerImage?: number|null }}
 */
export function resolveGenerationConfig(mapping, { fallbackModelKey } = {}) {
  if (!mapping) {
    return {
      ok: false,
      code: "NOT_CONFIGURED",
      error: GENERATION_ERRORS.NOT_CONFIGURED,
    };
  }

  const prompt = mapping.prompt;
  const promptText = toTrimmedString(prompt?.content);

  if (!promptText) {
    return {
      ok: false,
      code: "NO_PROMPT",
      error: GENERATION_ERRORS.NO_PROMPT,
      detail: "No prompt is assigned to this design.",
    };
  }

  if (toTrimmedString(prompt?.status).toUpperCase() !== "ACTIVE") {
    return {
      ok: false,
      code: "NO_PROMPT",
      error: GENERATION_ERRORS.NO_PROMPT,
      detail: `Prompt "${toTrimmedString(prompt?.name)}" is not active.`,
    };
  }

  // A model that has been switched off must not keep running just because a
  // design still points at it.
  const model = mapping.aiModel;
  const modelEnabled = model ? model.enabled !== false : false;
  const configuredKey = modelEnabled ? toTrimmedString(model?.modelKey) : "";
  const modelKey = configuredKey || toTrimmedString(fallbackModelKey);

  if (!modelKey) {
    return {
      ok: false,
      code: "NOT_CONFIGURED",
      error: GENERATION_ERRORS.NOT_CONFIGURED,
      detail: "No AI model is configured for this design.",
    };
  }

  const resolution = normalizeResolution(mapping.outputResolution);

  return {
    ok: true,
    promptId: toTrimmedString(prompt?.id) || null,
    promptName: toTrimmedString(prompt?.name),
    promptText,
    aiModelId: configuredKey ? toTrimmedString(model?.id) : null,
    modelKey,
    usingFallbackModel: !configuredKey,
    resolution,
    longEdge: RESOLUTION_LONG_EDGE[resolution],
    pricePerImage:
      configuredKey && Number.isFinite(Number(model?.pricePerImage))
        ? Number(model.pricePerImage)
        : null,
  };
}

/**
 * Estimated cost of a generation (NFR-06 / AC-10).
 *
 * An estimate by definition: it applies the rate the admin configured, so it is
 * accurate only while that rate is kept current. Returns null when no rate is
 * set, which the admin renders as "not configured" rather than as £0.00.
 */
export function estimateGenerationCost(pricePerImage, images = 1) {
  // `Number(null)` is 0, so an unset rate would otherwise price every
  // generation at exactly zero — indistinguishable from a genuinely free model,
  // and wrong in the direction that hides cost.
  if (pricePerImage === null || pricePerImage === undefined || pricePerImage === "") {
    return null;
  }

  const rate = Number(pricePerImage);
  const count = Number(images);

  if (!Number.isFinite(rate) || rate < 0) return null;
  if (!Number.isFinite(count) || count <= 0) return null;

  return rate * Math.floor(count);
}
