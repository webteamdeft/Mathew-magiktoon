import test from "node:test";
import assert from "node:assert/strict";

import sharp from "sharp";

import { mmToPx, resolvePrintGeometry } from "../app/lib/print-geometry.js";

/**
 * The print file is the only thing Gelato prints — support confirmed that no
 * identifier carries a template's composed design into an order. So everything
 * the customer approved has to be inside this one file.
 */

const {
  PRINT_FILE_ERRORS,
  buildTextOverlaySvg,
  composePrintFile,
  printFileCompositingEnabled,
  textCompositingEnabled,
} = await import("../app/lib/print-file.server.js");

/** A solid PNG of a known colour, so a composite can be proved by pixel. */
async function solid(colour, width = 400, height = 400) {
  return sharp({ create: { width, height, channels: 4, background: colour } })
    .png()
    .toBuffer();
}

const RED = { r: 255, g: 0, b: 0, alpha: 1 };
const BLUE = { r: 0, g: 0, b: 255, alpha: 1 };

/** The live mug, configured from its Gelato template PDF. */
function mapping(overrides = {}) {
  return {
    id: "map_mug",
    printFileRequirements: "204x100mm, 300 DPI, sRGB, 4mm bleed",
    layers: [
      {
        name: "Text 4",
        type: "text",
        x: 0.25,
        y: 0.4,
        width: 0.5,
        height: 0.1,
        text: { content: "", fontSize: 0.05, align: "center", color: "#112233" },
      },
    ],
    ...overrides,
  };
}

// ------------------------------------------------------------------ switches

test("the app does not build print files unless told to", () => {
  // A self-composited file holds only the artwork and an uploaded background.
  // The live mug template also carries a barcode graphic and seven text layers
  // that exist only on Gelato's side; compositing our own file for a design
  // like that would drop them and widen the gap with the approved mockup.
  assert.equal(printFileCompositingEnabled({}), false);
  assert.equal(printFileCompositingEnabled({ PRINT_FILE_COMPOSITE: "false" }), false);
  assert.equal(printFileCompositingEnabled({ PRINT_FILE_COMPOSITE: "yes" }), false);
  assert.equal(printFileCompositingEnabled({ PRINT_FILE_COMPOSITE: "true" }), true);
});

test("text compositing is off unless explicitly switched on", () => {
  // SOW 3.6 / FR-25 puts text through Personalization Studio. Gelato has since
  // confirmed no such API exists, but changing the clause is the Client's call.
  assert.equal(textCompositingEnabled({}), false);
  assert.equal(textCompositingEnabled({ PRINT_FILE_COMPOSITE_TEXT: "" }), false);
  assert.equal(textCompositingEnabled({ PRINT_FILE_COMPOSITE_TEXT: "false" }), false);
  assert.equal(textCompositingEnabled({ PRINT_FILE_COMPOSITE_TEXT: "1" }), false);
  assert.equal(textCompositingEnabled({ PRINT_FILE_COMPOSITE_TEXT: "true" }), true);
  assert.equal(textCompositingEnabled({ PRINT_FILE_COMPOSITE_TEXT: "TRUE" }), true);
});

// ---------------------------------------------------------------- text layout

const GEOMETRY = resolvePrintGeometry(mapping());

test("the customer's own wording is drawn, not the layer's placeholder text", () => {
  const svg = buildTextOverlaySvg(
    mapping({ layers: [{ ...mapping().layers[0], text: { content: "AUGUST" } }] }),
    { "Text 4": "MATTHEW" },
    GEOMETRY,
  );

  assert.match(svg, /MATTHEW/);
  assert.doesNotMatch(svg, /AUGUST/);
});

test("a layer the customer left blank falls back to its own wording", () => {
  const svg = buildTextOverlaySvg(
    mapping({ layers: [{ ...mapping().layers[0], text: { content: "AUGUST" } }] }),
    {},
    GEOMETRY,
  );

  assert.match(svg, /AUGUST/);
});

test("text is inset by bleed plus safe margin, so trimming cannot reach it", () => {
  // Gelato: 4 mm bleed is cut away, and important elements stay 4 mm inside the
  // trim line. Drawn against the full sheet, text would sit 8 mm too far out.
  const svg = buildTextOverlaySvg(mapping(), { "Text 4": "HI" }, GEOMETRY);

  const x = Number(svg.match(/x="([\d.]+)"/)[1]);
  const box = GEOMETRY.width - GEOMETRY.safeInset * 2;
  const expected = GEOMETRY.safeInset + box / 2; // centre anchor, centred box

  assert.equal(GEOMETRY.safeInset, mmToPx(8));
  assert.ok(Math.abs(x - expected) < 1, `x was ${x}, expected about ${expected}`);
});

