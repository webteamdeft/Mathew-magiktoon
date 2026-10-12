import test from "node:test";
import assert from "node:assert/strict";

import { renderCustomizePage } from "../app/lib/customize-page.server.js";

/**
 * Which text the customer may change.
 *
 * Gelato publishes every text area a template contains and nothing about which
 * of them are meant to be edited. The page used to offer all of them, so on a
 * design carrying seven fixed lines and one name — which is how the real
 * templates are built — a customer could rewrite the design itself.
 *
 * Fixed versus editable is recorded on the layer stack, and that is what
 * decides here.
 */

function textLayer(name, content, overrides = {}) {
  return {
    name,
    type: "text",
    label: name,
    x: 0.3,
    y: 0.5,
    width: 0.4,
    height: 0.06,
    text: { content },
    ...overrides,
  };
}

function page(mapping) {
  return renderCustomizePage({
    mapping: { mappingId: "m1", templateId: "t1", ...mapping },
    templates: [],
    product: { title: "White Ceramic Mug", imageUrl: "https://example.com/m.png" },
    productId: "gid://shopify/Product/1",
    variantId: "v1",
    returnUrl: "/",
    customizationUrl: "/c",
    generateUrl: "/g",
    mockupUrl: "/mk",
  });
}

/** The `data-name` of every text input the page offers. */
function inputNames(html) {
  return [...html.matchAll(/data-mtcp-text\s+data-name="([^"]*)"/g)].map((m) => m[1]);
}

test("only the layers marked editable become inputs", () => {
  const html = page({
    layers: [
      textLayer("Name", "CARLA", { editable: true }),
      textLayer("Tagline", "TIMELESS STYLE", { locked: true }),
      textLayer("Year", "1972", { locked: true }),
    ],
  });

  assert.deepEqual(inputNames(html), ["Name"]);
});

test("a locked layer is not offered, whatever its editable flag says", () => {
  // `normalizeLayer` makes locked win over editable; the page must not
  // second-guess that.
  const html = page({
    layers: [textLayer("Tagline", "TIMELESS STYLE", { locked: true, editable: true })],
  });

  assert.deepEqual(inputNames(html), []);
});

test("a design whose text is all fixed omits the step rather than showing it empty", () => {
  const html = page({
    layers: [
      textLayer("Tagline", "TIMELESS STYLE", { locked: true }),
      textLayer("Year", "1972", { locked: true }),
    ],
  });

  assert.doesNotMatch(html, /Step 2\. Add Your Text/);
});

test("the field is labelled and pre-filled from its own layer", () => {
  const html = page({
    layers: [textLayer("Text 4", "CARLA", { label: "First name", editable: true })],
  });

  assert.match(html, /First name/);
  assert.match(html, /value="CARLA"/);
});

test("a design with no layers keeps every placeholder, as it did before layers existed", () => {
  // Rows created before the layer stack have no layers to read, and must not
  // lose their inputs.
  const html = page({
    layers: [],
    textPlaceholders: [
      { name: "Text 1", label: "Line one", defaultText: "A" },
      { name: "Text 2", label: "Line two", defaultText: "B" },
    ],
  });

  assert.deepEqual(inputNames(html), ["Text 1", "Text 2"]);
});

test("image layers never become text inputs", () => {
  const html = page({
    layers: [
      { name: "art.png", type: "image", x: 0.3, y: 0.3, width: 0.4, height: 0.4 },
      textLayer("Name", "CARLA", { editable: true }),
    ],
  });

  assert.deepEqual(inputNames(html), ["Name"]);
});

test("every text layer still draws on the product, fixed ones included", () => {
  // Hiding a fixed line from the inputs must not hide it from the preview —
  // the customer still needs to see the design they are buying.
  const html = page({
    layers: [
      textLayer("Name", "CARLA", { editable: true }),
      textLayer("Tagline", "TIMELESS STYLE", { locked: true }),
    ],
  });

  assert.match(html, /TIMELESS STYLE/, "the fixed wording reaches the page data");
});

/**
 * What a text field is called before anyone renames it.
 *
 * Gelato publishes no label, only a name and the wording. Both make bad
 * defaults: the name is "Copy of Copy of Copy of Copy of Text 4", and the
 * wording gave the live mug design two fields both labelled "$5.00" — which
 * the shopper cannot tell apart and the merchant cannot rename confidently.
 */

const { seedLayersFromTemplate } = await import("../app/lib/layers.js");

test("text fields are numbered, not named after their wording", () => {
  const layers = seedLayersFromTemplate({
    placeholders: [{ name: "art.png" }],
    textPlaceholders: [
      { name: "Copy of Text 4", defaultText: "$5.00" },
      { name: "Copy of Copy of Text 4", defaultText: "$5.00" },
    ],
  });

  const labels = layers
    .filter((layer) => layer.type === "text")
    .map((layer) => layer.label);

  assert.deepEqual(labels, ["Text 1", "Text 2"]);
  assert.equal(new Set(labels).size, labels.length, "no two fields share a label");
});

test("the wording still reaches the customer, as the field's value", () => {
  // Losing it would leave the merchant guessing which field is which.
  const layers = seedLayersFromTemplate({
    placeholders: [],
    textPlaceholders: [{ name: "Text 4", defaultText: "1972" }],
  });

  assert.equal(layers[0].text.content, "1972");
});

test("a label the merchant has set is never overwritten by re-seeding", () => {
  // Re-mapping a design must not undo the naming work.
  const existing = seedLayersFromTemplate({
    placeholders: [],
    textPlaceholders: [{ name: "Text 4", defaultText: "1972" }],
  }).map((layer) => ({ ...layer, label: "Year of birth" }));

  const reseeded = seedLayersFromTemplate(
    { placeholders: [], textPlaceholders: [{ name: "Text 4", defaultText: "1972" }] },
    existing,
  );

  assert.equal(reseeded[0].label, "Year of birth");
});
