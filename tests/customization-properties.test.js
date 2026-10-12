import test from "node:test";
import assert from "node:assert/strict";

import {
  CUSTOMIZATION_PROPERTY_KEYS as KEYS,
  MAX_TEXT_LENGTH,
  VISIBLE_PREVIEW_PROPERTY_KEY,
  buildLineItemProperties,
  normalizePersonalizationText,
  normalizeLineItemProperties,
  readCustomizationFromLineItem,
} from "../app/lib/customization-properties.js";

const CUSTOMIZATION = {
  id: "cus_1",
  artworkUrl: "https://cdn.example.com/artwork/1.png",
  previewUrl: "https://cdn.example.com/preview/1.png",
  gelatoProductId: "gp_1",
  gelatoProductUid: "mug_product_msz_11-oz_mmat_ceramic-white_cl_4-0",
  gelatoVariantId: "gv_1",
  gelatoTemplateId: "gt_1",
  gelatoPlaceholderName: "ImageFront",
  gelatoPrintAreaName: "front",
  placement: { mode: "customer-placed", x: 0.5, y: 0.5, zoom: 1 },
  // Keys are the Gelato template's own text-area names.
  personalizationText: { "Text 4": "Ada", "Copy of Text 4": "Happy birthday" },
};

test("buildLineItemProperties carries every field the webhook needs", () => {
  const properties = buildLineItemProperties(CUSTOMIZATION);

  assert.equal(properties[KEYS.customizationId], "cus_1");
  assert.equal(properties[KEYS.artworkUrl], CUSTOMIZATION.artworkUrl);
  assert.equal(properties[KEYS.previewUrl], CUSTOMIZATION.previewUrl);
  assert.equal(properties[KEYS.gelatoProductId], "gp_1");
  assert.equal(
    properties[KEYS.gelatoProductUid],
    "mug_product_msz_11-oz_mmat_ceramic-white_cl_4-0",
  );
  assert.equal(properties[KEYS.gelatoVariantId], "gv_1");
  assert.equal(properties[KEYS.gelatoTemplateId], "gt_1");
  assert.equal(properties[KEYS.placeholderName], "ImageFront");
  assert.equal(properties[KEYS.printAreaName], "front");
  assert.deepEqual(JSON.parse(properties[KEYS.placement]), CUSTOMIZATION.placement);
});

test("buildLineItemProperties exposes a visible preview for the shopper", () => {
  const properties = buildLineItemProperties(CUSTOMIZATION);

  assert.equal(properties[VISIBLE_PREVIEW_PROPERTY_KEY], CUSTOMIZATION.previewUrl);
});

test("buildLineItemProperties drops empty values instead of sending blanks", () => {
  const properties = buildLineItemProperties({
    id: "cus_2",
    artworkUrl: "https://cdn.example.com/a.png",
  });

  assert.equal(KEYS.gelatoVariantId in properties, false);
  assert.equal(VISIBLE_PREVIEW_PROPERTY_KEY in properties, false);
  assert.equal(properties[KEYS.customizationId], "cus_2");
});

test("every machine-readable key is hidden from the storefront", () => {
  for (const key of Object.values(KEYS)) {
    assert.equal(key.startsWith("_"), true, `${key} must start with "_"`);
  }
});

test("normalizeLineItemProperties handles the REST webhook shape", () => {
  const normalized = normalizeLineItemProperties([
    { name: "_mt_customization_id", value: "cus_1" },
    { name: "  spaced  ", value: "  trimmed  " },
    { name: "", value: "dropped" },
  ]);

  assert.equal(normalized._mt_customization_id, "cus_1");
  assert.equal(normalized.spaced, "trimmed");
  assert.equal("" in normalized, false);
});

test("normalizeLineItemProperties handles the GraphQL key/value shape", () => {
  const normalized = normalizeLineItemProperties([
    { key: "_mt_artwork_url", value: "https://cdn.example.com/a.png" },
  ]);

  assert.equal(normalized._mt_artwork_url, "https://cdn.example.com/a.png");
});

test("normalizeLineItemProperties handles a plain AJAX-cart object", () => {
  const normalized = normalizeLineItemProperties({ _mt_customization_id: "cus_9" });

  assert.equal(normalized._mt_customization_id, "cus_9");
});

test("normalizeLineItemProperties returns {} for unusable input", () => {
  assert.deepEqual(normalizeLineItemProperties(null), {});
  assert.deepEqual(normalizeLineItemProperties(undefined), {});
  assert.deepEqual(normalizeLineItemProperties("string"), {});
});

test("readCustomizationFromLineItem round-trips what the block attached", () => {
  const properties = buildLineItemProperties(CUSTOMIZATION);

  const lineItem = {
    id: 111,
    properties: Object.entries(properties).map(([name, value]) => ({ name, value })),
  };

  const read = readCustomizationFromLineItem(lineItem);

  assert.equal(read.isCustomized, true);
  assert.equal(read.customizationId, "cus_1");
  assert.equal(read.gelatoTemplateId, "gt_1");
  assert.equal(read.placeholderName, "ImageFront");
  assert.equal(read.printAreaName, "front");
  assert.deepEqual(read.placement, CUSTOMIZATION.placement);
});

test("readCustomizationFromLineItem flags a plain, uncustomized line item", () => {
  const read = readCustomizationFromLineItem({ id: 222, properties: [] });

  assert.equal(read.isCustomized, false);
  assert.equal(read.customizationId, "");
});

test("readCustomizationFromLineItem survives corrupt placement JSON", () => {
  const read = readCustomizationFromLineItem({
    id: 333,
    properties: [
      { name: KEYS.customizationId, value: "cus_3" },
      { name: KEYS.placement, value: "{not json" },
    ],
  });

  assert.equal(read.isCustomized, true);
  assert.equal(read.placement, null);
});


test("Step 2 text is carried as visible cart properties", () => {
  const properties = buildLineItemProperties(CUSTOMIZATION);

  assert.equal(properties["Text 4"], "Ada");
  assert.equal(properties["Copy of Text 4"], "Happy birthday");

  // Visible on purpose: the shopper must see what they typed, and the key is
  // the Gelato text-area name so fulfilment can match it back.
  assert.equal("Text 4".startsWith("_"), false);
});

test("empty text fields are omitted rather than sent blank", () => {
  const properties = buildLineItemProperties({
    ...CUSTOMIZATION,
    personalizationText: { "Text 4": "", "Copy of Text 4": "   " },
  });

  assert.equal("Text 4" in properties, false);
  assert.equal("Copy of Text 4" in properties, false);
});

test("text is trimmed to the length limit", () => {
  const text = normalizePersonalizationText({
    "Text 4": "  " + "n".repeat(400) + "  ",
  });

  assert.equal(text["Text 4"].length, MAX_TEXT_LENGTH);
});

test("any Gelato text-area name is accepted, not just a fixed pair", () => {
  // Names come from the template, so they cannot be enumerated in advance.
  const text = normalizePersonalizationText({
    "Text 4": "AUGUST 2026",
    "Copy of Copy of Copy of Text 4": "Understated charm",
  });

  assert.deepEqual(Object.keys(text).sort(), [
    "Copy of Copy of Copy of Text 4",
    "Text 4",
  ]);
});

test("normalizePersonalizationText tolerates junk input", () => {
  assert.deepEqual(normalizePersonalizationText(null), {});
  assert.deepEqual(normalizePersonalizationText("nope"), {});
  assert.deepEqual(normalizePersonalizationText([]), {});
  assert.deepEqual(normalizePersonalizationText({}), {});
});
