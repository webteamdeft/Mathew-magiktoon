/**
 * Shopify product -> Gelato product/variant/template mapping store.
 *
 * SERVER ONLY (talks to Prisma).
 */

import prisma from "../db.server.js";
import { asArray, toNumericShopifyId, toTrimmedString } from "./normalize.js";
import { expectedGenerationMs } from "./generation-config.js";
import { normalizeLayers } from "./layers.js";
import { forgetMappingPreview } from "./gelato-preview.server.js";
import {
  normalizeMappingInput,
  placeholderAspectRatio,
  printAreaOf,
  validateMapping,
} from "./mapping-validation.js";

/**
 * Relations every read of a mapping carries.
 *
 * Loaded on the storefront reads too, because a generation request resolves the
 * mapping first and would otherwise need a second round trip to discover which
 * prompt and model the design uses. Nothing here reaches the browser:
 * `toStorefrontMapping` is an allow-list and never spreads the record, so the
 * prompt text stays server-side.
 */
const GENERATION_RELATIONS = {
  prompt: true,
  aiModel: true,
};

/** Every mapping for a shop, newest first. */
export async function listMappings(shop) {
  const mappings = await prisma.productMapping.findMany({
    where: { shop },
    orderBy: { updatedAt: "desc" },
    include: GENERATION_RELATIONS,
  });

  return asArray(mappings);
}

/**
 * One mapping by its primary key, scoped to the shop.
 *
 * `db` is an injection seam for tests; everything else passes nothing and gets
 * the real client.
 */
export async function getMappingById(shop, id, { db = prisma } = {}) {
  const mappingId = toTrimmedString(id);

  if (!mappingId) {
    return null;
  }

  return db.productMapping.findFirst({
    where: { id: mappingId, shop },
    include: GENERATION_RELATIONS,
  });
}

/**
 * Find the mapping for a storefront product.
 *
 * The storefront only knows the numeric product id from Liquid, while the
 * admin stores a GID, so both forms are matched.
 */
export async function findMappingForProduct(shop, productId, { activeOnly = true } = {}) {
  const raw = toTrimmedString(productId);

  if (!shop || !raw) {
    return null;
  }

  const numericId = toNumericShopifyId(raw) || raw;
  const gid = raw.startsWith("gid://")
    ? raw
    : `gid://shopify/Product/${numericId}`;

  const where = {
    shop,
    OR: [
      { shopifyProductNumericId: numericId },
      { shopifyProductId: gid },
      { shopifyProductId: raw },
    ],
  };

  if (activeOnly) {
    where.status = "ACTIVE";
  }

  return prisma.productMapping.findFirst({
    where,
    orderBy: [{ sortOrder: "asc" }, { updatedAt: "desc" }],
    include: GENERATION_RELATIONS,
  });
}

/**
 * Every design a Shopify product offers, in the order the customer sees them.
 *
 * A Shopify product is never replaced by a Gelato product: each row here is one
 * *design option* on that same product, and the customer picks between them
 * before customizing.
 */
export async function listMappingsForProduct(
  shop,
  productId,
  { activeOnly = true } = {},
) {
  const raw = toTrimmedString(productId);

  if (!shop || !raw) {
    return [];
  }

  const numericId = toNumericShopifyId(raw) || raw;
  const gid = raw.startsWith("gid://")
    ? raw
    : `gid://shopify/Product/${numericId}`;

  const where = {
    shop,
    OR: [
      { shopifyProductNumericId: numericId },
      { shopifyProductId: gid },
      { shopifyProductId: raw },
    ],
  };

  if (activeOnly) {
    where.status = "ACTIVE";
  }

  const mappings = await prisma.productMapping.findMany({
    where,
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    include: GENERATION_RELATIONS,
  });

  return asArray(mappings);
}

/**
 * One specific design option on a product.
 *
 * The id is checked against the product as well as the shop, so a customer
 * cannot pair another product's design with this one by editing the URL.
 */
export async function findMappingForProductDesign(
  shop,
  productId,
  mappingId,
  { activeOnly = true } = {},
) {
  const wanted = toTrimmedString(mappingId);

  if (!wanted) {
    return findMappingForProduct(shop, productId, { activeOnly });
  }

  const options = await listMappingsForProduct(shop, productId, { activeOnly });

  return options.find((option) => option.id === wanted) || null;
}

/**
 * Create or update a mapping from raw form input.
 *
 * @returns {Promise<{ ok: boolean, errors?: object, mapping?: object, error?: string }>}
 */
