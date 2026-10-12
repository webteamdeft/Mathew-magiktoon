import test from "node:test";
import assert from "node:assert/strict";

/**
 * "Add design" must never overwrite a design that already exists.
 *
 * This is not hypothetical: the save path used to upsert on
 * (shop, product, designRef), so picking a product and template that were
 * already paired silently replaced the existing design instead of refusing.
 * The merchant believed they had added a second option and had in fact
 * destroyed the first.
 */

const saved = [];
let nextId = 1;

/** Enough of Prisma to exercise the unique index on (shop, product, designRef). */
const fakePrisma = {
  productMapping: {
    findFirst: async ({ where }) =>
      saved.find(
        (row) =>
          (!where.id || row.id === where.id) &&
          (!where.shop || row.shop === where.shop),
      ) || null,

    findMany: async () => saved,

    create: async ({ data }) => {
      const clash = saved.find(
        (row) =>
          row.shop === data.shop &&
          row.shopifyProductId === data.shopifyProductId &&
          row.designRef === data.designRef,
      );

      if (clash) {
        const error = new Error("Unique constraint failed");
        error.code = "P2002";
        throw error;
      }

      const row = { id: `map_${nextId++}`, ...data };
      saved.push(row);
      return row;
    },

    update: async ({ where, data }) => {
      const row = saved.find((item) => item.id === where.id);
      Object.assign(row, data);
      return row;
    },
  },
};

const { saveMapping } = await import("../app/lib/mappings.server.js");

function form(overrides = {}) {
  return {
    shopifyProductId: "gid://shopify/Product/1001",
    shopifyProductTitle: "Organic Tote Bag",
    gelatoTemplateId: "0af2c9ef-5b94-4625-95a0-5d4731f803ff",
    gelatoProductUid: "tote_product_tsz_38x42-cm",
    gelatoVariantId: "var_1",
    gelatoPlaceholderName: "art.png",
    gelatoPrintAreaName: "1",
    gelatoPreviewUrl: "https://cdn.example.com/tote.png",
    status: "ACTIVE",
    ...overrides,
  };
}

test("the first design on a product saves", async () => {
  const result = await saveMapping("shop.myshopify.com", form(), {}, { db: fakePrisma });

  assert.equal(result.ok, true, JSON.stringify(result.errors || result.error));
  assert.equal(saved.length, 1);
});

test("adding the SAME design again is refused, not silently applied", async () => {
  const before = saved.length;

  const result = await saveMapping("shop.myshopify.com", form(), {}, { db: fakePrisma });

  assert.equal(result.ok, false);
  assert.ok(result.errors?.gelatoTemplateId, "the clash is reported on the template field");
  assert.match(result.errors.gelatoTemplateId, /already offers/i);

  // The critical assertion: nothing was created and nothing was overwritten.
  assert.equal(saved.length, before, "no row was added");
});

test("a different template on the same product is a second design, and is allowed", async () => {
  const before = saved.length;

  const result = await saveMapping(
    "shop.myshopify.com",
    form({
      gelatoTemplateId: "9003df1e-6ffa-42bf-9223-6db01680e16d",
      designLabel: "Second design",
    }),
    {},
    { db: fakePrisma },
  );

  assert.equal(result.ok, true, JSON.stringify(result.errors || result.error));
  assert.equal(saved.length, before + 1, "a genuine second option was added");
});

test("editing an existing design by id still updates it", async () => {
  const target = saved[0];

  const result = await saveMapping(
    "shop.myshopify.com",
    form({ designLabel: "Renamed" }),
    { id: target.id },
    { db: fakePrisma },
  );

  assert.equal(result.ok, true, JSON.stringify(result.errors || result.error));
  assert.equal(result.mapping.designLabel, "Renamed");
});
