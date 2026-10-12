/**
 * Shared handlers for the storefront app-proxy endpoints.
 *
 * WHY THIS EXISTS
 * ---------------
 * Shopify's app proxy strips the configured prefix and subpath before
 * forwarding. With `url = "https://<app>"`, `prefix = "apps"` and
 * `subpath = "magiktoon"`, a storefront request to
 *
 *     https://shop.myshopify.com/apps/magiktoon/mapping?product_id=1
 *
 * arrives at the app as
 *
 *     https://<app>/mapping?product_id=1&shop=…&signature=…
 *
 * — i.e. `/mapping`, not `/apps/magiktoon/mapping`. If the proxy `url` is ever
 * given a path of its own, the prefixed form arrives instead. Both shapes are
 * therefore registered as routes, and both delegate here so the behaviour can
 * never drift between them.
 *
 * SERVER ONLY.
 */

import prisma from "../db.server.js";
import {
  authenticateStorefrontRequest,
  storefrontJson,
} from "./app-proxy.server.js";
import {
  getMappingById,
  findMappingForProductDesign,
  listMappingsForProduct,
  toStorefrontMapping,
} from "./mappings.server.js";
import { fixedImageLayers } from "./layers.js";
import { readAsset } from "./storage.server.js";
import { getCustomization, saveCustomization, storeImage } from "./customizations.server.js";
import { generateArtwork } from "./generation.server.js";
import { renderGelatoMockup } from "./gelato-mockup.server.js";
import {
  FULFILMENT_TTL_MS,
  buildSignedAssetUrl,
} from "./signed-urls.server.js";
import { buildLineItemProperties } from "./customization-properties.js";
import { renderCustomizePage } from "./customize-page.server.js";
import {
  customizationProxyPath,
  generateProxyPath,
  mockupProxyPath,
  normalizeProxyBase,
} from "./proxy-paths.js";
import {
  IMAGE_CACHE_SECONDS,
  fetchTemplatePreview,
  resolveTemplateImages,
} from "./gelato-preview.server.js";
import { toNumericShopifyId, toTrimmedString } from "./normalize.js";

/**
 * GET → the Gelato mapping for the current storefront product.
 *
 * Returns `{ ok: false, reason: "not-mapped" }` with HTTP 200 when the product
 * has no active mapping. That is a normal state for most products in a store,
 * not an error, and the block simply keeps itself hidden.
 */
export async function storefrontMappingLoader({ request }) {
  const auth = await authenticateStorefrontRequest(request);

  if (!auth.ok) {
    return storefrontJson(
      { ok: false, error: auth.error, mapping: null },
      { status: auth.status || 401 },
    );
  }

  const url = new URL(request.url);
  const productId = toTrimmedString(url.searchParams.get("product_id"));

  if (!productId) {
    return storefrontJson(
      { ok: false, error: "A product_id is required.", mapping: null },
      { status: 400 },
    );
  }

  // Every design this Shopify product offers. The product itself is never
  // swapped for a Gelato one: these are design options *on* it, and the
  // customer chooses between them before customizing.
  const options = await listMappingsForProduct(auth.shop, productId, {
    activeOnly: true,
  });

  if (options.length === 0) {
    return storefrontJson({
      ok: false,
      reason: "not-mapped",
      productId,
      mapping: null,
      templates: [],
    });
  }

  // How many images each design really has, resolved now rather than trusted
  // from the column. That column is only written by `--refresh`, so editing a
  // mapping in admin left it stale and the thumbnail strip drew the wrong
  // number of tiles. `resolveTemplateImages` is cached for hours, so this costs
  // one Gelato call per design at most.
  const templates = await Promise.all(
    options.map(async (option) => {
      const mapping = toStorefrontMapping(option);

      try {
        const images = await resolveTemplateImages(option);

        if (images.length > 0) {
          mapping.imagePaths = images.map((unused, index) =>
            index === 0
              ? `/template-image/${option.id}`
              : `/template-image/${option.id}?i=${index}`,
          );
        }
      } catch (error) {
        // Keep the stored count rather than dropping the design entirely.
        console.error("[storefront] image count lookup failed:", error);
      }

      return mapping;
    }),
  );

  return storefrontJson({
    ok: true,
    productId,
    templates,
    // The default selection, and what older block versions read.
    mapping: templates[0],
  });
}

