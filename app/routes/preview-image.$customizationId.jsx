/**
 * `/apps/<subpath>/preview-image/:customizationId` — the approved mockup.
 *
 * A stable path for the cart, which would otherwise hold a signed URL that
 * expires long before the shopper checks out.
 */
export { storefrontPreviewImageLoader as loader } from "../lib/storefront-handlers.server";