export async function saveMapping(shop, input, { id = "" } = {}, { db = prisma } = {}) {
  const mapping = normalizeMappingInput(input);
  const { valid, errors } = validateMapping(mapping);

  if (!valid) {
    return { ok: false, errors };
  }

  const data = {
    shopifyProductId: mapping.shopifyProductId,
    shopifyProductNumericId: mapping.shopifyProductNumericId,
    shopifyVariantId: mapping.shopifyVariantId || null,
    shopifyVariantTitle: mapping.shopifyVariantTitle || null,
    shopifyProductTitle: mapping.shopifyProductTitle,
    shopifyProductHandle: mapping.shopifyProductHandle || null,
    shopifyProductImageUrl: mapping.shopifyProductImageUrl || null,
    gelatoProductId: mapping.gelatoProductId,
    gelatoProductName: mapping.gelatoProductName || null,
    gelatoProductUid: mapping.gelatoProductUid || null,
    gelatoVariantId: mapping.gelatoVariantId || null,
    gelatoVariantName: mapping.gelatoVariantName || null,
    gelatoTemplateId: mapping.gelatoTemplateId,
    gelatoTemplateName: mapping.gelatoTemplateName || null,
    gelatoPlaceholderName: mapping.gelatoPlaceholderName,
    gelatoPrintAreaName: mapping.gelatoPrintAreaName,
    gelatoPlaceholderWidth: mapping.gelatoPlaceholderWidth,
    gelatoPlaceholderHeight: mapping.gelatoPlaceholderHeight,
    gelatoTextPlaceholders: mapping.gelatoTextPlaceholders,
    gelatoImageCount: mapping.gelatoImageCount,
    layers: mapping.layers,
    printAreaX: mapping.printAreaX,
    printAreaY: mapping.printAreaY,
    printAreaSize: mapping.printAreaSize,
    gelatoPreviewUrl: mapping.gelatoPreviewUrl || null,
    backgroundImageKey: mapping.backgroundImageKey,
    backgroundImageName: mapping.backgroundImageName,
    backgroundPlaceholderName: mapping.backgroundPlaceholderName,
    supplierSku: mapping.supplierSku,
    printFileRequirements: mapping.printFileRequirements,
    mockupTemplate: mapping.mockupTemplate,
    pricingRules: mapping.pricingRules,
    shippingRules: mapping.shippingRules,
    promptId: mapping.promptId,
    aiModelId: mapping.aiModelId,
    outputResolution: mapping.outputResolution,
    aspectRatio: mapping.aspectRatio,
    temperature: mapping.temperature,
    seed: mapping.seed,
    designLabel: mapping.designLabel || null,
    sortOrder: mapping.sortOrder,
    designRef: mapping.designRef,
    status: mapping.status,
  };

  const mappingId = toTrimmedString(id);

  try {
    if (mappingId) {
      const existing = await getMappingById(shop, mappingId, { db });

      if (!existing) {
        return { ok: false, error: "That mapping no longer exists." };
      }

      const saved = await db.productMapping.update({
        where: { id: existing.id },
        data,
      });

      // The design may now point at a different Gelato template, so anything
      // cached against the old one has to go.
      forgetMappingPreview(saved.id);

      return { ok: true, mapping: saved };
    }

    // A real create, not an upsert.
    //
    // Upserting here meant "Add design" silently replaced an existing design
    // whenever the merchant happened to pick a product and template that were
    // already paired — they believed they were adding a second option and had
    // in fact overwritten the first, with no warning and no way back. The
    // unique index now surfaces as the friendly P2002 message below, which
    // names the clash and sends them to the existing design instead.
    const saved = await db.productMapping.create({
      data: { shop, ...data },
    });

    return { ok: true, mapping: saved };
  } catch (error) {
    console.error("[mappings] save failed:", error);

    if (error?.code === "P2002") {
      return {
        ok: false,
        errors: {
          gelatoTemplateId:
            "This Shopify product already offers that Gelato design. Edit the existing option, or choose a different template.",
        },
      };
    }

    return { ok: false, error: error.message || "The mapping could not be saved." };
  }
}

/** Delete a mapping. Customizations survive with a null mapping reference. */
export async function deleteMapping(shop, id) {
  const existing = await getMappingById(shop, id);

  if (!existing) {
    return { ok: false, error: "That mapping no longer exists." };
  }

  await prisma.productMapping.delete({ where: { id: existing.id } });

  return { ok: true };
}