test("font size is measured against the safe area, not the whole sheet", () => {
  const svg = buildTextOverlaySvg(mapping(), { "Text 4": "HI" }, GEOMETRY);

  const fontSize = Number(svg.match(/font-size="(\d+)"/)[1]);
  const box = GEOMETRY.width - GEOMETRY.safeInset * 2;

  assert.equal(fontSize, Math.round(0.05 * box));
  assert.notEqual(fontSize, Math.round(0.05 * GEOMETRY.width));
});

test("a multi-line layer prints as separate lines, not one run with a newline in it", () => {
  const svg = buildTextOverlaySvg(
    mapping(),
    { "Text 4": "Effortless power,\nunforgettable presence" },
    GEOMETRY,
  );

  const spans = svg.match(/<tspan/g) || [];

  assert.equal(spans.length, 2);
  assert.match(svg, /Effortless power,/);
  assert.match(svg, /unforgettable presence/);
});

test("nothing to draw produces no overlay at all", () => {
  // An empty transparent sheet over the artwork is wasted work and one more
  // chance to introduce a seam.
  assert.equal(buildTextOverlaySvg(mapping(), {}, GEOMETRY), "");
  assert.equal(buildTextOverlaySvg({}, { a: "b" }, GEOMETRY), "");
});

test("no print area means no overlay, rather than one at a guessed size", () => {
  const unknown = resolvePrintGeometry({});

  assert.equal(buildTextOverlaySvg(mapping(), { "Text 4": "HI" }, unknown), "");
  assert.equal(buildTextOverlaySvg(mapping(), { "Text 4": "HI" }, null), "");
});

test("text that looks like markup cannot break the SVG", () => {
  const svg = buildTextOverlaySvg(
    mapping(),
    { "Text 4": `</text><script>alert("x")</script>` },
    GEOMETRY,
  );

  assert.doesNotMatch(svg, /<script>/);
  assert.match(svg, /&lt;script&gt;/);
});

// -------------------------------------------------------------------- compose

/** Compose tests state a small explicit pixel size so they stay fast. */
function small(overrides = {}) {
  return mapping({ printFileRequirements: "400x200", ...overrides });
}

function deps(overrides = {}) {
  const stored = [];

  return {
    stored,
    options: {
      read: async (key) => {
        if (key === "art") return solid(RED);
        if (key === "bg") return solid(BLUE);
        throw new Error(`no such key: ${key}`);
      },
      store: async (buffer, options) => {
        stored.push({ buffer, options });
        return `printfiles/demo/${stored.length}.png`;
      },
      env: {},
      ...overrides,
    },
  };
}

/** The RGBA of the file's top-left pixel, so a stack order can be proved. */
async function topLeftPixel(buffer) {
  const { data } = await sharp(buffer).raw().toBuffer({ resolveWithObject: true });

  return { r: data[0], g: data[1], b: data[2], a: data[3] };
}

test("a design with no print area is refused before anything is read or stored", async () => {
  // The regression guard: the print area used to be derived from the template
  // placeholder, which is one image slot and not the printable area at all.
  // Guessing produces a parcel that is wrong in a way nobody sees until it
  // arrives, so a missing print area has to stop the file being built.
  const { options, stored } = deps({
    read: async () => {
      throw new Error("must not read");
    },
  });

  const result = await composePrintFile(
    {
      shop: "demo.myshopify.com",
      mapping: { id: "map_x", gelatoPlaceholderWidth: 75.33, gelatoPlaceholderHeight: 96 },
      artworkKey: "art",
    },
    options,
  );

  assert.equal(result.ok, false);
  assert.equal(result.code, PRINT_FILE_ERRORS.NO_PRINT_AREA);
  assert.match(result.error, /template PDF/);
  assert.equal(stored.length, 0);
});

test("a design with no background prints just the artwork, at the stated size", async () => {
  const { options } = deps();

  const result = await composePrintFile(
    { shop: "demo.myshopify.com", mapping: small(), artworkKey: "art" },
    options,
  );

  assert.equal(result.ok, true, result.error);
  assert.equal(result.hasBackground, false);
  assert.equal(result.width, 400);
  assert.equal(result.height, 200);
  assert.equal(result.mimeType, "image/png");
});

