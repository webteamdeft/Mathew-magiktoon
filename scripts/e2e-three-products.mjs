/**
 * End-to-end exercise of the Milestone 3 flow for three products.
 *
 * Runs against the real Prisma client and the real SQLite database, and calls
 * every server helper the live app calls. The only stub is the outbound Gelato
 * HTTP call, which is injected so the run neither needs network access nor
 * places real print orders.
 *
 * Everything is written under a dedicated test shop domain and removed again
 * at the end, so a dev database is left exactly as it was found.
 *
 *   node scripts/e2e-three-products.mjs
 */

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

process.env.SHOPIFY_APP_URL =
  process.env.SHOPIFY_APP_URL || "https://e2e.example.com";
process.env.GELATO_API_KEY = process.env.GELATO_API_KEY || "e2e-key";
process.env.GELATO_STORE_ID = process.env.GELATO_STORE_ID || "e2e-store";
process.env.ARTWORK_SIGNING_SECRET =
  process.env.ARTWORK_SIGNING_SECRET || "e2e-signing-secret";

const prisma = (await import("../app/db.server.js")).default;

const {
  saveMapping,
  findMappingForProduct,
  listMappingsForProduct,
  setMappingStatus,
  deleteMapping,
} = await import("../app/lib/mappings.server.js");

const { saveCustomization, getCustomization } = await import(
  "../app/lib/customizations.server.js"
);

const { buildLineItemProperties, CUSTOMIZATION_PROPERTY_KEYS: PROPERTY_KEYS } =
  await import("../app/lib/customization-properties.js");

const { processOrderCreated, retryOrderItems } = await import(
  "../app/lib/fulfillment.server.js"
);

const SHOP = "magiktoon-e2e-harness.myshopify.com";

// Must match `storage.server.js`, which keeps uploads outside the app
// directory so Vite does not intercept them in dev.
const uploadsDirectory = path.resolve(
  process.env.UPLOADS_DIR ||
    path.join(path.dirname(fileURLToPath(import.meta.url)), "../../magiktoon-uploads"),
);

/** A real 1x1 PNG, so the storage layer does actual work. */
const PNG_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ" +
  "AAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

/** The three products this milestone wires up, each on a different template. */
const PRODUCTS = [
  {
    label: "Mug",
    numericId: "8100000000001",
    input: {
      shopifyProductId: "gid://shopify/Product/8100000000001",
      shopifyProductTitle: "E2E Classic Mug",
      shopifyProductHandle: "e2e-classic-mug",
      shopifyVariantId: "gid://shopify/ProductVariant/9100000000001",
      gelatoProductId: "e2e-gp-mug",
      gelatoProductName: "Gelato Mug 11oz",
      gelatoProductUid: "mug_product_msz_11-oz_mmat_ceramic-white_cl_4-0",
      gelatoVariantId: "e2e-gv-mug-11oz",
      gelatoVariantName: "11oz White",
      gelatoTemplateId: "e2e-gt-mug",
      gelatoTemplateName: "Mug Front Wrap",
      gelatoPlaceholderName: "ImageFront",
      gelatoPrintAreaName: "front",
      gelatoPreviewUrl: "https://cdn.example.com/e2e/mug.png",
      status: "ACTIVE",
    },
  },
  {
    label: "Tote",
    numericId: "8100000000002",
    input: {
      shopifyProductId: "gid://shopify/Product/8100000000002",
      shopifyProductTitle: "E2E Cotton Tote",
      shopifyProductHandle: "e2e-cotton-tote",
      shopifyVariantId: "gid://shopify/ProductVariant/9100000000002",
      gelatoProductId: "e2e-gp-tote",
      gelatoProductName: "Gelato Tote Bag",
      gelatoProductUid: "tote_product_size_medium_cl_4-0",
      gelatoVariantId: "e2e-gv-tote-m",
      gelatoVariantName: "Medium Natural",
      gelatoTemplateId: "e2e-gt-tote",
      gelatoTemplateName: "Tote Front Panel",
      gelatoPlaceholderName: "ImageFront",
      gelatoPrintAreaName: "front",
      gelatoPreviewUrl: "https://cdn.example.com/e2e/tote.png",
      status: "ACTIVE",
    },
  },
  {
    label: "Canvas",
    numericId: "8100000000003",
    input: {
      shopifyProductId: "gid://shopify/Product/8100000000003",
      shopifyProductTitle: "E2E Canvas Print",
      shopifyProductHandle: "e2e-canvas-print",
      shopifyVariantId: "gid://shopify/ProductVariant/9100000000003",
      gelatoProductId: "e2e-gp-canvas",
      gelatoProductName: "Gelato Canvas 30x40",
      gelatoProductUid: "canvas_product_pf_300x400-mm_pt_260-gsm-canvas_cl_4-0",
      gelatoVariantId: "e2e-gv-canvas-3040",
      gelatoVariantName: "30x40cm",
      // No template: exercises the catalog flow end to end alongside the two
      // template-based products above.
      gelatoTemplateId: "",
      gelatoTemplateName: "",
      gelatoPlaceholderName: "ImageBack",
      gelatoPrintAreaName: "back",
      gelatoPreviewUrl: "https://cdn.example.com/e2e/canvas.png",
      status: "ACTIVE",
    },
  },
];

