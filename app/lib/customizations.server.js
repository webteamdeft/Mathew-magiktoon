/**
 * Customer customization store: the uploaded photo and its preview, addressed
 * later by the cart line and the fulfilment webhook.
 *
 * PLACEMENT MODEL
 * ---------------
 * The approved Milestone 1 design puts the customer in control of placement:
 * "Adjust your artwork on the product - drag to move, use +/- to zoom." So we
 * persist the offset and zoom they chose, normalized against the print area.
 *
 * There is no rotation: the design offers move and zoom only.
 *
 * Values are fractions of the print area, so the same numbers describe the
 * artwork at preview size and at print resolution.
 *
 * URLS (NFR-09)
 * -------------
 * Only storage *keys* are persisted. Every URL is HMAC-signed with an expiry
 * and minted on demand — see `signed-urls.server.js`.
 *
 * SERVER ONLY.
 */

import prisma from "../db.server.js";
import { storeAsset } from "./storage.server.js";
import {
  buildLineItemProperties,
  normalizePersonalizationText,
} from "./customization-properties.js";
import {
  FULFILMENT_TTL_MS,
  buildSignedAssetUrl,
} from "./signed-urls.server.js";
import { toTrimmedString } from "./normalize.js";
import { buildConfigSnapshot } from "./config-snapshot.js";

/** The approved design states "up to 30MB". */
const MAX_UPLOAD_BYTES = 30 * 1024 * 1024;

/** The approved design states "JPEG or PNG". */
const ALLOWED_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/jpg"]);

/**
 * How many generations the accepted artwork took.
 *
 * Client-supplied, so it is bounded rather than trusted: the figure feeds the
 * cost report, and an inflated one would quietly overstate what a design cost.
 */
function normalizeGenerationCount(value) {
  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed <= 0) return 0;

  return Math.min(Math.floor(parsed), 100);
}

/** Clamp a number into a range, falling back when unusable. */
function clampNumber(value, min, max, fallback) {
  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.min(Math.max(parsed, min), max);
}

/**
 * Record of where the customer positioned their artwork.
 *
 * `x`/`y` are the artwork centre as a fraction of the print area; `zoom` is a
 * multiplier over the "fit inside the print area" baseline. Defaults are dead
 * centre at 1× — exactly what the editor opens with.
 */
export function buildPlacementRecord(mapping, rawPlacement) {
  let placement = rawPlacement;

  if (typeof placement === "string") {
    try {
      placement = JSON.parse(placement);
    } catch {
      placement = null;
    }
  }

  if (!placement || typeof placement !== "object") {
    placement = {};
  }

  return {
    mode: "customer-placed",
    placeholder: toTrimmedString(mapping?.gelatoPlaceholderName) || "ImageFront",
    printArea: toTrimmedString(mapping?.gelatoPrintAreaName) || "front",
    x: clampNumber(placement.x, -1, 2, 0.5),
    y: clampNumber(placement.y, -1, 2, 0.5),
    zoom: clampNumber(placement.zoom, 0.2, 5, 1),
  };
}

/** Decode a `data:image/...;base64,...` URL into a buffer + mime type. */
export function decodeDataUrl(dataUrl) {
  const raw = toTrimmedString(dataUrl);
  const match = /^data:([a-z0-9.+/-]+);base64,(.+)$/i.exec(raw);

  if (!match) {
    return { ok: false, error: "The image must be a base64 data URL." };
  }

  const mimeType = match[1].toLowerCase();

  if (!ALLOWED_MIME_TYPES.has(mimeType)) {
    return { ok: false, error: "Only PNG, JPEG and WebP images are supported." };
  }

  const buffer = Buffer.from(match[2], "base64");

  if (buffer.length === 0) {
    return { ok: false, error: "The uploaded image is empty." };
  }

  if (buffer.length > MAX_UPLOAD_BYTES) {
    return { ok: false, error: "Images must be 15MB or smaller." };
  }

  return { ok: true, buffer, mimeType };
}

/** Persist one image and return its storage key. No URL is produced here. */
export async function storeImage(dataUrl, { shop, prefix }) {
  const decoded = decodeDataUrl(dataUrl);

  if (!decoded.ok) {
    return decoded;
  }

  const shopSlug = toTrimmedString(shop).replace(/[^a-zA-Z0-9_-]/g, "_");

  const key = await storeAsset(decoded.buffer, {
    mimeType: decoded.mimeType === "image/jpg" ? "image/jpeg" : decoded.mimeType,
    prefix: `${prefix}/${shopSlug}`,
  });

  return { ok: true, key };
}

