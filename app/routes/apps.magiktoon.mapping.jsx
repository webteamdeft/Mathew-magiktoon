/**
 * GET /apps/magiktoon/mapping
 *
 * Only reached when the app proxy `url` is configured with a path of its own,
 * in which case Shopify forwards the prefixed path unchanged. Same handler as
 * `/mapping` so the two can never diverge.
 */
export { storefrontMappingLoader as loader } from "../lib/storefront-handlers.server";
