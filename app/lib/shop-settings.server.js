/**
 * Per-shop application settings (SERVER ONLY).
 *
 * Currently one setting: whether paid orders are held for the Client to
 * approve before they are sent to Gelato (SOW section 4.3, Milestone 5).
 */

import prisma from "../db.server.js";
import { toTrimmedString } from "./normalize.js";

/**
 * The agreed default, from the assumptions in the SOW:
 *
 *   "By default, each paid order is held for the Client's review and is
 *    submitted to Gelato only after the Client approves it."
 *
 * A shop that has never opened the settings therefore behaves as agreed rather
 * than as whatever an empty row would imply.
 */
export const DEFAULT_ORDER_REVIEW_ENABLED = true;

export const DEFAULT_SETTINGS = {
  orderReviewEnabled: DEFAULT_ORDER_REVIEW_ENABLED,
};

/**
 * Read a shop's settings, without creating a row.
 *
 * Deliberately read-only: this runs inside the `orders/create` webhook, and a
 * write there would turn a read into a possible failure on the hot path.
 */
export async function getShopSettings(shop, { db = prisma } = {}) {
  const name = toTrimmedString(shop);

  if (!name) return { ...DEFAULT_SETTINGS };

  try {
    const row = await db.shopSetting.findUnique({ where: { shop: name } });

    if (!row) return { ...DEFAULT_SETTINGS };

    return { orderReviewEnabled: row.orderReviewEnabled !== false };
  } catch (error) {
    // A settings read must never be the reason an order is lost. Falling back
    // to the agreed default holds the order for review, which is the safe
    // direction: nothing is printed that the Client has not seen.
    console.error("[settings] could not be read, using defaults:", error);

    return { ...DEFAULT_SETTINGS };
  }
}

/** Turn the order-review step on or off for every order in this shop. */
export async function setOrderReviewEnabled(shop, enabled, { db = prisma } = {}) {
  const name = toTrimmedString(shop);

  if (!name) {
    return { ok: false, error: "The shop could not be identified." };
  }

  const value = Boolean(enabled);

  const row = await db.shopSetting.upsert({
    where: { shop: name },
    update: { orderReviewEnabled: value },
    create: { shop: name, orderReviewEnabled: value },
  });

  return { ok: true, orderReviewEnabled: row.orderReviewEnabled };
}
