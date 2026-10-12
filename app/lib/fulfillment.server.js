/**
 * Gelato fulfillment for Shopify orders.
 *
 * Entry points:
 *   - `processOrderCreated`  — called by the `orders/create` webhook.
 *   - `retryOrderItems`      — called by the admin "Retry" action and by
 *                              `processOrderCreated` when a webhook replays.
 *
 * Duplicate protection: a `GelatoOrderItem` row is claimed *before* any Gelato
 * call, guarded by the `(shop, shopifyOrderId, shopifyLineItemId)` unique
 * index. A replayed webhook loses the race on that insert and does nothing, so
 * a Shopify order can only ever produce one Gelato order. Gelato's own
 * `orderReferenceId` de-duplication is a second line of defence.
 *
 * SERVER ONLY.
 */

import defaultPrisma from "../db.server.js";
import { asArray, toTrimmedString } from "./normalize.js";
import { readCustomizationFromLineItem } from "./customization-properties.js";
import { findMappingForProduct as defaultFindMapping } from "./mappings.server.js";
import { buildFulfilmentArtworkUrl } from "./customizations.server.js";
import {
  FULFILMENT_TTL_MS,
  buildSignedAssetUrl,
} from "./signed-urls.server.js";
import {
  composePrintFile as defaultComposePrintFile,
  printFileCompositingEnabled,
} from "./print-file.server.js";
import { getShopSettings } from "./shop-settings.server.js";
import {
  buildGelatoOrderItem,
  buildGelatoOrderPayload,
  buildGelatoShippingAddress,
  createGelatoOrder as defaultCreateGelatoOrder,
  validateGelatoShippingAddress,
} from "./gelato-orders.server.js";

import {
  FULFILLMENT_STATUS,
  MAX_FULFILLMENT_ATTEMPTS,
} from "./fulfillment-status.js";

export { FULFILLMENT_STATUS, MAX_FULFILLMENT_ATTEMPTS };

function defaultDeps(overrides = {}) {
  return {
    prisma: defaultPrisma,
    createGelatoOrder: defaultCreateGelatoOrder,
    findMappingForProduct: defaultFindMapping,
    readSettings: getShopSettings,
    composePrintFile: defaultComposePrintFile,
    loadShopifyOrder: null,
    ...overrides,
  };
}

/** Stable, human-readable reference Gelato de-duplicates on. */
export function buildOrderReferenceId(shop, shopifyOrderId) {
  return `shopify-${toTrimmedString(shop)}-${toTrimmedString(shopifyOrderId)}`;
}

/**
 * Resolve which Gelato product/variant/template a line item should print.
 *
 * Precedence: the stored `Customization` (authoritative, written by our own
 * server) > the current admin mapping > the cart line properties (a fallback
 * for mappings edited between checkout and fulfillment).
 */
/**
 * A fetchable artwork URL, or "" if one cannot be produced.
 *
 * Signing requires an absolute URL because Gelato downloads the file. When no
 * base URL is configured that now throws, so it is caught here: falling through
 * to the URL captured at checkout is better than aborting the whole order, and
 * the reason is logged rather than swallowed.
 */
function safeFulfilmentArtworkUrl(customization, baseUrl) {
  try {
    return buildFulfilmentArtworkUrl(customization, { baseUrl });
  } catch (error) {
    console.error(
      "[fulfillment] artwork URL could not be signed:",
      error.message,
    );
    return "";
  }
}

/**
 * Attach the file Gelato will actually print.
 *
 * Gelato prints `files[].url` and nothing else. It cannot resolve the template
 * the mockup was rendered from, so a background layer (SOW 3.5) approved by the
 * customer would never reach the parcel. Compositing it into the artwork is the
 * only way the printed item can match what was approved (FR-20 / AC-03).
 *
 * Skipped when there is nothing to composite: without a background the raw
 * artwork already IS the correct print file, and re-encoding it would cost time
 * and a generation of quality to produce the same picture.
 *
 * A failure here never fails the order. Printing without the background is bad;
 * not printing at all is worse, and the reason is left on the record either way.
 */
