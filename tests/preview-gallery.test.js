import test from "node:test";
import assert from "node:assert/strict";

process.env.GELATO_API_KEY = process.env.GELATO_API_KEY || "test-key";
process.env.GELATO_STORE_ID = process.env.GELATO_STORE_ID || "test-store";

const { resolveTemplateImages } = await import("../app/lib/gelato-preview.server.js");

/**
 * Which images make up a design's thumbnail strip.
 *
 * Reported from a walkthrough: "the last thumbnail is from a different product
 * for some reason." It was the template's own previewUrl, appended after the
 * store product's gallery. That preview is a render of the design as its author
 * built it — their sample artwork, on whichever colourway they happened to use
 * — so on the end of a real gallery it reads as a picture of something else.
 */

/** A fresh mapping id per test: the module caches on it for six hours. */
let counter = 0;

function mapping(overrides = {}) {
  counter += 1;

  return {
    id: `map_${counter}`,
    gelatoProductId: "prod_1",
    gelatoTemplateId: "tpl_1",
    ...overrides,
  };
}

/**
 * The NORMALISED store-product shape.
 *
 * The resolver never sees Gelato's raw JSON. `getGelatoStoreProduct` runs the
 * response through `normalizeGelatoStoreProduct` first, which maps
 * `productImages[].fileUrl` onto `images[].url`, drops entries carrying no
 * file, and sorts the primary shot to the front.
 *
 * Mocking Gelato's raw shape here would test a resolver that does not exist —
 * and briefly did, when this was "fixed" to read the raw field names and a
 * twelve-image gallery collapsed to one.
 */
function deps({ images = [], productPreview = "", templatePreview = "" } = {}) {
  return {
    loadStoreProduct: async () => ({
      images: images.map((url) => ({ url })),
      previewUrl: productPreview,
    }),
    findStoreProduct: async () => null,
    loadTemplateDetail: async () => ({ template: { previewUrl: templatePreview } }),
  };
}

test("a design with its own gallery does not get the template preview tacked on", () => {
  return resolveTemplateImages(
    mapping(),
    deps({
      images: ["https://cdn/a.jpg", "https://cdn/b.jpg"],
      templatePreview: "https://cdn/the-designers-sample.jpg",
    }),
  ).then((urls) => {
    assert.deepEqual(urls, ["https://cdn/a.jpg", "https://cdn/b.jpg"]);
    assert.ok(
      !urls.some((url) => url.includes("the-designers-sample")),
      "the template's own render must not appear in a real gallery",
    );
  });
});

test("the gallery keeps Gelato's order, primary first", async () => {
  const urls = await resolveTemplateImages(
    mapping(),
    deps({ images: ["https://cdn/first.jpg", "https://cdn/second.jpg"] }),
  );

  assert.deepEqual(urls, ["https://cdn/first.jpg", "https://cdn/second.jpg"]);
});

test("the store product's own preview still follows its gallery", async () => {
  // That one IS this product, unlike the template's.
  const urls = await resolveTemplateImages(
    mapping(),
    deps({ images: ["https://cdn/a.jpg"], productPreview: "https://cdn/hero.jpg" }),
  );

  assert.deepEqual(urls, ["https://cdn/a.jpg", "https://cdn/hero.jpg"]);
});

test("a design with no gallery falls back to the template preview", async () => {
  // A design mapped from a template id alone has no store product, so this is
  // the only image there is — worth having, just not on the end of a real one.
  const urls = await resolveTemplateImages(
    mapping({ gelatoProductId: "" }),
    deps({ templatePreview: "https://cdn/template.jpg" }),
  );

  assert.deepEqual(urls, ["https://cdn/template.jpg"]);
});

test("the same file is never listed twice, however its signature differs", async () => {
  const urls = await resolveTemplateImages(
    mapping(),
    deps({
      images: ["https://cdn/a.jpg?sig=one", "https://cdn/a.jpg?sig=two"],
    }),
  );

  assert.equal(urls.length, 1);
});

test("a design with nothing at all returns nothing, rather than a broken entry", async () => {
  const urls = await resolveTemplateImages(mapping({ gelatoProductId: "" }), deps());

  assert.deepEqual(urls, []);
});

test("an entry with no file is skipped rather than becoming a broken thumbnail", async () => {
  const urls = await resolveTemplateImages(
    mapping(),
    deps({ images: ["https://cdn/a.jpg", "", "https://cdn/b.jpg"] }),
  );

  assert.deepEqual(urls, ["https://cdn/a.jpg", "https://cdn/b.jpg"]);
});