const created = { mappingIds: [], uploadKeys: [] };

let stepNumber = 0;

function step(message) {
  stepNumber += 1;
  console.log(`\n[${stepNumber}] ${message}`);
}

function pass(message) {
  console.log(`    ok  ${message}`);
}

/** Remove every row and file this run produced. */
async function cleanup() {
  await prisma.gelatoOrderItem.deleteMany({ where: { shop: SHOP } });
  await prisma.customization.deleteMany({ where: { shop: SHOP } });
  await prisma.productMapping.deleteMany({ where: { shop: SHOP } });

  for (const key of created.uploadKeys) {
    await fs.rm(path.join(uploadsDirectory, key), { force: true });
  }

  const shopSlug = SHOP.replace(/[^a-zA-Z0-9_-]/g, "_");

  for (const prefix of ["artwork", "previews"]) {
    await fs.rm(path.join(uploadsDirectory, prefix, shopSlug), {
      recursive: true,
      force: true,
    });
  }
}

async function run() {
  // Start from a clean slate in case a previous run was interrupted.
  await cleanup();

  // -------------------------------------------------------------------------
  step("Admin: map three Shopify products to three different Gelato products");

  const mappings = {};

  for (const product of PRODUCTS) {
    const result = await saveMapping(SHOP, product.input);

    assert.equal(result.ok, true, `${product.label}: ${JSON.stringify(result)}`);

    mappings[product.label] = result.mapping;
    created.mappingIds.push(result.mapping.id);

    pass(
      `${product.label} -> product ${result.mapping.gelatoProductId}, ` +
        `variant ${result.mapping.gelatoVariantId}, ` +
        `template ${result.mapping.gelatoTemplateId}, ` +
        `placeholder ${result.mapping.gelatoPlaceholderName}, ` +
        `print area ${result.mapping.gelatoPrintAreaName}`,
    );
  }

  const targets = Object.values(mappings).map(
    (m) => m.gelatoTemplateId || m.gelatoProductUid,
  );
  assert.equal(new Set(targets).size, 3, "three distinct Gelato targets");
  pass("all three products print through a different Gelato target");
  pass("two use the template flow, one uses the catalog flow");

  // -------------------------------------------------------------------------
  step("Admin: validation rejects an incomplete mapping");

  const invalid = await saveMapping(SHOP, {
    shopifyProductId: "gid://shopify/Product/8100000000009",
    shopifyProductTitle: "Missing everything",
    status: "ACTIVE",
  });

  assert.equal(invalid.ok, false);
  assert.ok(invalid.errors.gelatoTemplateId);
  pass("a mapping with nothing for Gelato to print is refused");

  // A template ID on its own is a complete mapping: the merchant pastes one
  // rather than having the whole Gelato store listed for them.
  const templateOnly = await saveMapping(SHOP, {
    shopifyProductId: "gid://shopify/Product/8100000000010",
    shopifyProductTitle: "Template-only mug",
    gelatoTemplateId: "tpl_pasted_by_merchant",
    gelatoPlaceholderName: "ImageFront",
    gelatoPrintAreaName: "front",
    gelatoPreviewUrl: "https://cdn.example.com/template-only.png",
    status: "ACTIVE",
  });

  assert.equal(templateOnly.ok, true, JSON.stringify(templateOnly.errors));
  await deleteMapping(SHOP, templateOnly.mapping.id);
  pass("a pasted template ID alone is enough to map a product");

  // -------------------------------------------------------------------------
  step("Admin: status can be toggled and edits update in place");

  const toggled = await setMappingStatus(SHOP, mappings.Mug.id, "DISABLED");
  assert.equal(toggled.mapping.status, "DISABLED");

  const disabledLookup = await findMappingForProduct(SHOP, "8100000000001");
  assert.equal(disabledLookup, null, "a disabled mapping is hidden from the storefront");
  pass("a disabled mapping stops being offered to customers");

  await setMappingStatus(SHOP, mappings.Mug.id, "ACTIVE");

  const edited = await saveMapping(
    SHOP,
    { ...PRODUCTS[0].input, gelatoPlaceholderName: "ImageFront", status: "ACTIVE" },
    { id: mappings.Mug.id },
  );

  assert.equal(edited.ok, true);
  assert.equal(edited.mapping.id, mappings.Mug.id, "edit updated in place, no duplicate");
  pass("edit and re-activate work without creating a second row");

  // -------------------------------------------------------------------------
  step("Customer: the storefront detects each product by its numeric Liquid id");

  for (const product of PRODUCTS) {
    const found = await findMappingForProduct(SHOP, product.numericId);

    assert.ok(found, `${product.label} was not detected`);
    assert.equal(found.gelatoTemplateId, product.input.gelatoTemplateId);
    assert.equal(found.gelatoProductUid, product.input.gelatoProductUid);
    assert.equal(found.gelatoPreviewUrl, product.input.gelatoPreviewUrl);

    pass(
      `${product.label} (id ${product.numericId}) -> ` +
        (found.gelatoTemplateId
          ? `template ${found.gelatoTemplateId}`
          : `product UID ${found.gelatoProductUid}`),
    );
  }

  const unmapped = await findMappingForProduct(SHOP, "9999999999999");
  assert.equal(unmapped, null);
  pass("an unmapped product returns nothing, so the block stays hidden");

  // -------------------------------------------------------------------------
  step("Customer: save a customization for each product");

  const lineItems = [];
  const savedCustomizations = {};

  for (const [index, product] of PRODUCTS.entries()) {
    const mapping = mappings[product.label];

    const result = await saveCustomization({
      shop: SHOP,
      mapping,
      artworkDataUrl: PNG_DATA_URL,
      previewDataUrl: PNG_DATA_URL,
      placement: { x: 0.42, y: 0.55, zoom: 1.4 },
      personalizationText: { "Text 4": "Ada", "Copy of Text 4": "Happy birthday" },
      shopifyVariantId: product.input.shopifyVariantId,
      requestUrl: "https://e2e.example.com/apps/magiktoon/customization",
    });

    assert.equal(result.ok, true, JSON.stringify(result));

    created.uploadKeys.push(result.customization.artworkKey);

    if (result.customization.previewKey) {
      created.uploadKeys.push(result.customization.previewKey);
    }

    // The stored artwork must be an absolute, signed, fetchable URL (NFR-09).
    assert.match(result.customization.artworkUrl, /^https:\/\/e2e\.example\.com\/uploads\//);
    assert.match(result.customization.artworkUrl, /[?&]sig=/, "artwork URL is signed");
    assert.match(result.customization.artworkUrl, /[?&]exp=/, "artwork URL expires");
    assert.ok(result.customization.artworkKey, "the storage key is persisted");
    assert.ok(result.customization.previewUrl);

    // The approved design lets the customer drag and zoom; the values are
    // clamped server-side and stored with the mapped placeholder/print area.
    assert.equal(result.customization.placement.mode, "customer-placed");
    assert.equal(result.customization.placement.x, 0.42);
    assert.equal(result.customization.placement.y, 0.55);
    assert.equal(result.customization.placement.zoom, 1.4);
    assert.equal(
      result.customization.placement.placeholder,
      mapping.gelatoPlaceholderName,
    );
    assert.equal(
      result.customization.placement.printArea,
      mapping.gelatoPrintAreaName,
    );

    // Step 2 text is stored, never composited onto the artwork.
    assert.equal(result.customization.personalizationText["Text 4"], "Ada");
    assert.equal(
      result.customization.personalizationText["Copy of Text 4"],
      "Happy birthday",
    );

    // The properties carry every field the cart line must hold.
    const properties = result.properties;
    assert.equal(properties._mt_customization_id, result.customization.id);
    assert.equal(properties._mt_gelato_product_id, mapping.gelatoProductId);
    assert.equal(properties._mt_gelato_variant_id, mapping.gelatoVariantId);
    assert.equal(properties._mt_gelato_product_uid, mapping.gelatoProductUid);

    if (mapping.gelatoTemplateId) {
      assert.equal(properties._mt_gelato_template_id, mapping.gelatoTemplateId);
    }
    assert.equal(properties._mt_gelato_placeholder, mapping.gelatoPlaceholderName);
    assert.equal(properties._mt_gelato_print_area, mapping.gelatoPrintAreaName);
    assert.ok(properties._mt_artwork_url);
    assert.ok(properties._mt_preview_url);

    // Step 2 text rides along as visible cart properties, keyed by the Gelato
    // text-area name so fulfilment can match each value back to its layer.
    assert.equal(properties["Text 4"], "Ada");
    assert.equal(properties["Copy of Text 4"], "Happy birthday");

    lineItems.push({
      id: 7700000000000 + index,
      product_id: Number(product.numericId),
      quantity: index + 1,
      properties: Object.entries(properties).map(([name, value]) => ({
        name,
        value,
      })),
    });

    savedCustomizations[product.label] = result.customization;

    pass(
      `${product.label}: customization ${result.customization.id} saved with ` +
        `${Object.keys(properties).length} cart line properties`,
    );
  }

  // -------------------------------------------------------------------------
  step("Customer: one Shopify product offers several designs, and stays itself");

  const mugProduct = PRODUCTS[0];
  const mugMapping = mappings[mugProduct.label];

  // A second design on the SAME Shopify product.
  const secondDesign = await saveMapping(SHOP, {
    ...mugProduct.input,
    gelatoTemplateId: "e2e-gt-mug-wraparound",
    gelatoTemplateName: "Wrap-around mug",
    designLabel: "Wrap-around",
    sortOrder: 1,
    status: "ACTIVE",
  });

  assert.equal(secondDesign.ok, true, JSON.stringify(secondDesign.errors));

  const designs = await listMappingsForProduct(SHOP, mugProduct.numericId);

  assert.equal(designs.length, 2, "the product now offers two designs");
  assert.equal(
    new Set(designs.map((design) => design.shopifyProductNumericId)).size,
    1,
    "both designs belong to the same Shopify product",
  );
  assert.equal(
    new Set(designs.map((design) => design.shopifyVariantId)).size,
    1,
    "both designs buy the same Shopify variant",
  );
  pass(`${mugProduct.label} offers ${designs.length} designs on one product`);

  // Adding the same design twice must update, never duplicate.
  const repeat = await saveMapping(SHOP, {
    ...mugProduct.input,
    gelatoTemplateId: "e2e-gt-mug-wraparound",
    designLabel: "Wrap-around (renamed)",
    status: "ACTIVE",
  });

  assert.equal(repeat.ok, true);
  assert.equal(
    (await listMappingsForProduct(SHOP, mugProduct.numericId)).length,
    2,
    "re-saving a design updates it instead of adding another",
  );
  pass("the same design cannot be added to a product twice");

  // Customizing against the second design must not change the product bought.
  const secondCustomization = await saveCustomization({
    shop: SHOP,
    mapping: designs[1],
    artworkDataUrl: PNG_DATA_URL,
    previewDataUrl: PNG_DATA_URL,
    shopifyVariantId: mugProduct.input.shopifyVariantId,
    requestUrl: "https://e2e.example.com/apps/magiktoon/customization",
  });

  assert.equal(secondCustomization.ok, true);
  assert.equal(
    secondCustomization.customization.shopifyProductId,
    mugMapping.shopifyProductId,
    "the customization still belongs to the original Shopify product",
  );
  assert.equal(
    secondCustomization.customization.shopifyVariantId,
    mugProduct.input.shopifyVariantId,
    "the customization still points at the original Shopify variant",
  );
  assert.equal(
    secondCustomization.customization.gelatoTemplateId,
    "e2e-gt-mug-wraparound",
    "only the Gelato design reference changed",
  );
  pass("switching design changes the artwork template, not the product bought");

  // Leave the harness with one design per product for the steps that follow.
  await deleteMapping(SHOP, designs[1].id);

  // -------------------------------------------------------------------------
  step("Customer: a saved design survives leaving the page and coming back");

  // The full-page customizer keeps only the id in the browser. Everything the
  // cart needs must be rebuildable from the stored record, or a customer who
  // navigates away loses their design.
  for (const product of PRODUCTS) {
    const saved = savedCustomizations[product.label];
    const reloaded = await getCustomization(SHOP, saved.id);

    assert.ok(reloaded, `${product.label}: the design could not be retrieved`);
    assert.equal(reloaded.id, saved.id);
    assert.ok(reloaded.artworkKey, "the artwork is still addressable");

    const rebuilt = buildLineItemProperties(reloaded);

    assert.equal(
      rebuilt[PROPERTY_KEYS.customizationId],
      saved.id,
      "the restored design points at the same record",
    );
    assert.equal(
      rebuilt[PROPERTY_KEYS.gelatoTemplateId] || rebuilt[PROPERTY_KEYS.gelatoProductUid],
      saved.gelatoTemplateId || saved.gelatoProductUid,
      "the restored design keeps its own Gelato target",
    );
    assert.equal(
      rebuilt[PROPERTY_KEYS.gelatoVariantId] || "",
      saved.gelatoVariantId || "",
      "the restored design stays bound to the same variant",
    );

    pass(`${product.label}: design ${saved.id} retrieved and re-attachable`);
  }

  // -------------------------------------------------------------------------
  step("Cart and checkout: one order carries all three customized line items");

  const order = {
    id: 7500000000001,
    name: "#E2E1001",
    currency: "USD",
    email: "buyer@example.com",
    customer: { id: 4400000000001 },
    shipping_address: {
      first_name: "Ada",
      last_name: "Lovelace",
      address1: "1 Analytical Way",
      city: "London",
      zip: "EC1A 1AA",
      country_code: "GB",
      province_code: "ENG",
    },
    line_items: [
      ...lineItems,
      // A plain, uncustomized product sharing the same order.
      { id: 7700000000099, product_id: 123456, quantity: 1, properties: [] },
    ],
  };

  pass(`order has ${order.line_items.length} line items, 3 of them customized`);

  // -------------------------------------------------------------------------
  step("Fulfillment: the orders/create webhook submits every item to Gelato");

  const gelatoCalls = [];

  const stubGelato = async (payload) => {
    gelatoCalls.push(payload);

    return {
      gelatoOrderId: "e2e-gelato-order-1",
      status: "created",
      raw: { id: "e2e-gelato-order-1", fulfillmentStatus: "created" },
    };
  };

  const result = await processOrderCreated(
    { shop: SHOP, order },
    { createGelatoOrder: stubGelato },
  );

  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.claimed, 3);
  assert.equal(result.submitted, 3);
  assert.equal(result.failed, 0);
  assert.equal(result.gelatoOrderId, "e2e-gelato-order-1");
  assert.equal(gelatoCalls.length, 1, "one Gelato order for the whole Shopify order");

  const payload = gelatoCalls[0];
  assert.equal(payload.items.length, 3);
  assert.equal(payload.shippingAddress.postCode, "EC1A 1AA");
  assert.equal(payload.shippingAddress.country, "GB");

  for (const [index, product] of PRODUCTS.entries()) {
    const item = payload.items[index];

    assert.equal(item.quantity, index + 1);
    assert.match(item.files[0].url, /^https:\/\/e2e\.example\.com\/uploads\/artwork\//);
    assert.match(item.files[0].url, /[?&]sig=/, "Gelato receives a signed URL");

    if (product.input.gelatoTemplateId) {
      // Template flow: artwork is addressed by PRINT AREA. Gelato rejects
      // `files[].id` unless it is a placeholder UUID, which its E-commerce API
      // never publishes — that returned 400 on every real order.
      assert.equal(item.templateId, product.input.gelatoTemplateId);
      assert.equal(item.variantId, product.input.gelatoVariantId);
      assert.equal(item.files[0].type, product.input.gelatoPrintAreaName);
      assert.equal("id" in item.files[0], false);

      pass(
        `${product.label}: TEMPLATE flow, template ${item.templateId}, ` +
          `variant ${item.variantId}, print area ${item.files[0].type}, qty ${item.quantity}`,
      );
    } else {
      // Catalog flow: artwork is addressed by print area on a product UID.
      assert.equal(item.productUid, product.input.gelatoProductUid);
      assert.equal(item.files[0].type, product.input.gelatoPrintAreaName);
      assert.equal("templateId" in item, false);

      pass(
        `${product.label}: CATALOG flow, product UID ${item.productUid}, ` +
          `print area ${item.files[0].type}, qty ${item.quantity}`,
      );
    }
  }

  const stored = await prisma.gelatoOrderItem.findMany({
    where: { shop: SHOP },
    orderBy: { shopifyLineItemId: "asc" },
  });

  assert.equal(stored.length, 3);

  for (const row of stored) {
    assert.equal(row.status, "SUBMITTED");
    assert.equal(row.gelatoOrderId, "e2e-gelato-order-1");
    assert.equal(row.gelatoOrderStatus, "created");
    assert.ok(row.submittedAt);
  }

  pass("Gelato order id and fulfillment status persisted for all three items");

  // -------------------------------------------------------------------------
  step("Fulfillment: replaying the webhook creates no duplicate Gelato order");

  const replay = await processOrderCreated(
    { shop: SHOP, order },
    { createGelatoOrder: stubGelato },
  );

  assert.equal(replay.claimed, 0);
  assert.equal(replay.skipped, 3);
  assert.equal(gelatoCalls.length, 1, "Gelato was not called a second time");

  const afterReplay = await prisma.gelatoOrderItem.count({ where: { shop: SHOP } });
  assert.equal(afterReplay, 3, "no duplicate rows");

  pass("duplicate webhook delivery was a no-op");

  // -------------------------------------------------------------------------
  step("Fulfillment: a failure is recorded and can be retried");

  const failingOrder = {
    ...order,
    id: 7500000000002,
    name: "#E2E1002",
    line_items: [{ ...lineItems[0], id: 7700000000100 }],
  };

  const failed = await processOrderCreated(
    { shop: SHOP, order: failingOrder },
    {
      createGelatoOrder: async () => {
        throw new Error("Gelato Order API 503: service unavailable");
      },
    },
  );

  assert.equal(failed.submitted, 0);
  assert.equal(failed.failed, 1);

  const failedRow = await prisma.gelatoOrderItem.findFirst({
    where: { shop: SHOP, shopifyOrderId: "7500000000002" },
  });

  assert.equal(failedRow.status, "FAILED");
  assert.equal(failedRow.attempts, 1);
  assert.match(failedRow.lastError, /503/);

  pass("failure recorded with the Gelato error and an attempt count");

  const retried = await retryOrderItems(
    { shop: SHOP, shopifyOrderId: "7500000000002" },
    {
      createGelatoOrder: async () => ({
        gelatoOrderId: "e2e-gelato-order-2",
        status: "created",
        raw: {},
      }),
    },
  );

  assert.equal(retried.retried, 1);
  assert.equal(retried.submitted, 1);

  const retriedRow = await prisma.gelatoOrderItem.findFirst({
    where: { shop: SHOP, shopifyOrderId: "7500000000002" },
  });

  assert.equal(retriedRow.status, "SUBMITTED");
  assert.equal(retriedRow.gelatoOrderId, "e2e-gelato-order-2");
  assert.equal(retriedRow.attempts, 2);

  pass("retry succeeded and stored the new Gelato order id");

  // -------------------------------------------------------------------------
  step("Admin: deleting a mapping keeps the order history intact");

  const deleted = await deleteMapping(SHOP, mappings.Canvas.id);
  assert.equal(deleted.ok, true);

  const survivingRows = await prisma.gelatoOrderItem.count({ where: { shop: SHOP } });
  assert.equal(survivingRows, 4, "fulfillment history survives a mapping delete");

  pass("mapping deleted; Gelato order history preserved");
}

try {
  await run();

  console.log("\n──────────────────────────────────────────────");
  console.log("END-TO-END PASSED for all three products.");
  console.log("──────────────────────────────────────────────");
} catch (error) {
  console.error("\nEND-TO-END FAILED\n", error);
  process.exitCode = 1;
} finally {
  await cleanup();
  await prisma.$disconnect();
  console.log("\nTest data removed.");
}