/**
 * Save a completed customization and return the cart line properties for it.
 *
 * @param {object} params
 * @param {string} params.shop
 * @param {object} params.mapping        The `ProductMapping` this belongs to.
 * @param {string} params.artworkDataUrl The customer's uploaded photo.
 * @param {string} [params.previewDataUrl] On-product preview for the cart.
 * @param {string} [params.shopifyVariantId]
 * @param {string} [params.requestUrl]   Used to absolutise signed URLs.
 */
export async function saveCustomization({
  shop,
  mapping,
  artworkDataUrl,
  previewDataUrl,
  placement,
  personalizationText,
  shopifyVariantId,
  generationCount,
  // Storage key of the Gelato mockup the customer approved, when one was
  // rendered. Preferred over our own canvas composite as the order's preview:
  // the pending-orders view is meant to show what was actually approved.
  mockupKey,
  requestUrl,
}) {
  if (!shop) {
    return { ok: false, error: "The shop could not be identified." };
  }

  if (!mapping) {
    return { ok: false, error: "This product is not set up for customization." };
  }

  const artwork = await storeImage(artworkDataUrl, { shop, prefix: "artwork" });

  if (!artwork.ok) {
    return artwork;
  }

  // A Gelato mockup, if the customer got as far as Step 4. It is already
  // stored, so unlike the canvas preview there is nothing to upload again.
  const approvedMockupKey = toTrimmedString(mockupKey);

  let previewKey = approvedMockupKey || null;

  if (toTrimmedString(previewDataUrl)) {
    const preview = await storeImage(previewDataUrl, { shop, prefix: "previews" });

    if (preview.ok) {
      // Only when there is no approved mockup: the mockup is what the
      // customer said yes to, and our approximation must not replace it.
      if (!approvedMockupKey) previewKey = preview.key;
    } else {
      // A failed preview must not lose the photo the customer just uploaded.
      console.error("[customizations] preview failed:", preview.error);
    }
  }

  const baseUrl =
    toTrimmedString(process.env.SHOPIFY_APP_URL) || toTrimmedString(requestUrl);

  // Preview links live as long as the retention window, so an order opened in
  // the Shopify admin weeks later still shows what the customer approved.
  const artworkUrl = buildSignedAssetUrl(artwork.key, {
    ttlMs: FULFILMENT_TTL_MS,
    baseUrl,
  });

  const previewUrl = previewKey
    ? buildSignedAssetUrl(previewKey, { ttlMs: FULFILMENT_TTL_MS, baseUrl })
    : toTrimmedString(mapping.gelatoPreviewUrl);

  const customization = await prisma.customization.create({
    data: {
      shop,
      productMappingId: mapping.id,
      shopifyProductId: mapping.shopifyProductId,
      shopifyVariantId:
        toTrimmedString(shopifyVariantId) || mapping.shopifyVariantId || null,
      artworkUrl,
      artworkKey: artwork.key,
      previewUrl: previewUrl || null,
      previewKey,
      placement: buildPlacementRecord(mapping, placement),
      generationCount: normalizeGenerationCount(generationCount),
      // What produced this design, frozen at the moment it was approved. Later
      // admin edits change new orders only, never this one (Milestone 6).
      configSnapshot: buildConfigSnapshot(mapping),
      personalizationText: normalizePersonalizationText(personalizationText),
      gelatoProductId: mapping.gelatoProductId,
      gelatoProductUid: mapping.gelatoProductUid,
      gelatoVariantId: mapping.gelatoVariantId,
      gelatoTemplateId: mapping.gelatoTemplateId,
      gelatoPlaceholderName: mapping.gelatoPlaceholderName,
      gelatoPrintAreaName: mapping.gelatoPrintAreaName,
      status: "COMPLETE",
    },
  });

  return {
    ok: true,
    customization,
    properties: buildLineItemProperties(customization),
  };
}

/** Look one up by id, scoped to the shop. */
export async function getCustomization(shop, id) {
  const customizationId = toTrimmedString(id);

  if (!shop || !customizationId) {
    return null;
  }

  return prisma.customization.findFirst({
    where: { id: customizationId, shop },
    include: { productMapping: true },
  });
}

/**
 * A freshly signed, long-lived artwork URL for handing to Gelato.
 *
 * Re-minted at submission time from the stored key, so an order held in review
 * for days still resolves — the URL persisted at checkout may well have aged
 * out by then.
 */
export function buildFulfilmentArtworkUrl(
  customization,
  { baseUrl, requireAbsolute = true } = {},
) {
  const key = toTrimmedString(customization?.artworkKey);

  if (!key) {
    // Pre-signed-URL records, or artwork supplied only as a cart property.
    return toTrimmedString(customization?.artworkUrl);
  }

  // Gelato fetches this file from its own servers, so it has to be absolute.
  return buildSignedAssetUrl(key, {
    ttlMs: FULFILMENT_TTL_MS,
    baseUrl,
    requireAbsolute,
  });
}