async function attachPrintFile({
  shop,
  target,
  mapping,
  customization,
  baseUrl,
  deps,
}) {
  const compose = deps?.composePrintFile;
  const artworkKey = toTrimmedString(customization?.artworkKey);

  // Deliberately NOT triggered by "this design has a background". A template
  // can contribute images and text we do not hold, and replacing Gelato's
  // composite with ours would silently drop them. Opt in per deployment, per
  // the reasoning on .
  if (!compose || !artworkKey || !printFileCompositingEnabled()) return;

  const result = await compose({
    shop,
    mapping,
    artworkKey,
    textValues: customization?.personalizationText,
  });

  if (!result?.ok) {
    target.printFileError =
      result?.error || "The print file could not be built.";
    console.error(
      "[fulfillment] print file not composited:",
      target.printFileError,
    );
    return;
  }

  let url = "";

  try {
    url = buildSignedAssetUrl(result.key, {
      ttlMs: FULFILMENT_TTL_MS,
      baseUrl,
      requireAbsolute: true,
    });
  } catch (error) {
    target.printFileError = error.message;
    console.error(
      "[fulfillment] print file could not be signed:",
      error.message,
    );
    return;
  }

  // Kept so an order can always be traced back to the artwork it came from,
  // even though it is no longer what gets sent.
  target.sourceArtworkUrl = target.artworkUrl;

  target.printFileKey = result.key;
  target.printFileHasBackground = Boolean(result.hasBackground);
  target.printFileTextComposited = Boolean(result.textComposited);
  target.artworkUrl = url;
}

export async function resolveLineItemTarget({
  shop,
  lineItem,
  customizationProperties,
  baseUrl,
  deps,
}) {
  const { prisma, findMappingForProduct } = deps;

  let customization = null;

  if (customizationProperties.customizationId) {
    customization = await prisma.customization.findFirst({
      where: { id: customizationProperties.customizationId, shop },
      include: { productMapping: true },
    });
  }

  const mapping =
    customization?.productMapping ||
    (await findMappingForProduct(shop, lineItem?.product_id, {
      activeOnly: false,
    }));

  const target = {
    customizationId:
      customization?.id || customizationProperties.customizationId,
    productMappingId: customization?.productMappingId || mapping?.id || null,
    // Freshly signed at submission time (NFR-09): the URL captured at checkout
    // may already have expired, especially for an order held in review.
    artworkUrl:
      (customization ? safeFulfilmentArtworkUrl(customization, baseUrl) : "") ||
      toTrimmedString(customization?.artworkUrl) ||
      customizationProperties.artworkUrl,
    previewUrl:
      toTrimmedString(customization?.previewUrl) ||
      customizationProperties.previewUrl,
    gelatoTemplateId:
      toTrimmedString(customization?.gelatoTemplateId) ||
      toTrimmedString(mapping?.gelatoTemplateId) ||
      customizationProperties.gelatoTemplateId,
    gelatoVariantId:
      toTrimmedString(customization?.gelatoVariantId) ||
      toTrimmedString(mapping?.gelatoVariantId) ||
      customizationProperties.gelatoVariantId,
    gelatoProductId:
      toTrimmedString(customization?.gelatoProductId) ||
      toTrimmedString(mapping?.gelatoProductId) ||
      customizationProperties.gelatoProductId,
    gelatoProductUid:
      toTrimmedString(customization?.gelatoProductUid) ||
      toTrimmedString(mapping?.gelatoProductUid) ||
      customizationProperties.gelatoProductUid,
    placeholderName:
      toTrimmedString(customization?.gelatoPlaceholderName) ||
      toTrimmedString(mapping?.gelatoPlaceholderName) ||
      customizationProperties.placeholderName ||
      "ImageFront",
    printAreaName:
      toTrimmedString(customization?.gelatoPrintAreaName) ||
      toTrimmedString(mapping?.gelatoPrintAreaName) ||
      customizationProperties.printAreaName ||
      "front",
  };

  await attachPrintFile({
    shop,
    target,
    mapping,
    customization,
    baseUrl,
    deps,
  });

  return target;
}

