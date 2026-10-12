/**
 * POST /generate
 *
 * The path the app receives once Shopify has stripped the proxy prefix.
 * Same handler as `/apps/magiktoon/generate`.
 */
export { storefrontGenerateAction as action } from "../lib/storefront-handlers.server";
