/**
 * POST /apps/magiktoon/mockup
 *
 * Only reached when the app proxy `url` is configured with a path of its own.
 * Same handler as `/mockup`.
 */
export { storefrontMockupAction as action } from "../lib/storefront-handlers.server";
