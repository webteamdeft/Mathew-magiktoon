import test from "node:test";
import assert from "node:assert/strict";

process.env.GELATO_API_KEY = process.env.GELATO_API_KEY || "test-key";
process.env.GELATO_STORE_ID = process.env.GELATO_STORE_ID || "test-store";

import { createFakePrisma } from "./helpers/fake-prisma.js";
import { buildLineItemProperties } from "../app/lib/customization-properties.js";

const {
  processOrderCreated,
  approveOrderItems,
  rejectOrderItems,
  retryOrderItems,
} = await import("../app/lib/fulfillment.server.js");

const { FULFILLMENT_STATUS } = await import("../app/lib/fulfillment-status.js");

const SHOP = "magiktoon-demo.myshopify.com";

const MAPPING = {
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
};

function customization(index = 1) {
  return {
    id: `cust_${index}`,
    shop: SHOP,
    productMappingId: MAPPING.id,
    artworkUrl: `https://cdn.example.com/artwork/${index}.png`,
    previewUrl: `https://cdn.example.com/preview/${index}.png`,
    gelatoProductUid: MAPPING.gelatoProductUid,
    gelatoTemplateId: MAPPING.gelatoTemplateId,
    gelatoVariantId: MAPPING.gelatoVariantId,
    gelatoPlaceholderName: MAPPING.gelatoPlaceholderName,
    gelatoPrintAreaName: MAPPING.gelatoPrintAreaName,
    productMapping: MAPPING,
  };
}

function order(id = 5001) {
  const record = customization(1);

  return {
    id,
    name: `#${id}`,
    currency: "GBP",
    email: "buyer@example.com",
    shipping_address: {
      first_name: "Ada",
      last_name: "Lovelace",
      address1: "1 Test Street",
      city: "London",
      zip: "SW1A 1AA",
      country_code: "GB",
    },
    line_items: [
      {
        id: 9001,
        product_id: 1001,
        quantity: 1,
        properties: Object.entries(buildLineItemProperties(record)).map(
          ([name, value]) => ({ name, value }),
        ),
      },
    ],
  };
}

/** Deps with the review switch in a known position and no real Gelato call. */
function makeDeps({ orderReviewEnabled, onCreate } = {}) {
  const prisma = createFakePrisma({
    customizations: [customization(1)],
    mappings: [MAPPING],
  });

  const calls = [];

  return {
    prisma,
    calls,
    findMappingForProduct: async () => MAPPING,
    readSettings: async () => ({ orderReviewEnabled }),
    createGelatoOrder: async (payload) => {
      calls.push(payload);

      if (onCreate) return onCreate(payload);

      return { gelatoOrderId: "gelato-1", status: "created", raw: {} };
    },
  };
}

test("with review on, a paid order is held and nothing reaches Gelato", async () => {
  const deps = makeDeps({ orderReviewEnabled: true });

  const result = await processOrderCreated(
    { shop: SHOP, order: order() },
    deps,
  );

  assert.equal(result.ok, true);
  assert.equal(result.claimed, 1);
  assert.equal(result.heldForReview, 1);
  assert.equal(result.submitted, 0);
  assert.equal(result.gelatoOrderId, "");

  // The important one: Gelato was never called.
  assert.equal(deps.calls.length, 0);

  const [row] = await deps.prisma.gelatoOrderItem.findMany({
    where: { shop: SHOP },
  });

  assert.equal(row.status, FULFILLMENT_STATUS.pendingReview);
  // The artwork is still captured, so the merchant can see what they approve.
  assert.ok(row.artworkUrl);
});

test("with review off, the order goes straight through as before", async () => {
  const deps = makeDeps({ orderReviewEnabled: false });

  const result = await processOrderCreated(
    { shop: SHOP, order: order() },
    deps,
  );

  assert.equal(result.submitted, 1);
  assert.equal(result.heldForReview, 0);
  assert.equal(result.gelatoOrderId, "gelato-1");
  assert.equal(deps.calls.length, 1);
});

test("an order with incomplete shipping is not sent to Gelato", async () => {
  const deps = makeDeps({ orderReviewEnabled: false });
  const incomplete = order();
  incomplete.shipping_address.city = "";

  const result = await processOrderCreated(
    { shop: SHOP, order: incomplete },
    deps,
  );

  assert.equal(result.ok, false);
  assert.equal(result.submitted, 0);
  assert.equal(result.failed, 1);
  assert.equal(deps.calls.length, 0);

  const [row] = await deps.prisma.gelatoOrderItem.findMany({
    where: { shop: SHOP },
  });

  assert.equal(row.status, FULFILLMENT_STATUS.failed);
  assert.match(row.lastError, /complete the shipping address/i);
  assert.match(row.lastError, /city/i);
});

