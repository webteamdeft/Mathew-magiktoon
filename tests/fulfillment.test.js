import test from "node:test";
import assert from "node:assert/strict";

process.env.GELATO_API_KEY = process.env.GELATO_API_KEY || "test-key";
process.env.GELATO_STORE_ID = process.env.GELATO_STORE_ID || "test-store";

import { createFakePrisma } from "./helpers/fake-prisma.js";
import { buildLineItemProperties } from "../app/lib/customization-properties.js";

const {
  processOrderCreated,
  retryOrderItems,
  buildOrderReferenceId,
  MAX_FULFILLMENT_ATTEMPTS,
  freshAssetUrl,
} = await import("../app/lib/fulfillment.server.js");

const SHOP = "magiktoon-demo.myshopify.com";

const TEST_SHIPPING_ADDRESS = {
  first_name: "Ada",
  last_name: "Lovelace",
  address1: "1 Main St",
  city: "Springfield",
  zip: "11111",
  country_code: "US",
  email: "buyer@example.com",
};

/**
 * The three Milestone 3 products.
 *
 * Each carries a catalog product UID as well as a template: the template drives
 * the preview, but the UID is the only identifier Gelato's Order API resolves,
 * so a mapping without one cannot be fulfilled.
 */
const MAPPINGS = {
  1001: {
    id: "map_mug",
    shop: SHOP,
    shopifyProductId: "gid://shopify/Product/1001",
    shopifyProductTitle: "Classic Mug",
    gelatoProductId: "gp_mug",
    gelatoVariantId: "gv_mug",
    gelatoProductUid: "mug_product_msz_11-oz_mmat_ceramic-white_cl_4-0",
    gelatoTemplateId: "gt_mug",
    gelatoPlaceholderName: "ImageFront",
    gelatoPrintAreaName: "front",
  },
  1002: {
    id: "map_tote",
    shop: SHOP,
    shopifyProductId: "gid://shopify/Product/1002",
    shopifyProductTitle: "Cotton Tote",
    gelatoProductId: "gp_tote",
    gelatoVariantId: "gv_tote",
    gelatoProductUid: "tote_product_tsz_38x42-cm_tfab_organic-cotton_cl_black",
    gelatoTemplateId: "gt_tote",
    gelatoPlaceholderName: "ImageFront",
    gelatoPrintAreaName: "front",
  },
  1003: {
    id: "map_canvas",
    shop: SHOP,
    shopifyProductId: "gid://shopify/Product/1003",
    shopifyProductTitle: "Canvas Print",
    gelatoProductId: "gp_canvas",
    gelatoVariantId: "gv_canvas",
    gelatoProductUid: "canvas_product_cs_30x40-cm_cf_wood_cl_4-0",
    gelatoTemplateId: "gt_canvas",
    gelatoPlaceholderName: "ImageBack",
    gelatoPrintAreaName: "back",
  },
};

function customizationFor(productKey, index) {
  const mapping = MAPPINGS[productKey];

  return {
    id: `cus_${index}`,
    shop: SHOP,
    productMappingId: mapping.id,
    productMapping: mapping,
    artworkUrl: `https://cdn.example.com/artwork/${index}.png`,
    previewUrl: `https://cdn.example.com/preview/${index}.png`,
    gelatoProductId: mapping.gelatoProductId,
    gelatoVariantId: mapping.gelatoVariantId,
    gelatoTemplateId: mapping.gelatoTemplateId,
    gelatoPlaceholderName: mapping.gelatoPlaceholderName,
    gelatoPrintAreaName: mapping.gelatoPrintAreaName,
  };
}

function lineItemFor(customization, { id, productId, quantity = 1 }) {
  return {
    id,
    product_id: productId,
    quantity,
    properties: Object.entries(buildLineItemProperties(customization)).map(
      ([name, value]) => ({ name, value }),
    ),
  };
}

/** An order containing all three customized products. */
function threeProductOrder() {
  const customizations = [
    customizationFor(1001, 1),
    customizationFor(1002, 2),
    customizationFor(1003, 3),
  ];

  const order = {
    id: 5001,
    name: "#1001",
    currency: "USD",
    email: "buyer@example.com",
    shipping_address: TEST_SHIPPING_ADDRESS,
    line_items: [
      lineItemFor(customizations[0], { id: 9001, productId: 1001 }),
      lineItemFor(customizations[1], {
        id: 9002,
        productId: 1002,
        quantity: 2,
      }),
      lineItemFor(customizations[2], { id: 9003, productId: 1003 }),
    ],
  };

  return { order, customizations };
}

