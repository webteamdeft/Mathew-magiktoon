/**
 * The path-bearing shape of the customizer page.
 *
 * Used when the app proxy `url` carries a path of its own and Shopify forwards
 * the full `/apps/magiktoon/customize`. See `customize.jsx`.
 */
export { storefrontCustomizePageLoader as loader } from "../lib/storefront-handlers.server";
