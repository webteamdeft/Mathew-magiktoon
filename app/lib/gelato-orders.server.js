/**
 * Gelato Order API (v4) client.
 *
 * SERVER ONLY. The Gelato API key lives in `process.env.GELATO_API_KEY` and is
 * never serialised into a loader response or shipped to the browser.
 */

import { asArray, toTrimmedString } from "./normalize.js";

const GELATO_ORDER_API = "https://order.gelatoapis.com/v4";

function getApiKey() {
  const apiKey = process.env.GELATO_API_KEY;

  if (!apiKey || !apiKey.trim()) {
    throw new Error("GELATO_API_KEY is missing");
  }

  return apiKey.trim();
}

async function orderRequest(path, options = {}, fetchImpl = fetch) {
  const response = await fetchImpl(`${GELATO_ORDER_API}${path}`, {
    ...options,
    headers: {
      "X-API-KEY": getApiKey(),
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });

  const text = await response.text();

  let data;

  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  if (!response.ok) {
    const message = typeof data === "string" ? data : JSON.stringify(data);

    const error = new Error(`Gelato Order API ${response.status}: ${message}`);
    error.status = response.status;
    error.responseBody = data;

    // 4xx other than 408/429 will never succeed on retry.
    error.retryable =
      response.status === 408 ||
      response.status === 429 ||
      response.status >= 500;

    throw error;
  }

  return data;
}

/**
 * Map a Shopify webhook address onto Gelato's shipping address shape.
 *
 * Gelato requires country/city/postcode/address1 and a recipient name; missing
 * optional fields are omitted rather than sent as `null`.
 */
export function buildGelatoShippingAddress(order) {
  const address = order?.shipping_address || order?.shippingAddress || {};

  const fullName = toTrimmedString(address.name);
  const nameParts = fullName.split(/\s+/).filter(Boolean);
  const firstName =
    toTrimmedString(address.first_name) ||
    toTrimmedString(address.firstName) ||
    toTrimmedString(order?.customer?.first_name) ||
    toTrimmedString(order?.customer?.firstName) ||
    nameParts[0] ||
    "";
  const lastName =
    toTrimmedString(address.last_name) ||
    toTrimmedString(address.lastName) ||
    toTrimmedString(order?.customer?.last_name) ||
    toTrimmedString(order?.customer?.lastName) ||
    nameParts.slice(1).join(" ");

  const shippingAddress = {
    firstName,
    lastName,
    addressLine1:
      toTrimmedString(address.address1) ||
      toTrimmedString(address.addressLine1),
    city: toTrimmedString(address.city),
    postCode: toTrimmedString(address.zip) || toTrimmedString(address.postCode),
    country:
      toTrimmedString(address.country_code) ||
      toTrimmedString(address.countryCode) ||
      toTrimmedString(address.countryCodeV2) ||
      toTrimmedString(address.country),
    email:
      toTrimmedString(order?.email) ||
      toTrimmedString(order?.contact_email) ||
      toTrimmedString(order?.customer?.email) ||
      toTrimmedString(address.email),
  };

  const addressLine2 =
    toTrimmedString(address.address2) || toTrimmedString(address.addressLine2);
  if (addressLine2) shippingAddress.addressLine2 = addressLine2;

  const company = toTrimmedString(address.company);
  if (company) shippingAddress.companyName = company;

  const state =
    toTrimmedString(address.province_code) ||
    toTrimmedString(address.provinceCode);
  if (state) shippingAddress.state = state;

  const phone = toTrimmedString(address.phone) || toTrimmedString(order?.phone);
  if (phone) shippingAddress.phone = phone;

  return shippingAddress;
}

const REQUIRED_SHIPPING_FIELDS = [
  ["firstName", "recipient first name"],
  ["lastName", "recipient last name"],
  ["addressLine1", "address line 1"],
  ["city", "city"],
  ["postCode", "postcode"],
  ["country", "country"],
];

export function validateGelatoShippingAddress(shippingAddress) {
  const missing = [];

  for (const [field, label] of REQUIRED_SHIPPING_FIELDS) {
    if (!toTrimmedString(shippingAddress?.[field])) {
      missing.push(label);
    }
  }

  return missing;
}

export function assertGelatoShippingAddress(shippingAddress) {
  const missing = validateGelatoShippingAddress(shippingAddress);

  if (missing.length > 0) {
    throw new Error(
      "Please complete the shipping address before sending this order to Gelato. " +
        `Missing: ${missing.join(", ")}.`,
    );
  }
}

/**
 * Print-area names the Order API understands.
 *
 * NOT the same vocabulary as the E-commerce API. A Gelato template publishes
 * `printArea: "1"` for its image placeholders, and copying that straight into
 * an order sends a file the API has no print area to attach it to.
 */
const ORDER_API_FILE_TYPES = new Set([
  "default",
  "front",
  "back",
  "inside",
  "outside",
  "neck-inner",
  "neck-outer",
  "sleeve-left",
  "sleeve-right",
  "chest-left",
  "chest-right",
]);

/**
 * The print area to address the artwork by.
 *
 * Anything the Order API does not recognise — most importantly the numeric
 * identifier the E-commerce API publishes — becomes "default", which every
 * single-area product accepts.
 */
export function normalizeOrderFileType(printAreaName) {
  const name = toTrimmedString(printAreaName).toLowerCase();

  return ORDER_API_FILE_TYPES.has(name) ? name : "default";
}

/**
 * Build one Gelato order item.
 *
 * ALWAYS keyed on `productUid`, because that is the only identifier the Order
 * API actually resolves. Verified against the live API with draft orders:
 *
 *   templateId + variantId                  -> productUid null, "not_connected"
 *   templateId + variantId + files[type]    -> productUid null, "not_connected"
 *   templateId alone                        -> productUid null, "not_connected"
 *   storeProductVariantId (+/- files)       -> echoed back, still not resolved
 *   productUid + files[type]                -> RESOLVED, item "created"
 *
 * An unresolved item has no product, no price and never enters production; it
 * simply sits in Gelato as a draft, which is exactly what was happening to
 * every order this app submitted.
 *
 * The variant is carried BY the productUid — `..._ceramic-white_...` and
 * `..._ceramic-black_...` are different UIDs — so no separate variant id is
 * needed or sent. `templateId` is still attached for traceability; sending it
 * alongside a productUid was verified not to affect resolution.
 */
export function buildGelatoOrderItem({
  itemReferenceId,
  gelatoTemplateId,
  // Accepted but not sent. Gelato's own variant ids — whether from a template
  // or from a connected store product — do not resolve an order item; the
  // productUid identifies the exact variant on its own.
  // eslint-disable-next-line no-unused-vars
  gelatoVariantId,
  gelatoProductUid,
  artworkUrl,
  // Accepted but not sent: Gelato rejects `files[].id` unless it is a
  // placeholder UUID its E-commerce API never publishes.
  // eslint-disable-next-line no-unused-vars
  placeholderName,
  printAreaName,
  quantity = 1,
}) {
  const reference = toTrimmedString(itemReferenceId);
  const artwork = toTrimmedString(artworkUrl);

  if (!reference) {
    throw new Error("Gelato order item requires an itemReferenceId");
  }

  if (!artwork) {
    throw new Error("Gelato order item requires an artwork URL");
  }

  const safeQuantity =
    Number.isFinite(Number(quantity)) && Number(quantity) > 0
      ? Math.floor(Number(quantity))
      : 1;

  const productUid = toTrimmedString(gelatoProductUid);

  // Deliberately NOT falling back to the store-product GUID or to a template
  // id: neither resolves, and an order Gelato silently parks as a draft is far
  // worse than a submission that fails loudly with a fixable reason.
  if (!productUid) {
    throw new Error(
      "Gelato order item requires a catalog product UID " +
        '(for example "mug_product_msz_11-oz_mmat_ceramic-white_cl_4-0"). ' +
        "A template ID alone is not enough: the Order API does not resolve it.",
    );
  }

  const item = {
    itemReferenceId: reference,
    productUid,
    quantity: safeQuantity,
    files: [
      {
        type: normalizeOrderFileType(printAreaName),
        url: artwork,
      },
    ],
  };

  // Reference only, so an order can be traced back to the design it came from.
  const templateId = toTrimmedString(gelatoTemplateId);
  if (templateId) item.templateId = templateId;

  return item;
}

/**
 * Build the full Gelato order body for one Shopify order.
 *
 * `items` must already be built with `buildGelatoOrderItem`.
 */
export function buildGelatoOrderPayload({
  orderReferenceId,
  customerReferenceId,
  currency,
  items,
  shippingAddress,
  shipmentMethodUid = "normal",
  // "draft" creates the order in Gelato without sending it to production or
  // charging for it, which is how the submission path can be proved end to end
  // against the real API without printing anything.
  orderType = "order",
}) {
  const orderItems = asArray(items);

  if (orderItems.length === 0) {
    throw new Error("A Gelato order requires at least one item");
  }

  if (orderType !== "order" && orderType !== "draft") {
    throw new Error(`Unsupported Gelato order type: ${orderType}`);
  }

  assertGelatoShippingAddress(shippingAddress);

  return {
    orderType,
    orderReferenceId: toTrimmedString(orderReferenceId),
    customerReferenceId:
      toTrimmedString(customerReferenceId) || toTrimmedString(orderReferenceId),
    currency: toTrimmedString(currency) || "USD",
    shipmentMethodUid,
    items: orderItems,
    shippingAddress,
  };
}

/** POST a prepared order body to Gelato. */
export async function createGelatoOrder(payload, { fetchImpl = fetch } = {}) {
  const data = await orderRequest(
    "/orders",
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
    fetchImpl,
  );

  return {
    gelatoOrderId: toTrimmedString(data?.id) || toTrimmedString(data?.orderId),
    status:
      toTrimmedString(data?.fulfillmentStatus) ||
      toTrimmedString(data?.status) ||
      "CREATED",
    raw: data,
  };
}

/** Fetch the current status of a previously created Gelato order. */
export async function getGelatoOrder(
  gelatoOrderId,
  { fetchImpl = fetch } = {},
) {
  const id = toTrimmedString(gelatoOrderId);

  if (!id) {
    throw new Error("Gelato order ID is required");
  }

  const data = await orderRequest(
    `/orders/${encodeURIComponent(id)}`,
    { method: "GET" },
    fetchImpl,
  );

  return {
    gelatoOrderId: toTrimmedString(data?.id) || id,
    status:
      toTrimmedString(data?.fulfillmentStatus) ||
      toTrimmedString(data?.status) ||
      "UNKNOWN",
    raw: data,
  };
}
