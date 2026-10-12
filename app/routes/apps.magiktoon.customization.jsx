/**
 * POST /apps/magiktoon/customization
 *
 * Only reached when the app proxy `url` is configured with a path of its own.
 * Same handler as `/customization`.
 */
export {
  storefrontCustomizationAction as action,
  storefrontCustomizationLoader as loader,
} from "../lib/storefront-handlers.server";