/**
 * POST → store the artwork and preview, and return the cart line properties.
 *
 * The properties are built server-side from the mapping so the Gelato ids on
 * the cart line always match the admin configuration.
 */
export async function storefrontCustomizationAction({ request }) {
  if (request.method !== "POST") {
    return storefrontJson(
      { ok: false, error: "Use POST to save a customization." },
      { status: 405 },
    );
  }

  const auth = await authenticateStorefrontRequest(request);

  if (!auth.ok) {
    return storefrontJson(
      { ok: false, error: auth.error },
      { status: auth.status || 401 },
    );
  }

  let body;

  try {
    body = await request.json();
  } catch {
    return storefrontJson(
      { ok: false, error: "The request body must be JSON." },
      { status: 400 },
    );
  }

  const productId = toTrimmedString(body?.productId);

  if (!productId) {
    return storefrontJson(
      { ok: false, error: "A productId is required." },
      { status: 400 },
    );
  }

  // The design the customer picked, verified against this product so a mapping
  // belonging to another product can never be paired with it.
  const mapping = await findMappingForProductDesign(
    auth.shop,
    productId,
    toTrimmedString(body?.mappingId),
    { activeOnly: true },
  );

  if (!mapping) {
    return storefrontJson(
      { ok: false, error: "This product is not available for customization." },
      { status: 404 },
    );
  }

  const result = await saveCustomization({
    shop: auth.shop,
    mapping,
    artworkDataUrl: body?.artwork,
    previewDataUrl: body?.preview,
    // The approved design lets the customer drag to move and +/- to zoom, so
    // their placement is accepted here — clamped server-side, never trusted raw.
    placement: body?.placement,
    personalizationText: body?.text,
    shopifyVariantId: body?.variantId,
    // How many AI generations the customer went through before accepting this
    // artwork (FR-05 / NFR-06).
    generationCount: body?.generations,
    // The Gelato mockup they approved, when they previewed on the product.
    mockupKey: body?.mockupKey,
    requestUrl: request.url,
  });

  if (!result.ok) {
    return storefrontJson({ ok: false, error: result.error }, { status: 400 });
  }

  return storefrontJson({
    ok: true,
    customizationId: result.customization.id,
    artworkUrl: result.customization.artworkUrl,
    previewUrl: result.customization.previewUrl || "",
    properties: result.properties,
  });
}

/**
 * POST → generate AI artwork from the customer's photo (Milestone 4).
 *
 * Body: { productId, mappingId, image (data URL), regenerate }
 *
 * The prompt, model and resolution are never taken from the request: they are
 * read from the mapping the product resolves to, so a crafted request cannot
 * run its own prompt against the shop's AI budget.
 */