/**
 * Claim every customized line item on an order.
 *
 * Returns the rows this invocation created. Rows another invocation already
 * claimed are reported separately as `skipped` and never resubmitted here.
 */
export async function claimOrderItems({
  shop,
  order,
  baseUrl,
  deps,
  // PENDING when the order goes straight through, PENDING_REVIEW when the
  // Client holds orders for approval first (Milestone 5).
  initialStatus = FULFILLMENT_STATUS.pending,
}) {
  const { prisma } = deps;

  const shopifyOrderId = toTrimmedString(order?.id);
  const shopifyOrderName = toTrimmedString(order?.name);
  const lineItems = asArray(order?.line_items);

  const claimed = [];
  const skipped = [];

  for (const lineItem of lineItems) {
    const customizationProperties = readCustomizationFromLineItem(lineItem);

    if (!customizationProperties.isCustomized) {
      continue;
    }

    const shopifyLineItemId = toTrimmedString(lineItem?.id);

    if (!shopifyLineItemId) {
      console.error("[fulfillment] line item without an id, skipping");
      continue;
    }

    const target = await resolveLineItemTarget({
      baseUrl,
      shop,
      lineItem,
      customizationProperties,
      deps,
    });

    let record;

    try {
      record = await prisma.gelatoOrderItem.create({
        data: {
          shop,
          shopifyOrderId,
          shopifyOrderName: shopifyOrderName || null,
          shopifyLineItemId,
          customizationId: target.customizationId || null,
          productMappingId: target.productMappingId,
          gelatoOrderReferenceId: buildOrderReferenceId(shop, shopifyOrderId),
          status: initialStatus,
          quantity:
            Number(lineItem?.quantity) > 0 ? Number(lineItem.quantity) : 1,
          artworkUrl: target.artworkUrl || null,
          previewUrl: target.previewUrl || null,
          requestPayload: {
            target,
            currency: toTrimmedString(order?.currency) || "USD",
            shippingAddress: buildGelatoShippingAddress(order),
            quantity:
              Number(lineItem?.quantity) > 0 ? Number(lineItem.quantity) : 1,
          },
        },
      });
    } catch (error) {
      if (error?.code === "P2002") {
        // A concurrent or replayed webhook already owns this line item.
        skipped.push(shopifyLineItemId);
        continue;
      }

      throw error;
    }

    claimed.push(record);
  }

  return { claimed, skipped };
}

/**
 * Submit a set of claimed rows to Gelato as a single order.
 *
 * Rows whose artwork or Gelato target is unusable are failed individually and
 * left out of the request rather than poisoning the whole order.
 */
