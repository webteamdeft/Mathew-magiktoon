/**
 * `/apps/<subpath>/customize` — the dedicated full-page customizer.
 *
 * Shopify's app proxy strips the prefix, so this route sees `/customize`. The
 * prefixed shape is registered in `apps.magiktoon.customize.jsx`; both delegate
 * to the same handler.
 */
export { storefrontCustomizePageLoader as loader } from "../lib/storefront-handlers.server";
