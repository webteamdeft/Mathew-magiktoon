/**
 * Mapping validation rules shared by the Polaris admin form (client) and the
 * route action (server). Client-safe: pure functions only.
 */

import {
  normalizeResolution,
  normalizeSeed,
  normalizeTemperature,
} from "./generation-config.js";
import { normalizeAspectRatio } from "./image-shape.js";
import { normalizeLayers } from "./layers.js";
import { toNumericShopifyId, toTrimmedString } from "./normalize.js";

export const MAPPING_STATUSES = ["DRAFT", "ACTIVE", "DISABLED"];

export const MAPPING_STATUS_OPTIONS = [
  { label: "Draft", value: "DRAFT" },
  { label: "Active", value: "ACTIVE" },
  { label: "Disabled", value: "DISABLED" },
];

/** Polaris `Badge` tone for a mapping status. */
export function statusTone(status) {
  if (status === "ACTIVE") return "success";
  if (status === "DISABLED") return "critical";
  return "attention";
}

/**
 * Free-form supplier rules, as JSON.
 *
 * Accepts an object, or the JSON string a form field carries. Anything that
 * will not parse is kept as `{ note: "<the raw text>" }` rather than
 * discarded — a merchant who typed prose into the box should not silently lose
 * it, and FR-29 only asks that these are stored where provided.
 */
function toRuleJson(value) {
  if (!value) return null;

  if (typeof value === "object") return value;

  const text = toTrimmedString(value);

  if (!text) return null;

  try {
    const parsed = JSON.parse(text);

    return parsed && typeof parsed === "object" ? parsed : { note: text };
  } catch {
    return { note: text };
  }
}

/**
 * A finite positive number, or null.
 *
 * Placeholder dimensions come from Gelato and are optional, so anything that is
 * not a usable measurement becomes null rather than 0 — a zero would silently
 * make the print guide's aspect ratio collapse.
 */
function toPositiveNumber(value) {
  const parsed = Number(value);

  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/**
 * A fraction of the product image, clamped into a usable range.
 *
 * Accepts either a fraction (0.42) or a percentage (42), because the admin form
 * and the old theme settings expressed the same value both ways.
 */
function toFraction(value, fallback, min = 0) {
  let parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  if (parsed > 1) {
    parsed = parsed / 100;
  }

  return Math.min(Math.max(parsed, min), 1);
}

/**
 * The template's editable text areas, as a clean array.
 *
 * Accepts the array itself or the JSON string a form field carries. Anything
 * unusable becomes an empty array rather than null, so callers can always
 * `.map()` over it without a guard.
 */
function toTextPlaceholders(value) {
  let parsed = value;

  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return [];
    }
  }

  if (!Array.isArray(parsed)) {
    return [];
  }

  return parsed
    .map((entry) => ({
      name: toTrimmedString(entry?.name),
      defaultText: toTrimmedString(entry?.defaultText),
      label: toTrimmedString(entry?.label) || toTrimmedString(entry?.name),
    }))
    .filter((entry) => entry.name);
}

/** The print guide's position and size on the product photo. */
export function printAreaOf(mapping) {
  return {
    x: toFraction(mapping?.printAreaX, 0.3),
    y: toFraction(mapping?.printAreaY, 0.3),
    size: toFraction(mapping?.printAreaSize, 0.42, 0.05),
  };
}

/**
 * The aspect ratio (width / height) of a mapping's print placeholder.
 *
 * Returns null when Gelato did not report dimensions, so callers can fall back
 * to a square rather than inventing a shape.
 */
export function placeholderAspectRatio(mapping) {
  const width = toPositiveNumber(mapping?.gelatoPlaceholderWidth);
  const height = toPositiveNumber(mapping?.gelatoPlaceholderHeight);

  if (!width || !height) {
    return null;
  }

  return width / height;
}

/**
 * Stable identity of the Gelato design a mapping points at.
 *
 * A Shopify product can offer several designs, so mappings are unique per
 * design rather than per product. The template id identifies a design on the
 * template flow; the catalog flow has no template, so its product UID is used,
 * namespaced to keep the two kinds of reference from ever colliding.
 */
