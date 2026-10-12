import test from "node:test";
import assert from "node:assert/strict";

import {
  CONFIG_SNAPSHOT_VERSION,
  buildConfigSnapshot,
  describeConfigSnapshot,
} from "../app/lib/config-snapshot.js";

function mapping(overrides = {}) {
  return {
    id: "map_mug",
    shopifyProductTitle: "White Ceramic Mug",
    designLabel: "ICONE",
    status: "ACTIVE",
    outputResolution: "2K",
    gelatoTemplateId: "tpl_mug",
    gelatoTemplateName: "11oz Ceramic Mug",
    gelatoProductUid: "mug_product_msz_11-oz_mmat_ceramic-white_cl_4-0",
    gelatoVariantId: "var_white",
    gelatoPlaceholderName: "art.png",
    gelatoPrintAreaName: "1",
    supplierSku: "MUG-11OZ-WHITE",
    printFileRequirements: "2000x2000, 300 DPI",
    prompt: { id: "p1", name: "ICONE portrait", version: 3, status: "ACTIVE" },
    aiModel: {
      id: "m1",
      modelKey: "gemini-2.5-flash-image",
      name: "Gemini 2.5 Flash Image",
      pricePerImage: 0.039,
    },
    ...overrides,
  };
}

test("a snapshot records what produced the design", () => {
  const snapshot = buildConfigSnapshot(mapping());

  assert.equal(snapshot.version, CONFIG_SNAPSHOT_VERSION);
  assert.equal(snapshot.prompt.name, "ICONE portrait");
  assert.equal(snapshot.prompt.version, 3);
  assert.equal(snapshot.model.key, "gemini-2.5-flash-image");
  assert.equal(snapshot.resolution, "2K");
  assert.equal(snapshot.gelato.productUid, mapping().gelatoProductUid);
  assert.equal(snapshot.supplier.sku, "MUG-11OZ-WHITE");
  assert.ok(snapshot.capturedAt);
});

test("the prompt name and version are kept, not just its id", () => {
  // A prompt can be edited or deleted after an order. An id alone would then
  // answer nothing about what the customer actually approved.
  const snapshot = buildConfigSnapshot(mapping());

  assert.equal(snapshot.prompt.id, "p1");
  assert.equal(snapshot.prompt.name, "ICONE portrait");
  assert.equal(snapshot.prompt.version, 3);
});

test("editing the design afterwards cannot change a snapshot already taken", () => {
  const before = buildConfigSnapshot(mapping());

  // The admin reworks the design: new prompt, new model, 4K.
  const after = buildConfigSnapshot(
    mapping({
      outputResolution: "4K",
      prompt: { id: "p2", name: "New portrait", version: 1, status: "ACTIVE" },
      aiModel: { id: "m2", modelKey: "gemini-3-pro-image", name: "Pro" },
    }),
  );

  assert.equal(before.resolution, "2K");
  assert.equal(before.prompt.name, "ICONE portrait");
  assert.equal(after.resolution, "4K");
  assert.equal(after.prompt.name, "New portrait");
});

test("the resolution actually generated at wins over the design's current one", () => {
  const snapshot = buildConfigSnapshot(mapping(), { resolution: "4K" });

  assert.equal(snapshot.resolution, "4K");
});

test("a design with no prompt or model still snapshots cleanly", () => {
  const snapshot = buildConfigSnapshot(mapping({ prompt: null, aiModel: null }));

  assert.equal(snapshot.prompt, null);
  assert.equal(snapshot.model, null);
  assert.equal(snapshot.gelato.templateId, "tpl_mug");
});

test("a background is recorded only when one is set", () => {
  assert.equal(buildConfigSnapshot(mapping()).background, null);

  const withBackground = buildConfigSnapshot(
    mapping({
      backgroundImageKey: "backgrounds/shop/bg.png",
      backgroundImageName: "icone-cover.png",
      backgroundPlaceholderName: "art.png",
    }),
  );

  assert.equal(withBackground.background.name, "icone-cover.png");
  assert.equal(withBackground.background.placeholderName, "art.png");
});

test("no mapping means no snapshot, rather than an empty shell", () => {
  assert.equal(buildConfigSnapshot(null), null);
  assert.equal(buildConfigSnapshot(undefined), null);
});

test("a snapshot describes itself for the admin", () => {
  const lines = describeConfigSnapshot(buildConfigSnapshot(mapping()));
  const labels = lines.map((line) => line.label);

  assert.ok(labels.includes("Prompt"));
  assert.ok(labels.includes("AI model"));
  assert.ok(labels.includes("Resolution"));
  assert.ok(labels.includes("SKU"));

  const prompt = lines.find((line) => line.label === "Prompt");

  assert.equal(prompt.value, "ICONE portrait (v3)");
});

test("an order approved before snapshots existed shows nothing, not placeholders", () => {
  // "Unknown" repeated six times is worse than an empty section.
  assert.deepEqual(describeConfigSnapshot(null), []);
  assert.deepEqual(describeConfigSnapshot(undefined), []);
  assert.deepEqual(describeConfigSnapshot("not an object"), []);
});