function makeDeps({
  customizations,
  createGelatoOrder,
  orderReviewEnabled = false,
}) {
  const prisma = createFakePrisma({ customizations });

  return {
    prisma,
    createGelatoOrder,
    findMappingForProduct: async (_shop, productId) =>
      MAPPINGS[String(productId)] || null,
    // These tests cover the direct submission path, so the review step is
    // explicitly off. Its own behaviour — holding, approving, rejecting — is
    // covered in `order-review.test.js`. Stated rather than inherited, because
    // the shipped default is review ON (SOW section 8).
    readSettings: async () => ({ orderReviewEnabled }),
  };
}

test("three customized products in one order become one Gelato order", async () => {
  const { order, customizations } = threeProductOrder();
  const calls = [];

  const deps = makeDeps({
    customizations,
    createGelatoOrder: async (payload) => {
      calls.push(payload);

      return {
        gelatoOrderId: "gelato-999",
        status: "created",
        raw: { id: "gelato-999" },
      };
    },
  });

  const result = await processOrderCreated({ shop: SHOP, order }, deps);

  assert.equal(result.ok, true);
  assert.equal(result.claimed, 3);
  assert.equal(result.submitted, 3);
  assert.equal(result.failed, 0);
  assert.equal(result.gelatoOrderId, "gelato-999");

  assert.equal(calls.length, 1, "one Gelato order, not one per line item");

  const payload = calls[0];
  assert.equal(payload.items.length, 3);
  assert.equal(payload.orderReferenceId, buildOrderReferenceId(SHOP, 5001));
  assert.equal(payload.currency, "USD");
  assert.equal(payload.shippingAddress.postCode, "11111");
});

test("each product is printed with its own template, placeholder and artwork", async () => {
  const { order, customizations } = threeProductOrder();
  let payload = null;

  const deps = makeDeps({
    customizations,
    createGelatoOrder: async (body) => {
      payload = body;
      return { gelatoOrderId: "gelato-1", status: "created", raw: {} };
    },
  });

  await processOrderCreated({ shop: SHOP, order }, deps);

  const byReference = Object.fromEntries(
    payload.items.map((item) => [item.itemReferenceId, item]),
  );

  assert.equal(byReference["9001"].templateId, "gt_mug");
  assert.equal(byReference["9001"].files[0].type, "front");
  assert.equal("id" in byReference["9001"].files[0], false);
  assert.equal(
    byReference["9001"].files[0].url,
    "https://cdn.example.com/artwork/1.png",
  );

  assert.equal(byReference["9002"].templateId, "gt_tote");
  assert.equal(byReference["9002"].quantity, 2);

  assert.equal(byReference["9003"].templateId, "gt_canvas");
  assert.equal(byReference["9003"].files[0].type, "back");
  assert.equal(
    byReference["9003"].files[0].url,
    "https://cdn.example.com/artwork/3.png",
  );

  // Three distinct templates — no cross-contamination between products.
  const templateIds = payload.items.map((item) => item.templateId);
  assert.equal(new Set(templateIds).size, 3);
});

test("a replayed webhook never creates a second Gelato order", async () => {
  const { order, customizations } = threeProductOrder();
  let callCount = 0;

  const deps = makeDeps({
    customizations,
    createGelatoOrder: async () => {
      callCount += 1;
      return { gelatoOrderId: "gelato-1", status: "created", raw: {} };
    },
  });

  const first = await processOrderCreated({ shop: SHOP, order }, deps);
  const replay = await processOrderCreated({ shop: SHOP, order }, deps);
  const thirdDelivery = await processOrderCreated({ shop: SHOP, order }, deps);

  assert.equal(first.claimed, 3);
  assert.equal(replay.claimed, 0);
  assert.equal(replay.skipped, 3);
  assert.equal(thirdDelivery.claimed, 0);
  assert.equal(
    callCount,
    1,
    "Gelato was called exactly once across three deliveries",
  );
  assert.equal(deps.prisma._rows.length, 3, "no duplicate rows were stored");
});