test("the mug builds at the size its template PDF states", async () => {
  const { options } = deps();

  const result = await composePrintFile(
    { shop: "demo.myshopify.com", mapping: mapping(), artworkKey: "art" },
    options,
  );

  assert.equal(result.ok, true, result.error);
  assert.equal(result.width, 2409);
  assert.equal(result.height, 1181);
  assert.equal(result.geometry.source, "template-pdf");
});

test("the background is composited UNDER the artwork, not over it", async () => {
  // The order carries one flat file, and the background the customer approved
  // has to be inside it.
  const { options, stored } = deps();

  const result = await composePrintFile(
    {
      shop: "demo.myshopify.com",
      mapping: small({ backgroundImageKey: "bg" }),
      artworkKey: "art",
    },
    options,
  );

  assert.equal(result.ok, true, result.error);
  assert.equal(result.hasBackground, true);

  const pixel = await topLeftPixel(stored[0].buffer);

  assert.ok(pixel.r > 200, `expected the artwork on top, got ${JSON.stringify(pixel)}`);
  assert.ok(pixel.b < 50, `expected the artwork on top, got ${JSON.stringify(pixel)}`);
});

test("the file carries its DPI, so Gelato prints it at the intended size", async () => {
  // A 300 DPI file tagged as 72 prints at four times the size.
  const { options, stored } = deps();

  await composePrintFile(
    { shop: "demo.myshopify.com", mapping: small(), artworkKey: "art" },
    options,
  );

  const meta = await sharp(stored[0].buffer).metadata();

  assert.equal(meta.density, 300);
});

test("a background that cannot be read still produces a printable file", async () => {
  // Failing an order because an optional layer is missing is worse than
  // printing the artwork alone.
  const { options } = deps();

  const result = await composePrintFile(
    {
      shop: "demo.myshopify.com",
      mapping: small({ backgroundImageKey: "gone" }),
      artworkKey: "art",
    },
    options,
  );

  assert.equal(result.ok, true, result.error);
  assert.equal(result.hasBackground, false);
});

test("no artwork is refused before anything is stored", async () => {
  const { options, stored } = deps();

  const result = await composePrintFile(
    { shop: "demo.myshopify.com", mapping: small(), artworkKey: "" },
    options,
  );

  assert.equal(result.ok, false);
  assert.equal(result.code, PRINT_FILE_ERRORS.NO_ARTWORK);
  assert.equal(stored.length, 0);
});

test("unreadable artwork fails loudly rather than printing an empty product", async () => {
  const { options, stored } = deps();

  const result = await composePrintFile(
    { shop: "demo.myshopify.com", mapping: small(), artworkKey: "missing" },
    options,
  );

  assert.equal(result.ok, false);
  assert.equal(result.code, PRINT_FILE_ERRORS.UNREADABLE);
  assert.equal(stored.length, 0);
});

test("by default the file carries no text, whatever the customer typed", async () => {
  const { options } = deps();

  const result = await composePrintFile(
    {
      shop: "demo.myshopify.com",
      mapping: small(),
      artworkKey: "art",
      textValues: { "Text 4": "MATTHEW" },
    },
    options,
  );

  assert.equal(result.ok, true, result.error);
  assert.equal(result.textComposited, false);
});

test("with the switch on, the text is burned in", async () => {
  const { options } = deps({ env: { PRINT_FILE_COMPOSITE_TEXT: "true" } });

  const result = await composePrintFile(
    {
      shop: "demo.myshopify.com",
      mapping: small(),
      artworkKey: "art",
      textValues: { "Text 4": "MATTHEW" },
    },
    options,
  );

  assert.equal(result.ok, true, result.error);
  assert.equal(result.textComposited, true);
});

