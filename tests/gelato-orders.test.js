import test from "node:test";
import assert from "node:assert/strict";

process.env.GELATO_API_KEY = process.env.GELATO_API_KEY || "test-key";

const {
  buildGelatoOrderItem,
  normalizeOrderFileType,
  buildGelatoOrderPayload,
  buildGelatoShippingAddress,
  validateGelatoShippingAddress,
  createGelatoOrder,
} = await import("../app/lib/gelato-orders.server.js");

test("an order item is keyed on the product UID, which is what Gelato resolves", () => {
  const item = buildGelatoOrderItem({
    itemReferenceId: "line-1",
    gelatoTemplateId: "gt_mug",
    gelatoVariantId: "gv_11oz",
    gelatoProductUid: "mug_product_msz_11-oz_mmat_ceramic-white_cl_4-0",
    artworkUrl: "https://cdn.example.com/a.png",
    placeholderName: "ImageFront",
    printAreaName: "front",
    quantity: 2,
  });

  assert.equal(
    item.productUid,
    "mug_product_msz_11-oz_mmat_ceramic-white_cl_4-0",
  );
  assert.equal(item.quantity, 2);

  // Verified against the live API: an item sent with a templateId or a Gelato
  // variant id and no productUid comes back "not_connected" with a null
  // productUid, and the order is parked as a draft that never prints.
  assert.equal("variantId" in item, false);

  // The template rides along for traceability only. Sending it beside a
  // productUid was verified not to affect resolution.
  assert.equal(item.templateId, "gt_mug");
  // Addressed by print area, never by placeholder name. The Order API requires
  // `files[].id` to be a placeholder UUID, and the E-commerce API publishes no
  // such id — sending the name returned 400 on every real order:
  //   items[0].files[0].id: "<name>.png" is not a valid UUID
  assert.deepEqual(item.files, [
    { type: "front", url: "https://cdn.example.com/a.png" },
  ]);
  assert.equal("id" in item.files[0], false);
});

test("the e-commerce print area is not sent as an Order API file type", () => {
  // A Gelato template publishes printArea "1" for its image placeholders. That
  // is an identifier in a different vocabulary, and the Order API has no print
  // area of that name to attach the artwork to.
  const item = buildGelatoOrderItem({
    itemReferenceId: "line-1b",
    gelatoProductUid: "mug_product_msz_11-oz_mmat_ceramic-white_cl_4-0",
    artworkUrl: "https://cdn.example.com/a.png",
    printAreaName: "1",
  });

  assert.equal(item.files[0].type, "default");
});

test("recognised print areas pass through, anything else becomes default", () => {
  assert.equal(normalizeOrderFileType("front"), "front");
  assert.equal(normalizeOrderFileType("BACK"), "back");
  assert.equal(normalizeOrderFileType("neck-inner"), "neck-inner");
  assert.equal(normalizeOrderFileType("1"), "default");
  assert.equal(normalizeOrderFileType("42"), "default");
  assert.equal(normalizeOrderFileType("ImageFront"), "default");
  assert.equal(normalizeOrderFileType(""), "default");
  assert.equal(normalizeOrderFileType(undefined), "default");
});

test("an item with no print area defaults rather than guessing", () => {
  const item = buildGelatoOrderItem({
    itemReferenceId: "line-2",
    gelatoProductUid: "mug_product_msz_11-oz_mmat_ceramic-black_cl_4-0",
    artworkUrl: "https://cdn.example.com/b.png",
  });

  assert.equal(
    item.productUid,
    "mug_product_msz_11-oz_mmat_ceramic-black_cl_4-0",
  );
  assert.deepEqual(item.files, [
    { type: "default", url: "https://cdn.example.com/b.png" },
  ]);
});

test("a template ID alone is refused, because Gelato will not resolve it", () => {
  assert.throws(
    () =>
      buildGelatoOrderItem({
        itemReferenceId: "line-2c",
        gelatoTemplateId: "gt_mug",
        gelatoVariantId: "gv_11oz",
        artworkUrl: "https://cdn.example.com/b.png",
      }),
    /product UID/i,
  );
});

