/**
 * `/apps/<subpath>/layer-image/:mappingId?l=<layer name>` — a design's fixed
 * layer artwork.
 *
 * Gelato names a template's image placeholders but publishes none of their
 * artwork, so every layer that is not the customer's photo is an image the
 * merchant uploaded. See `storefront-handlers.server.js`.
 */
export { storefrontLayerImageLoader as loader } from "../lib/storefront-handlers.server";