export async function submitClaimedItems({ shop, order, records, deps }) {
  const { prisma, createGelatoOrder } = deps;

  const rows = asArray(records);

  if (rows.length === 0) {
    return { submitted: 0, failed: 0, gelatoOrderId: "" };
  }

  const items = [];
  const submittable = [];
  let failed = 0;

  for (const record of rows) {
    const payload = record?.requestPayload || {};
    const target = payload.target || {};

    try {
      items.push(
        buildGelatoOrderItem({
          itemReferenceId: record.shopifyLineItemId,
          gelatoTemplateId: target.gelatoTemplateId,
          gelatoVariantId: target.gelatoVariantId,
          gelatoProductUid: target.gelatoProductUid,
          artworkUrl: target.artworkUrl,
          placeholderName: target.placeholderName,
          printAreaName: target.printAreaName,
          quantity: payload.quantity || record.quantity || 1,
        }),
      );

      submittable.push(record);
    } catch (error) {
      failed += 1;

      await prisma.gelatoOrderItem.update({
        where: { id: record.id },
        data: {
          status: FULFILLMENT_STATUS.failed,
          attempts: { increment: 1 },
          lastError: error.message || "The Gelato item could not be built.",
        },
      });
    }
  }

  if (submittable.length === 0) {
    return { submitted: 0, failed, gelatoOrderId: "" };
  }

  const first = submittable[0];
  const firstPayload = first.requestPayload || {};
  const storedShippingAddress = firstPayload.shippingAddress;
  const freshShippingAddress = buildGelatoShippingAddress(order);
  const storedShippingMissing = validateGelatoShippingAddress(
    storedShippingAddress,
  );
  const freshShippingMissing =
    validateGelatoShippingAddress(freshShippingAddress);
  const shippingAddress =
    storedShippingMissing.length === 0
      ? storedShippingAddress
      : freshShippingMissing.length === 0
        ? freshShippingAddress
        : storedShippingAddress;

  const recordIds = submittable.map((record) => record.id);

  try {
    const orderPayload = buildGelatoOrderPayload({
      orderReferenceId: first.gelatoOrderReferenceId,
      customerReferenceId: toTrimmedString(order?.customer?.id) || shop,
      currency: firstPayload.currency,
      items,
      shippingAddress,
    });

    const result = await createGelatoOrder(orderPayload);

    await prisma.gelatoOrderItem.updateMany({
      where: { id: { in: recordIds } },
      data: {
        status: FULFILLMENT_STATUS.submitted,
        gelatoOrderId: result.gelatoOrderId || null,
        gelatoOrderStatus: result.status || null,
        attempts: { increment: 1 },
        lastError: null,
        submittedAt: new Date(),
      },
    });

    // `updateMany` cannot write JSON per row, so persist the response once each.
    await Promise.all(
      recordIds.map((recordId) =>
        prisma.gelatoOrderItem.update({
          where: { id: recordId },
          data: { responsePayload: result.raw ?? null },
        }),
      ),
    );

    return {
      submitted: submittable.length,
      failed,
      gelatoOrderId: result.gelatoOrderId,
    };
  } catch (error) {
    console.error("[fulfillment] Gelato order failed:", error);

    await prisma.gelatoOrderItem.updateMany({
      where: { id: { in: recordIds } },
      data: {
        status: FULFILLMENT_STATUS.failed,
        attempts: { increment: 1 },
        lastError:
          toTrimmedString(error.message) || "Gelato rejected the order.",
      },
    });

    return {
      submitted: 0,
      failed: failed + submittable.length,
      gelatoOrderId: "",
      error: error.message,
    };
  }
}

/**
 * Handle one `orders/create` payload end to end.
 *
 * Idempotent: replays claim nothing and submit nothing.
 */
export async function processOrderCreated(
  { shop, order, baseUrl },
  overrides = {},
) {
  const deps = defaultDeps(overrides);

  const shopifyOrderId = toTrimmedString(order?.id);

  if (!shop || !shopifyOrderId) {
    return {
      ok: false,
      error: "The order payload was missing a shop or an id.",
    };
  }

  const settings = await deps.readSettings(shop);
  const holdForReview = settings.orderReviewEnabled !== false;

  const { claimed, skipped } = await claimOrderItems({
    shop,
    order,
    baseUrl,
    deps,
    initialStatus: holdForReview
      ? FULFILLMENT_STATUS.pendingReview
      : FULFILLMENT_STATUS.pending,
  });

  if (claimed.length === 0) {
    return {
      ok: true,
      shopifyOrderId,
      claimed: 0,
      skipped: skipped.length,
      submitted: 0,
      failed: 0,
      heldForReview: 0,
      gelatoOrderId: "",
    };
  }

  // The whole point of the review step: the artwork is claimed and stored, but
  // nothing reaches Gelato until a person has looked at it.
  if (holdForReview) {
    return {
      ok: true,
      shopifyOrderId,
      claimed: claimed.length,
      skipped: skipped.length,
      submitted: 0,
      failed: 0,
      heldForReview: claimed.length,
      gelatoOrderId: "",
    };
  }

  const result = await submitClaimedItems({
    shop,
    order,
    records: claimed,
    deps,
  });

  return {
    ok: !result.error,
    shopifyOrderId,
    claimed: claimed.length,
    skipped: skipped.length,
    submitted: result.submitted,
    failed: result.failed,
    heldForReview: 0,
    gelatoOrderId: result.gelatoOrderId,
    error: result.error,
  };
}

/**
 * Release orders the Client has approved (Milestone 5).
 *
 * Everything needed to build the Gelato order was captured on the row at
 * checkout — currency, shipping address, the resolved Gelato target — so the
 * original Shopify payload is not needed here, which is what makes an order
 * approvable days later.
 *
 * The artwork URL is a deliberate exception: it is re-signed at submission
 * time, because the one captured at checkout may well have expired while the
 * order sat in review.
 */
