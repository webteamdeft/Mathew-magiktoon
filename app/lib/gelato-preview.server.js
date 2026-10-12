/**
 * Stable image URLs for Gelato template previews.
 *
 * WHY THIS EXISTS
 * ---------------
 * Gelato's E-commerce API hands back **presigned S3 URLs** carrying
 * `X-Amz-Expires=86400`. Persisting one as a product's preview looks fine for a
 * day and then returns HTTP 403 forever after — the storefront silently shows a
 * broken image, with nothing in any log to explain it.
 *
 * So the storefront is never given the S3 URL. It is given a stable path on the
 * shop's own domain, and this module re-resolves the real URL from Gelato
 * behind it, caching the result well inside the signature's lifetime.
 *
 * SERVER ONLY — reads `GELATO_API_KEY` by way of the catalog client.
 */

import {
  getGelatoStoreProduct,
  listGelatoStoreProducts,
  tryGetGelatoTemplateDetail,
} from "./gelato-catalog.server.js";
import { asArray, toTrimmedString } from "./normalize.js";

/**
 * How long a resolved URL is reused.
 *
 * Gelato signs for 24 hours; six is a wide margin against clock skew and
 * against a cached entry being handed out moments before it expires.
 */
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

/** How long the browser may cache the image bytes. */
export const IMAGE_CACHE_SECONDS = 3600;

/** cacheKey -> { urls: string[], expiresAt } */
const cache = new Map();

/**
 * What a mapping's images actually depend on.
 *
 * Keyed on the mapping id ALONE, this cache served the previous template's
 * images for six hours after a merchant changed the template — in the admin and
 * on the storefront alike, with no way to force a refresh. The Gelato source
 * ids are part of the key so that changing either one is simply a different
 * entry, and the new images appear immediately.
 */
export function previewCacheKey(mapping) {
  return [
    toTrimmedString(mapping?.id),
    toTrimmedString(mapping?.gelatoTemplateId),
    toTrimmedString(mapping?.gelatoProductId),
  ].join("|");
}

/**
 * Forget everything cached for one mapping, whatever it used to point at.
 *
 * Called when a mapping is saved. The key above already prevents a stale hit,
 * but this also stops entries for templates the merchant has moved away from
 * sitting in memory until they expire.
 */
export function forgetMappingPreview(mappingId) {
  const id = toTrimmedString(mappingId);

  if (!id) return;

  for (const key of cache.keys()) {
    if (key.split("|")[0] === id) {
      cache.delete(key);
    }
  }
}

/** The store catalog, cached: it is one call for up to a hundred products. */
let catalogCache = null;

/**
 * The Gelato store product published for a Shopify product, if any.
 *
 * A *template* holds one preview image. The mockup gallery a merchant builds in
 * Gelato's product wizard is attached to the STORE PRODUCT that wizard
 * publishes — so a mapping made from a template id alone cannot see it. Gelato
 * stamps the Shopify product id onto `externalId` when it publishes, which is
 * the only reliable link back, and it appears the moment the wizard finishes.
 */
async function findStoreProductFor(mapping, { now = Date.now } = {}) {
  const wanted = toTrimmedString(mapping?.shopifyProductNumericId);
  const templateName = toTrimmedString(mapping?.gelatoTemplateName).toLowerCase();

  if (!wanted && !templateName) {
    return null;
  }

  if (!catalogCache || catalogCache.expiresAt <= now()) {
    try {
      const result = await listGelatoStoreProducts({ offset: 0, limit: 100 });

      catalogCache = {
        items: asArray(result?.items),
        expiresAt: now() + CACHE_TTL_MS,
      };
    } catch (error) {
      console.error("[gelato-preview] catalog lookup failed:", error);
      return null;
    }
  }

  // Preferred link: Gelato stamps the Shopify product id onto `externalId`
  // when it publishes to a connected store.
  const byExternalId = catalogCache.items.find(
    (product) => toTrimmedString(product.externalId) === wanted,
  );

  if (byExternalId) {
    return byExternalId;
  }

  // Fallback: match the template's name to a store product's title. Needed
  // whenever the Gelato store is connected to a DIFFERENT Shopify store than
  // the one being mapped, in which case no externalId can ever match — which is
  // the case here, and would otherwise leave every design with one image.
  if (!templateName) {
    return null;
  }

  return (
    catalogCache.items.find(
      (product) => toTrimmedString(product.title).toLowerCase() === templateName,
    ) || null
  );
}

/** Test seam: drop everything currently cached. */
export function clearPreviewCache() {
  cache.clear();
  catalogCache = null;
}

