import test from "node:test";
import assert from "node:assert/strict";

import {
  FONT_FAMILIES,
  LAYER_TYPES,
  editableTextLayers,
  findUploadLayer,
  normalizeLayer,
  normalizeLayers,
  reorderLayer,
  seedLayersFromTemplate,
} from "../app/lib/layers.js";

/**
 * Gelato names a template's elements but publishes no geometry:
 *   image → { name, width, height, printArea }
 *   text  → { name, text }
 * So position, font and colour are configured in admin and stored with the
 * mapping. These tests pin that contract, and the bounds that stop a bad admin
 * value from rendering an invisible layer.
 */

const TEMPLATE = {
  placeholders: [{ name: "art.png", width: 200, height: 96, printArea: "1" }],
  textPlaceholders: [
    { name: "Text 4", defaultText: "AUGUST 2026", label: "AUGUST 2026" },
    { name: "Copy of Text 4", defaultText: "MATTHEW", label: "MATTHEW" },
  ],
};

test("seeding creates one layer per Gelato placeholder", () => {
  const layers = seedLayersFromTemplate(TEMPLATE);

  assert.equal(layers.length, 3);
  assert.equal(layers.filter((l) => l.type === LAYER_TYPES.IMAGE).length, 1);
  assert.equal(layers.filter((l) => l.type === LAYER_TYPES.TEXT).length, 2);
});

test("the image layer takes the real aspect ratio Gelato reports", () => {
  const [image] = seedLayersFromTemplate(TEMPLATE);

  // 200 x 96 is a wide band, not a square.
  assert.ok(Math.abs(image.width / image.height - 200 / 96) < 0.001);
});

test("text layers carry the wording the designer typed", () => {
  const layers = seedLayersFromTemplate(TEMPLATE);
  const text = layers.find((l) => l.name === "Text 4");

  assert.equal(text.text.content, "AUGUST 2026");
  assert.equal(text.label, "AUGUST 2026");
});

test("re-seeding never overwrites a layer the merchant positioned", () => {
  const placed = seedLayersFromTemplate(TEMPLATE).map((layer) =>
    layer.name === "Text 4" ? { ...layer, x: 0.11, y: 0.22 } : layer,
  );

  const reseeded = seedLayersFromTemplate(TEMPLATE, placed);
  const text = reseeded.find((l) => l.name === "Text 4");

  assert.equal(text.x, 0.11);
  assert.equal(text.y, 0.22);
});

test("layers come back in paint order", () => {
  const layers = normalizeLayers([
    { name: "c", zIndex: 3 },
    { name: "a", zIndex: 1 },
    { name: "b", zIndex: 2 },
  ]);

  assert.deepEqual(layers.map((l) => l.name), ["a", "b", "c"]);
});

test("a duplicate layer name is dropped", () => {
  // Two layers with one name would be indistinguishable at fulfilment.
  const layers = normalizeLayers([{ name: "art" }, { name: "art" }]);

  assert.equal(layers.length, 1);
});

test("out-of-range geometry is clamped rather than rendered invisible", () => {
  const layer = normalizeLayer({ name: "x", width: 0, height: -3, x: 99 });

  assert.ok(layer.width >= 0.02);
  assert.ok(layer.height >= 0.02);
  assert.ok(layer.x <= 1.5);
});

test("junk styling falls back to something renderable", () => {
  const layer = normalizeLayer({
    name: "t",
    type: "text",
    text: { color: "not-a-colour", align: "sideways", fontFamily: "Comic Sans" },
  });

  assert.equal(layer.text.color, "#111111");
  assert.equal(layer.text.align, "center");
  assert.equal(FONT_FAMILIES.includes(layer.text.fontFamily), true);
});

test("locked always beats editable", () => {
  // Otherwise a locked layer could still be changed by a customer.
  const layer = normalizeLayer({ name: "x", locked: true, editable: true });

  assert.equal(layer.editable, false);
});

test("the upload layer is the editable image layer", () => {
  const layers = normalizeLayers([
    { name: "bg", type: "image", editable: false, zIndex: 1 },
    { name: "art", type: "image", editable: true, zIndex: 2 },
  ]);

  assert.equal(findUploadLayer(layers).name, "art");
});

test("only editable text layers are offered to the customer", () => {
  const layers = normalizeLayers([
    { name: "fixed", type: "text", editable: false },
    { name: "open", type: "text", editable: true },
  ]);

  assert.deepEqual(editableTextLayers(layers).map((l) => l.name), ["open"]);
});

test("reordering renumbers the whole stack", () => {
  const layers = seedLayersFromTemplate(TEMPLATE);
  const moved = reorderLayer(layers, layers[0].name, "up");

  assert.deepEqual(moved.map((l) => l.zIndex), [1, 2, 3]);
  assert.equal(moved[1].name, layers[0].name);
});

test("reordering past either end is a no-op", () => {
  const layers = seedLayersFromTemplate(TEMPLATE);

  assert.deepEqual(
    reorderLayer(layers, layers[0].name, "down").map((l) => l.name),
    layers.map((l) => l.name),
  );
});

test("layers survive a JSON round trip through the form field", () => {
  const layers = seedLayersFromTemplate(TEMPLATE);

  assert.deepEqual(normalizeLayers(JSON.stringify(layers)), layers);
});

test("unusable input yields an empty stack, never a crash", () => {
  assert.deepEqual(normalizeLayers(null), []);
  assert.deepEqual(normalizeLayers("{not json"), []);
  assert.deepEqual(normalizeLayers(42), []);
});
