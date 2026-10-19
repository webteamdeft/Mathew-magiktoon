/**
 * Template layer model.
 *
 * WHERE THE GEOMETRY COMES FROM
 * -----------------------------
 * Gelato tells us *which* elements a template has, and nothing about where they
 * sit:
 *
 *   image placeholder → { name, width, height, printArea }   (no x / y)
 *   text placeholder  → { name, text }                       (nothing else)
 *
 * There is no font, size, colour, alignment or position in the API. So Gelato
 * supplies the layer INVENTORY and the merchant supplies the LAYOUT, which is
 * what the admin Layers panel is for. Seeding fills in workable defaults so a
 * freshly mapped template renders sensibly before anyone touches it.
 *
 * COORDINATES
 * -----------
 * `x`, `y`, `width` and `height` are fractions of the product image (0–1), not
 * pixels, so one definition renders correctly at thumbnail size, at editor size
 * and at print resolution.
 *
 * Client-safe: pure functions, no Prisma, no credentials.
 */

import { asArray, toTrimmedString } from "./normalize.js";

/** Gelato's designer convention for a layer the customer must not change. */
export function isFixedGelatoName(name) {
  return /\(fixed\)/i.test(toTrimmedString(name));
}

/**
 * A customer-facing title from a Gelato layer name, or "" when the name is
 * Gelato's auto-generated one ("Text 4", "Copy of Copy of Text 4") and says
 * nothing. "(fixed)" is the designer's note to us, not part of the title.
 */
export function gelatoFieldLabel(name) {
  const trimmed = toTrimmedString(name);

  if (!trimmed || /^(copy of\s+)*(text|image)(\s*\d+)?$/i.test(trimmed)) {
    return "";
  }

  return trimmed.replace(/\s*\(fixed\)\s*/gi, " ").trim();
}

/** Wording compared without whitespace or case. */
function squashWording(value) {
  return toTrimmedString(value).replace(/\s+/g, "").toLowerCase();
}

export const LAYER_TYPES = { IMAGE: "image", TEXT: "text" };

export const TEXT_ALIGNMENTS = ["left", "center", "right"];

export const FONT_WEIGHTS = ["normal", "bold"];

/** Faces every browser has already. Safe everywhere, including in print. */
export const SYSTEM_FONT_FAMILIES = [
  "Helvetica, Arial, sans-serif",
  "Georgia, 'Times New Roman', serif",
  "'Courier New', monospace",
  "Impact, Haettenschweiler, sans-serif",
];

/**
 * Design faces, fetched from Google Fonts by the customizer.
 *
 * Chosen to cover the shapes a merch design actually reaches for — a geometric
 * sans, a condensed one, heavy display caps, a high-contrast serif, a reading
 * serif, and a script — rather than to be a long list.
 *
 * Each carries a real fallback stack, which matters more than usual: the print
 * file is rendered on the server, where none of these are installed, so the
 * fallback is what would print. `isWebFont` exists so that can be reported
 * instead of discovered on a parcel.
 */
export const WEB_FONT_FAMILIES = [
  { family: "Montserrat", stack: "'Montserrat', Helvetica, Arial, sans-serif" },
  { family: "Oswald", stack: "'Oswald', 'Arial Narrow', Helvetica, sans-serif" },
  { family: "Bebas Neue", stack: "'Bebas Neue', Impact, Haettenschweiler, sans-serif" },
  { family: "Anton", stack: "'Anton', Impact, Haettenschweiler, sans-serif" },
  { family: "Poppins", stack: "'Poppins', Helvetica, Arial, sans-serif" },
  { family: "Playfair Display", stack: "'Playfair Display', Georgia, serif" },
  { family: "Lora", stack: "'Lora', Georgia, 'Times New Roman', serif" },
  { family: "Dancing Script", stack: "'Dancing Script', 'Brush Script MT', cursive" },
];

export const FONT_FAMILIES = [
  ...SYSTEM_FONT_FAMILIES,
  ...WEB_FONT_FAMILIES.map((font) => font.stack),
];

/** Is this stack one the server would have to fall back on? */
export function isWebFont(stack) {
  return WEB_FONT_FAMILIES.some((font) => font.stack === stack);
}

/**
 * The Google Fonts stylesheet for every design face.
 *
 * One request for all of them: the customizer cannot know which a merchant has
 * chosen until the page is built, and a stylesheet per face would be worse.
 */
export function googleFontsHref() {
  const families = WEB_FONT_FAMILIES.map(
    (font) => `family=${font.family.replace(/ /g, "+")}:wght@400;700`,
  ).join("&");

  return `https://fonts.googleapis.com/css2?${families}&display=swap`;
}

/** Where a newly seeded image layer sits, as fractions of the product image. */
const DEFAULT_IMAGE_BOX = { x: 0.3, y: 0.3, width: 0.4, height: 0.28 };