/** Flip a mapping between ACTIVE and DISABLED (or set an explicit status). */
export async function setMappingStatus(shop, id, status) {
  const existing = await getMappingById(shop, id);

  if (!existing) {
    return { ok: false, error: "That mapping no longer exists." };
  }

  const nextStatus =
    toTrimmedString(status) ||
    (existing.status === "ACTIVE" ? "DISABLED" : "ACTIVE");

  if (nextStatus === "ACTIVE" && !existing.gelatoPreviewUrl) {
    return {
      ok: false,
      error:
        "Add a preview image to this mapping before activating it on the storefront.",
    };
  }

  const mapping = await prisma.productMapping.update({
    where: { id: existing.id },
    data: { status: nextStatus },
  });

  return { ok: true, mapping };
}

/**
 * Shape a mapping for the storefront.
 *
 * Deliberately narrow — only what the customizer needs, never internal ids or
 * anything credential-adjacent.
 */
export function toStorefrontMapping(mapping) {
  if (!mapping) {
    return null;
  }

  return {
    mappingId: mapping.id,
    shopifyProductId: mapping.shopifyProductId,
    shopifyProductNumericId: mapping.shopifyProductNumericId,
    // The variant the customization is bound to. Empty means "whichever
    // variant the shopper has selected" — the page passes that through so the
    // design can never be attached to a different product than the one bought.
    shopifyVariantId: mapping.shopifyVariantId || "",
    productTitle: mapping.shopifyProductTitle,
    productHandle: mapping.shopifyProductHandle || "",
    // The original Shopify product's own image. Kept distinct from the Gelato
    // preview so the customizer can show the product being bought rather than
    // the design reference.
    productImageUrl: mapping.shopifyProductImageUrl || "",
    designLabel: mapping.designLabel || "",
    // A stable path the storefront prefixes with the app-proxy base. Gelato's
    // own preview URLs are presigned and die after 24 hours, so they are never
    // handed out directly — see `gelato-preview.server.js`.
    previewPath: `/template-image/${mapping.id}`,
    // One stable path per Gelato image, in Gelato's own order. Each is
    // re-signed behind the proxy, so none of them can expire.
    imagePaths: Array.from(
      { length: Math.max(1, Number(mapping.gelatoImageCount) || 1) },
      (unused, index) =>
        index === 0
          ? `/template-image/${mapping.id}`
          : `/template-image/${mapping.id}?i=${index}`,
    ),
    // Kept for diagnostics and as a last-resort fallback; may well be expired.
    previewUrl: mapping.gelatoPreviewUrl || mapping.shopifyProductImageUrl || "",
    templateId: mapping.gelatoTemplateId,
    templateName: mapping.gelatoTemplateName || "",
    placeholderName: mapping.gelatoPlaceholderName || "ImageFront",
    printAreaName: mapping.gelatoPrintAreaName || "front",
    // Lets the block draw the print guide at the shape Gelato will actually
    // print, rather than a shape the design happened to illustrate.
    placeholderAspectRatio: placeholderAspectRatio(mapping),
    printArea: printAreaOf(mapping),
    // One input per editable text area the template defines.
    textPlaceholders: asArray(mapping.gelatoTextPlaceholders),
    // The layer stack the customizer renders over the product image.
    //
    // A fixed layer's artwork travels as a proxy PATH, not as its storage key
    // and not as a signed URL: a signed URL baked into page source outlives the
    // page it was rendered into, and the key is of no use to the browser.
    layers: normalizeLayers(mapping.layers).map((layer) => {
      const { imageKey, ...rest } = layer;

      if (!imageKey) return rest;

      return {
        ...rest,
        imagePath: `/layer-image/${mapping.id}?l=${encodeURIComponent(layer.name)}`,
      };
    }),
    // Whether this design can run an AI generation (Milestone 4). A boolean,
    // never the prompt: prompt text is the client's intellectual property and
    // must not reach the browser. False keeps the pre-Milestone-4 behaviour, in
    // which the uploaded photo is itself the artwork.
    canGenerate: Boolean(
      mapping.prompt &&
        String(mapping.prompt.status || "").toUpperCase() === "ACTIVE" &&
        String(mapping.prompt.content || "").trim(),
    ),
    // Roughly how long this design takes, for pacing the progress bar.
    //
    // A duration, never the model name — which model a shop runs is its own
    // business and has no reason to reach a customer's browser. The number
    // paces an animation and nothing else depends on it.
    expectedGenerationMs: expectedGenerationMs(mapping.aiModel?.modelKey),
    status: mapping.status,
  };
}
