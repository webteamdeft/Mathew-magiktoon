import test from "node:test";
import assert from "node:assert/strict";

import {
  BLEED_MM,
  MAX_PRINT_EDGE,
  PRINT_FILE_DPI,
  describePrintGeometry,
  hasPrintArea,
  mmToPx,
  parsePrintFileRequirements,
  resolvePrintGeometry,
} from "../app/lib/print-geometry.js";

/**
 * These numbers come off Gelato's own product template PDF. Getting them wrong
 * produces a misprinted parcel a customer has already paid for, and it is not
 * visible anywhere before that.
 *
 * The live 11oz mug: MediaBox 204 x 100 mm, which at 300 DPI is 2409 x 1181 px.
 */

/** The mug as configured from its template PDF. */
function mug(overrides = {}) {
  return {
    id: "map_mug",
    printFileRequirements: "204x100mm, 300 DPI, sRGB, 4mm bleed",
    // Deliberately present, and deliberately NOT the print area: this is one
    // image slot inside the mug's wrap, and it is portrait while the wrap is
    // landscape. Nothing may derive the print size from it.
    gelatoPlaceholderWidth: 75.3333654662,
    gelatoPlaceholderHeight: 96,
    ...overrides,
  };
}

test("millimetres convert at the stated DPI", () => {
  assert.equal(mmToPx(25.4, 300), 300);
  assert.equal(mmToPx(25.4, 150), 150);
  assert.equal(mmToPx(4, 300), 47);
});

test("the mug's print file comes out at the size its template PDF states", () => {
  const geometry = resolvePrintGeometry(mug());

  assert.equal(geometry.source, "template-pdf");
  assert.equal(geometry.dpi, PRINT_FILE_DPI);
  assert.equal(geometry.width, 2409);
  assert.equal(geometry.height, 1181);
  assert.equal(geometry.widthMm, 204);
  assert.equal(geometry.heightMm, 100);
});

test("the placeholder size is NEVER used as the print area", () => {
  // The regression this whole module exists to prevent. A placeholder is one
  // image slot: 75.33 x 96 mm portrait, inside a 204 x 100 mm landscape wrap.
  // Deriving the print file from it printed at under half size, stretched.
  const withoutRequirements = resolvePrintGeometry({
    gelatoPlaceholderWidth: 75.3333654662,
    gelatoPlaceholderHeight: 96,
  });

  assert.equal(withoutRequirements.source, "unknown");
  assert.equal(hasPrintArea(withoutRequirements), false);

  // And when a print area IS configured, the placeholder must not influence it.
  const geometry = resolvePrintGeometry(mug({ gelatoPlaceholderWidth: 9999 }));

  assert.equal(geometry.width, 2409);
});

test("a design with no print area is refused, not guessed at", () => {
  assert.equal(hasPrintArea(resolvePrintGeometry({})), false);
  assert.equal(hasPrintArea(resolvePrintGeometry(null)), false);
  assert.equal(hasPrintArea(resolvePrintGeometry({ printFileRequirements: "300 DPI" })), false);
  assert.equal(hasPrintArea(null), false);
});

test("bleed is reported but never added — the PDF page already includes it", () => {
  // MediaBox and TrimBox are both 204 x 100 for this mug, and the sheet is
  // drawn with a hatched bleed border inside that. Adding 4 mm again would
  // print everything 8 mm too large.
  const geometry = resolvePrintGeometry(mug());

  assert.equal(geometry.bleedMm, BLEED_MM);
  assert.equal(geometry.bleed, 47);
  assert.equal(geometry.width, mmToPx(204), "no bleed added on top");
});

test("the safe inset keeps content clear of both the bleed and the trim line", () => {
  // 4 mm bleed plus 4 mm safe margin.
  assert.equal(resolvePrintGeometry(mug()).safeInset, mmToPx(8));
});

test("millimetres are read whichever way they are written", () => {
  assert.deepEqual(parsePrintFileRequirements("204x100mm"), {
    unit: "mm",
    width: 204,
    height: 100,
    dpi: 300,
  });

  assert.deepEqual(parsePrintFileRequirements("204 mm × 100 mm"), {
    unit: "mm",
    width: 204,
    height: 100,
    dpi: 300,
  });

  assert.deepEqual(parsePrintFileRequirements("204x100mm @ 150dpi"), {
    unit: "mm",
    width: 204,
    height: 100,
    dpi: 150,
  });
});

test("a supplier who states pixels is taken at their word", () => {
  const geometry = resolvePrintGeometry({ printFileRequirements: "2409x1181" });

  assert.equal(geometry.source, "requirements-px");
  assert.equal(geometry.width, 2409);
  assert.equal(geometry.height, 1181);
  assert.ok(Math.abs(geometry.widthMm - 204) < 0.5);
});

test("prose with no size in it configures nothing", () => {
  assert.equal(parsePrintFileRequirements("300 DPI, CMYK, no bleed"), null);
  assert.equal(parsePrintFileRequirements(""), null);
  assert.equal(parsePrintFileRequirements(null), null);
});

test("an absurd size is capped rather than attempted", () => {
  const geometry = resolvePrintGeometry({ printFileRequirements: "5000x5000mm" });

  assert.equal(geometry.width, MAX_PRINT_EDGE);
  assert.equal(geometry.height, MAX_PRINT_EDGE);
});

test("a geometry describes itself for the admin and the logs", () => {
  const text = describePrintGeometry(resolvePrintGeometry(mug()));

  assert.match(text, /2409 × 1181 px/);
  assert.match(text, /300 DPI/);
  assert.match(text, /204\.0 × 100\.0 mm/);
  assert.match(text, /4 mm bleed included/);
});

test("an unconfigured design says so, rather than reporting 0 × 0", () => {
  const text = describePrintGeometry(resolvePrintGeometry({}));

  assert.match(text, /No print area configured/);
  assert.match(text, /template PDF/);
});