export async function storefrontGenerateAction({ request }) {
  if (request.method !== "POST") {
    return storefrontJson(
      { ok: false, error: "Use POST to generate artwork." },
      { status: 405 },
    );
  }

  const auth = await authenticateStorefrontRequest(request);

  if (!auth.ok) {
    return storefrontJson(
      { ok: false, error: auth.error },
      { status: auth.status || 401 },
    );
  }

  let body;

  try {
    body = await request.json();
  } catch {
    return storefrontJson(
      { ok: false, error: "The request body must be JSON." },
      { status: 400 },
    );
  }

  const productId = toTrimmedString(body?.productId);

  if (!productId) {
    return storefrontJson(
      { ok: false, error: "A productId is required." },
      { status: 400 },
    );
  }

  const mapping = await findMappingForProductDesign(
    auth.shop,
    productId,
    toTrimmedString(body?.mappingId),
    { activeOnly: true },
  );

  if (!mapping) {
    return storefrontJson(
      { ok: false, error: "This product is not available for personalisation." },
      { status: 404 },
    );
  }

  const result = await generateArtwork({
    shop: auth.shop,
    mapping,
    imageDataUrl: body?.image,
    // Printed into the artwork, so the image the customer approves already
    // carries their wording.
    textValues: body?.text,
    // Regeneration is a normal customer action, not only failure recovery
    // (FR-05), but it is counted separately so the cost of one accepted order
    // can be reported honestly.
    generationType: body?.regenerate ? "REGENERATION" : "INITIAL",
    // Rate limited per shopper rather than per shop, so one enthusiastic
    // customer cannot lock everyone else out.
    rateKey: `${auth.shop}:${toTrimmedString(body?.clientId) || productId}`,
  });

  if (!result.ok) {
    // 200 with ok:false for a customer-caused refusal the page must render as a
    // message; a real server fault keeps its status so it shows up in logs.
    const status = result.code === "GENERATION_FAILED" ? 502 : 200;

    return storefrontJson(
      {
        ok: false,
        code: result.code,
        error: result.error,
        retryAfterMs: result.retryAfterMs,
      },
      { status },
    );
  }

  return storefrontJson({
    ok: true,
    artwork: result.artwork,
    generationId: result.generationId,
    durationMs: result.durationMs,
    resolution: result.resolution,
  });
}

/**
 * POST → render a Gelato mockup of the generated artwork (Milestone 5).
 *
 * Body: { productId, mappingId, generationId, text }
 *
 * The artwork is looked up from the generation log rather than accepted from
 * the request. A storage key sent by the browser would be a key the browser
 * could choose, and rendering an arbitrary stored file for anyone who asks is
 * not a thing to leave open.
 */
export async function storefrontMockupAction({ request }) {
  if (request.method !== "POST") {
    return storefrontJson(
      { ok: false, error: "Use POST to render a preview." },
      { status: 405 },
    );
  }

  const auth = await authenticateStorefrontRequest(request);

  if (!auth.ok) {
    return storefrontJson(
      { ok: false, error: auth.error },
      { status: auth.status || 401 },
    );
  }

  let body;

  try {
    body = await request.json();
  } catch {
    return storefrontJson(
      { ok: false, error: "The request body must be JSON." },
      { status: 400 },
    );
  }

  const productId = toTrimmedString(body?.productId);
  const generationId = toTrimmedString(body?.generationId);

  if (!productId || !generationId) {
    return storefrontJson(
      { ok: false, error: "Generate your artwork before previewing it." },
      { status: 400 },
    );
  }

  const mapping = await findMappingForProductDesign(
    auth.shop,
    productId,
    toTrimmedString(body?.mappingId),
    { activeOnly: true },
  );

  if (!mapping) {
    return storefrontJson(
      { ok: false, error: "This product is not available for personalisation." },
      { status: 404 },
    );
  }

  const log = await prisma.generationLog.findFirst({
    where: { id: generationId, shop: auth.shop },
    select: { outputAssetId: true },
  });

  if (!log?.outputAssetId) {
    return storefrontJson(
      { ok: false, error: "That artwork is no longer available. Please generate again." },
      { status: 404 },
    );
  }

  let artworkUrl = "";

  try {
    artworkUrl = buildSignedAssetUrl(log.outputAssetId, {
      ttlMs: FULFILMENT_TTL_MS,
      requireAbsolute: true,
    });
  } catch (error) {
    console.error("[mockup] artwork URL could not be signed:", error.message);

    return storefrontJson(
      { ok: false, error: "Preview generation failed. Please try again." },
      { status: 500 },
    );
  }

  // The optional background layer, signed for the same window as the artwork
  // so Gelato can fetch both.
  let backgroundUrl = "";

  if (mapping.backgroundImageKey) {
    try {
      backgroundUrl = buildSignedAssetUrl(mapping.backgroundImageKey, {
        ttlMs: FULFILMENT_TTL_MS,
        requireAbsolute: true,
      });
    } catch (error) {
      // A background that cannot be signed is dropped rather than failing the
      // preview: the design still renders, just without its backdrop.
      console.error("[mockup] background URL could not be signed:", error.message);
    }
  }

  const result = await renderGelatoMockup({
    shop: auth.shop,
    mapping,
    artworkUrl,
    backgroundUrl,
    textValues: body?.text,
  });

  if (!result.ok) {
    return storefrontJson(
      { ok: false, code: result.code, error: result.error },
      { status: result.code === "PREVIEW_FAILED" ? 502 : 200 },
    );
  }

  return storefrontJson({
    ok: true,
    // Short-lived and signed, like every other customer asset (NFR-09). The
    // key travels too, so the approved mockup becomes the order's preview.
    mockup: buildSignedAssetUrl(result.key),
    mockupKey: result.key,
    durationMs: result.durationMs,
  });
}