test("plain line items are ignored and never sent to Gelato", async () => {
  const customization = customizationFor(1001, 1);

  const order = {
    id: 5002,
    name: "#1002",
    currency: "USD",
    shipping_address: TEST_SHIPPING_ADDRESS,
    line_items: [
      lineItemFor(customization, { id: 9101, productId: 1001 }),
      { id: 9102, product_id: 2002, quantity: 1, properties: [] },
      { id: 9103, product_id: 2003, quantity: 1 },
    ],
  };

  let payload = null;

  const deps = makeDeps({
    customizations: [customization],
    createGelatoOrder: async (body) => {
      payload = body;
      return { gelatoOrderId: "gelato-2", status: "created", raw: {} };
    },
  });

  const result = await processOrderCreated({ shop: SHOP, order }, deps);

  assert.equal(result.claimed, 1);
  assert.equal(payload.items.length, 1);
  assert.equal(payload.items[0].itemReferenceId, "9101");
});

test("an order with no customized items calls Gelato zero times", async () => {
  let called = false;

  const deps = makeDeps({
    customizations: [],
    createGelatoOrder: async () => {
      called = true;
      return { gelatoOrderId: "x", status: "created", raw: {} };
    },
  });

  const result = await processOrderCreated(
    {
      shop: SHOP,
      order: {
        id: 5003,
        line_items: [{ id: 1, product_id: 1, properties: [] }],
      },
    },
    deps,
  );

  assert.equal(result.ok, true);
  assert.equal(result.claimed, 0);
  assert.equal(called, false);
});

test("a Gelato failure records a retryable error instead of losing the order", async () => {
  const { order, customizations } = threeProductOrder();

  const deps = makeDeps({
    customizations,
    createGelatoOrder: async () => {
      throw new Error("Gelato Order API 503: service unavailable");
    },
  });

  const result = await processOrderCreated({ shop: SHOP, order }, deps);

  assert.equal(result.submitted, 0);
  assert.equal(result.failed, 3);

  for (const row of deps.prisma._rows) {
    assert.equal(row.status, "FAILED");
    assert.equal(row.attempts, 1);
    assert.match(row.lastError, /503/);
  }
});

test("retry resubmits failed items and records the Gelato order id", async () => {
  const { order, customizations } = threeProductOrder();
  let shouldFail = true;

  const deps = makeDeps({
    customizations,
    createGelatoOrder: async () => {
      if (shouldFail) {
        throw new Error("Gelato Order API 503: service unavailable");
      }

      return { gelatoOrderId: "gelato-retry", status: "created", raw: {} };
    },
  });

  await processOrderCreated({ shop: SHOP, order }, deps);

  shouldFail = false;

  const retry = await retryOrderItems(
    { shop: SHOP, shopifyOrderId: "5001" },
    deps,
  );

  assert.equal(retry.retried, 3);
  assert.equal(retry.submitted, 3);
  assert.equal(retry.failed, 0);

  for (const row of deps.prisma._rows) {
    assert.equal(row.status, "SUBMITTED");
    assert.equal(row.gelatoOrderId, "gelato-retry");
    assert.equal(row.attempts, 2);
  }
});

test("retry refreshes the Shopify address when the stored one is incomplete", async () => {
  const { order, customizations } = threeProductOrder();
  let shouldFail = true;
  let payload = null;

  const deps = makeDeps({
    customizations,
    createGelatoOrder: async (body) => {
      if (shouldFail) {
        throw new Error("Gelato Order API 503: service unavailable");
      }

      payload = body;
      return { gelatoOrderId: "gelato-retry", status: "created", raw: {} };
    },
  });

  await processOrderCreated({ shop: SHOP, order }, deps);

  for (const row of deps.prisma._rows) {
    row.requestPayload.shippingAddress = {};
  }

  shouldFail = false;

  const retry = await retryOrderItems(
    { shop: SHOP, shopifyOrderId: "5001" },
    {
      ...deps,
      loadShopifyOrder: async () => order,
    },
  );

  assert.equal(retry.submitted, 3);
  assert.equal(payload.shippingAddress.addressLine1, "1 Main St");
  assert.equal(payload.shippingAddress.city, "Springfield");
  assert.equal(payload.shippingAddress.postCode, "11111");
  assert.equal(payload.shippingAddress.country, "US");
  assert.equal(payload.shippingAddress.email, "buyer@example.com");
});

