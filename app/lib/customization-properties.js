/**
 * The cart line-item property contract shared by the storefront block, the
 * cart/checkout, and the `orders/create` webhook.
 *
 * Client-safe: no server-only imports. The same key names are hard-coded in
 * `extensions/magiktoon-personalization/assets/personalisation.js`; keep the
 * two in sync.
 *
 * Keys prefixed with `_` are hidden from the cart and checkout UI by Shopify
 * but are preserved verbatim onto the created order, which is exactly what the
 * fulfillment webhook needs.
 */

import { asArray, toTrimmedString } from "./normalize.js";

export const CUSTOMIZATION_PROPERTY_KEYS = {
  customizationId: "_mt_customization_id",
  artworkUrl: "_mt_artwork_url",
  previewUrl: "_mt_preview_url",
  gelatoProductId: "_mt_gelato_product_id",
  gelatoProductUid: "_mt_gelato_product_uid",
  gelatoVariantId: "_mt_gelato_variant_id",
  gelatoTemplateId: "_mt_gelato_template_id",
  placeholderName: "_mt_gelato_placeholder",
  printAreaName: "_mt_gelato_print_area",
  placement: "_mt_placement",
};

/** Visible property so the shopper and merchant can see the artwork. */
export const VISIBLE_PREVIEW_PROPERTY_KEY = "Custom design";

/**
 * Customer-entered text from Step 2 of the approved design.
 *
 * Deliberately VISIBLE (no `_` prefix): the shopper should see what they typed
 * in the cart and at checkout, and the merchant needs it on the order.
 *
 * This app never composites these onto the artwork — the values are passed
 * through to Gelato Personalization Studio (SOW §3.6 / FR-25).
 */
/**
 * Length caps for customer-supplied text.
 *
 * The field names come from the Gelato template, so both the key and the value
 * are bounded to keep a malformed payload from writing unbounded data.
 */
export const MAX_TEXT_NAME_LENGTH = 80;
export const MAX_TEXT_LENGTH = 120;

/** Normalize the Step 2 text inputs, enforcing the design's length limits. */
export function normalizePersonalizationText(rawText) {
  const source =
    rawText && typeof rawText === "object" && !Array.isArray(rawText)
      ? rawText
      : {};

  const text = {};

  // Keys are Gelato text-area names taken from the template — "Text 4", "Copy
  // of Text 4" — so they cannot be enumerated ahead of time. Every entry is
  // trimmed and capped; empty ones are dropped rather than stored blank.
  for (const [key, value] of Object.entries(source)) {
    const name = toTrimmedString(key).slice(0, MAX_TEXT_NAME_LENGTH);
    const content = toTrimmedString(value).slice(0, MAX_TEXT_LENGTH);

    if (name && content) {
      text[name] = content;
    }
  }

  return text;
}

/**
 * Build the full `properties` object for a Shopify `/cart/add` request.
 *
 * @param {object} customization
 * @returns {Record<string, string>}
 */
export function buildLineItemProperties(customization) {
  const keys = CUSTOMIZATION_PROPERTY_KEYS;

  const properties = {
    [keys.customizationId]: toTrimmedString(customization?.id),
    [keys.artworkUrl]: toTrimmedString(customization?.artworkUrl),
    [keys.previewUrl]: toTrimmedString(customization?.previewUrl),
    [keys.gelatoProductId]: toTrimmedString(customization?.gelatoProductId),
    [keys.gelatoProductUid]: toTrimmedString(customization?.gelatoProductUid),
    [keys.gelatoVariantId]: toTrimmedString(customization?.gelatoVariantId),
    [keys.gelatoTemplateId]: toTrimmedString(customization?.gelatoTemplateId),
    [keys.placeholderName]: toTrimmedString(customization?.gelatoPlaceholderName),
    [keys.printAreaName]: toTrimmedString(customization?.gelatoPrintAreaName),
    [keys.placement]: customization?.placement
      ? JSON.stringify(customization.placement)
      : "",
  };

  const previewUrl = toTrimmedString(customization?.previewUrl);

  if (previewUrl) {
    properties[VISIBLE_PREVIEW_PROPERTY_KEY] = previewUrl;
  }

  const text = normalizePersonalizationText(customization?.personalizationText);

  // Visible on purpose: the shopper must be able to check what they typed, and
  // the label is the Gelato text-area name so fulfilment can match it back.
  for (const [name, value] of Object.entries(text)) {
    properties[name] = value;
  }

  // Shopify rejects empty-string properties inconsistently across themes;
  // dropping them keeps the cart payload clean.
  return Object.fromEntries(
    Object.entries(properties).filter(([, value]) => value !== ""),
  );
}

/**
 * Normalize the many shapes line-item properties arrive in.
 *
 * The REST `orders/create` webhook sends `[{ name, value }]`; the Storefront
 * and Admin GraphQL APIs send `[{ key, value }]`; the AJAX cart sends a plain
 * object. All three collapse to a `Record<string, string>` here.
 */
export function normalizeLineItemProperties(rawProperties) {
  if (!rawProperties) {
    return {};
  }

  if (Array.isArray(rawProperties)) {
    const entries = {};

    for (const property of rawProperties) {
      const key = toTrimmedString(property?.name ?? property?.key);

      if (key) {
        entries[key] = toTrimmedString(property?.value);
      }
    }

    return entries;
  }

  if (typeof rawProperties === "object") {
    // Some payloads nest the array under `edges`/`nodes`.
    const nested = asArray(rawProperties);

    if (nested.length > 0) {
      return normalizeLineItemProperties(nested);
    }

    const entries = {};

    for (const [key, value] of Object.entries(rawProperties)) {
      const trimmedKey = toTrimmedString(key);

      if (trimmedKey) {
        entries[trimmedKey] = toTrimmedString(value);
      }
    }

    return entries;
  }

  return {};
}

/**
 * Read our customization payload back off a webhook line item.
 *
 * @returns {{
 *   isCustomized: boolean,
 *   customizationId: string,
 *   artworkUrl: string,
 *   previewUrl: string,
 *   gelatoProductId: string,
 *   gelatoVariantId: string,
 *   gelatoTemplateId: string,
 *   placeholderName: string,
 *   printAreaName: string,
 *   placement: object|null,
 * }}
 */
export function readCustomizationFromLineItem(lineItem) {
  const properties = normalizeLineItemProperties(lineItem?.properties);
  const keys = CUSTOMIZATION_PROPERTY_KEYS;

  let placement = null;
  const rawPlacement = toTrimmedString(properties[keys.placement]);

  if (rawPlacement) {
    try {
      placement = JSON.parse(rawPlacement);
    } catch {
      placement = null;
    }
  }

  const customizationId = toTrimmedString(properties[keys.customizationId]);
  const artworkUrl = toTrimmedString(properties[keys.artworkUrl]);

  return {
    isCustomized: Boolean(customizationId || artworkUrl),
    customizationId,
    artworkUrl,
    previewUrl: toTrimmedString(properties[keys.previewUrl]),
    gelatoProductId: toTrimmedString(properties[keys.gelatoProductId]),
    gelatoProductUid: toTrimmedString(properties[keys.gelatoProductUid]),
    gelatoVariantId: toTrimmedString(properties[keys.gelatoVariantId]),
    gelatoTemplateId: toTrimmedString(properties[keys.gelatoTemplateId]),
    placeholderName: toTrimmedString(properties[keys.placeholderName]),
    printAreaName: toTrimmedString(properties[keys.printAreaName]),
    placement,
  };
}