/**
 * GET → retrieve a previously saved design.
 *
 * Requirement: a customer who navigates away and comes back must not lose their
 * design. The browser remembers the id; this returns the stored record so the
 * page can show it again and re-attach it to the cart.
 */
export async function storefrontCustomizationLoader({ request }) {
  const url = new URL(request.url);
  const customizationId = toTrimmedString(url.searchParams.get("id"));

  if (!customizationId) {
    return storefrontJson({ ok: true, route: "customization" });
  }

  const auth = await authenticateStorefrontRequest(request);

  if (!auth.ok) {
    return storefrontJson(
      { ok: false, error: auth.error },
      { status: auth.status || 401 },
    );
  }

  const customization = await getCustomization(auth.shop, customizationId);

  if (!customization) {
    return storefrontJson(
      { ok: false, reason: "not-found", customization: null },
      { status: 404 },
    );
  }

  return storefrontJson({
    ok: true,
    customizationId: customization.id,
    previewUrl: customization.previewUrl || customization.artworkUrl || "",
    placement: customization.placement || null,
    personalizationText: customization.personalizationText || null,
    // Rebuilt from the stored record so a restored design carries exactly the
    // same Gelato target as when it was saved.
    properties: buildLineItemProperties(customization),
  });
}

/**
 * The full-page customizer, rendered inside the merchant's theme layout.
 *
 * Responds with `application/liquid` so Shopify wraps it in the store's own
 * header and footer — this is a page of the shop, not a widget.
 */