/** A number clamped into a range, with a fallback for unusable input. */
function toNumber(value, { min, max, fallback }) {
  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.min(Math.max(parsed, min), max);
}

function toBoolean(value, fallback) {
  if (value === true || value === "true") return true;
  if (value === false || value === "false") return false;

  return fallback;
}

function oneOf(value, allowed, fallback) {
  const candidate = toTrimmedString(value);

  return allowed.includes(candidate) ? candidate : fallback;
}

/**
 * Normalize one layer.
 *
 * Every field is bounded, because these values are written by an admin form and
 * then used to position elements on a canvas: an out-of-range size or a NaN
 * coordinate would render nothing at all, with no obvious cause.
 */
export function normalizeLayer(raw, index = 0) {
  const type = raw?.type === LAYER_TYPES.TEXT ? LAYER_TYPES.TEXT : LAYER_TYPES.IMAGE;

  const layer = {
    // The Gelato placeholder name. This is the join key at fulfilment time, so
    // it is never regenerated or renamed by us.
    name: toTrimmedString(raw?.name) || `Layer ${index + 1}`,
    type,
    label: toTrimmedString(raw?.label),

    x: toNumber(raw?.x, { min: -0.5, max: 1.5, fallback: DEFAULT_IMAGE_BOX.x }),
    y: toNumber(raw?.y, { min: -0.5, max: 1.5, fallback: DEFAULT_IMAGE_BOX.y }),
    width: toNumber(raw?.width, { min: 0.02, max: 2, fallback: DEFAULT_IMAGE_BOX.width }),
    height: toNumber(raw?.height, { min: 0.02, max: 2, fallback: DEFAULT_IMAGE_BOX.height }),
    rotation: toNumber(raw?.rotation, { min: -180, max: 180, fallback: 0 }),

    zIndex: Math.trunc(toNumber(raw?.zIndex, { min: 0, max: 999, fallback: index + 1 })),

    // Locked wins over editable: a locked layer is never customer-editable,
    // whatever the other flag says.
    locked: toBoolean(raw?.locked, false),
    editable: toBoolean(raw?.editable, true),
  };

  if (layer.locked) {
    layer.editable = false;
  }

  if (type === LAYER_TYPES.IMAGE) {
    // The artwork for a FIXED image layer — a logo, a barcode, a block of set
    // wording saved as an image. Gelato names the placeholder but publishes
    // none of its artwork, so anything that is not the customer's photo has to
    // be uploaded per design.
    //
    // Only the storage key is kept, never a URL: asset URLs are signed and
    // expire, so persisting one would leave a dead link on the record (NFR-09).
    layer.imageKey = toTrimmedString(raw?.imageKey);
    layer.imageName = toTrimmedString(raw?.imageName);
  }

  if (type === LAYER_TYPES.TEXT) {
    layer.text = {
      content: toTrimmedString(raw?.text?.content ?? raw?.content),
      fontFamily: oneOf(raw?.text?.fontFamily, FONT_FAMILIES, FONT_FAMILIES[0]),
      // A fraction of the product image's width, so text scales with the canvas.
      fontSize: toNumber(raw?.text?.fontSize, { min: 0.005, max: 0.4, fallback: 0.04 }),
      color: /^#[0-9a-f]{3,8}$/i.test(toTrimmedString(raw?.text?.color))
        ? toTrimmedString(raw.text.color)
        : "#111111",
      align: oneOf(raw?.text?.align, TEXT_ALIGNMENTS, "center"),
      weight: oneOf(raw?.text?.weight, FONT_WEIGHTS, "normal"),
      lineHeight: toNumber(raw?.text?.lineHeight, { min: 0.8, max: 3, fallback: 1.2 }),
    };
  }

  return layer;
}

/** Normalize a whole set, in paint order, with unique names. */
export function normalizeLayers(raw) {
  let parsed = raw;

  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return [];
    }
  }

  const seen = new Set();

  return asArray(parsed)
    .map((layer, index) => normalizeLayer(layer, index))
    // A duplicate name would make two layers indistinguishable at fulfilment.
    .filter((layer) => {
      if (seen.has(layer.name)) return false;

      seen.add(layer.name);
      return true;
    })
    .sort((a, b) => a.zIndex - b.zIndex);
}

/**
 * Build a starting layer set from a Gelato template.
 *
 * Image placeholders become the customer's upload areas, sized to the real
 * aspect ratio Gelato reports. Text placeholders become text layers carrying
 * the wording the designer typed, stacked below one another — a guess, but a
 * legible one that the merchant then positions properly.
 */
