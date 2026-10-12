/**
 * Fulfillment status vocabulary shared by the admin UI and the server.
 *
 * Client-safe on purpose: the admin screen renders these constants, so they
 * must not live in `fulfillment.server.js` — importing a `.server` module from
 * a component would pull the Gelato client (and its API key handling) into the
 * browser bundle.
 */

export const MAX_FULFILLMENT_ATTEMPTS = 5;

export const FULFILLMENT_STATUS = {
  /// Claimed, and on its way to Gelato.
  pending: "PENDING",
  /// Held for the Client to approve before it reaches Gelato (Milestone 5).
  pendingReview: "PENDING_REVIEW",
  /// The Client declined it. Terminal: never submitted, never retried.
  rejected: "REJECTED",
  submitted: "SUBMITTED",
  failed: "FAILED",
};

/** Human label for a status, for the admin. */
export const FULFILLMENT_STATUS_LABELS = {
  PENDING: "Pending",
  PENDING_REVIEW: "Awaiting your approval",
  REJECTED: "Rejected",
  SUBMITTED: "Submitted",
  FAILED: "Failed",
};

/** Polaris `Badge` tone for a fulfillment status. */
export function fulfillmentTone(status) {
  if (status === FULFILLMENT_STATUS.submitted) return "success";
  if (status === FULFILLMENT_STATUS.failed) return "critical";
  if (status === FULFILLMENT_STATUS.rejected) return "critical";
  if (status === FULFILLMENT_STATUS.pendingReview) return "info";
  return "attention";
}

/** True when this row is waiting for the Client to approve or reject it. */
export function isAwaitingReview(item) {
  return item?.status === FULFILLMENT_STATUS.pendingReview;
}

/** True when a row can still be retried. */
export function isRetryable(item, maxAttempts = MAX_FULFILLMENT_ATTEMPTS) {
  return (
    item?.status === FULFILLMENT_STATUS.failed && Number(item?.attempts) < maxAttempts
  );
}
