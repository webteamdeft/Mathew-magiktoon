import test from "node:test";
import assert from "node:assert/strict";

process.env.ARTWORK_SIGNING_SECRET =
  process.env.ARTWORK_SIGNING_SECRET || "test-signing-secret";

const { generateArtwork, buildGenerationPrompt, classifyGenerationError } =
  await import("../app/lib/generation.server.js");

const { GENERATION_ERRORS } = await import("../app/lib/generation-config.js");

const SHOP = "magiktoon-demo.myshopify.com";

/** A one-pixel PNG, which is all `decodeDataUrl` needs to see. */
const PHOTO =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

function mapping(overrides = {}) {
  return {
    id: "map_mug",
    gelatoPlaceholderName: "ImageFront",
    gelatoPrintAreaName: "front",
    outputResolution: "2K",
    prompt: {
      id: "prompt_1",
      name: "ICONE magazine",
      content: "Make it a magazine cover portrait.",
      status: "ACTIVE",
    },
    aiModel: {
      id: "model_flash",
      modelKey: "gemini-2.5-flash-image",
      enabled: true,
      pricePerImage: 0.04,
    },
    ...overrides,
  };
}

/** Collects what would have been written to `GenerationLog`. */
function fakeDb() {
  const logs = [];

  return {
    logs,
    generationLog: {
      create: async ({ data }) => {
        const row = { id: `log_${logs.length + 1}`, ...data };
        logs.push(row);
        return row;
      },
    },
  };
}

/** Deps that never touch the network, the queue, or the clock. */
function deps(overrides = {}) {
  let clock = 1000;

  return {
    db: fakeDb(),
    generate: async () => ({
      base64: "Z2VuZXJhdGVk",
      mimeType: "image/png",
      model: "gemini-2.5-flash-image",
    }),
    queue: { run: (job) => Promise.resolve().then(job) },
    rates: { take: () => ({ ok: true, remaining: 5 }) },
    // Every call advances the clock by 1.2s, so durations are deterministic.
    now: () => (clock += 1200) - 1200,
    fallbackModelKey: "gemini-2.5-flash-image",
    ...overrides,
  };
}

test("a configured design generates artwork and records the run", async () => {
  const injected = deps();

  const result = await generateArtwork(
    { shop: SHOP, mapping: mapping(), imageDataUrl: PHOTO },
    injected,
  );

  assert.equal(result.ok, true);
  assert.match(result.artwork, /^data:image\/png;base64,/);
  assert.equal(result.resolution, "2K");
  assert.equal(result.model, "gemini-2.5-flash-image");

  const [log] = injected.db.logs;

  assert.equal(log.status, "SUCCESS");
  assert.equal(log.generationType, "INITIAL");
  assert.equal(log.productMappingId, "map_mug");
  assert.equal(log.aiModelId, "model_flash");
  // Timing is recorded for every run — the 40s ceiling is pass-or-fail (AC-04).
  assert.ok(Number.isFinite(log.durationMs));
  // Priced from the configured per-image rate (NFR-06 / AC-10).
  assert.equal(log.estimatedCost, 0.04);
});

test("the model configured for the design is the one called", async () => {
  const called = [];

  const injected = deps({
    generate: async (request) => {
      called.push(request.model);
      return { base64: "Z2VuZXJhdGVk", mimeType: "image/png" };
    },
  });

  await generateArtwork(
    {
      shop: SHOP,
      mapping: mapping({
        aiModel: { id: "model_pro", modelKey: "gemini-3-pro-image", enabled: true },
      }),
      imageDataUrl: PHOTO,
    },
    injected,
  );

  assert.deepEqual(called, ["gemini-3-pro-image"]);
});

test("the configured prompt reaches the model, and the resolution with it", async () => {
  let sent = null;

  const injected = deps({
    generate: async (request) => {
      sent = request;
      return { base64: "Z2VuZXJhdGVk", mimeType: "image/png" };
    },
  });

  await generateArtwork(
    { shop: SHOP, mapping: mapping({ outputResolution: "4K" }), imageDataUrl: PHOTO },
    injected,
  );

  assert.match(sent.prompt, /magazine cover portrait/);
  assert.match(sent.prompt, /4K/);
});

test("a regeneration is counted separately from the first attempt", async () => {
  const injected = deps();

  await generateArtwork(
    {
      shop: SHOP,
      mapping: mapping(),
      imageDataUrl: PHOTO,
      generationType: "REGENERATION",
    },
    injected,
  );

  assert.equal(injected.db.logs[0].generationType, "REGENERATION");
});

