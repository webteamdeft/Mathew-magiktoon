/**
 * Gelato E-commerce catalog reader: store products, their variants, and the
 * templates (with image placeholders and print areas) behind them.
 *
 * SERVER ONLY — reads `GELATO_API_KEY` / `GELATO_STORE_ID`. Everything
 * returned by this module is already normalized and safe to send to the admin
 * UI; no credentials are included in any return value.
 */

import { asArray, firstString, toTrimmedString } from "./normalize.js";
import { gelatoFieldLabel } from "./layers.js";

const GELATO_ECOMMERCE_API = "https://ecommerce.gelatoapis.com/v1";

function getConfig() {
  const apiKey = toTrimmedString(process.env.GELATO_API_KEY);
  const storeId = toTrimmedString(process.env.GELATO_STORE_ID);

  if (!apiKey) {
    throw new Error("GELATO_API_KEY is missing");
  }

  if (!storeId) {
    throw new Error("GELATO_STORE_ID is missing");
  }

  return { apiKey, storeId };
}

async function catalogRequest(path, { fetchImpl = fetch } = {}) {
  const { apiKey } = getConfig();

  const response = await fetchImpl(`${GELATO_ECOMMERCE_API}${path}`, {
    method: "GET",
    headers: {
      "X-API-KEY": apiKey,
      Accept: "application/json",
    },
  });

  const text = await response.text();

  let data;

  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  if (!response.ok) {
    const message = typeof data === "string" ? data : JSON.stringify(data);
    const error = new Error(`Gelato catalog ${response.status}: ${message}`);
    error.status = response.status;
    throw error;
  }

  return data;
}

function getPreviewUrl(item) {
  const images = asArray(item?.images);

  return firstString(
    item?.previewUrl,
    item?.preview_url,
    item?.mockupUrl,
    item?.thumbnailUrl,
    item?.imageUrl,
    item?.preview?.url,
    images[0]?.url,
    typeof images[0] === "string" ? images[0] : "",
  );
}

/** Normalize one Gelato product variant. */
export function normalizeGelatoVariant(variant) {
  return {
    id: firstString(variant?.id, variant?.variantId, variant?.uid),
    title: firstString(
      variant?.title,
      variant?.name,
      variant?.variantName,
      "Default variant",
    ),
    productUid: firstString(variant?.productUid, variant?.product_uid),
    // The Shopify variant Gelato published this colourway as. It is the only
    // link from the variant a shopper picked back to Gelato's own gallery.
    externalId: firstString(variant?.externalId, variant?.external_id),
    templateVariantId: firstString(
      variant?.templateVariantId,
      variant?.template_variant_id,
    ),
    previewUrl: getPreviewUrl(variant),
    imagePlaceholders: asArray(variant?.imagePlaceholders).map(
      normalizeGelatoPlaceholder,
    ),
    textPlaceholders: asArray(variant?.textPlaceholders).map(
      normalizeGelatoTextPlaceholder,
    ),
  };
}

/**
 * Normalize one editable text area from a template.
 *
 * Gelato names these after the layer they came from — "Text 4", "Copy of Text
 * 4" and so on — and carries the wording the designer typed. That default text
 * is the only human-readable clue to what the field is for, so it is kept and
 * used as the label a merchant or customer sees.
 */
export function normalizeGelatoTextPlaceholder(placeholder) {
  const name = firstString(placeholder?.name, placeholder?.id);
  const text = firstString(placeholder?.text, placeholder?.defaultText);

  return {
    name,
    // What the template ships with, and what prints if nobody edits it.
    defaultText: text,
    // A name the designer chose ("Name", "Year") is the title. "Text 4" tells
    // a customer nothing; the default wording does.
    label:
      gelatoFieldLabel(name) || (text ? text.split("\n")[0].slice(0, 40) : name),
  };
}

/** Normalize one image placeholder / print area pair from a template. */
export function normalizeGelatoPlaceholder(placeholder) {
  return {
    name: firstString(
      placeholder?.name,
      placeholder?.id,
      placeholder?.placeholderName,
      "ImageFront",
    ),
    printArea: firstString(
      placeholder?.printArea,
      placeholder?.print_area,
      placeholder?.placementArea,
      placeholder?.area,
      "front",
    ),
    width: Number(placeholder?.width) || null,
    height: Number(placeholder?.height) || null,
  };
}