test("retry stops once an item has exhausted its attempts", async () => {
  const { order, customizations } = threeProductOrder();

  const deps = makeDeps({
    customizations,
    createGelatoOrder: async () => {
      throw new Error("Gelato Order API 400: bad artwork");
    },
  });

  await processOrderCreated({ shop: SHOP, order }, deps);

  let lastRetry = null;

  for (let attempt = 1; attempt < 10; attempt += 1) {
    lastRetry = await retryOrderItems(
      { shop: SHOP, shopifyOrderId: "5001" },
      deps,
    );
  }

  for (const row of deps.prisma._rows) {
    assert.equal(row.status, "FAILED");
    assert.equal(
      row.attempts,
      MAX_FULFILLMENT_ATTEMPTS,
      "attempts stop at the cap instead of growing forever",
    );
  }

  assert.equal(
    lastRetry.retried,
    0,
    "an exhausted item is no longer picked up",
  );
});

test("one unprintable item fails alone; the rest of the order still ships", async () => {
  const good = customizationFor(1001, 1);

  // Artwork lost between checkout and fulfillment.
  const broken = { ...customizationFor(1002, 2), artworkUrl: "" };

  const order = {
    id: 5004,
    currency: "USD",
    shipping_address: TEST_SHIPPING_ADDRESS,
    line_items: [
      lineItemFor(good, { id: 9201, productId: 1001 }),
      lineItemFor(broken, { id: 9202, productId: 1002 }),
    ],
  };

  let payload = null;

  const deps = makeDeps({
    customizations: [good, broken],
    createGelatoOrder: async (body) => {
      payload = body;
      return { gelatoOrderId: "gelato-3", status: "created", raw: {} };
    },
  });

  const result = await processOrderCreated({ shop: SHOP, order }, deps);

  assert.equal(result.submitted, 1);
  assert.equal(result.failed, 1);
  assert.equal(payload.items.length, 1);
  assert.equal(payload.items[0].itemReferenceId, "9201");

  const brokenRow = deps.prisma._rows.find(
    (row) => row.shopifyLineItemId === "9202",
  );
  assert.equal(brokenRow.status, "FAILED");
  assert.match(brokenRow.lastError, /artwork URL/i);
});

test("a template-less mapping prints through the catalog product UID", async () => {
  // Mirrors a Gelato store product created directly rather than from a
  // template: no templateId, but each variant carries a catalog productUid.
  const catalogMapping = {
    id: "map_catalog",
    shop: SHOP,
    shopifyProductId: "gid://shopify/Product/1004",
    shopifyProductTitle: "Catalog Mug",
    gelatoProductId: "83966067-b7da-44cc-a728-6a65d47a064b",
    gelatoProductUid: "mug_product_msz_11-oz_mmat_ceramic-white_cl_4-0",
    gelatoVariantId: "21eac5fd-9961-4d93-9ffb-a725f9fe14d5",
    gelatoTemplateId: "",
    gelatoPlaceholderName: "ImageFront",
    gelatoPrintAreaName: "front",
  };

  const customization = {
    id: "cus_catalog",
    shop: SHOP,
    productMappingId: catalogMapping.id,
    productMapping: catalogMapping,
    artworkUrl: "https://cdn.example.com/artwork/catalog.png",
    previewUrl: "https://cdn.example.com/preview/catalog.png",
    gelatoProductId: catalogMapping.gelatoProductId,
    gelatoProductUid: catalogMapping.gelatoProductUid,
    gelatoVariantId: catalogMapping.gelatoVariantId,
    gelatoTemplateId: "",
    gelatoPlaceholderName: "ImageFront",
    gelatoPrintAreaName: "front",
  };

  const order = {
    id: 5006,
    currency: "USD",
    shipping_address: TEST_SHIPPING_ADDRESS,
    line_items: [lineItemFor(customization, { id: 9401, productId: 1004 })],
  };

  let payload = null;

  const prisma = createFakePrisma({ customizations: [customization] });

  const result = await processOrderCreated(
    { shop: SHOP, order },
    {
      prisma,
      findMappingForProduct: async () => catalogMapping,
      // Direct submission path: the review step is covered separately.
      readSettings: async () => ({ orderReviewEnabled: false }),
      createGelatoOrder: async (body) => {
        payload = body;
        return { gelatoOrderId: "gelato-catalog", status: "created", raw: {} };
      },
    },
  );

  assert.equal(result.submitted, 1);

  const item = payload.items[0];

  assert.equal(
    item.productUid,
    "mug_product_msz_11-oz_mmat_ceramic-white_cl_4-0",
  );
  assert.equal("templateId" in item, false);
  assert.deepEqual(item.files, [
    { type: "front", url: "https://cdn.example.com/artwork/catalog.png" },
  ]);
});