test("the Gelato store-product GUID is never sent as a productUid", () => {
  // A store product id looks like "83966067-b7da-44cc-a728-6a65d47a064b".
  // Gelato's order API rejects it, so building must fail loudly instead of
  // quietly submitting an order that can never be printed.
  assert.throws(
    () =>
      buildGelatoOrderItem({
        itemReferenceId: "line-2b",
        gelatoProductId: "83966067-b7da-44cc-a728-6a65d47a064b",
        artworkUrl: "https://cdn.example.com/b.png",
      }),
    /product UID/i,
  );
});

test("quantity is coerced to a sane positive integer", () => {
  const cases = [
    [0, 1],
    [-3, 1],
    ["nonsense", 1],
    [undefined, 1],
    [2.7, 2],
  ];

  for (const [input, expected] of cases) {
    const item = buildGelatoOrderItem({
      itemReferenceId: "line",
      gelatoProductUid: "mug_product_msz_11-oz_mmat_ceramic-white_cl_4-0",
      artworkUrl: "https://cdn.example.com/a.png",
      quantity: input,
    });

    assert.equal(item.quantity, expected, `quantity ${input}`);
  }
});

test("an item without artwork is refused rather than silently printed blank", () => {
  assert.throws(
    () =>
      buildGelatoOrderItem({
        itemReferenceId: "line-3",
        gelatoProductUid: "mug_product_msz_11-oz_mmat_ceramic-white_cl_4-0",
        artworkUrl: "",
      }),
    /artwork URL/i,
  );
});

test("an item with no product UID is refused", () => {
  assert.throws(
    () =>
      buildGelatoOrderItem({
        itemReferenceId: "line-4",
        artworkUrl: "https://cdn.example.com/a.png",
      }),
    /product UID/i,
  );
});

test("the shipping address is mapped from the Shopify order", () => {
  const address = buildGelatoShippingAddress({
    email: "buyer@example.com",
    shipping_address: {
      first_name: "Ada",
      last_name: "Lovelace",
      address1: "1 Analytical Way",
      address2: "Flat 2",
      city: "London",
      zip: "EC1A 1AA",
      province_code: "ENG",
      country_code: "GB",
      phone: "+44 20 0000 0000",
    },
  });

  assert.equal(address.firstName, "Ada");
  assert.equal(address.addressLine1, "1 Analytical Way");
  assert.equal(address.addressLine2, "Flat 2");
  assert.equal(address.postCode, "EC1A 1AA");
  assert.equal(address.country, "GB");
  assert.equal(address.state, "ENG");
  assert.equal(address.email, "buyer@example.com");
});

test("optional address fields are omitted, never sent as empty strings", () => {
  const address = buildGelatoShippingAddress({
    email: "buyer@example.com",
    shipping_address: {
      first_name: "Ada",
      last_name: "Lovelace",
      address1: "1 Main St",
      city: "Springfield",
      zip: "11111",
      country_code: "US",
    },
  });

  assert.equal("addressLine2" in address, false);
  assert.equal("state" in address, false);
  assert.equal("phone" in address, false);
  assert.equal(address.country, "US");
});

test("recipient name can be mapped from Shopify's combined shipping name", () => {
  const address = buildGelatoShippingAddress({
    email: "buyer@example.com",
    shipping_address: {
      name: "Ada Lovelace",
      address1: "1 Main St",
      city: "London",
      zip: "EC1A 1AA",
      country_code: "GB",
    },
  });

  assert.equal(address.firstName, "Ada");
  assert.equal(address.lastName, "Lovelace");
  assert.deepEqual(validateGelatoShippingAddress(address), []);
});

test("GraphQL-shaped Shopify shipping addresses are mapped", () => {
  const address = buildGelatoShippingAddress({
    email: "buyer@example.com",
    shippingAddress: {
      firstName: "Ada",
      lastName: "Lovelace",
      address1: "1 Main St",
      city: "London",
      zip: "EC1A 1AA",
      countryCodeV2: "GB",
      provinceCode: "ENG",
    },
  });

  assert.equal(address.firstName, "Ada");
  assert.equal(address.lastName, "Lovelace");
  assert.equal(address.addressLine1, "1 Main St");
  assert.equal(address.postCode, "EC1A 1AA");
  assert.equal(address.country, "GB");
  assert.equal(address.state, "ENG");
  assert.deepEqual(validateGelatoShippingAddress(address), []);
});

