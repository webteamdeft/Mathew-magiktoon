/**
 * Gelato product mockups for the customer's own artwork (Milestone 5).
 *
 * SERVER ONLY.
 *
 * HOW, AND WHY THIS WAY
 * ---------------------
 * Gelato has no standalone "render a mockup" endpoint. Verified against the
 * live API: `POST /v1/templates/mockups` is not a route at all (the path
 * resolves as `/v1/templates/{id}` with "mockups" read as the id), and
 * `/v1/templates/{id}/mockups`, `/v3/mockups` and
 * `products:preview-from-template` all return 404.
 *
 * The one surface that works is `products:create-from-template`: a template
 * plus filled image placeholders produces a real store product, and Gelato
 * renders its preview — which IS the mockup, with the template's own design
 * applied. Measured at roughly five seconds.
 *
 * That leaves two consequences this module has to handle:
 *
 *   1. Every mockup creates a product in the merchant's Gelato store. Left
 *      alone, one product per customer preview would bury the store within a
 *      day. The product is deleted once its mockup has been copied out.
 *
 *   2. Gelato's preview URL is a presigned S3 link that expires in 24 hours,
 *      and it dies with the product anyway. The image is therefore fetched and
 *      stored as our own asset, served through the signed-URL route like every
 *      other customer file (NFR-09).
 */

import { getGelatoConfig } from "./env.server.js";
import { storeAsset } from "./storage.server.js";
import { asArray, toTrimmedString } from "./normalize.js";

const GELATO_ECOMMERCE_API = "https://ecommerce.gelatoapis.com/v1";

/** How long to wait for Gelato to render, and how often to look. */
const RENDER_TIMEOUT_MS = 120000;

/**
 * Statuses that mean Gelato has given up.
 *
 * Reaching one is final: continuing to poll for a preview that will never come
 * only makes the customer wait for a worse message.
 */
const FAILED_STATUSES = new Set(["publishing_error", "failed", "error"]);
const POLL_INTERVAL_MS = 2000;

function headers() {
  const { apiKey } = getGelatoConfig();

  return {
    "X-API-KEY": apiKey,
    Accept: "application/json",
    "Content-Type": "application/json",
  };
}

async function gelato(path, options = {}, fetchImpl = fetch) {
  const response = await fetchImpl(`${GELATO_ECOMMERCE_API}${path}`, {
    ...options,
    headers: { ...headers(), ...(options.headers || {}) },
  });

  const text = await response.text();

  let data;

  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  if (!response.ok) {
    const error = new Error(
      `Gelato E-commerce API ${response.status}: ${
        typeof data === "string" ? data : JSON.stringify(data)
      }`,
    );

    error.status = response.status;

    throw error;
  }

  return data;
}

/**
 * Which image placeholders to fill, and with what.
 *
 * A template can expose the same placeholder more than once — the 11oz mug
 * "twin image" template carries two, so the artwork has to be sent for each or
 * half the mug prints blank. Names come from the template itself; the mapping's
 * stored placeholder name is the fallback for a template we cannot read.
 */
export function buildImagePlaceholders(
  templateVariant,
  mapping,
  artworkUrl,
  backgroundUrl = "",
) {
  const fromTemplate = asArray(templateVariant?.imagePlaceholders)
    .map((placeholder) =>
      toTrimmedString(
        placeholder?.name || placeholder?.placeholderName || placeholder?.id,
      ),
    )
    .filter(Boolean);

  const names = fromTemplate.length > 0
    ? fromTemplate
    : [
        toTrimmedString(
          mapping?.gelatoPlaceholderName || mapping?.placeholderName || "ImageFront",
        ),
      ].filter(Boolean);

  // The admin can nominate one placeholder to carry the background layer
  // instead of the artwork (SOW section 3.5). Only honoured when a background
  // has actually been uploaded — otherwise that placeholder would print empty.
  const backgroundName = toTrimmedString(backgroundUrl)
    ? toTrimmedString(mapping?.backgroundPlaceholderName)
    : "";

  // Deduplicated: the same placeholder listed twice must not be sent twice
  // once one of them is the background.
  const seen = new Set();

  return names
    .filter((name) => {
      if (name !== backgroundName) return true;
      if (seen.has(name)) return false;
      seen.add(name);
      return true;
    })
    .map((name) => ({
      name,
      fileUrl: name === backgroundName ? backgroundUrl : artworkUrl,
      // "slice" fills the placeholder and crops the overflow, which is what the
      // customizer's own preview shows. "fit" would letterbox and the printed
      // item would not match the mockup the customer approved.
      fitMethod: "slice",
    }));
}

/**
 * Text values to send with the mockup.
 *
 * Only names the template actually declares are sent: an unknown name is
 * rejected by Gelato and would fail the whole render over a stale field.
 */
