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
import sharp from "sharp";
import { asArray, toTrimmedString } from "./normalize.js";

/**
 * How long a resolved URL is reused.
 *
 * Gelato signs for 24 hours; six is a wide margin against clock skew and
 * against a cached entry being handed out moments before it expires.
 */
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

/**
 * How long a result WITHOUT the product's own gallery is reused.
 *
 * A design created moments ago has no gallery yet: its Gelato store product is
 * still being published, or Gelato has not finished rendering its mockups. The
 * template preview stands in, but caching that stand-in for six hours kept a
 * brand-new product showing one wrong image — or none — long after its real
 * gallery existed. A minute is short enough that the gallery appears on the
 * next visit, and long enough that a busy page does not hammer Gelato.
 */
const FALLBACK_TTL_MS = 60 * 1000;

/**
 * How stale the store catalog may be before a design that is NOT in it forces
 * a re-read.
 *
 * The catalog is otherwise kept for six hours, which is fine for designs it
 * already contains. A product published after it was read was invisible for
 * the rest of those six hours.
 */
const CATALOG_MISS_REFRESH_MS = 60 * 1000;

/** How long the browser may cache the image bytes. */
export const IMAGE_CACHE_SECONDS = 3600;

/** cacheKey -> { urls: string[], expiresAt } */
const cache = new Map();

/**
 * Image bytes, so a thumbnail is not re-downloaded from Gelato on every view.
 *
 * Keyed on the URL's path (which identifies the file; the signature changes
 * run to run) plus the requested width. Bounded: the oldest entry is dropped
 * once the limit is reached.
 */
const imageCache = new Map();
const IMAGE_CACHE_LIMIT = 200;

/**
 * Widths a caller may ask for. Snapping to a few sizes keeps the byte cache
 * from filling with one entry per arbitrary `?w=` value.
 */
const IMAGE_WIDTHS = [160, 240, 320, 480, 640, 1024];

/**
 * What a mapping's images actually depend on.
 *
 * Keyed on the mapping id ALONE, this cache served the previous template's
 * images for six hours after a merchant changed the template — in the admin and
 * on the storefront alike, with no way to force a refresh. The Gelato source
 * ids are part of the key so that changing either one is simply a different
 * entry, and the new images appear immediately.
 */
export function previewCacheKey(mapping, variantId = "") {
  return [
    toTrimmedString(mapping?.id),
    toTrimmedString(mapping?.gelatoTemplateId),
    toTrimmedString(mapping?.gelatoProductId),
    // Each variant now resolves to its own gallery, so they cannot share an
    // entry: without this the first colourway asked for would be served to
    // every other one until the entry expired.
    toTrimmedString(variantId),
  ].join("|");
}

/**
 * The gallery shots that belong to one Shopify variant.
 *
 * Gelato returns every colourway's photos in a single flat list and marks each
 * with the variant(s) it was shot for. A shot carrying no variant at all was
 * attached to the product as a whole, so it is kept for every variant — that
 * is also what preserves the extra angles a merchant uploads once rather than
 * per colour.
 *
 * An unknown variant, or one with no shots of its own, keeps the whole gallery
 * rather than returning nothing: a wrong-coloured preview is poor, but no
 * preview at all is worse.
 */
export function imagesForVariant(images, variants, variantId) {
  const wanted = toTrimmedString(variantId);

  if (!wanted) return images;

  const variant = asArray(variants).find(
    (candidate) => toTrimmedString(candidate?.externalId) === wanted,
  );

  if (!variant?.id) return images;

  const matching = asArray(images).filter((image) => {
    const ids = asArray(image?.variantIds);

    return ids.length === 0 || ids.includes(variant.id);
  });

  // Every shot is attributed, and none of them to this variant.
  return matching.length > 0 ? matching : images;
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

  const match = () => {
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
    // the one being mapped, in which case no externalId can ever match — which
    // is the case here, and would otherwise leave every design with one image.
    if (!templateName) {
      return null;
    }

    return (
      catalogCache.items.find(
        (product) => toTrimmedString(product.title).toLowerCase() === templateName,
      ) || null
    );
  };

  if (!catalogCache || catalogCache.expiresAt <= now()) {
    if (!(await refreshCatalog({ now }))) return null;
  }

  const found = match();

  if (found) {
    return found;
  }

  // Not in the catalog we hold. If that copy is more than a minute old, the
  // product may simply have been published since — the usual case for a design
  // created just now — so read it again once before giving up.
  if (now() - catalogCache.fetchedAt > CATALOG_MISS_REFRESH_MS) {
    if (await refreshCatalog({ now })) {
      return match();
    }
  }

  return null;
}

/** One catalog read at a time, however many designs ask at once. */
let catalogRequest = null;

async function refreshCatalog({ now }) {
  if (!catalogRequest) {
    catalogRequest = listGelatoStoreProducts({ offset: 0, limit: 100 })
      .then((result) => {
        catalogCache = {
          items: asArray(result?.items),
          fetchedAt: now(),
          expiresAt: now() + CACHE_TTL_MS,
        };
        return true;
      })
      .catch((error) => {
        console.error("[gelato-preview] catalog lookup failed:", error);
        return false;
      })
      .finally(() => {
        catalogRequest = null;
      });
  }

  // A failed re-read keeps the previous copy, so a Gelato hiccup never makes
  // designs that were already found lose their gallery.
  return (await catalogRequest) || Boolean(catalogCache);
}