export async function approveOrderItems(
  { shop, shopifyOrderId = "", gelatoOrderItemId = "", reviewedBy = "" },
  overrides = {},
) {
  const deps = defaultDeps(overrides);
  const { prisma } = deps;

  const where = { shop, status: FULFILLMENT_STATUS.pendingReview };

  if (toTrimmedString(gelatoOrderItemId))
    where.id = toTrimmedString(gelatoOrderItemId);
  if (toTrimmedString(shopifyOrderId))
    where.shopifyOrderId = toTrimmedString(shopifyOrderId);

  const records = await prisma.gelatoOrderItem.findMany({ where });

  if (records.length === 0) {
    return { ok: true, approved: 0, submitted: 0, failed: 0 };
  }

  // Moved out of review BEFORE submitting, so a second click while the first
  // request is in flight finds nothing to approve and cannot double-submit.
  await prisma.gelatoOrderItem.updateMany({
    where: { id: { in: records.map((record) => record.id) } },
    data: {
      status: FULFILLMENT_STATUS.pending,
      reviewedBy: toTrimmedString(reviewedBy) || null,
      reviewedAt: new Date(),
    },
  });

  // One Gelato order per Shopify order, so submit in per-order batches.
  const byOrder = new Map();

  for (const record of records) {
    const list = byOrder.get(record.shopifyOrderId) || [];
    list.push(record);
    byOrder.set(record.shopifyOrderId, list);
  }

  let submitted = 0;
  let failed = 0;

  for (const [, batch] of byOrder) {
    const loadedOrder = deps.loadShopifyOrder
      ? await deps.loadShopifyOrder(batch[0]?.shopifyOrderId)
      : null;
    const result = await submitClaimedItems({
      shop,
      order: loadedOrder,
      records: batch,
      deps,
    });

    submitted += result.submitted;
    failed += result.failed;
  }

  return { ok: true, approved: records.length, submitted, failed };
}

/**
 * Decline orders the Client does not want printed.
 *
 * Terminal by design: a rejected row is never submitted and never picked up by
 * a retry. The artwork is left in place so the reason can still be examined.
 */
export async function rejectOrderItems(
  {
    shop,
    shopifyOrderId = "",
    gelatoOrderItemId = "",
    reason = "",
    reviewedBy = "",
  },
  overrides = {},
) {
  const deps = defaultDeps(overrides);
  const { prisma } = deps;

  const where = {
    shop,
    status: {
      in: [
        FULFILLMENT_STATUS.pendingReview,
        FULFILLMENT_STATUS.pending,
        FULFILLMENT_STATUS.failed,
      ],
    },
  };

  if (toTrimmedString(gelatoOrderItemId))
    where.id = toTrimmedString(gelatoOrderItemId);
  if (toTrimmedString(shopifyOrderId))
    where.shopifyOrderId = toTrimmedString(shopifyOrderId);

  const result = await prisma.gelatoOrderItem.updateMany({
    where,
    data: {
      status: FULFILLMENT_STATUS.rejected,
      lastError: toTrimmedString(reason) || "Rejected by the merchant.",
      reviewedBy: toTrimmedString(reviewedBy) || null,
      reviewedAt: new Date(),
    },
  });

  return { ok: true, rejected: result.count };
}

/**
 * Retry failed items, either for one order or for every failure in the shop.
 *
 * Rows past `MAX_FULFILLMENT_ATTEMPTS` are left alone so a permanently bad
 * payload cannot be retried forever; the admin surfaces them as exhausted.
 */
