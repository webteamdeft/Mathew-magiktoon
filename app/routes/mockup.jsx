/**
 * POST /mockup
 *
 * The path the app receives once Shopify has stripped the proxy prefix.
 * Same handler as `/apps/magiktoon/mockup`.
 */
export { storefrontMockupAction as action } from "../lib/storefront-handlers.server";