/** Test seam: drop everything currently cached. */
export function clearPreviewCache() {
  cache.clear();
  imageCache.clear();
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
    // The Shopify variant the shopper is actually buying. Supplied, the
    // gallery is narrowed to that colourway; omitted, the whole gallery is
    // used exactly as before.
    variantId = "",
    // Injected so the gallery ordering can be tested without the live API.
    loadStoreProduct = getGelatoStoreProduct,
    findStoreProduct = findStoreProductFor,
    loadTemplateDetail = tryGetGelatoTemplateDetail,
  } = {},
) {
  if (!mapping) {
    return [];
  }

  const key = previewCacheKey(mapping, variantId);
  const cached = cache.get(key);

  if (cached && cached.expiresAt > now()) {
    return cached.urls;
  }

  const urls = [];
  const seen = new Set();

  // Whether the product's own mockup gallery was found. Only that is cached for
  // the full lifetime; anything less is a stand-in for a design whose gallery
  // may appear any moment (see FALLBACK_TTL_MS).
  let hasGallery = false;

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
      for (const image of imagesForVariant(
        asArray(product?.images),
        product?.variants,
        variantId,
      )) {
        add(image.url);
      }

      hasGallery = urls.length > 0;

      // The product's own preview is a render of whichever colourway Gelato
      // made primary. Appending it to a gallery that has already been narrowed
      // to the shopper's variant puts the wrong colour back in the strip, so
      // it stays a fallback for when the narrowing found nothing.
      if (!(variantId && hasGallery)) {
        add(product?.previewUrl);
      }
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

  cache.set(key, {
    urls,
    expiresAt: now() + (hasGallery ? CACHE_TTL_MS : FALLBACK_TTL_MS),
  });

  return urls;
}

/** The single best image for a mapping. */
export async function resolveTemplatePreviewUrl(mapping, options) {
  const urls = await resolveTemplateImages(mapping, options);

  return urls[0] || "";
}

/**
 * The nearest allowed width at or above the one asked for, or 0 for "the
 * original". Anything unparseable is the original, as before `?w=` existed.
 */
export function snapImageWidth(value) {
  const wanted = Number(value);

  if (!Number.isFinite(wanted) || wanted <= 0) return 0;

  return (
    IMAGE_WIDTHS.find((width) => width >= wanted) ||
    IMAGE_WIDTHS[IMAGE_WIDTHS.length - 1]
  );
}

function rememberImage(key, entry) {
  if (imageCache.size >= IMAGE_CACHE_LIMIT) {
    imageCache.delete(imageCache.keys().next().value);
  }

  imageCache.set(key, entry);
}

/**
 * Fetch the preview image itself.
 *
 * The bytes are served back rather than redirected to, so the storefront
 * never sees a presigned URL that could be shared and then die. A 403 from a
 * cached-but-expired signature retries once against a freshly resolved URL.
 *
 * `width` asks for a scaled-down copy, for thumbnails: Gelato's originals are
 * 2048px, which made a strip of small tiles download megabytes. Either way the
 * bytes are kept in memory, so repeat views do not wait on Gelato again.
 */
export async function fetchTemplatePreview(
  mapping,
  { fetchImpl = fetch, index = 0, width = 0, now = Date.now } = {},
) {
  let urls = await resolveTemplateImages(mapping);
  let url = urls[index] || urls[0];

  if (!url) {
    return { ok: false, status: 404, error: "This design has no preview image." };
  }

  const size = snapImageWidth(width);
  const cacheKeyFor = (value) => `${value.split("?")[0]}|${size}`;

  const cached = imageCache.get(cacheKeyFor(url));

  if (cached && cached.expiresAt > now()) {
    return { ok: true, body: cached.body, contentType: cached.contentType };
  }

  let response = await fetchImpl(url);

  if (response.status === 403 || response.status === 401) {
    // The signature died between resolving and using it. The cache is keyed by
    // `previewCacheKey`, not the bare id — deleting by id cleared nothing, so
    // the retry reused the same dead URL and the image came back blank.
    cache.delete(previewCacheKey(mapping));
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

  let body = Buffer.from(await response.arrayBuffer());
  let contentType = response.headers.get("content-type") || "image/png";

  if (size > 0) {
    try {
      body = await sharp(body)
        .resize({ width: size, withoutEnlargement: true })
        .jpeg({ quality: 82 })
        .toBuffer();
      contentType = "image/jpeg";
    } catch (error) {
      // An image sharp cannot read is still worth showing at full size.
      console.error("[gelato-preview] thumbnail resize failed:", error);
    }
  }

  rememberImage(cacheKeyFor(url), {
    body,
    contentType,
    expiresAt: now() + CACHE_TTL_MS,
  });

  return { ok: true, body, contentType };
}
