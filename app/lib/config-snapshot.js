/**
 * The configuration that produced an approved design, frozen (Milestone 6).
 *
 * Client-safe: a pure function over a mapping, so the admin can render a
 * snapshot and the server can write one from the same code.
 *
 * WHY
 * ---
 * Milestone 6 requires that "when a customer approves their preview, the
 * settings that produced it are saved with that order approval, and later admin
 * changes apply only to new orders and never change an order already approved."
 *
 * The Gelato target is already copied onto the `Customization` row, so an order
 * still prints the right product after a mapping is edited. This captures the
 * rest of the settings — which prompt, which model, which resolution, which
 * background — so the Client can answer "what produced this?" months later,
 * even if the design has been reworked since or the prompt deleted.
 *
 * Read for display and audit only. Nothing rebuilds an order from it: the
 * authoritative fields live in their own columns, and a snapshot that could be
 * replayed would be a second source of truth to keep in step.
 */

import { toTrimmedString } from "./normalize.js";

/** Version of the snapshot shape, so an old row can always be read correctly. */
export const CONFIG_SNAPSHOT_VERSION = 1;

/**
 * Freeze the settings behind a design.
 *
 * @param {object} mapping Loaded with its `prompt` and `aiModel` relations.
 * @param {object} [extra] Anything decided at approval time rather than stored
 *   on the mapping — currently the resolution actually generated at.
 */
export function buildConfigSnapshot(mapping, extra = {}) {
  if (!mapping) return null;

  const prompt = mapping.prompt;
  const model = mapping.aiModel;

  return {
    version: CONFIG_SNAPSHOT_VERSION,
    capturedAt: new Date().toISOString(),

    design: {
      mappingId: toTrimmedString(mapping.id),
      label: toTrimmedString(mapping.designLabel) || toTrimmedString(mapping.shopifyProductTitle),
      status: toTrimmedString(mapping.status),
    },

    // Name and version as well as the id: a prompt can be edited or deleted,
    // and an id alone would then answer nothing.
    prompt: prompt
      ? {
          id: toTrimmedString(prompt.id),
          name: toTrimmedString(prompt.name),
          version: Number(prompt.version) || null,
          status: toTrimmedString(prompt.status),
        }
      : null,

    // The model key is what actually ran; the row it came from may be renamed
    // or removed later.
    model: model
      ? {
          id: toTrimmedString(model.id),
          key: toTrimmedString(model.modelKey),
          name: toTrimmedString(model.name),
          pricePerImage: Number.isFinite(Number(model.pricePerImage))
            ? Number(model.pricePerImage)
            : null,
        }
      : null,

    resolution:
      toTrimmedString(extra.resolution) || toTrimmedString(mapping.outputResolution),

    gelato: {
      templateId: toTrimmedString(mapping.gelatoTemplateId),
      templateName: toTrimmedString(mapping.gelatoTemplateName),
      productUid: toTrimmedString(mapping.gelatoProductUid),
      variantId: toTrimmedString(mapping.gelatoVariantId),
      placeholderName: toTrimmedString(mapping.gelatoPlaceholderName),
      printAreaName: toTrimmedString(mapping.gelatoPrintAreaName),
    },

    background: toTrimmedString(mapping.backgroundImageKey)
      ? {
          key: toTrimmedString(mapping.backgroundImageKey),
          name: toTrimmedString(mapping.backgroundImageName),
          placeholderName: toTrimmedString(mapping.backgroundPlaceholderName),
        }
      : null,

    supplier: {
      sku: toTrimmedString(mapping.supplierSku),
      printFileRequirements: toTrimmedString(mapping.printFileRequirements),
      mockupTemplate: toTrimmedString(mapping.mockupTemplate),
    },
  };
}

/**
 * Human-readable lines describing a snapshot, for the admin.
 *
 * Returns [] rather than placeholder rows for a design approved before
 * snapshots existed: "unknown" repeated six times is worse than nothing.
 */
export function describeConfigSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== "object") return [];

  const lines = [];

  if (snapshot.prompt) {
    lines.push({
      label: "Prompt",
      value: `${snapshot.prompt.name}${
        snapshot.prompt.version ? ` (v${snapshot.prompt.version})` : ""
      }`,
    });
  }

  if (snapshot.model) {
    lines.push({ label: "AI model", value: snapshot.model.key });
  }

  if (snapshot.resolution) {
    lines.push({ label: "Resolution", value: snapshot.resolution });
  }

  if (snapshot.gelato?.templateId) {
    lines.push({
      label: "Gelato template",
      value: snapshot.gelato.templateName || snapshot.gelato.templateId,
    });
  }

  if (snapshot.background) {
    lines.push({
      label: "Background",
      value: snapshot.background.name || "uploaded image",
    });
  }

  if (snapshot.supplier?.sku) {
    lines.push({ label: "SKU", value: snapshot.supplier.sku });
  }

  return lines;
}
