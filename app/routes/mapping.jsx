/**
 * GET /mapping
 *
 * This is where the app proxy actually delivers a storefront request to
 * `https://<shop>/apps/magiktoon/mapping` — Shopify strips the `apps/magiktoon`
 * prefix before forwarding. See `app/lib/storefront-handlers.server.js`.
 */
export { storefrontMappingLoader as loader } from "../lib/storefront-handlers.server";
