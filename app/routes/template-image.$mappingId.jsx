/**
 * `/apps/<subpath>/template-image/:mappingId` — the Gelato preview image.
 *
 * A stable URL in front of Gelato's presigned, 24-hour S3 links. See
 * `gelato-preview.server.js` for why the raw URL must not reach the storefront.
 */
export { storefrontTemplateImageLoader as loader } from "../lib/storefront-handlers.server";