test("an order payload without a shop or an id is rejected", async () => {
  const deps = makeDeps({
    customizations: [],
    createGelatoOrder: async () => ({}),
  });

  const noShop = await processOrderCreated(
    { shop: "", order: { id: 1 } },
    deps,
  );
  const noId = await processOrderCreated({ shop: SHOP, order: {} }, deps);

  assert.equal(noShop.ok, false);
  assert.equal(noId.ok, false);
});

test("the current admin mapping is used when a customization row is gone", async () => {
  // Only the cart properties survive — the Customization row was purged.
  const customization = customizationFor(1003, 7);

  const order = {
    id: 5005,
    currency: "USD",
    shipping_address: TEST_SHIPPING_ADDRESS,
    line_items: [lineItemFor(customization, { id: 9301, productId: 1003 })],
  };

  let payload = null;

  const deps = makeDeps({
    customizations: [],
    createGelatoOrder: async (body) => {
      payload = body;
      return { gelatoOrderId: "gelato-4", status: "created", raw: {} };
    },
  });

  const result = await processOrderCreated({ shop: SHOP, order }, deps);

  assert.equal(result.submitted, 1);
  assert.equal(payload.items[0].templateId, "gt_canvas");
  assert.equal(payload.items[0].files[0].type, "back");
  assert.equal(
    payload.items[0].files[0].url,
    "https://cdn.example.com/artwork/7.png",
  );
});

/*
 * Admin thumbnails.
 *
 * A Gelato order row stores the artwork URL that was signed when the webhook
 * ran. That URL is absolute, so it embeds the app host of the moment — a
 * `trycloudflare` tunnel in development, which is replaced on every restart.
 * Rendering the stored value left the merchant looking at broken images.
 */

test("an asset URL is re-signed from the stored key against the current host", () => {
  process.env.ARTWORK_SIGNING_SECRET =
    process.env.ARTWORK_SIGNING_SECRET || "test-signing-secret";

  const url = freshAssetUrl(
    "artwork/shop/abc.png",
    "https://dead-tunnel.trycloudflare.com/uploads/artwork/shop/abc.png?exp=1&sig=x",
    "https://live-tunnel.trycloudflare.com",
  );

  assert.ok(
    url.startsWith(
      "https://live-tunnel.trycloudflare.com/uploads/artwork/shop/abc.png",
    ),
    `expected the live host, got ${url}`,
  );

  // Re-signed, not the stale query string carried over from the stored URL.
  assert.ok(url.includes("sig="));
  assert.ok(!url.includes("sig=x"));
});

test("the stored URL is kept when there is no key to re-sign", () => {
  const stored = "https://cdn.example.com/artwork/7.png";

  assert.equal(freshAssetUrl("", stored, "https://live.example.com"), stored);
  assert.equal(freshAssetUrl(null, stored, "https://live.example.com"), stored);
});

test("a key that cannot be signed falls back rather than blanking the row", () => {
  const secret = process.env.ARTWORK_SIGNING_SECRET;
  delete process.env.ARTWORK_SIGNING_SECRET;

  try {
    assert.equal(
      freshAssetUrl(
        "artwork/shop/abc.png",
        "https://cdn.example.com/a.png",
        "https://live.example.com",
      ),
      "https://cdn.example.com/a.png",
    );
  } finally {
    process.env.ARTWORK_SIGNING_SECRET = secret;
  }
});
