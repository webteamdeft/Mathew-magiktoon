import { authenticate } from "../shopify.server";
import { processOrderCreated } from "../lib/fulfillment.server";
import {
  buildGelatoShippingAddress,
  validateGelatoShippingAddress,
} from "../lib/gelato-orders.server";

function shopifyOrderGid(order) {
  if (
    typeof order?.admin_graphql_api_id === "string" &&
    order.admin_graphql_api_id
  ) {
    return order.admin_graphql_api_id;
  }

  if (order?.id) {
    return `gid://shopify/Order/${order.id}`;
  }

  return "";
}

async function fetchAdminShippingAddress(admin, order) {
  const id = shopifyOrderGid(order);

  if (!admin || !id) {
    return null;
  }

  let data;

  try {
    const response = await admin.graphql(
      `#graphql
        query OrderShippingAddress($id: ID!) {
          order(id: $id) {
            shippingAddress {
              name
              company
              address1
              address2
              city
              zip
              provinceCode
              countryCodeV2
              phone
            }
          }
        }
      `,
      { variables: { id } },
    );

    data = await response.json();
  } catch (error) {
    console.error("[webhook] could not fetch Shopify shipping address:", error);
    return null;
  }

  if (data?.errors?.length) {
    console.error(
      "[webhook] could not fetch Shopify shipping address:",
      data.errors,
    );
    return null;
  }

  return data?.data?.order || null;
}

async function ensureShippingAddress(order, admin) {
  if (
    validateGelatoShippingAddress(buildGelatoShippingAddress(order)).length ===
    0
  ) {
    return order;
  }

  const adminOrder = await fetchAdminShippingAddress(admin, order);

  if (!adminOrder?.shippingAddress) {
    return order;
  }

  return {
    ...order,
    shippingAddress: adminOrder.shippingAddress,
  };
}

/**
 * POST /webhooks/orders/create
 *
 * Reads the customization properties off every line item, resolves each one to
 * its Shopify -> Gelato mapping, and submits the customized items to Gelato as
 * a single order.
 *
 * Always returns 200. Shopify retries non-2xx responses, and a retry would be
 * pointless here: duplicate protection lives in the database, and genuine
 * submission failures are recorded as retryable rows the merchant can replay
 * from Gelato orders in the admin.
 */
export const action = async ({ request }) => {
  const { shop, topic, payload, admin } = await authenticate.webhook(request);

  console.log(`[webhook] ${topic} for ${shop}`);

  try {
    const order = await ensureShippingAddress(payload, admin);

    // Gelato downloads the artwork, so the URL it is given must be absolute.
    // Deriving the origin from the webhook request means fulfilment keeps
    // working even if SHOPIFY_APP_URL is unset, as it is under a dev tunnel.
    const result = await processOrderCreated({
      shop,
      order,
      baseUrl: new URL(request.url).origin,
    });

    console.log(
      `[webhook] order ${result.shopifyOrderId}: ` +
        `claimed=${result.claimed} skipped=${result.skipped} ` +
        `submitted=${result.submitted} failed=${result.failed} ` +
        `gelatoOrderId=${result.gelatoOrderId || "-"}`,
    );
  } catch (error) {
    console.error("[webhook] orders/create failed:", error);
  }

  return new Response();
};