test("approving a held order submits it to Gelato", async () => {
  const deps = makeDeps({ orderReviewEnabled: true });

  await processOrderCreated({ shop: SHOP, order: order() }, deps);
  assert.equal(deps.calls.length, 0);

  const approved = await approveOrderItems(
    { shop: SHOP, shopifyOrderId: "5001", reviewedBy: "matthew" },
    deps,
  );

  assert.equal(approved.approved, 1);
  assert.equal(approved.submitted, 1);
  assert.equal(deps.calls.length, 1);

  const [row] = await deps.prisma.gelatoOrderItem.findMany({
    where: { shop: SHOP },
  });

  assert.equal(row.status, FULFILLMENT_STATUS.submitted);
  assert.equal(row.reviewedBy, "matthew");
  assert.ok(row.reviewedAt);
});

test("an approved order carries the address captured at checkout", async () => {
  // The Shopify payload is long gone by the time a merchant approves, so the
  // order must be rebuildable from the row alone.
  const deps = makeDeps({ orderReviewEnabled: true });

  await processOrderCreated({ shop: SHOP, order: order() }, deps);
  await approveOrderItems({ shop: SHOP, shopifyOrderId: "5001" }, deps);

  const [payload] = deps.calls;

  assert.equal(payload.currency, "GBP");
  assert.equal(payload.shippingAddress.city, "London");
  assert.equal(payload.shippingAddress.postCode, "SW1A 1AA");
  assert.equal(payload.items[0].productUid, MAPPING.gelatoProductUid);
});

test("approving a held order with incomplete captured shipping does not call Gelato", async () => {
  const deps = makeDeps({ orderReviewEnabled: true });
  const incomplete = order();
  incomplete.shipping_address.postCode = "";
  incomplete.shipping_address.zip = "";

  await processOrderCreated({ shop: SHOP, order: incomplete }, deps);
  const approved = await approveOrderItems(
    { shop: SHOP, shopifyOrderId: "5001" },
    deps,
  );

  assert.equal(approved.approved, 1);
  assert.equal(approved.submitted, 0);
  assert.equal(approved.failed, 1);
  assert.equal(deps.calls.length, 0);
});

test("approving twice cannot submit the same order twice", async () => {
  const deps = makeDeps({ orderReviewEnabled: true });

  await processOrderCreated({ shop: SHOP, order: order() }, deps);

  await approveOrderItems({ shop: SHOP, shopifyOrderId: "5001" }, deps);
  const second = await approveOrderItems(
    { shop: SHOP, shopifyOrderId: "5001" },
    deps,
  );

  assert.equal(second.approved, 0);
  assert.equal(deps.calls.length, 1);
});

test("rejecting a held order stops it for good", async () => {
  const deps = makeDeps({ orderReviewEnabled: true });

  await processOrderCreated({ shop: SHOP, order: order() }, deps);

  const rejected = await rejectOrderItems(
    {
      shop: SHOP,
      shopifyOrderId: "5001",
      reason: "Wrong artwork",
      reviewedBy: "matthew",
    },
    deps,
  );

  assert.equal(rejected.rejected, 1);
  assert.equal(deps.calls.length, 0);

  const [row] = await deps.prisma.gelatoOrderItem.findMany({
    where: { shop: SHOP },
  });

  assert.equal(row.status, FULFILLMENT_STATUS.rejected);
  assert.match(row.lastError, /Wrong artwork/);
});

test("a rejected order cannot then be approved", async () => {
  const deps = makeDeps({ orderReviewEnabled: true });

  await processOrderCreated({ shop: SHOP, order: order() }, deps);
  await rejectOrderItems({ shop: SHOP, shopifyOrderId: "5001" }, deps);

  const approved = await approveOrderItems(
    { shop: SHOP, shopifyOrderId: "5001" },
    deps,
  );

  assert.equal(approved.approved, 0);
  assert.equal(deps.calls.length, 0);
});

test("a rejected order is never picked up by a retry", async () => {
  const deps = makeDeps({ orderReviewEnabled: true });

  await processOrderCreated({ shop: SHOP, order: order() }, deps);
  await rejectOrderItems({ shop: SHOP, shopifyOrderId: "5001" }, deps);

  const retried = await retryOrderItems(
    { shop: SHOP, shopifyOrderId: "5001" },
    deps,
  );

  assert.equal(retried.retried, 0);
  assert.equal(deps.calls.length, 0);
});

test("an order held for review is not retried into Gelato behind the merchant", async () => {
  const deps = makeDeps({ orderReviewEnabled: true });

  await processOrderCreated({ shop: SHOP, order: order() }, deps);

  const retried = await retryOrderItems(
    { shop: SHOP, shopifyOrderId: "5001" },
    deps,
  );

  assert.equal(retried.retried, 0);
  assert.equal(deps.calls.length, 0);
});

test("a replayed webhook does not queue a second copy for review", async () => {
  const deps = makeDeps({ orderReviewEnabled: true });

  await processOrderCreated({ shop: SHOP, order: order() }, deps);
  const replay = await processOrderCreated(
    { shop: SHOP, order: order() },
    deps,
  );

  assert.equal(replay.claimed, 0);
  assert.equal(replay.skipped, 1);

  const rows = await deps.prisma.gelatoOrderItem.findMany({
    where: { shop: SHOP },
  });

  assert.equal(rows.length, 1);
});