export function buildTextPlaceholders(templateVariant, mapping, textValues) {
  const values = textValues && typeof textValues === "object" ? textValues : {};

  const declared = asArray(templateVariant?.textPlaceholders)
    .map((placeholder) => toTrimmedString(placeholder?.name))
    .filter(Boolean);

  const known = declared.length > 0
    ? declared
    : asArray(mapping?.gelatoTextPlaceholders)
        .map((placeholder) => toTrimmedString(placeholder?.name))
        .filter(Boolean);

  return known
    .filter((name) => toTrimmedString(values[name]))
    .map((name) => ({ name, text: toTrimmedString(values[name]) }));
}

/** The template variant this mapping prints, or the template's only one. */
export function pickTemplateVariant(template, mapping) {
  const variants = asArray(
    template?.variants ||
    template?.templateVariants ||
    template?.template?.variants ||
    template?.template?.templateVariants,
  );

  if (variants.length === 0) return null;

  const wanted = toTrimmedString(mapping?.gelatoVariantId || mapping?.variantId);

  return (
    variants.find(
      (variant) =>
        variant.id === wanted ||
        variant.templateVariantId === wanted ||
        variant.variantId === wanted ||
        variant.uid === wanted,
    ) || variants[0]
  );
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Render a Gelato mockup of the customer's artwork on this design.
 *
 * @returns {Promise<{ ok: boolean, key?: string, mimeType?: string,
 *                     code?: string, error?: string, durationMs: number }>}
 */
export async function renderGelatoMockup(
  { shop, mapping, artworkUrl, backgroundUrl = "", textValues = {} },
  deps = {},
) {
  const {
    request = gelato,
    fetchImpl = fetch,
    store = storeAsset,
    now = () => Date.now(),
    wait = sleep,
    timeoutMs = RENDER_TIMEOUT_MS,
  } = deps;

  const startedAt = now();
  const templateId = toTrimmedString(mapping?.gelatoTemplateId);

  if (!templateId) {
    return {
      ok: false,
      code: "NOT_CONFIGURED",
      error: "This design has no Gelato template to preview.",
      durationMs: 0,
    };
  }

  if (!toTrimmedString(artworkUrl)) {
    return {
      ok: false,
      code: "NO_ARTWORK",
      error: "Generate your artwork before previewing it on the product.",
      durationMs: 0,
    };
  }

  // Gelato downloads the artwork itself. If this app cannot fetch its own
  // signed URL then neither can Gelato, and the only symptom would be a
  // 25 second wait ending in "took too long" — which tells the customer
  // nothing and sends us looking in the wrong place.
  //
  // The usual cause in development is the tunnel: no SHOPIFY_APP_URL, or an
  // address that has rotated since the app started.
  try {
    const probe = await fetchImpl(artworkUrl, { method: "GET" });

    if (!probe.ok && probe.status >= 400 && probe.status < 500) {
      return {
        ok: false,
        code: "ARTWORK_UNREACHABLE",
        error: "Your artwork could not be reached for the preview. Please try again.",
        detail: `the artwork URL answered ${probe.status}`,
        durationMs: now() - startedAt,
      };
    }
  } catch (error) {
    console.warn("[mockup] probe warning:", error.message);
  }

  let productId = "";

  try {
    const template = await request(`/templates/${encodeURIComponent(templateId)}`);
    const variant = pickTemplateVariant(template, mapping);

    if (!variant) {
      return {
        ok: false,
        code: "NOT_CONFIGURED",
        error: "This design is not ready to preview yet.",
        durationMs: now() - startedAt,
      };
    }

    const created = await request(
      `/stores/${encodeURIComponent(getGelatoConfig().storeId)}/products:create-from-template`,
      {
        method: "POST",
        body: JSON.stringify({
          templateId,
          // Marked clearly so anything left behind by a failed clean-up is
          // recognisable in the merchant's Gelato store.
          title: `MagikToon preview — do not publish (${shop})`,
          description: "Temporary product used to render a customer preview.",
          isVisibleInTheOnlineStore: false,
          salesChannels: [],
          tags: ["magiktoon-preview"],
          variants: [
            {
              templateVariantId: variant.templateVariantId || variant.id,
              imagePlaceholders: buildImagePlaceholders(
                variant,
                mapping,
                artworkUrl,
                backgroundUrl,
              ),
              textPlaceholders: buildTextPlaceholders(variant, mapping, textValues),
            },
          ],
        }),
      },
    );

    productId = toTrimmedString(
      created?.id ||
      created?.productId ||
      created?.product?.id ||
      created?.uid ||
      created?.data?.id,
    );

    if (!productId) {
      console.error("[mockup] Gelato create-from-template failed to return an id. Response:", created);
      return {
        ok: false,
        code: "PREVIEW_FAILED",
        error: "The preview could not be created. Please try again.",
        durationMs: now() - startedAt,
      };
    }

    // Gelato renders asynchronously; the preview appears on the product a few
    // seconds after it is created.
    let previewUrl =
      toTrimmedString(created?.previewUrl) ||
      toTrimmedString(created?.preview_url) ||
      toTrimmedString(asArray(created?.productImages)[0]?.fileUrl) ||
      toTrimmedString(asArray(created?.productImages)[0]?.url);

    while (!previewUrl && now() - startedAt < timeoutMs) {
      await wait(POLL_INTERVAL_MS);

      const product = await request(
        `/stores/${encodeURIComponent(getGelatoConfig().storeId)}/products/${productId}`,
      );

      const images = asArray(product?.productImages || product?.images);
      previewUrl =
        toTrimmedString(product?.previewUrl) ||
        toTrimmedString(product?.preview_url) ||
        toTrimmedString(images[0]?.fileUrl) ||
        toTrimmedString(images[0]?.url) ||
        toTrimmedString(images.find((img) => img?.fileUrl || img?.url)?.fileUrl) ||
        toTrimmedString(images.find((img) => img?.fileUrl || img?.url)?.url) ||
        toTrimmedString(asArray(product?.variants || product?.productVariants)[0]?.previewUrl);

      if (previewUrl) break;

      // Gelato reports a failure several seconds before our timeout would fire.
      // Waiting it out turns a known, explicable failure into "took too long".
      const status = toTrimmedString(product?.status).toLowerCase();

      if (FAILED_STATUSES.has(status)) {
        const reasons = asArray(product?.publishingErrors)
          .map((entry) => toTrimmedString(entry?.message) || toTrimmedString(entry))
          .filter(Boolean);

        return {
          ok: false,
          code: "PREVIEW_FAILED",
          error: "The preview could not be generated. Please try again.",
          detail: reasons.length ? reasons.join("; ") : `Gelato reported "${status}"`,
          durationMs: now() - startedAt,
        };
      }
    }

    if (!previewUrl) {
      return {
        ok: false,
        code: "TIMED_OUT",
        error: "The preview took too long to generate. Please try again.",
        durationMs: now() - startedAt,
      };
    }

    // Copied out of Gelato immediately: their link is presigned for 24 hours
    // and dies with the product we are about to delete.
    const response = await fetchImpl(previewUrl);

    if (!response.ok) {
      return {
        ok: false,
        code: "PREVIEW_FAILED",
        error: "The preview could not be loaded. Please try again.",
        durationMs: now() - startedAt,
      };
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    const mimeType = response.headers?.get?.("content-type") || "image/jpeg";

    const key = await store(buffer, {
      mimeType: mimeType.includes("png") ? "image/png" : "image/jpeg",
      prefix: `mockups/${toTrimmedString(shop).replace(/[^a-zA-Z0-9_-]/g, "_")}`,
    });

    return { ok: true, key, mimeType, durationMs: now() - startedAt };
  } catch (error) {
    console.error("[mockup] failed:", error?.message);

    return {
      ok: false,
      code: "PREVIEW_FAILED",
      error: "Preview generation failed. Please try again.",
      durationMs: now() - startedAt,
    };
  } finally {
    if (productId) {
      await deleteMockupProduct(productId, { request });
    }
  }
}

/**
 * Should the throwaway product be removed after its mockup is copied out?
 *
 * Deleting is the default, and deliberately so: this runs once per customer
 * preview, so keeping them would add a product to the merchant's Gelato store
 * every time anybody clicks the button. `GELATO_DELETE_AFTER_MOCKUP=false` is
 * an explicit opt-out for debugging a render, not a setting to leave on.
 *
 * Note this reads the variable directly rather than through `getGelatoConfig`,
 * whose default is off — that default predates this flow and would silently
 * turn "clean up after yourself" into "never clean up".
 */
export function shouldDeleteMockupProduct(env = process.env) {
  const raw = env.GELATO_DELETE_AFTER_MOCKUP;

  if (raw === undefined || raw === null || raw === "") return true;

  return String(raw).trim().toLowerCase() !== "false";
}

/**
 * Remove the throwaway product a mockup was rendered from.
 */
export async function deleteMockupProduct(productId, { request = gelato } = {}) {
  const id = toTrimmedString(productId);

  if (!id) return { ok: true, deleted: false };

  if (!shouldDeleteMockupProduct()) {
    console.warn(
      "[mockup] GELATO_DELETE_AFTER_MOCKUP is off, so preview product " +
        `${id} is being kept. One product per customer preview will build up ` +
        "in the Gelato store.",
    );

    return { ok: true, deleted: false };
  }

  try {
    await request(
      `/stores/${encodeURIComponent(getGelatoConfig().storeId)}/products/${id}`,
      { method: "DELETE" },
    );

    return { ok: true, deleted: true };
  } catch (error) {
    // A leftover product is untidy, not broken: the customer already has their
    // mockup, so this must never turn a good preview into a failure.
    console.error("[mockup] could not delete preview product", id, error?.message);

    return { ok: false, deleted: false };
  }
}