export async function retryOrderItems(
  { shop, shopifyOrderId = "", gelatoOrderItemId = "" },
  overrides = {},
) {
  const deps = defaultDeps(overrides);
  const { prisma } = deps;

  const where = {
    shop,
    status: FULFILLMENT_STATUS.failed,
    attempts: { lt: MAX_FULFILLMENT_ATTEMPTS },
  };

  if (toTrimmedString(gelatoOrderItemId)) {
    where.id = toTrimmedString(gelatoOrderItemId);
  }

  if (toTrimmedString(shopifyOrderId)) {
    where.shopifyOrderId = toTrimmedString(shopifyOrderId);
  }

  const records = await prisma.gelatoOrderItem.findMany({ where });

  if (records.length === 0) {
    return { ok: true, retried: 0, submitted: 0, failed: 0 };
  }

  // One Gelato order per Shopify order, so retry in per-order batches.
  const byOrder = new Map();

  for (const record of records) {
    const key = record.shopifyOrderId;
    byOrder.set(key, [...(byOrder.get(key) || []), record]);
  }

  let submitted = 0;
  let failed = 0;

  for (const [orderId, orderRecords] of byOrder) {
    const loadedOrder = deps.loadShopifyOrder
      ? await deps.loadShopifyOrder(orderId)
      : null;

    const result = await submitClaimedItems({
      shop,
      order: loadedOrder || { id: orderId },
      records: orderRecords,
      deps,
    });

    submitted += result.submitted;
    failed += result.failed;
  }

  return { ok: true, retried: records.length, submitted, failed };
}

/** Fulfillment rows for the admin screen, newest first. */
/**
 * Every Gelato line item for a shop, newest first, with **freshly minted**
 * artwork and preview URLs.
 *
 * The URLs persisted on the row were signed at webhook time against whatever
 * `SHOPIFY_APP_URL` was then. In development that is a `trycloudflare` tunnel
 * that changes on every `shopify app dev`, so a stored absolute URL points at
 * a host that no longer exists and the admin thumbnail silently breaks. The
 * signature also carries an expiry, which a stored URL eventually crosses.
 *
 * Both problems disappear by treating the stored URL as a fallback and signing
 * the *key* again at read time, against the origin actually serving this
 * request — the same approach `buildFulfilmentArtworkUrl` already takes for
 * Gelato. Short-lived by design (NFR-09): the link is re-minted on every load.
 *
 * @param {string} shop
 * @param {object} [options]
 * @param {number} [options.take]
 * @param {string} [options.baseUrl] Origin to sign against. Pass the current
 *   request URL from an embedded admin page: the page renders inside an iframe
 *   on `admin.shopify.com`, where a relative `/uploads/...` would resolve to
 *   Shopify's own host rather than to this app.
 */
export async function listGelatoOrderItems(shop, { take = 100, baseUrl } = {}) {
  const records = await defaultPrisma.gelatoOrderItem.findMany({
    where: { shop },
    orderBy: { createdAt: "desc" },
    take,
    include: {
      productMapping: true,
      // Only the keys are needed, but the relation also carries the stored
      // URLs, which are the fallback for rows written before keys existed.
      customization: true,
    },
  });

  return asArray(records).map((record) => ({
    ...record,
    // Frozen at approval (Milestone 6). Later admin edits never touch it, so
    // this is what the merchant is actually approving.
    configSnapshot: record.customization?.configSnapshot || null,
    artworkUrl: freshAssetUrl(
      record.customization?.artworkKey,
      record.artworkUrl || record.customization?.artworkUrl,
      baseUrl,
    ),
    previewUrl: freshAssetUrl(
      record.customization?.previewKey,
      record.previewUrl || record.customization?.previewUrl,
      baseUrl,
    ),
  }));
}

/**
 * Re-sign a stored asset key for immediate viewing, falling back to whatever
 * URL was persisted when there is no key to sign (legacy rows, or artwork that
 * only ever arrived as a cart property pointing at somebody else's host).
 */
export function freshAssetUrl(key, storedUrl, baseUrl) {
  const storageKey = toTrimmedString(key);

  if (!storageKey) {
    return toTrimmedString(storedUrl);
  }

  try {
    return buildSignedAssetUrl(storageKey, { baseUrl, requireAbsolute: true });
  } catch (error) {
    // A missing signing secret or base URL must not blank the whole page: a
    // stale link is no worse than none, and the cause is logged.
    console.error("[fulfillment] could not sign asset URL:", error);

    return toTrimmedString(storedUrl);
  }
}