export async function storefrontCustomizePageLoader({ request }) {
  const auth = await authenticateStorefrontRequest(request);
  const url = new URL(request.url);

  if (!auth.ok) {
    return liquidResponse(
      notice("We could not verify this request", "Please return to the product page and try again."),
      { status: auth.status || 401 },
    );
  }

  const productId = toTrimmedString(
    url.searchParams.get("product_id") || url.searchParams.get("product"),
  );

  if (!productId) {
    return liquidResponse(
      notice("No product selected", "Open the customizer from a product page."),
      { status: 400 },
    );
  }

  const options = await listMappingsForProduct(auth.shop, productId, {
    activeOnly: true,
  });

  if (options.length === 0) {
    return liquidResponse(
      notice(
        "This product is not customizable",
        "It has not been set up for personalisation yet.",
      ),
      { status: 404 },
    );
  }

  const requestedMappingId = toTrimmedString(
    url.searchParams.get("mapping_id") || url.searchParams.get("design"),
  );

  const selected =
    options.find((option) => option.id === requestedMappingId) || options[0];

  const templates = options.map(toStorefrontMapping);
  const storefrontMapping = toStorefrontMapping(selected);

  // How many thumbnails this design actually has.
  //
  // The mapping carries a count recorded when the merchant saved it, which is
  // before Gelato has generated any mockups — so it is almost always 1, and
  // nothing updates it afterwards. The gallery itself is the only honest
  // source, and it is already cached, so asking costs nothing on a warm page.
  //
  // A failure here leaves the stored count in place rather than emptying the
  // strip: one thumbnail is a poor gallery, none is a broken page.
  try {
    const images = await resolveTemplateImages(selected);

    if (images.length > 0) {
      storefrontMapping.imagePaths = images.map((unused, index) =>
        index === 0
          ? `/template-image/${selected.id}`
          : `/template-image/${selected.id}?i=${index}`,
      );
    }
  } catch (error) {
    console.error("[customize] gallery could not be counted:", error.message);
  }

  // The variant actually being purchased wins over the mapping's default, so
  // the design is always attached to the exact variant the shopper chose.
  const variantId =
    toTrimmedString(url.searchParams.get("variant_id")) ||
    toTrimmedString(url.searchParams.get("variant")) ||
    toNumericShopifyId(storefrontMapping.shopifyVariantId) ||
    "";

  const returnUrl =
    toTrimmedString(url.searchParams.get("return_to")) ||
    (storefrontMapping.productHandle
      ? `/products/${storefrontMapping.productHandle}`
      : "/collections/all");

  return liquidResponse(
    renderCustomizePage({
      mapping: storefrontMapping,
      templates,
      productId,
      variantId,
      returnUrl,
      customizationUrl: customizationProxyPath(url),
      generateUrl: generateProxyPath(url),
      mockupUrl: mockupProxyPath(url),
      proxyBase: normalizeProxyBase(url.searchParams.get("proxy_base")),
      // Passed through from the theme so the page can state the exact product,
      // variant and price being bought. Display only — the cart is built from
      // the variant id, never from these.
      product: {
        title:
          toTrimmedString(url.searchParams.get("product_title")) ||
          storefrontMapping.productTitle,
        imageUrl:
          toTrimmedString(url.searchParams.get("product_image")) ||
          storefrontMapping.productImageUrl,
        variantTitle: toTrimmedString(url.searchParams.get("variant_title")),
        price: toTrimmedString(url.searchParams.get("price")),
        // Shopify's product type, so the heading reads "Customize Your Mug".
        type: toTrimmedString(url.searchParams.get("product_type")),
      },
    }),
  );
}

/**
 * GET → the Gelato preview image for one design, by way of the app proxy.
 *
 * Gelato's own preview URLs are presigned and expire in 24 hours, so they must
 * never reach the storefront. This path is stable; the signature is renewed
 * behind it on every cache miss.
 */
export async function storefrontTemplateImageLoader({ request, params }) {
  const auth = await authenticateStorefrontRequest(request);

  if (!auth.ok) {
    return new Response("Forbidden", { status: auth.status || 401 });
  }

  const mapping = await getMappingById(
    auth.shop,
    toTrimmedString(params.mappingId),
  );

  if (!mapping) {
    return new Response("Not found", { status: 404 });
  }

  const index = Math.max(
    0,
    Number(new URL(request.url).searchParams.get("i")) || 0,
  );

  const result = await fetchTemplatePreview(mapping, { index });

  if (!result.ok) {
    return new Response(result.error, { status: result.status });
  }

  return new Response(result.body, {
    headers: {
      "Content-Type": result.contentType,
      "Cache-Control": `public, max-age=${IMAGE_CACHE_SECONDS}`,
      "X-Content-Type-Options": "nosniff",
    },
  });
}

/** Content type for a stored layer image, from the key its extension carries. */
function storedImageType(key) {
  if (/\.png$/i.test(key)) return "image/png";
  if (/\.webp$/i.test(key)) return "image/webp";

  return "image/jpeg";
}

