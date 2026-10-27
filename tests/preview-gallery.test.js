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

/**
 * A brand-new design.
 *
 * Its Gelato gallery does not exist for the first few minutes, so the template
 * preview stands in. That stand-in used to be cached for six hours, which kept
 * a just-created product on one wrong image long after its gallery was ready.
 */
test("a stand-in without the gallery is re-checked within minutes, not hours", async () => {
  const design = mapping({ gelatoProductId: "" });
  let clock = 1_000_000;
  const now = () => clock;

  const before = await resolveTemplateImages(design, {
    ...deps({ templatePreview: "https://cdn/template.jpg" }),
    now,
  });

  assert.deepEqual(before, ["https://cdn/template.jpg"]);

  // Gelato finishes publishing: the store product and its gallery now exist.
  clock += 2 * 60 * 1000;

  const after = await resolveTemplateImages(design, {
    ...deps({ images: ["https://cdn/a.jpg", "https://cdn/b.jpg"] }),
    findStoreProduct: async () => ({ id: "prod_new" }),
    now,
  });

  assert.deepEqual(after, ["https://cdn/a.jpg", "https://cdn/b.jpg"]);
});

test("a real gallery is still cached, so pages do not re-ask Gelato", async () => {
  const design = mapping();
  let clock = 1_000_000;
  const now = () => clock;

  await resolveTemplateImages(design, { ...deps({ images: ["https://cdn/a.jpg"] }), now });

  clock += 2 * 60 * 1000;

  const again = await resolveTemplateImages(design, {
    ...deps({ images: ["https://cdn/changed.jpg"] }),
    now,
  });

  assert.deepEqual(again, ["https://cdn/a.jpg"]);
});

/**
 * The gallery narrowed to the colourway being bought.
 *
 * Reported from end-to-end testing: choosing the white mug produced previews
 * of a pink one. Gelato returns every colourway's shots in a single flat list
 * and the resolver handed all of them on, so the wrap renderer — which takes
 * the first shot of each angle — picked whichever colour Gelato had made
 * primary. Each shot carries the variant(s) it was taken for, and a Gelato
 * variant carries the Shopify variant id it was published as, which is the
 * link back to what the shopper actually selected.
 */

/** As above, but with the variant attribution the narrowing needs. */
function variantDeps({ images = [], variants = [], productPreview = "" } = {}) {
  return {
    loadStoreProduct: async () => ({ images, variants, previewUrl: productPreview }),
    findStoreProduct: async () => null,
    loadTemplateDetail: async () => ({ template: {} }),
  };
}

const VARIANTS = [
  { id: "gel_pink", externalId: "111", title: "Ceramic Pink" },
  { id: "gel_white", externalId: "222", title: "Ceramic White" },
];

const GALLERY = [
  { url: "https://cdn/pink.jpg", variantIds: ["gel_pink"] },
  { url: "https://cdn/white.jpg", variantIds: ["gel_white"] },
  { url: "https://cdn/any-angle.jpg", variantIds: [] },
];

test("the gallery is narrowed to the Shopify variant being bought", async () => {
  const urls = await resolveTemplateImages(mapping(), {
    ...variantDeps({ images: GALLERY, variants: VARIANTS }),
    variantId: "222",
  });

  // The white shot, plus the angle attached to the product rather than to one
  // colour. The pink shot is what used to leak through.
  assert.deepEqual(urls, ["https://cdn/white.jpg", "https://cdn/any-angle.jpg"]);
});

test("no variant asked for keeps the whole gallery, as before", async () => {
  const urls = await resolveTemplateImages(
    mapping(),
    variantDeps({ images: GALLERY, variants: VARIANTS }),
  );

  assert.equal(urls.length, 3);
});

test("a variant Gelato has no shots for keeps the whole gallery", async () => {
  // Better a preview in the wrong colour than no preview at all.
  const urls = await resolveTemplateImages(mapping(), {
    ...variantDeps({
      images: [{ url: "https://cdn/pink.jpg", variantIds: ["gel_pink"] }],
      variants: VARIANTS,
    }),
    variantId: "222",
  });

  assert.deepEqual(urls, ["https://cdn/pink.jpg"]);
});

test("the product's own preview is not appended to a narrowed gallery", async () => {
  // It renders the primary colourway, so on a narrowed strip it is exactly the
  // wrong-coloured thumbnail this change exists to remove.
  const urls = await resolveTemplateImages(mapping(), {
    ...variantDeps({
      images: GALLERY,
      variants: VARIANTS,
      productPreview: "https://cdn/hero-pink.jpg",
    }),
    variantId: "222",
  });

  assert.ok(!urls.includes("https://cdn/hero-pink.jpg"));
});

test("two variants of one mapping do not share a cached gallery", async () => {
  const shared = mapping();
  const options = variantDeps({ images: GALLERY, variants: VARIANTS });

  const white = await resolveTemplateImages(shared, { ...options, variantId: "222" });
  const pink = await resolveTemplateImages(shared, { ...options, variantId: "111" });

  assert.ok(white.includes("https://cdn/white.jpg"));
  assert.ok(pink.includes("https://cdn/pink.jpg"));
  assert.ok(!pink.includes("https://cdn/white.jpg"));
});
