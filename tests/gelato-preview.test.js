import test from "node:test";
import assert from "node:assert/strict";

import { designImage } from "../app/lib/customize-page.server.js";

/**
 * Gelato's E-commerce API returns presigned S3 URLs carrying
 * `X-Amz-Expires=86400`. One stored as a product's preview works for a day and
 * then 403s forever, showing a broken image with nothing in any log. The
 * storefront must therefore be handed a stable app-proxy path instead.
 */

const PRESIGNED =
  "https://gelato-api-live.s3.eu-west-1.amazonaws.com/ecommerce/" +
  "store_product_image/abc/preview?X-Amz-Expires=86400&X-Amz-Signature=deadbeef";

test("a design resolves to the stable proxy path, not the presigned URL", () => {
  const url = designImage("/apps/magiktoon", {
    previewPath: "/template-image/map_1",
    previewUrl: PRESIGNED,
  });

  assert.equal(url, "/apps/magiktoon/template-image/map_1");
  assert.equal(url.includes("X-Amz-Signature"), false);
});

test("a custom proxy prefix is honoured", () => {
  assert.equal(
    designImage("/tools/personalise", { previewPath: "/template-image/map_1" }),
    "/tools/personalise/template-image/map_1",
  );
});

test("a missing proxy base falls back to the documented default", () => {
  assert.equal(
    designImage("", { previewPath: "/template-image/map_1" }),
    "/apps/magiktoon/template-image/map_1",
  );
});

test("a design with no stable path falls back to whatever was stored", () => {
  // Older rows have no previewPath. A possibly-expired URL beats no image.
  assert.equal(designImage("/apps/magiktoon", { previewUrl: PRESIGNED }), PRESIGNED);
});

test("nothing at all yields an empty string, never 'undefined'", () => {
  assert.equal(designImage("/apps/magiktoon", null), "");
  assert.equal(designImage("/apps/magiktoon", {}), "");
});

// ---------------------------------------------------------------------------
// A design may hold several images. Gelato only carries a mockup gallery on a
// *store product*; a template on its own has exactly one preview. Each image is
// addressed through a stable proxy path so none of them can expire.
// ---------------------------------------------------------------------------

import { toStorefrontMapping } from "../app/lib/mappings.server.js";

const BASE_MAPPING = {
  id: "map_1",
  shopifyProductId: "gid://shopify/Product/1",
  shopifyProductTitle: "Mug",
  gelatoPlaceholderName: "ImageFront",
  gelatoPrintAreaName: "front",
  status: "ACTIVE",
};

test("a single-image design exposes exactly one path", () => {
  const mapping = toStorefrontMapping({ ...BASE_MAPPING, gelatoImageCount: 1 });

  assert.deepEqual(mapping.imagePaths, ["/template-image/map_1"]);
});

test("a mockup gallery exposes one path per image, in order", () => {
  const mapping = toStorefrontMapping({ ...BASE_MAPPING, gelatoImageCount: 6 });

  assert.equal(mapping.imagePaths.length, 6);
  assert.equal(mapping.imagePaths[0], "/template-image/map_1");
  assert.equal(mapping.imagePaths[5], "/template-image/map_1?i=5");
});

test("the first image keeps the unindexed path older blocks already request", () => {
  const mapping = toStorefrontMapping({ ...BASE_MAPPING, gelatoImageCount: 3 });

  assert.equal(mapping.imagePaths[0], mapping.previewPath);
});

test("a missing or nonsense count still yields one usable path", () => {
  for (const count of [0, null, undefined, -4, "abc"]) {
    const mapping = toStorefrontMapping({ ...BASE_MAPPING, gelatoImageCount: count });

    assert.equal(mapping.imagePaths.length, 1, `count ${count}`);
    assert.equal(mapping.imagePaths[0], "/template-image/map_1");
  }
});

test("no presigned Gelato URL is ever exposed as an image path", () => {
  const mapping = toStorefrontMapping({
    ...BASE_MAPPING,
    gelatoImageCount: 4,
    gelatoPreviewUrl: "https://gelato-api-live.s3.amazonaws.com/x?X-Amz-Expires=86400",
  });

  for (const path of mapping.imagePaths) {
    assert.equal(path.startsWith("/template-image/"), true);
    assert.equal(path.includes("X-Amz"), false);
  }
});
