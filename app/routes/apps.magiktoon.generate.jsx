/**
 * POST /apps/magiktoon/generate
 *
 * Only reached when the app proxy `url` is configured with a path of its own.
 * Same handler as `/generate`.
 */
export { storefrontGenerateAction as action } from "../lib/storefront-handlers.server";