test("a design with no prompt is refused, and does not call the model", async () => {
  let called = 0;

  const injected = deps({
    generate: async () => {
      called += 1;
      return { base64: "x", mimeType: "image/png" };
    },
  });

  const result = await generateArtwork(
    { shop: SHOP, mapping: mapping({ prompt: null }), imageDataUrl: PHOTO },
    injected,
  );

  assert.equal(result.ok, false);
  assert.equal(result.code, "NO_PROMPT");
  assert.equal(called, 0);
  // Misconfiguration is not a generation, and must not pollute the numbers the
  // reliability gate is judged on.
  assert.equal(injected.db.logs.length, 0);
});

test("a slow generation fails cleanly inside the ceiling", async () => {
  const injected = deps({
    generate: () => new Promise((resolve) => setTimeout(resolve, 200)),
    timeoutMs: 20,
  });

  const result = await generateArtwork(
    { shop: SHOP, mapping: mapping(), imageDataUrl: PHOTO },
    injected,
  );

  assert.equal(result.ok, false);
  assert.equal(result.code, "TIMED_OUT");
  assert.equal(result.error, GENERATION_ERRORS.TIMED_OUT);
  assert.equal(injected.db.logs[0].status, "TIMED_OUT");
});

test("a photo the model refuses is a clean failure, not a broken result", async () => {
  const injected = deps({
    generate: async () => {
      throw new Error("Gemini did not return an image");
    },
  });

  const result = await generateArtwork(
    { shop: SHOP, mapping: mapping(), imageDataUrl: PHOTO },
    injected,
  );

  assert.equal(result.ok, false);
  assert.equal(result.code, "UNPROCESSABLE_IMAGE");
  assert.equal(result.error, GENERATION_ERRORS.UNPROCESSABLE_IMAGE);
  assert.equal(injected.db.logs[0].status, "UNPROCESSABLE_IMAGE");
});

test("a rate-limited shopper never reaches the model", async () => {
  let called = 0;

  const injected = deps({
    rates: { take: () => ({ ok: false, retryAfterMs: 4000 }) },
    generate: async () => {
      called += 1;
      return { base64: "x", mimeType: "image/png" };
    },
  });

  const result = await generateArtwork(
    { shop: SHOP, mapping: mapping(), imageDataUrl: PHOTO },
    injected,
  );

  assert.equal(result.ok, false);
  assert.equal(result.code, "RATE_LIMITED");
  assert.equal(result.retryAfterMs, 4000);
  assert.equal(called, 0);
});

test("an unusable upload is rejected before any AI spend", async () => {
  let called = 0;

  const injected = deps({
    generate: async () => {
      called += 1;
      return { base64: "x", mimeType: "image/png" };
    },
  });

  const result = await generateArtwork(
    { shop: SHOP, mapping: mapping(), imageDataUrl: "not-an-image" },
    injected,
  );

  assert.equal(result.ok, false);
  assert.equal(result.code, "UNPROCESSABLE_IMAGE");
  assert.equal(called, 0);
});

test("no customer-facing failure leaks the underlying error", async () => {
  const injected = deps({
    generate: async () => {
      throw new Error("403 API key invalid for project magiktoon-prod");
    },
  });

  const result = await generateArtwork(
    { shop: SHOP, mapping: mapping(), imageDataUrl: PHOTO },
    injected,
  );

  assert.equal(result.ok, false);
  assert.doesNotMatch(result.error, /API key|magiktoon-prod|403/);
  // The detail is still kept where an operator can find it.
  assert.match(injected.db.logs[0].errorMessage, /API key/);
});

test("a quota error is reported as busy, which is retryable, not as a failure", () => {
  const classified = classifyGenerationError(
    new Error("429 RESOURCE_EXHAUSTED: quota exceeded"),
  );

  assert.equal(classified.code, "RATE_LIMITED");
});

test("a logging failure does not lose a good generation", async () => {
  const injected = deps({
    db: {
      generationLog: {
        create: async () => {
          throw new Error("database is locked");
        },
      },
    },
  });

  const result = await generateArtwork(
    { shop: SHOP, mapping: mapping(), imageDataUrl: PHOTO },
    injected,
  );

  assert.equal(result.ok, true);
  assert.match(result.artwork, /^data:image\/png;base64,/);
});

test("the prompt is left alone when no resolution is configured", () => {
  assert.equal(buildGenerationPrompt("Make it pop.", ""), "Make it pop.");
  assert.match(buildGenerationPrompt("Make it pop.", "2K"), /2K resolution/);
});
