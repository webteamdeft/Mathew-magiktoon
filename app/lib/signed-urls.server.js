/**
 * Secure, non-guessable, temporary asset URLs (NFR-09).
 *
 * Storage keys are random UUIDs, but an unsigned `/uploads/<uuid>` path never
 * expires — anyone who ever saw it keeps access forever. Every asset URL we
 * hand out is therefore HMAC-signed and carries an expiry.
 *
 * IMPORTANT: only the storage *key* is persisted, never a signed URL. URLs are
 * minted at the moment they are needed:
 *   - short-lived for the storefront and the admin preview,
 *   - long-lived at the moment an order is submitted to Gelato, so that a
 *     paid order held in review for days still has fetchable artwork.
 *
 * SERVER ONLY.
 */

import crypto from "node:crypto";

import { toTrimmedString } from "./normalize.js";

/** Default lifetime for a storefront/admin preview URL. */
export const DEFAULT_TTL_MS = 60 * 60 * 1000;

/**
 * Lifetime for URLs handed to Gelato.
 *
 * Gelato downloads the artwork asynchronously during production, which can be
 * well after submission, so these are deliberately long-lived.
 */
export const FULFILMENT_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function getSecret() {
  const secret = toTrimmedString(process.env.ARTWORK_SIGNING_SECRET);

  if (!secret) {
    throw new Error("ARTWORK_SIGNING_SECRET is missing");
  }

  return secret;
}

/** Configured default TTL, falling back to one hour. */
export function getConfiguredTtlMs() {
  const raw = Number(process.env.ARTWORK_URL_TTL_MS);

  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_TTL_MS;
}

/** Normalize a storage key to the exact form that gets signed. */
export function normalizeKey(key) {
  return toTrimmedString(key).replace(/\\/g, "/").replace(/^\/+/, "");
}

/** The HMAC over `key` and `expiresAt`. */
export function computeSignature(key, expiresAt) {
  return crypto
    .createHmac("sha256", getSecret())
    .update(`${normalizeKey(key)}:${expiresAt}`)
    .digest("base64url");
}

/**
 * Build a signed, expiring path for a stored asset.
 *
 * @param {string} key      Storage key returned by `storeAsset`.
 * @param {object} [options]
 * @param {number} [options.ttlMs]
 * @param {number} [options.now]  Injectable clock, for tests.
 * @returns {string} e.g. `/uploads/artwork/shop/id.png?exp=…&sig=…`
 */
export function buildSignedAssetPath(key, { ttlMs, now = Date.now() } = {}) {
  const normalized = normalizeKey(key);

  if (!normalized) {
    throw new Error("A storage key is required");
  }

  const lifetime =
    Number.isFinite(ttlMs) && ttlMs > 0 ? ttlMs : getConfiguredTtlMs();

  const expiresAt = now + lifetime;
  const signature = computeSignature(normalized, expiresAt);

  const encodedKey = normalized
    .split("/")
    .map(encodeURIComponent)
    .join("/");

  return (
    `/uploads/${encodedKey}` +
    `?exp=${expiresAt}&sig=${encodeURIComponent(signature)}`
  );
}

/**
 * Verify a signed asset request.
 *
 * Uses a timing-safe comparison so the signature cannot be probed byte by byte.
 *
 * @returns {{ ok: boolean, reason?: "missing"|"expired"|"invalid" }}
 */
export function verifySignedAsset(key, expiresAt, signature, { now = Date.now() } = {}) {
  const normalized = normalizeKey(key);
  const expiry = Number(expiresAt);
  const provided = toTrimmedString(signature);

  if (!normalized || !provided || !Number.isFinite(expiry)) {
    return { ok: false, reason: "missing" };
  }

  if (expiry < now) {
    return { ok: false, reason: "expired" };
  }

  const expected = computeSignature(normalized, expiry);

  const expectedBuffer = Buffer.from(expected);
  const providedBuffer = Buffer.from(provided);

  if (expectedBuffer.length !== providedBuffer.length) {
    return { ok: false, reason: "invalid" };
  }

  if (!crypto.timingSafeEqual(expectedBuffer, providedBuffer)) {
    return { ok: false, reason: "invalid" };
  }

  return { ok: true };
}

/**
 * Absolute signed URL for an asset.
 *
 * Gelato and the storefront both need a fully qualified URL, never a path.
 */
export function buildSignedAssetUrl(
  key,
  { ttlMs, baseUrl, now, requireAbsolute = false } = {},
) {
  const path = buildSignedAssetPath(key, { ttlMs, now });

  const base =
    toTrimmedString(baseUrl) || toTrimmedString(process.env.SHOPIFY_APP_URL);

  let absolute = "";

  if (base) {
    try {
      absolute = new URL(path, base).toString();
    } catch {
      absolute = "";
    }
  }

  // A relative path is fine for a browser already on this origin, but useless
  // to a third party that has to fetch the file itself. Gelato downloads the
  // artwork, so handing it "/uploads/..." produces an order that either fails
  // or prints nothing — with no obvious cause. Callers that need a fetchable
  // URL ask for one, and get a loud error rather than a silent relative path.
  if (requireAbsolute && !absolute) {
    throw new Error(
      "An absolute asset URL was required, but no base URL is available. " +
        "Set SHOPIFY_APP_URL, or pass baseUrl explicitly.",
    );
  }

  return absolute || path;
}