export function designRefFor(mapping) {
  const templateId = toTrimmedString(mapping?.gelatoTemplateId);

  if (templateId) {
    return templateId;
  }

  const productUid = toTrimmedString(mapping?.gelatoProductUid);

  return productUid ? `uid:${productUid}` : "";
}

/**
 * Normalize raw form input into the canonical mapping shape.
 *
 * Accepts a `FormData` instance or a plain object.
 */
export function normalizeMappingInput(input) {
  const read = (key) =>
    typeof input?.get === "function"
      ? toTrimmedString(input.get(key))
      : toTrimmedString(input?.[key]);

  const shopifyProductId = read("shopifyProductId");
  const status = read("status");

  const sortOrder = Number(read("sortOrder"));

  const normalized = {
    designLabel: read("designLabel"),
    sortOrder: Number.isFinite(sortOrder) ? Math.trunc(sortOrder) : 0,
    shopifyProductId,
    shopifyProductNumericId:
      toNumericShopifyId(shopifyProductId) || shopifyProductId,
    shopifyVariantId: read("shopifyVariantId"),
    shopifyVariantTitle: read("shopifyVariantTitle"),
    shopifyProductTitle: read("shopifyProductTitle"),
    shopifyProductHandle: read("shopifyProductHandle"),
    shopifyProductImageUrl: read("shopifyProductImageUrl"),
    gelatoProductId: read("gelatoProductId"),
    gelatoProductName: read("gelatoProductName"),
    gelatoProductUid: read("gelatoProductUid"),
    gelatoVariantId: read("gelatoVariantId"),
    gelatoVariantName: read("gelatoVariantName"),
    gelatoTemplateId: read("gelatoTemplateId"),
    gelatoTemplateName: read("gelatoTemplateName"),
    gelatoPlaceholderName: read("gelatoPlaceholderName") || "ImageFront",
    gelatoPrintAreaName: read("gelatoPrintAreaName") || "front",
    gelatoPlaceholderWidth: toPositiveNumber(read("gelatoPlaceholderWidth")),
    gelatoPlaceholderHeight: toPositiveNumber(read("gelatoPlaceholderHeight")),
    gelatoTextPlaceholders: toTextPlaceholders(
      typeof input?.get === "function"
        ? input.get("gelatoTextPlaceholders")
        : input?.gelatoTextPlaceholders,
    ),
    gelatoImageCount: Math.max(1, Number(read("gelatoImageCount")) || 1),
    layers: normalizeLayers(
      typeof input?.get === "function" ? input.get("layers") : input?.layers,
    ),
    printAreaX: toFraction(read("printAreaX"), 0.3),
    printAreaY: toFraction(read("printAreaY"), 0.3),
    // Never zero: a zero-width guide would be invisible and undraggable.
    printAreaSize: toFraction(read("printAreaSize"), 0.42, 0.05),
    gelatoPreviewUrl: read("gelatoPreviewUrl"),

    // Milestone 6: the optional background layer and the supplier facts.
    // Every one of these is optional — a design with none of them is complete.
    backgroundImageKey: read("backgroundImageKey") || null,
    backgroundImageName: read("backgroundImageName") || null,
    backgroundPlaceholderName: read("backgroundPlaceholderName") || null,
    supplierSku: read("supplierSku") || null,
    printFileRequirements: read("printFileRequirements") || null,
    mockupTemplate: read("mockupTemplate") || null,
    pricingRules: toRuleJson(
      typeof input?.get === "function" ? input.get("pricingRules") : input?.pricingRules,
    ),
    shippingRules: toRuleJson(
      typeof input?.get === "function" ? input.get("shippingRules") : input?.shippingRules,
    ),

    // Milestone 4 generation settings. Empty becomes null rather than "" so the
    // foreign keys stay valid, and an unrecognised resolution falls back to the
    // default instead of reaching the model as nonsense.
    promptId: read("promptId") || null,
    aiModelId: read("aiModelId") || null,
    outputResolution: normalizeResolution(read("outputResolution")),
    // Null rather than "" when unset, so the column reads as "nothing chosen"
    // instead of "chosen as blank". An unrecognised value becomes null too:
    // sending a ratio the API rejects would fail the whole generation.
    aspectRatio: normalizeAspectRatio(read("aspectRatio")) || null,
    // Null when unset, so the request omits them and the model default stands.
    temperature: normalizeTemperature(read("temperature")),
    seed: normalizeSeed(read("seed")),

    status: MAPPING_STATUSES.includes(status) ? status : "DRAFT",
  };

  return { ...normalized, designRef: designRefFor(normalized) };
}