export function seedLayersFromTemplate(template, existing = []) {
  const previous = new Map(
    normalizeLayers(existing).map((layer) => [layer.name, layer]),
  );

  const images = asArray(template?.placeholders);
  const texts = asArray(template?.textPlaceholders);

  const layers = [];

  images.forEach((placeholder, index) => {
    const name = toTrimmedString(placeholder?.name);

    if (!name) return;

    // Never overwrite a layer the merchant has already positioned.
    if (previous.has(name)) {
      layers.push(previous.get(name));
      return;
    }

    const ratio =
      Number(placeholder?.width) > 0 && Number(placeholder?.height) > 0
        ? Number(placeholder.width) / Number(placeholder.height)
        : 1;

    const width = DEFAULT_IMAGE_BOX.width;

    layers.push(
      normalizeLayer(
        {
          name,
          type: LAYER_TYPES.IMAGE,
          label: toTrimmedString(placeholder?.printArea)
            ? `Artwork (print area ${placeholder.printArea})`
            : "Artwork",
          x: DEFAULT_IMAGE_BOX.x,
          y: DEFAULT_IMAGE_BOX.y,
          width,
          height: width / ratio,
          zIndex: index + 1,
          editable: !isFixedGelatoName(name),
        },
        index,
      ),
    );
  });

  // Every name the template has now. A saved layer whose name is not among
  // them was renamed in Gelato, and may be carried over below.
  const currentNames = new Set(
    [...images, ...texts].map((placeholder) => toTrimmedString(placeholder?.name)),
  );
  const carried = new Set();

  texts.forEach((placeholder, index) => {
    const name = toTrimmedString(placeholder?.name);

    if (!name) return;

    if (previous.has(name)) {
      layers.push(previous.get(name));
      return;
    }

    // Renamed in Gelato ("Copy of Copy of Text 4" became "Name"): keep the
    // merchant's position and styling from the old layer, found by the default
    // wording the rename leaves untouched, under the new name and title.
    const wording = squashWording(placeholder?.defaultText);
    const renamed = wording
      ? normalizeLayers(existing).find(
          (layer) =>
            layer.type === LAYER_TYPES.TEXT &&
            !currentNames.has(layer.name) &&
            !carried.has(layer.name) &&
            squashWording(layer.text?.content) === wording,
        )
      : null;

    if (renamed) {
      carried.add(renamed.name);
      layers.push(
        normalizeLayer({
          ...renamed,
          name,
          label: gelatoFieldLabel(name) || renamed.label,
          editable: isFixedGelatoName(name) ? false : renamed.editable,
        }),
      );
      return;
    }

    layers.push(
      normalizeLayer(
        {
          name,
          type: LAYER_TYPES.TEXT,
          // Numbered, not named after the wording.
          //
          // Gelato's own name is unusable ("Copy of Copy of Copy of Text 4"),
          // and the wording is worse: the live mug design has two fields whose
          // text is "$5.00", so labelling by wording gives the shopper two
          // identical labels and no way to tell them apart.
          //
          // The wording is not lost — it is the field's value, in the box
          // directly beneath the label. This is a placeholder for the merchant
          // to replace in the layer editor, and it reads like one.
          //
          // A designer who names the layer in Gelato ("Name", "Year") has
          // written the title already; that wins.
          label:
            gelatoFieldLabel(name) ||
            toTrimmedString(placeholder?.label) ||
            `Text ${index + 1}`,
          x: 0.3,
          y: 0.62 + index * 0.06,
          width: 0.4,
          height: 0.06,
          zIndex: images.length + index + 1,
          // Marked "(fixed)" in Gelato: part of the design, not the customer's.
          editable: !isFixedGelatoName(name),
          text: { content: toTrimmedString(placeholder?.defaultText) },
        },
        images.length + index,
      ),
    );
  });

  return normalizeLayers(layers);
}

/**
 * The layer a customer's uploaded photo goes into.
 *
 * A layer carrying its own uploaded artwork is fixed by definition and is never
 * the upload slot, however its editable flag reads — otherwise a design whose
 * first image layer is a logo would drop the customer's photo onto the logo.
 */
export function findUploadLayer(layers) {
  const candidates = normalizeLayers(layers).filter(
    (layer) => layer.type === LAYER_TYPES.IMAGE && !layer.imageKey,
  );

  return candidates.find((layer) => layer.editable) || candidates[0] || null;
}

/** Image layers that carry their own artwork, in paint order. */
export function fixedImageLayers(layers) {
  return normalizeLayers(layers).filter(
    (layer) => layer.type === LAYER_TYPES.IMAGE && Boolean(layer.imageKey),
  );
}

/** Text layers a customer is allowed to change. */
export function editableTextLayers(layers) {
  return normalizeLayers(layers).filter(
    (layer) => layer.type === LAYER_TYPES.TEXT && layer.editable,
  );
}

/** Move a layer up or down the stack, renumbering the whole set. */
export function reorderLayer(layers, name, direction) {
  const all = normalizeLayers(layers);
  const index = all.findIndex((layer) => layer.name === name);

  if (index < 0) return all;

  const target = index + (direction === "up" ? 1 : -1);

  if (target < 0 || target >= all.length) return all;

  const next = all.slice();
  [next[index], next[target]] = [next[target], next[index]];

  return next.map((layer, position) => ({ ...layer, zIndex: position + 1 }));
}
