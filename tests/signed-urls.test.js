import test from "node:test";
import assert from "node:assert/strict";

process.env.ARTWORK_SIGNING_SECRET = "test-signing-secret";
process.env.ARTWORK_URL_TTL_MS = "3600000";

const {
  buildSignedAssetPath,
  buildSignedAssetUrl,
  computeSignature,
  normalizeKey,
  verifySignedAsset,
  FULFILMENT_TTL_MS,
} = await import("../app/lib/signed-urls.server.js");

const NOW = 1_700_000_000_000;
const KEY = "artwork/demo_myshopify_com/abc-123.png";

function parse(path) {
  const url = new URL(path, "https://app.example.com");

  return {
    exp: url.searchParams.get("exp"),
    sig: url.searchParams.get("sig"),
    pathname: url.pathname,
  };
}

test("a signed path carries an expiry and a signature", () => {
  const path = buildSignedAssetPath(KEY, { now: NOW });
  const { exp, sig, pathname } = parse(path);

  assert.equal(pathname, "/uploads/artwork/demo_myshopify_com/abc-123.png");
  assert.equal(Number(exp), NOW + 3_600_000);
  assert.ok(sig);
});

test("a freshly signed URL verifies", () => {
  const path = buildSignedAssetPath(KEY, { now: NOW });
  const { exp, sig } = parse(path);

  assert.deepEqual(verifySignedAsset(KEY, exp, sig, { now: NOW }), { ok: true });
});

test("an expired URL is refused", () => {
  const path = buildSignedAssetPath(KEY, { ttlMs: 1000, now: NOW });
  const { exp, sig } = parse(path);

  const verdict = verifySignedAsset(KEY, exp, sig, { now: NOW + 5000 });

  assert.equal(verdict.ok, false);
  assert.equal(verdict.reason, "expired");
});

test("a tampered signature is refused", () => {
  const path = buildSignedAssetPath(KEY, { now: NOW });
  const { exp, sig } = parse(path);

  const tampered = `${sig.slice(0, -1)}${sig.endsWith("A") ? "B" : "A"}`;

  assert.equal(verifySignedAsset(KEY, exp, tampered, { now: NOW }).ok, false);
});

test("extending the expiry without re-signing is refused", () => {
  const path = buildSignedAssetPath(KEY, { now: NOW });
  const { exp, sig } = parse(path);

  const extended = Number(exp) + 10_000_000;

  assert.equal(verifySignedAsset(KEY, extended, sig, { now: NOW }).ok, false);
});

test("a signature cannot be replayed against a different key", () => {
  const path = buildSignedAssetPath(KEY, { now: NOW });
  const { exp, sig } = parse(path);

  const otherKey = "artwork/demo_myshopify_com/other-999.png";

  assert.equal(verifySignedAsset(otherKey, exp, sig, { now: NOW }).ok, false);
});

test("knowing the storage key alone grants no access", () => {
  // The whole point of NFR-09: an unsigned request must fail.
  assert.equal(verifySignedAsset(KEY, "", "", { now: NOW }).reason, "missing");
  assert.equal(verifySignedAsset(KEY, NOW + 1000, "", { now: NOW }).reason, "missing");
});

test("signatures differ per key and per expiry", () => {
  assert.notEqual(computeSignature(KEY, NOW), computeSignature(KEY, NOW + 1));
  assert.notEqual(computeSignature(KEY, NOW), computeSignature("other.png", NOW));
});

test("keys are normalized consistently before signing", () => {
  assert.equal(normalizeKey("\\artwork\\a.png"), "artwork/a.png");
  assert.equal(normalizeKey("/artwork/a.png"), "artwork/a.png");

  // Windows-style and posix-style keys must produce the same signature.
  assert.equal(
    computeSignature("artwork\\a.png", NOW),
    computeSignature("artwork/a.png", NOW),
  );
});

test("fulfilment URLs outlive an order held in review", () => {
  const path = buildSignedAssetPath(KEY, { ttlMs: FULFILMENT_TTL_MS, now: NOW });
  const { exp, sig } = parse(path);

  // Ten days later, still valid.
  const tenDays = NOW + 10 * 24 * 60 * 60 * 1000;

  assert.equal(verifySignedAsset(KEY, exp, sig, { now: tenDays }).ok, true);
});

test("buildSignedAssetUrl produces an absolute URL", () => {
  const url = buildSignedAssetUrl(KEY, {
    baseUrl: "https://app.example.com",
    now: NOW,
  });

  assert.match(url, /^https:\/\/app\.example\.com\/uploads\/artwork\//);
  assert.match(url, /[?&]sig=/);
});

test("an empty key is refused rather than signed", () => {
  assert.throws(() => buildSignedAssetPath(""), /storage key is required/i);
});

// ---------------------------------------------------------------------------
// Gelato downloads the artwork from its own servers. A relative URL is useless
// to it, and used to be returned silently when no base URL was configured —
// which would have produced orders that failed or printed nothing, with no
// obvious cause. Absolute-or-throw is now the contract for fulfilment.
// ---------------------------------------------------------------------------

test("a relative URL is refused when an absolute one was required", () => {
  const previous = process.env.SHOPIFY_APP_URL;
  delete process.env.SHOPIFY_APP_URL;

  try {
    assert.throws(
      () => buildSignedAssetUrl("artwork/x.png", { requireAbsolute: true }),
      /absolute asset URL was required/i,
    );
  } finally {
    if (previous !== undefined) process.env.SHOPIFY_APP_URL = previous;
  }
});

test("an explicit base URL satisfies the absolute requirement", () => {
  const url = buildSignedAssetUrl("artwork/x.png", {
    baseUrl: "https://app.example.com",
    requireAbsolute: true,
  });

  assert.ok(url.startsWith("https://app.example.com/uploads/"));
});

test("the environment base URL satisfies it too", () => {
  const previous = process.env.SHOPIFY_APP_URL;
  process.env.SHOPIFY_APP_URL = "https://tunnel.example.com";

  try {
    const url = buildSignedAssetUrl("artwork/x.png", { requireAbsolute: true });
    assert.ok(url.startsWith("https://tunnel.example.com/uploads/"));
  } finally {
    if (previous === undefined) delete process.env.SHOPIFY_APP_URL;
    else process.env.SHOPIFY_APP_URL = previous;
  }
});

test("callers that do not require absolute still get a usable path", () => {
  const previous = process.env.SHOPIFY_APP_URL;
  delete process.env.SHOPIFY_APP_URL;

  try {
    // The browser is already on this origin, so relative is correct there.
    const url = buildSignedAssetUrl("artwork/x.png");
    assert.ok(url.startsWith("/uploads/"));
  } finally {
    if (previous !== undefined) process.env.SHOPIFY_APP_URL = previous;
  }
});