/**
 * Validate a normalized mapping.
 *
 * @returns {{ valid: boolean, errors: Record<string, string> }}
 */
export function validateMapping(mapping) {
  const errors = {};

  if (!mapping.shopifyProductId) {
    errors.shopifyProductId = "Select a Shopify product.";
  }

  if (!mapping.shopifyProductTitle) {
    errors.shopifyProductTitle = "The Shopify product title is missing.";
  }

  // What Gelato prints is decided by the catalog product UID. A template id is
  // useful for the preview and for traceability, but the Order API will not
  // resolve one, so a mapping without a UID cannot fulfil an order.
  const mode = fulfillmentMode(mapping);

  if (mode === "none") {
    errors.gelatoProductUid =
      "Pick the Gelato product variant to print. Its product UID is what the order is placed against.";
  }

  // Saving a template-only mapping is allowed — it is a normal half-finished
  // state while a merchant sets one up — but activating one would put a product
  // on sale that cannot be fulfilled, which is worse than not selling it.
  if (mode === "template-only" && mapping.status === "ACTIVE") {
    errors.gelatoProductUid =
      "This design has a Gelato template but no product UID, so orders for it " +
      "would be created in Gelato and never printed. Pick the Gelato product " +
      "variant before making it active.";
  }

  if (!mapping.gelatoPlaceholderName) {
    errors.gelatoPlaceholderName = "Choose the image placeholder to print into.";
  }

  if (!mapping.gelatoPrintAreaName) {
    errors.gelatoPrintAreaName = "Choose the print area.";
  }

  if (
    mapping.gelatoPreviewUrl &&
    !/^https?:\/\//i.test(mapping.gelatoPreviewUrl)
  ) {
    errors.gelatoPreviewUrl = "The preview must be an http(s) URL.";
  }

  if (mapping.status === "ACTIVE" && !mapping.gelatoPreviewUrl) {
    errors.gelatoPreviewUrl =
      "An active mapping needs a preview image for the storefront.";
  }

  return { valid: Object.keys(errors).length === 0, errors };
}

/**
 * Which Gelato flow a mapping will use at fulfillment time.
 *
 * The catalog product UID is what decides this, NOT the template.
 *
 * A template id used to count as printable, on the assumption that Gelato's
 * Order API would resolve it. Verified against the live API, it does not: an
 * item sent with only a templateId comes back with `productUid: null` and
 * "not_connected", and the order is parked as a draft that never prints. Only
 * the product UID resolves, so only the product UID makes a mapping printable.
 *
 * "template-only" is called out separately from "none" because it looks fully
 * configured in admin — a template is mapped, a preview renders — while being
 * unable to fulfil a single order.
 *
 * @returns {"catalog"|"template-only"|"none"}
 */
export function fulfillmentMode(mapping) {
  if (toTrimmedString(mapping?.gelatoProductUid)) {
    return "catalog";
  }

  if (toTrimmedString(mapping?.gelatoTemplateId)) {
    return "template-only";
  }

  return "none";
}

/** Human-readable label for the flow a mapping is on. */
export function fulfillmentModeLabel(mapping) {
  const mode = fulfillmentMode(mapping);

  if (mode === "catalog") return "Ready to fulfil";
  if (mode === "template-only") return "Template only — cannot fulfil";

  return "Not printable";
}

/** First error message, for a single-line banner. */
export function firstErrorMessage(errors) {
  const values = Object.values(errors || {});

  return values.length > 0 ? values[0] : "";
}