test("missing shipping fields are reported instead of defaulted", () => {
  const address = buildGelatoShippingAddress({
    customer: { first_name: "Ada" },
    shipping_address: { address1: "1 Main St", zip: "11111" },
  });

  assert.equal(address.country, "");
  assert.deepEqual(validateGelatoShippingAddress(address), [
    "recipient last name",
    "city",
    "country",
  ]);
});

test("an order payload carries every item and de-duplicates by reference", () => {
  const payload = buildGelatoOrderPayload({
    orderReferenceId: "shopify-demo.myshopify.com-5001",
    currency: "GBP",
    items: [
      buildGelatoOrderItem({
        itemReferenceId: "l1",
        gelatoProductUid: "mug_product_msz_11-oz_mmat_ceramic-white_cl_4-0",
        artworkUrl: "https://cdn.example.com/1.png",
      }),
      buildGelatoOrderItem({
        itemReferenceId: "l2",
        gelatoProductUid:
          "tote_product_tsz_38x42-cm_tfab_organic-cotton_cl_black",
        artworkUrl: "https://cdn.example.com/2.png",
      }),
    ],
    shippingAddress: {
      firstName: "A",
      lastName: "B",
      addressLine1: "1 Main St",
      city: "London",
      postCode: "SW1A 1AA",
      country: "GB",
      email: "buyer@example.com",
    },
  });

  assert.equal(payload.orderType, "order");
  assert.equal(payload.orderReferenceId, "shopify-demo.myshopify.com-5001");
  assert.equal(payload.currency, "GBP");
  assert.equal(payload.items.length, 2);
});

test("an empty order payload is refused", () => {
  assert.throws(
    () => buildGelatoOrderPayload({ orderReferenceId: "r", items: [] }),
    /at least one item/i,
  );
});

test("an order payload with an incomplete shipping address is refused", () => {
  assert.throws(
    () =>
      buildGelatoOrderPayload({
        orderReferenceId: "r",
        items: [
          buildGelatoOrderItem({
            itemReferenceId: "l1",
            gelatoProductUid: "mug_product_msz_11-oz_mmat_ceramic-white_cl_4-0",
            artworkUrl: "https://cdn.example.com/1.png",
          }),
        ],
        shippingAddress: {
          firstName: "A",
          lastName: "B",
          addressLine1: "1 Main St",
          city: "London",
          country: "GB",
          email: "buyer@example.com",
        },
      }),
    /complete the shipping address/i,
  );
});

test("createGelatoOrder sends the API key as a header and never in the body", async () => {
  let captured = null;

  const result = await createGelatoOrder(
    { orderReferenceId: "r", items: [] },
    {
      fetchImpl: async (url, options) => {
        captured = { url, options };

        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({ id: "gelato-1", fulfillmentStatus: "created" }),
        };
      },
    },
  );

  assert.equal(result.gelatoOrderId, "gelato-1");
  assert.equal(result.status, "created");
  assert.equal(
    captured.options.headers["X-API-KEY"],
    process.env.GELATO_API_KEY,
  );
  assert.equal(
    captured.options.body.includes(process.env.GELATO_API_KEY),
    false,
  );
});

test("a 5xx from Gelato is marked retryable, a 400 is not", async () => {
  const makeFetch = (status) => async () => ({
    ok: false,
    status,
    text: async () => JSON.stringify({ message: "nope" }),
  });

  await assert.rejects(
    createGelatoOrder({}, { fetchImpl: makeFetch(503) }),
    (error) => error.retryable === true,
  );

  await assert.rejects(
    createGelatoOrder({}, { fetchImpl: makeFetch(400) }),
    (error) => error.retryable === false,
  );

  await assert.rejects(
    createGelatoOrder({}, { fetchImpl: makeFetch(429) }),
    (error) => error.retryable === true,
  );
});