/**
 * The current Gelato preview URL for a mapping, freshly signed.
 *
 * Falls back through the template, then the store product, then whatever was
 * stored at mapping time — the last of which may well be expired, but a stale
 * attempt beats no image at all.
 */
/**
 * Every image Gelato has for a mapping, freshly signed, best first.
 *
 * A *template* exposes exactly one preview image. A *store product* additionally
 * carries `productImages` — the mockup gallery, several shots of the same
 * design — which is the only place more than one image is available. Mappings
 * created from a template id alone therefore have one image, and that is a
 * limit of the Gelato API rather than of this code.
 */
export async function resolveTemplateImages(
  mapping,
  {
    now = Date.now,
    // Injected so the gallery ordering can be tested without the live API.
    loadStoreProduct = getGelatoStoreProduct,
    findStoreProduct = findStoreProductFor,
    loadTemplateDetail = tryGetGelatoTemplateDetail,
  } = {},
) {
  if (!mapping) {
    return [];
  }

  const key = previewCacheKey(mapping);
  const cached = cache.get(key);

  if (cached && cached.expiresAt > now()) {
    return cached.urls;
  }

  const urls = [];
  const seen = new Set();

  const add = (value) => {
    const url = toTrimmedString(value);

    if (!url) return;

    // Signatures differ run to run; the path identifies the file.
    const key = url.split("?")[0];

    if (seen.has(key)) return;

    seen.add(key);
    urls.push(url);
  };

  // The mapping's own store product, when it has one.
  let storeProductId = toTrimmedString(mapping.gelatoProductId);

  // Otherwise, the store product Gelato published for this Shopify product.
  // This is what makes a template-only mapping gain its mockup gallery as soon
  // as the merchant finishes Gelato's product wizard — no re-mapping needed.
  if (!storeProductId) {
    const published = await findStoreProduct(mapping);

    storeProductId = toTrimmedString(published?.id);
  }

  if (storeProductId) {
    try {
      const product = await loadStoreProduct(storeProductId);

      // The normalised shape from `getGelatoStoreProduct`, NOT Gelato's raw
      // JSON: `normalizeGelatoStoreProduct` has already mapped
      // `productImages[].fileUrl` onto `images[].url`, dropped entries with no
      // file, and sorted the primary shot first. Reading the raw field names
      // here finds nothing.
      for (const image of asArray(product?.images)) {
        add(image.url);
      }

      add(product?.previewUrl);
    } catch (error) {
      console.error("[gelato-preview] store product lookup failed:", error);
    }
  }

  const templateId = toTrimmedString(mapping.gelatoTemplateId);

  // FALLBACK ONLY, and the ordering matters.
  //
  // A template's own previewUrl is a render of the design as its author made
  // it: the designer's sample artwork, and whichever colourway they happened to
  // build on. Appended to a gallery that already holds this product's own
  // shots, it lands at the END of the thumbnail strip looking like a picture of
  // a different item — which is exactly how it was reported.
  //
  // It is still worth having when there is nothing else, because a design
  // mapped from a template id alone has no store product and no gallery.
  if (urls.length === 0 && templateId) {
    const detail = await loadTemplateDetail(templateId);
    add(detail.template?.previewUrl);
  }

  if (urls.length === 0) {
    // Nothing fresher available; the stored URL is the last resort.
    add(mapping.gelatoPreviewUrl);
    return urls;
  }

  cache.set(key, { urls, expiresAt: now() + CACHE_TTL_MS });

  return urls;
}

/** The single best image for a mapping. */
export async function resolveTemplatePreviewUrl(mapping, options) {
  const urls = await resolveTemplateImages(mapping, options);

  return urls[0] || "";
}

/**
 * Fetch the preview image itself.
 *
 * The bytes are streamed back rather than redirected to, so the storefront
 * never sees a presigned URL that could be shared and then die. A 403 from a
 * cached-but-expired signature retries once against a freshly resolved URL.
 */
export async function fetchTemplatePreview(
  mapping,
  { fetchImpl = fetch, index = 0 } = {},
) {
  let urls = await resolveTemplateImages(mapping);
  let url = urls[index] || urls[0];

  if (!url) {
    return { ok: false, status: 404, error: "This design has no preview image." };
  }

  let response = await fetchImpl(url);

  if (response.status === 403 || response.status === 401) {
    // The signature died between resolving and using it.
    cache.delete(mapping.id);
    urls = await resolveTemplateImages(mapping);
    url = urls[index] || urls[0];
    response = await fetchImpl(url);
  }

  if (!response.ok) {
    return {
      ok: false,
      status: 502,
      error: `Gelato returned ${response.status} for the preview image.`,
    };
  }

  return {
    ok: true,
    body: response.body,
    contentType: response.headers.get("content-type") || "image/png",
  };
}
