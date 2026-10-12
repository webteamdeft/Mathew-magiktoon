import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_OUTPUT_RESOLUTION,
  GENERATION_ERRORS,
  estimateGenerationCost,
  normalizeResolution,
  resolveGenerationConfig,
  resolutionLongEdge,
} from "../app/lib/generation-config.js";

const ACTIVE_PROMPT = {
  id: "prompt_1",
  name: "ICONE magazine",
  content: "Turn the person into an ICONE cover portrait.",
  status: "ACTIVE",
};

const FLASH = {
  id: "model_flash",
  modelKey: "gemini-2.5-flash-image",
  enabled: true,
  pricePerImage: 0.04,
};

function mapping(overrides = {}) {
  return {
    prompt: ACTIVE_PROMPT,
    aiModel: FLASH,
    outputResolution: "2K",
    ...overrides,
  };
}

test("a fully configured design resolves its prompt, model and resolution", () => {
  const config = resolveGenerationConfig(mapping());

  assert.equal(config.ok, true);
  assert.equal(config.promptText, ACTIVE_PROMPT.content);
  assert.equal(config.modelKey, "gemini-2.5-flash-image");
  assert.equal(config.aiModelId, "model_flash");
  assert.equal(config.usingFallbackModel, false);
  assert.equal(config.resolution, "2K");
  assert.equal(config.longEdge, 2048);
  assert.equal(config.pricePerImage, 0.04);
});

test("the per-theme model takes effect over the environment default", () => {
  const pro = { id: "model_pro", modelKey: "gemini-3-pro-image", enabled: true };

  const config = resolveGenerationConfig(mapping({ aiModel: pro }), {
    fallbackModelKey: "gemini-2.5-flash-image",
  });

  assert.equal(config.modelKey, "gemini-3-pro-image");
  assert.equal(config.usingFallbackModel, false);
});

test("a design with no model falls back rather than breaking the storefront", () => {
  const config = resolveGenerationConfig(mapping({ aiModel: null }), {
    fallbackModelKey: "gemini-2.5-flash-image",
  });

  assert.equal(config.ok, true);
  assert.equal(config.modelKey, "gemini-2.5-flash-image");
  assert.equal(config.usingFallbackModel, true);
  // No configured model means no rate to price against.
  assert.equal(config.aiModelId, null);
  assert.equal(config.pricePerImage, null);
});

test("a disabled model is not used just because a design still points at it", () => {
  const config = resolveGenerationConfig(
    mapping({ aiModel: { ...FLASH, enabled: false } }),
    { fallbackModelKey: "gemini-2.5-flash-image" },
  );

  assert.equal(config.usingFallbackModel, true);
  assert.equal(config.aiModelId, null);
});

test("generation is refused with no model configured anywhere", () => {
  const config = resolveGenerationConfig(mapping({ aiModel: null }));

  assert.equal(config.ok, false);
  assert.equal(config.code, "NOT_CONFIGURED");
  assert.equal(config.error, GENERATION_ERRORS.NOT_CONFIGURED);
});

test("a draft prompt never runs against a customer", () => {
  const config = resolveGenerationConfig(
    mapping({ prompt: { ...ACTIVE_PROMPT, status: "DRAFT" } }),
  );

  assert.equal(config.ok, false);
  assert.equal(config.code, "NO_PROMPT");
  // The customer sees a plain sentence; the reason is kept for the log.
  assert.equal(config.error, GENERATION_ERRORS.NO_PROMPT);
  assert.match(config.detail, /not active/);
});

test("a design with no prompt cannot generate", () => {
  const missing = resolveGenerationConfig(mapping({ prompt: null }));
  const blank = resolveGenerationConfig(
    mapping({ prompt: { ...ACTIVE_PROMPT, content: "   " } }),
  );

  assert.equal(missing.ok, false);
  assert.equal(missing.code, "NO_PROMPT");
  assert.equal(blank.ok, false);
  assert.equal(blank.code, "NO_PROMPT");
});

test("a missing mapping is refused rather than throwing", () => {
  const config = resolveGenerationConfig(null);

  assert.equal(config.ok, false);
  assert.equal(config.code, "NOT_CONFIGURED");
});

test("no customer-facing message leaks internal detail", () => {
  for (const message of Object.values(GENERATION_ERRORS)) {
    assert.doesNotMatch(message, /prompt_|model_|gemini|api|http/i);
  }
});

test("resolutions are normalized and capped at the agreed 4K", () => {
  assert.equal(normalizeResolution("4k"), "4K");
  assert.equal(normalizeResolution(" 2K "), "2K");
  assert.equal(normalizeResolution("8K"), DEFAULT_OUTPUT_RESOLUTION);
  assert.equal(normalizeResolution(""), DEFAULT_OUTPUT_RESOLUTION);
  assert.equal(normalizeResolution(undefined), DEFAULT_OUTPUT_RESOLUTION);

  assert.equal(resolutionLongEdge("4K"), 4096);
  assert.equal(resolutionLongEdge("nonsense"), 2048);
});

test("cost is estimated per image, and null when no rate is configured", () => {
  assert.equal(estimateGenerationCost(0.04, 1), 0.04);
  // Three regenerations against the accepted order.
  assert.equal(Number(estimateGenerationCost(0.05, 3).toFixed(2)), 0.15);
  assert.equal(estimateGenerationCost(null, 1), null);
  assert.equal(estimateGenerationCost(undefined, 1), null);
  assert.equal(estimateGenerationCost(0.04, 0), null);
});
