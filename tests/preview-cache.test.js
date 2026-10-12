import test from "node:test";
import assert from "node:assert/strict";

process.env.GELATO_API_KEY = process.env.GELATO_API_KEY || "test-key";
process.env.GELATO_STORE_ID = process.env.GELATO_STORE_ID || "test-store";

const { previewCacheKey } = await import("../app/lib/gelato-preview.server.js");

/**
 * The preview cache used to be keyed on the mapping id alone, with a six-hour
 * lifetime. Changing a design's Gelato template therefore kept serving the
 * previous template's image — in the admin and on the storefront — with nothing
 * a merchant could do about it but wait.
 */

function mapping(overrides = {}) {
  return {
    id: "map_mug",
    gelatoTemplateId: "tpl_one",
    gelatoProductId: "prod_one",
    ...overrides,
  };
}

test("changing the template gives a different cache entry", () => {
  const before = previewCacheKey(mapping());
  const after = previewCacheKey(mapping({ gelatoTemplateId: "tpl_two" }));

  assert.notEqual(before, after, "the old template's images must not be reused");
});

test("changing the Gelato store product also busts the entry", () => {
  const before = previewCacheKey(mapping());
  const after = previewCacheKey(mapping({ gelatoProductId: "prod_two" }));

  assert.notEqual(before, after);
});

test("the same design keeps the same entry, so the cache still works", () => {
  assert.equal(previewCacheKey(mapping()), previewCacheKey(mapping()));
});

test("two designs never share an entry, even on one template", () => {
  // A product can offer several designs built from the same template.
  const first = previewCacheKey(mapping({ id: "map_a" }));
  const second = previewCacheKey(mapping({ id: "map_b" }));

  assert.notEqual(first, second);
});

test("a mapping with nothing set still produces a usable key", () => {
  assert.equal(typeof previewCacheKey({}), "string");
  assert.equal(typeof previewCacheKey(null), "string");
});

test("the mapping id leads the key, so one design can be forgotten alone", () => {
  // `forgetMappingPreview` matches on the first segment; if the id were not
  // first it would clear the wrong designs, or none.
  assert.equal(previewCacheKey(mapping()).split("|")[0], "map_mug");
});