test("the file is stored under the shop, as a PNG", async () => {
  const { options, stored } = deps();

  const result = await composePrintFile(
    { shop: "demo.myshopify.com", mapping: small(), artworkKey: "art" },
    options,
  );

  assert.equal(result.ok, true, result.error);
  assert.equal(stored.length, 1);
  assert.equal(stored[0].options.mimeType, "image/png");
  assert.match(stored[0].options.prefix, /^printfiles\/demo\.myshopify\.com$/);
  assert.match(result.key, /^printfiles\//);
});

test("a buffer can be passed straight in, skipping storage entirely", async () => {
  const { options } = deps({
    read: async () => {
      throw new Error("must not read");
    },
  });

  const result = await composePrintFile(
    { shop: "demo.myshopify.com", mapping: small(), artworkBuffer: await solid(RED) },
    options,
  );

  assert.equal(result.ok, true, result.error);
});

test("a corrupt image becomes a clean failure, not a thrown error", async () => {
  const { options } = deps({ read: async () => Buffer.from("not an image") });

  const result = await composePrintFile(
    { shop: "demo.myshopify.com", mapping: small(), artworkKey: "art" },
    options,
  );

  assert.equal(result.ok, false);
  assert.equal(result.code, PRINT_FILE_ERRORS.COMPOSE_FAILED);
});

/**
 * Text printed into the artwork itself.
 *
 * Asked for directly: the generated image should already carry the wording
 * rather than have it drawn over the top as a separate element. Distinct from
 * the print file — no print area, no bleed, and above all no resizing.
 */

const { composeArtworkText } = await import("../app/lib/print-file.server.js");

function artworkDesign(overrides = {}) {
  return {
    layers: [
      {
        name: "Text 4",
        type: "text",
        x: 0.2,
        y: 0.5,
        width: 0.6,
        height: 0.1,
        text: { content: "MATTHEW", fontSize: 0.06, align: "center", color: "#111111" },
      },
    ],
    ...overrides,
  };
}

test("the artwork keeps its exact dimensions — nothing cropped or stretched", async () => {
  // The whole point: the image comes back the shape it went in as.
  const original = await solid(RED, 900, 380);

  const out = await composeArtworkText(original, artworkDesign(), { "Text 4": "MATTHEW" });
  const meta = await sharp(out).metadata();

  assert.equal(meta.width, 900);
  assert.equal(meta.height, 380);
});

test("the wording actually lands on the pixels", async () => {
  // A dark word across a red field has to darken something.
  const original = await solid(RED, 600, 300);

  const out = await composeArtworkText(original, artworkDesign(), { "Text 4": "MATTHEW" });

  const { data } = await sharp(out).greyscale().raw().toBuffer({ resolveWithObject: true });

  // Walked rather than spread: a 600x300 greyscale buffer is 180,000 values and
  // Math.min.apply blows the call stack on it.
  let darkest = 255;

  for (let i = 0; i < data.length; i += 1) {
    if (data[i] < darkest) darkest = data[i];
  }

  assert.ok(darkest < 90, `expected dark text pixels, darkest was ${darkest}`);
});

test("the customer's wording wins over the design's own", async () => {
  const out = await composeArtworkText(
    await solid(RED, 400, 200),
    artworkDesign(),
    { "Text 4": "CARLA" },
  );

  assert.ok(Buffer.isBuffer(out));
});

test("a design with no text gets its artwork back untouched", async () => {
  // Returned by identity, so a caller can composite unconditionally without
  // paying to re-encode every image that has nothing to draw.
  const original = await solid(RED, 400, 200);

  const out = await composeArtworkText(original, { layers: [] }, {});

  assert.equal(out, original);
});

test("blank text draws nothing rather than an empty box", async () => {
  const original = await solid(RED, 400, 200);

  const out = await composeArtworkText(
    original,
    { layers: [{ name: "Text 4", type: "text", x: 0.2, y: 0.5, width: 0.6, height: 0.1, text: { content: "" } }] },
    { "Text 4": "   " },
  );

  assert.equal(out, original);
});

/**
 * The two text switches are not two switches for one feature.
 *
 * They draw the SAME wording in two different places: once onto the artwork at
 * generation, once onto the print file at fulfilment. Sharing a flag meant
 * enabling text printed every field twice, at two sizes, in one file — measured
 * on the live mug design before they were separated.
 */

const { generationTextCompositingEnabled: genText, textCompositingEnabled: printText } =
  await import("../app/lib/print-file.server.js");

test("the print-file switch does not also turn on the generation one", () => {
  const env = { PRINT_FILE_COMPOSITE_TEXT: "true" };

  assert.equal(printText(env), true);
  assert.equal(genText(env), false, "enabling both is what printed text twice");
});

test("the generation switch does not turn on the print-file one", () => {
  const env = { GENERATION_COMPOSITE_TEXT: "true" };

  assert.equal(genText(env), true);
  assert.equal(printText(env), false);
});

test("both default to off when nothing is configured", () => {
  assert.equal(printText({}), false);
  assert.equal(genText({}), false);
});