/**
 * `/layer-image/:mappingId?l=<layer name>` — one design's fixed layer artwork.
 *
 * Behind a stable path rather than a signed URL, for the same reason as the
 * template preview: a signed URL in page source outlives the page.
 */
export async function storefrontLayerImageLoader({ request, params }) {
  const auth = await authenticateStorefrontRequest(request);

  if (!auth.ok) {
    return new Response("Forbidden", { status: auth.status || 401 });
  }

  const mapping = await getMappingById(
    auth.shop,
    toTrimmedString(params.mappingId),
  );

  if (!mapping) {
    return new Response("Not found", { status: 404 });
  }

  const wanted = toTrimmedString(new URL(request.url).searchParams.get("l"));

  // Matched by name against this design's own layers, so the parameter cannot
  // be used to ask for an arbitrary stored file.
  const layer = fixedImageLayers(mapping.layers).find(
    (candidate) => candidate.name === wanted,
  );

  if (!layer) {
    return new Response("Not found", { status: 404 });
  }

  let body;

  try {
    body = await readAsset(layer.imageKey);
  } catch {
    return new Response("Not found", { status: 404 });
  }

  return new Response(body, {
    headers: {
      "Content-Type": storedImageType(layer.imageKey),
      "Cache-Control": `public, max-age=${IMAGE_CACHE_SECONDS}`,
      "X-Content-Type-Options": "nosniff",
    },
  });
}

/**
 * `/preview-image/:customizationId` — the mockup a customer approved.
 *
 * The cart needs this. A line item carries the preview as a signed URL, and a
 * signature lasts an hour while a cart can sit for days, so by the time the
 * shopper comes back to check out the link in their cart is dead. This path
 * does not expire, and puts no signed URL into the page.
 */
export async function storefrontPreviewImageLoader({ request, params }) {
  const auth = await authenticateStorefrontRequest(request);

  if (!auth.ok) {
    return new Response("Forbidden", { status: auth.status || 401 });
  }

  const customization = await getCustomization(
    auth.shop,
    toTrimmedString(params.customizationId),
  );

  // The approved mockup, or the artwork itself for a design saved before
  // mockups existed. Either beats the blank product photo the cart shows
  // without this.
  const key =
    toTrimmedString(customization?.previewKey) ||
    toTrimmedString(customization?.artworkKey);

  if (!key) {
    return new Response("Not found", { status: 404 });
  }

  let body;

  try {
    body = await readAsset(key);
  } catch {
    return new Response("Not found", { status: 404 });
  }

  return new Response(body, {
    headers: {
      "Content-Type": storedImageType(key),
      "Cache-Control": `public, max-age=${IMAGE_CACHE_SECONDS}`,
      "X-Content-Type-Options": "nosniff",
    },
  });
}

/**
 * The storefront path that saves a design.
 *
 * Derived from the incoming URL so it works whether Shopify delivered
 * `/customize` or `/apps/<subpath>/customize`, without hard-coding the
 * merchant's proxy prefix.
 */

/** A styled full-page message, used when the page cannot be rendered. */
function notice(title, body) {
  const escape = (value) =>
    String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  return `<div style="margin:0 auto;max-width:640px;padding:64px 24px;text-align:center">
  <h1 style="font-size:28px;margin:0 0 12px">${escape(title)}</h1>
  <p style="color:#5c5c5c;margin:0 0 24px">${escape(body)}</p>
  <a href="/collections/all"
     style="display:inline-block;background:#f4451d;border-radius:999px;color:#fff;
            padding:14px 30px;text-decoration:none">Continue shopping</a>
</div>`;
}

/**
 * `application/liquid` tells Shopify to render this body inside the theme
 * layout. Any other content type would be served bare, without the store's
 * header and footer.
 */
function liquidResponse(body, init = {}) {
  return new Response(body, {
    ...init,
    headers: {
      "Content-Type": "application/liquid",
      "Cache-Control": "no-store",
      ...(init.headers || {}),
    },
  });
}
