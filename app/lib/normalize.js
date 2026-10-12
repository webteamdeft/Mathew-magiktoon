/**
 * Client-safe normalization helpers.
 *
 * This module must never import anything server-only: it is used by Polaris
 * components, by loaders, and by `.server` helpers alike.
 */

/**
 * Coerce any external API payload into an array before calling `.map()`.
 *
 * Gelato, Shopify and our own proxy routes each wrap collections differently
 * (`items`, `products`, `data`, `nodes`, `edges`). Anything we cannot
 * recognise becomes an empty array rather than throwing.
 */
export function asArray(value) {
  if (Array.isArray(value)) {
    return value;
  }

  if (value && typeof value === "object") {
    if (Array.isArray(value.items)) return value.items;
    if (Array.isArray(value.products)) return value.products;
    if (Array.isArray(value.templates)) return value.templates;
    if (Array.isArray(value.variants)) return value.variants;
    if (Array.isArray(value.data)) return value.data;
    if (Array.isArray(value.results)) return value.results;
    if (Array.isArray(value.nodes)) return value.nodes;

    if (Array.isArray(value.edges)) {
      return value.edges
        .map((edge) => edge?.node)
        .filter(Boolean);
    }
  }

  return [];
}

/** First non-empty string in the list, otherwise `""`. */
export function firstString(...candidates) {
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }

    if (typeof candidate === "number" && Number.isFinite(candidate)) {
      return String(candidate);
    }
  }

  return "";
}

/** Trim any value into a string, tolerating null/undefined/numbers. */
export function toTrimmedString(value) {
  if (value === null || value === undefined) {
    return "";
  }

  return String(value).trim();
}

/**
 * Extract the numeric part of a Shopify GID.
 *
 * `gid://shopify/Product/1234` -> `"1234"`, `"1234"` -> `"1234"`.
 */
export function toNumericShopifyId(value) {
  const raw = toTrimmedString(value);

  if (!raw) {
    return "";
  }

  const parts = raw.split("/");
  const last = parts[parts.length - 1];

  return /^\d+$/.test(last) ? last : "";
}

/** Build a Shopify GID from a numeric id, passing through existing GIDs. */
export function toShopifyGid(resource, value) {
  const raw = toTrimmedString(value);

  if (!raw) {
    return "";
  }

  if (raw.startsWith("gid://")) {
    return raw;
  }

  return `gid://shopify/${resource}/${raw}`;
}

/** Clamp a number into a range, falling back to `fallback` when unusable. */
export function clampNumber(value, min, max, fallback) {
  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.min(Math.max(parsed, min), max);
}
