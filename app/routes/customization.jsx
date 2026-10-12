/**
 * POST /customization
 *
 * Where the app proxy delivers `https://<shop>/apps/magiktoon/customization`.
 * See `app/lib/storefront-handlers.server.js`.
 */
export {
  storefrontCustomizationAction as action,
  storefrontCustomizationLoader as loader,
} from "../lib/storefront-handlers.server";
