/**
 * Print file geometry.
 *
 * WHERE THE PRINT AREA COMES FROM — AND WHERE IT DOES NOT
 * -------------------------------------------------------
 * From Gelato's own product template PDF, and nothing else.
 *
 * This module previously derived the print area from the template's image
 * placeholder dimensions. That was WRONG, and the mistake is worth recording
 * because it is easy to make again: a placeholder is one image SLOT inside the
 * product's print area, not the area itself. The 11oz mug reports a placeholder
 * of 75.33 x 96 mm — portrait — while the product's actual print file is
 * 204 x 100 mm, landscape, because the mug's wrap carries two portrait images
 * and a barcode side by side. Building to the placeholder would have printed
 * every mug at less than half size, stretched, and nobody would have known
 * until a parcel arrived.
 *
 * The catalog API cannot supply it either: `GET /v3/products/{productUid}`
 * returns `contentAreas: []` for our products. Gelato support confirmed the
 * template PDF is the source of truth, downloaded from
 * Product catalog → product → the dropdown beside "Create order" →
 * "Download template". Its MediaBox is the print file size.
 *
 * So the print area is configured per design, read off that PDF, and entered
 * in the design's "print file requirements" field as millimetres —
 * for example "204x100mm". `scripts/read-template-pdf.mjs` extracts it.
 *
 * A design with no print area configured is NOT guessed at. `resolvePrintGeometry`
 * reports `source: "unknown"`, and the compositor refuses rather than inventing
 * a size.
 *
 * CONFIRMED BY GELATO SUPPORT
 * ---------------------------
 *   - Bleed 4 mm on all sides.
 *   - Keep important elements at least 4 mm inside the trim line.
 *   - 300 DPI at final print size (150 DPI minimum).
 *   - sRGB. PNG accepted.
 *   - How a submitted file is fitted into the print area: "not defined".
 *
 * That last gap is closed by construction: a file built at exactly the print
 * size and aspect ratio produces the same result whether it is scaled to fill,
 * scaled to fit, or taken as-is.
 *
 * NOTE ON BLEED: the template PDF's MediaBox already INCLUDES bleed — for the
 * mug, MediaBox and TrimBox are both 204 x 100 mm and the sheet is drawn with a
 * hatched bleed border inside it. So a stated size is the finished file, and
 * bleed is never added on top of it. It is reported only so that text and other
 * critical content can be kept away from the edge.
 *
 * Client-safe: pure arithmetic, no I/O.
 */

import { toTrimmedString } from "./normalize.js";

/** Gelato: "300 DPI recommended at final print size", 150 the minimum. */
export const PRINT_FILE_DPI = 300;

/** Gelato: 4 mm on all sides, already inside the template PDF's page size. */
export const BLEED_MM = 4;

/** Gelato: keep important elements at least 4 mm inside the trim line. */
export const SAFE_AREA_MM = 4;

const MM_PER_INCH = 25.4;

/** Beyond this a file is impractical to build and to upload. */
export const MAX_PRINT_EDGE = 8000;

export function mmToPx(mm, dpi = PRINT_FILE_DPI) {
  return Math.round((Number(mm) * dpi) / MM_PER_INCH);
}

export function pxToMm(px, dpi = PRINT_FILE_DPI) {
  return (Number(px) * MM_PER_INCH) / dpi;
}

/**
 * Read a print size out of a design's "print file requirements" field.
 *
 * Millimetres are preferred and are what the template PDF states:
 *
 *     "204x100mm"          -> 204 x 100 mm at 300 DPI
 *     "204 × 100 mm, 300 DPI"
 *
 * Pixels are accepted for a supplier who states them directly:
 *
 *     "2409x1181"          -> exactly that, no conversion
 *
 * Anything else — prose, a DPI on its own, an empty field — returns null, so
 * the caller can refuse rather than guess.
 */
export function parsePrintFileRequirements(value) {
  const text = toTrimmedString(value);

  if (!text) return null;

  // Millimetres may be written after either number, or once at the end.
  const millimetres = text.match(
    /(\d{1,4}(?:\.\d+)?)\s*(?:mm)?\s*[x×]\s*(\d{1,4}(?:\.\d+)?)\s*mm/i,
  );

  const dpiMatch = text.match(/(\d{2,4})\s*dpi/i);
  const dpi = dpiMatch ? Number(dpiMatch[1]) : PRINT_FILE_DPI;

  if (millimetres) {
    const width = Number(millimetres[1]);
    const height = Number(millimetres[2]);

    if (width > 0 && height > 0) {
      return { unit: "mm", width, height, dpi };
    }
  }

  const pixels = text.match(/(\d{3,5})\s*[x×]\s*(\d{3,5})/);

  if (pixels) {
    const width = Number(pixels[1]);
    const height = Number(pixels[2]);

    if (width > 0 && height > 0) {
      return { unit: "px", width, height, dpi };
    }
  }

  return null;
}

function clampEdge(px) {
  return Math.max(1, Math.min(Math.round(px), MAX_PRINT_EDGE));
}

/**
 * Everything needed to lay out one design's print file.
 *
 * `width`/`height` are the finished file, bleed included — that is what gets
 * rendered and uploaded. `safeInset` is how far in from the edge anything that
 * must survive has to sit: one bleed margin plus one safe margin.
 *
 * `source` is `"unknown"` when no print area is configured. Callers must treat
 * that as a refusal, not as a default.
 */
export function resolvePrintGeometry(mapping, { dpi = PRINT_FILE_DPI } = {}) {
  const stated = parsePrintFileRequirements(mapping?.printFileRequirements);

  if (!stated) {
    return {
      source: "unknown",
      dpi,
      width: 0,
      height: 0,
      widthMm: 0,
      heightMm: 0,
      bleed: 0,
      bleedMm: BLEED_MM,
      safeInset: 0,
    };
  }

  const effectiveDpi = stated.dpi || dpi;

  const widthMm =
    stated.unit === "mm" ? stated.width : pxToMm(stated.width, effectiveDpi);
  const heightMm =
    stated.unit === "mm" ? stated.height : pxToMm(stated.height, effectiveDpi);

  const width =
    stated.unit === "mm" ? clampEdge(mmToPx(stated.width, effectiveDpi)) : clampEdge(stated.width);
  const height =
    stated.unit === "mm"
      ? clampEdge(mmToPx(stated.height, effectiveDpi))
      : clampEdge(stated.height);

  const bleed = mmToPx(BLEED_MM, effectiveDpi);

  return {
    source: stated.unit === "mm" ? "template-pdf" : "requirements-px",
    dpi: effectiveDpi,
    width,
    height,
    widthMm,
    heightMm,
    bleed,
    bleedMm: BLEED_MM,
    // Bleed is cut away and the safe margin sits inside what remains.
    safeInset: mmToPx(BLEED_MM + SAFE_AREA_MM, effectiveDpi),
  };
}

/** Is this design ready to have a print file built for it? */
export function hasPrintArea(geometry) {
  return Boolean(geometry) && geometry.source !== "unknown" && geometry.width > 0;
}

/** A one-line description, for admin display and logs. */
export function describePrintGeometry(geometry) {
  if (!hasPrintArea(geometry)) {
    return "No print area configured — read it from the product's Gelato template PDF.";
  }

  return (
    `${geometry.width} × ${geometry.height} px @ ${geometry.dpi} DPI ` +
    `(${geometry.widthMm.toFixed(1)} × ${geometry.heightMm.toFixed(1)} mm, ` +
    `${geometry.bleedMm} mm bleed included)`
  );
}