/** Normalize a Gelato store product (list or detail shape). */
export function normalizeGelatoStoreProduct(product) {
  const variants = asArray(
    product?.productVariants || product?.variants,
  ).map(normalizeGelatoVariant);

  return {
    id: firstString(product?.id, product?.productId, product?.uid),
    title: firstString(
      product?.title,
      product?.name,
      product?.productName,
      "Untitled Gelato product",
    ),
    // Gelato names this `parentTemplateId` on the store-product payload; it is
    // empty for products that were created directly rather than from a template.
    templateId: firstString(
      product?.templateId,
      product?.template_id,
      product?.parentTemplateId,
    ),
    templateName: firstString(product?.templateName),
    externalId: firstString(product?.externalId),
    previewUrl: getPreviewUrl(product),
    // The mockup gallery. Gelato only carries several images on a *store
    // product*; a template on its own has exactly one preview.
    images: asArray(product?.productImages)
      .map((image) => ({
        id: firstString(image?.id),
        url: firstString(image?.fileUrl, image?.url),
        isPrimary: Boolean(image?.isPrimary),
        // Which colourways this shot belongs to. Gelato's gallery holds every
        // variant's photos in one flat list, so without this a white mug can
        // be previewed on a pink body. An empty array means the merchant
        // attached the shot to the product rather than to one variant, and it
        // is then valid for all of them.
        variantIds: asArray(image?.productVariantIds)
          .map((id) => firstString(id))
          .filter(Boolean),
      }))
      .filter((image) => image.url)
      // Primary first, original order otherwise.
      .sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary)),
    status: firstString(product?.status, "unknown"),
    variants,
  };
}

/** List every product configured in the connected Gelato store. */
export async function listGelatoStoreProducts({
  offset = 0,
  limit = 100,
  fetchImpl = fetch,
} = {}) {
  const { storeId } = getConfig();

  const data = await catalogRequest(
    `/stores/${encodeURIComponent(storeId)}/products` +
      `?offset=${encodeURIComponent(offset)}&limit=${encodeURIComponent(limit)}`,
    { fetchImpl },
  );

  const items = asArray(data)
    .map(normalizeGelatoStoreProduct)
    .filter((product) => product.id);

  return { items, raw: data };
}

/** Fetch one store product with its full variant list. */
export async function getGelatoStoreProduct(productId, { fetchImpl = fetch } = {}) {
  const { storeId } = getConfig();
  const id = toTrimmedString(productId);

  if (!id) {
    throw new Error("Gelato product ID is required");
  }

  const data = await catalogRequest(
    `/stores/${encodeURIComponent(storeId)}/products/${encodeURIComponent(id)}`,
    { fetchImpl },
  );

  return normalizeGelatoStoreProduct(data);
}

/**
 * Fetch a Gelato template with its placeholders and print areas.
 *
 * The unique placeholder names and print areas are hoisted to the top level so
 * the admin UI can offer them as select options without re-walking variants.
 */
export async function getGelatoTemplateDetail(templateId, { fetchImpl = fetch } = {}) {
  const id = toTrimmedString(templateId);

  if (!id) {
    throw new Error("Gelato template ID is required");
  }

  const data = await catalogRequest(
    `/templates/${encodeURIComponent(id)}`,
    { fetchImpl },
  );

  const variants = asArray(
    data?.variants || data?.templateVariants,
  ).map(normalizeGelatoVariant);

  const placeholders = [];
  const seenPlaceholders = new Set();

  const topLevelPlaceholders = asArray(data?.imagePlaceholders).map(
    normalizeGelatoPlaceholder,
  );

  for (const placeholder of [
    ...topLevelPlaceholders,
    ...variants.flatMap((variant) => variant.imagePlaceholders),
  ]) {
    const key = `${placeholder.name}::${placeholder.printArea}`;

    if (!seenPlaceholders.has(key)) {
      seenPlaceholders.add(key);
      placeholders.push(placeholder);
    }
  }

  const printAreas = [
    ...new Set(placeholders.map((placeholder) => placeholder.printArea)),
  ].filter(Boolean);

  // Editable text areas, deduplicated by name. Gelato repeats the same set on
  // every variant of a template, so a mug with six text layers and eight
  // variants would otherwise report forty-eight fields.
  const textPlaceholders = [];
  const seenText = new Set();

  for (const placeholder of [
    ...asArray(data?.textPlaceholders).map(normalizeGelatoTextPlaceholder),
    ...variants.flatMap((variant) => variant.textPlaceholders),
  ]) {
    if (!placeholder.name || seenText.has(placeholder.name)) continue;

    seenText.add(placeholder.name);
    textPlaceholders.push(placeholder);
  }

  return {
    id: firstString(data?.id, id),
    name: firstString(data?.templateName, data?.name, data?.title, "Template"),
    productUid: firstString(data?.productUid, data?.product_uid),
    previewUrl: getPreviewUrl(data),
    variants,
    placeholders,
    printAreas: printAreas.length > 0 ? printAreas : ["front"],
    textPlaceholders,
    raw: data,
  };
}

/**
 * Fetch a template detail without throwing.
 *
 * Used on the mapping form, where an unreachable Gelato API should degrade to
 * manual placeholder entry rather than blocking the save.
 */
export async function tryGetGelatoTemplateDetail(templateId, options = {}) {
  try {
    return { ok: true, template: await getGelatoTemplateDetail(templateId, options) };
  } catch (error) {
    console.error("[gelato-catalog] template detail failed:", error);

    return {
      ok: false,
      error: error.message || "Gelato template could not be loaded.",
      template: null,
    };
  }
}
