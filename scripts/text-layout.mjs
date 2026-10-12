/**
 * Set where a design's text prints — Option A's missing piece.
 *
 * WHY THIS IS A SCRIPT AND NOT AN ADMIN SCREEN
 * --------------------------------------------
 * The Client asked for the opposite of a settings page:
 *
 *   "I will not be adjusting text placement outside of Gelato, nor risk that an
 *    employee can accidentally change a template."
 *
 * So the visual controls were removed from the admin, and they are not coming
 * back. But Option A — which the Client chose — means this app draws the
 * customer's wording into the artwork itself, and drawing needs a position, a
 * size, a font and a colour.
 *
 * Gelato publishes none of them. Proven twice, not assumed:
 *
 *   - the API returns { name, text } for a text placeholder and nothing else,
 *     across all 63 on the live mug template
 *   - the downloadable template PDF holds only bleed, trim and safe-area
 *     guides; its four text objects are those guide labels
 *
 * So the values have to be set once per template by whoever builds the
 * integration, from the approved Gelato design. A script keeps that out of the
 * merchant admin entirely, which is what was actually asked for.
 *
 * WHY IT DRAWS A PROOF
 * --------------------
 * The stored values are fractions of the print area. Typing them blind is how
 * the current ones came to be — all seven fields stacked down one column at
 * x=0.3, the last of them off the canvas — and nothing on screen said so.
 * `proof` renders the real print geometry with the real wording on it, so a
 * wrong number is visible before it reaches a mug.
 *
 * USAGE
 *   node scripts/text-layout.mjs show  [mappingId]
 *   node scripts/text-layout.mjs proof [mappingId]
 *   node scripts/text-layout.mjs set   <mappingId> <layer#> key=value ...
 *   node scripts/text-layout.mjs print-area <mappingId> <"204x100mm">
 *
 * Keys for `set`: x y width height rotation size font colour weight align
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import { PrismaClient } from "@prisma/client";
import sharp from "sharp";

import { normalizeLayers, LAYER_TYPES } from "../app/lib/layers.js";
import {
  resolvePrintGeometry,
  hasPrintArea,
  describePrintGeometry,
} from "../app/lib/print-geometry.js";
import { buildTextOverlaySvg } from "../app/lib/print-file.server.js";
import { printReadiness } from "../app/lib/print-readiness.js";

const prisma = new PrismaClient();

/** Longest edge of a proof image. Full print size is unreadable on screen. */
const PROOF_MAX_EDGE = 1600;

const PROOF_DIR = path.join("tmp", "text-layout");

function asLayers(mapping) {
  const raw =
    typeof mapping.layers === "string"
      ? JSON.parse(mapping.layers || "[]")
      : mapping.layers || [];

  return normalizeLayers(raw);
}

async function loadMapping(id) {
  const mapping = id
    ? await prisma.productMapping.findUnique({ where: { id } })
    : await prisma.productMapping.findFirst();

  if (!mapping) {
    console.error(id ? `No mapping with id ${id}` : "No mappings exist yet.");
    process.exit(1);
  }

  return mapping;
}

/** The text layers, in the order `set` addresses them by number. */
function textLayers(mapping) {
  return asLayers(mapping).filter((layer) => layer.type === LAYER_TYPES.TEXT);
}

function geometryOf(mapping) {
  return resolvePrintGeometry(mapping);
}

// ------------------------------------------------------------------- show

function show(mapping) {
  const geometry = geometryOf(mapping);
  const texts = textLayers(mapping);

  console.log(`mapping     : ${mapping.id}`);
  console.log(`product     : ${mapping.shopifyProductId}`);
  console.log(`print area  : ${describePrintGeometry(geometry)}`);

  if (!hasPrintArea(geometry)) {
    console.log("");
    console.log("  !! No print area, so nothing can be composited yet.");
    console.log('  !! Fix with: print-area <mappingId> "204x100mm"');
    console.log("  !! The size comes from the template PDF, not from Gelato's API.");
  }

  console.log(`\n${texts.length} text layer(s):\n`);

  texts.forEach((layer, index) => {
    const label = layer.label || layer.name;

    console.log(`  [${index}] ${label}`);
    console.log(
      `      x=${layer.x}  y=${layer.y}  width=${layer.width}` +
        `  rotation=${layer.rotation || 0}`,
    );
    console.log(
      `      size=${layer.text.fontSize}  align=${layer.text.align}` +
        `  weight=${layer.text.weight}  colour=${layer.text.color}`,
    );
    console.log(`      font=${layer.text.fontFamily}`);
    console.log(`      text=${JSON.stringify(layer.text.content)}`);
    console.log("");
  });

  // The values that have never been reviewed look exactly like the ones that
  // have, so say which is which.
  const suspect = texts.filter((layer) => layer.x === 0.3 && layer.width === 0.4);

  if (suspect.length > 0) {
    console.log(
      `  NOTE: ${suspect.length} layer(s) still carry the seeded defaults ` +
        "(x=0.3, width=0.4).",
    );
    console.log("        Those are placeholders, not the Gelato design.");
  }
}

// ------------------------------------------------------------------ proof

/** A labelled tenth-grid, so a wrong fraction is readable off the image. */
function gridSvg(geometry) {
  const { width, height, safeInset = 0 } = geometry;
  const parts = [];

  for (let i = 1; i < 10; i += 1) {
    const x = (width * i) / 10;
    const y = (height * i) / 10;

    parts.push(
      `<line x1="${x}" y1="0" x2="${x}" y2="${height}" stroke="#c8d4e0" stroke-width="2"/>`,
      `<line x1="0" y1="${y}" x2="${width}" y2="${y}" stroke="#c8d4e0" stroke-width="2"/>`,
      `<text x="${x + 6}" y="26" fill="#8496a8" font-size="22" font-family="sans-serif">.${i}</text>`,
      `<text x="6" y="${y - 6}" fill="#8496a8" font-size="22" font-family="sans-serif">.${i}</text>`,
    );
  }

  // Everything that must survive trimming sits inside this.
  parts.push(
    `<rect x="${safeInset}" y="${safeInset}"` +
      ` width="${width - safeInset * 2}" height="${height - safeInset * 2}"` +
      ` fill="none" stroke="#e0574c" stroke-width="3" stroke-dasharray="14 10"/>`,
  );

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${parts.join("")}</svg>`;
}

async function proof(mapping) {
  const geometry = geometryOf(mapping);

  if (!hasPrintArea(geometry)) {
    console.error("No print area on this design, so there is nothing to draw on.");
    console.error('Set one first:  print-area <mappingId> "204x100mm"');
    process.exit(1);
  }

  const layers = asLayers(mapping);

  // Each field's own wording, which is what a merchant recognises. A field the
  // template left blank still gets drawn, so its position can be judged.
  const values = {};

  for (const layer of layers) {
    if (layer.type !== LAYER_TYPES.TEXT) continue;
    values[layer.name] = layer.text.content || layer.label || layer.name;
  }

  const svg = buildTextOverlaySvg({ layers }, values, geometry);

  if (!svg) {
    console.error("This design has no text layers to draw.");
    process.exit(1);
  }

  const composed = await sharp({
    create: {
      width: geometry.width,
      height: geometry.height,
      channels: 3,
      background: "#ffffff",
    },
  })
    .composite([
      { input: Buffer.from(gridSvg(geometry)), top: 0, left: 0 },
      { input: Buffer.from(svg), top: 0, left: 0 },
    ])
    .png()
    .toBuffer();

  const scale = Math.min(1, PROOF_MAX_EDGE / Math.max(geometry.width, geometry.height));

  const out = path.join(PROOF_DIR, `${mapping.id}.png`);
  fs.mkdirSync(PROOF_DIR, { recursive: true });

  await sharp(composed)
    .resize({ width: Math.round(geometry.width * scale) })
    .toFile(out);

  console.log(`print area : ${describePrintGeometry(geometry)}`);
  console.log(`proof      : ${out}`);
  console.log("");
  console.log("Red dashed line is the safe area — text outside it can be trimmed off.");
  console.log("Grid lines are tenths, matching the x / y fractions in `show`.");
}

// -------------------------------------------------------------------- set

/** Map the friendly key names onto where they actually live on a layer. */
function applyChange(layer, key, raw) {
  const number = Number(raw);

  switch (key) {
    case "x":
    case "y":
    case "width":
    case "height":
    case "rotation":
      if (Number.isNaN(number)) throw new Error(`${key} must be a number`);
      layer[key] = number;
      return `${key}=${number}`;

    case "size":
      if (Number.isNaN(number)) throw new Error("size must be a number");
      layer.text.fontSize = number;
      return `fontSize=${number}`;

    case "colour":
    case "color":
      layer.text.color = raw;
      return `color=${raw}`;

    case "font":
      layer.text.fontFamily = raw;
      return `fontFamily=${raw}`;

    case "weight":
      layer.text.weight = raw;
      return `weight=${raw}`;

    case "align":
      layer.text.align = raw;
      return `align=${raw}`;

    case "label":
      layer.label = raw;
      return `label=${raw}`;

    default:
      throw new Error(`unknown key: ${key}`);
  }
}

async function set(mapping, indexArg, pairs) {
  const layers = asLayers(mapping);
  const texts = layers.filter((layer) => layer.type === LAYER_TYPES.TEXT);
  const index = Number(indexArg);

  if (!Number.isInteger(index) || index < 0 || index >= texts.length) {
    console.error(`Layer number must be 0..${texts.length - 1}. See \`show\`.`);
    process.exit(1);
  }

  const target = texts[index];
  const applied = [];

  for (const pair of pairs) {
    const at = pair.indexOf("=");

    if (at < 0) {
      console.error(`Expected key=value, got: ${pair}`);
      process.exit(1);
    }

    try {
      applied.push(applyChange(target, pair.slice(0, at), pair.slice(at + 1)));
    } catch (error) {
      console.error(error.message);
      process.exit(1);
    }
  }

  // Written back through the normaliser so a value out of range is clamped here
  // rather than surprising the compositor later.
  await prisma.productMapping.update({
    where: { id: mapping.id },
    data: { layers: JSON.stringify(normalizeLayers(layers)) },
  });

  console.log(`[${index}] ${target.label || target.name}`);
  applied.forEach((change) => console.log(`  ${change}`));
  console.log("\nSaved. Run `proof` to see where it lands.");
}

// ---------------------------------------------------------------- ready

/**
 * What is still standing between this design and a printable file.
 *
 * Worth asking before every other question here, because a design missing an
 * element cannot be fulfilled however well its text is positioned.
 */
function ready(mapping) {
  const result = printReadiness(mapping);

  console.log(`design     : ${mapping.id}`);
  console.log(`print area : ${describePrintGeometry(result.geometry)}`);
  console.log("");

  if (result.ready) {
    console.log("READY — every element of this design is available.");
    return;
  }

  console.log(`NOT READY — ${result.blockers.length} blocker(s):\n`);

  result.blockers.forEach((blocker, index) => {
    console.log(`  ${index + 1}. ${blocker.code}`);
    console.log(`     ${blocker.detail}`);
    console.log("");
  });

  console.log("Artwork for a design element is uploaded against its layer in");
  console.log("the admin: Designs -> this design -> Layers -> the layer -> upload.");

  process.exitCode = 1;
}

// ----------------------------------------------------------- reseed text

/**
 * Put each field's wording back to what the Gelato template ships with.
 *
 * The wording belongs to the template, and a design that has been tested
 * against tends to carry whatever was typed during testing — this design had
 * two fields reading "text1" where the template says "MATTHEW" and "1972".
 * That is what a merchant would see in the admin, and what would print for any
 * field the customer leaves alone.
 *
 * Restored from the template placeholders stored on the design rather than
 * retyped, so this cannot introduce a third version of the wording.
 *
 * Position, size and font are untouched: those are ours, and re-deriving them
 * is exactly the work this tool exists to avoid repeating.
 */
async function reseedText(mapping) {
  const placeholders =
    typeof mapping.gelatoTextPlaceholders === "string"
      ? JSON.parse(mapping.gelatoTextPlaceholders || "[]")
      : mapping.gelatoTextPlaceholders || [];

  const wording = new Map(
    placeholders
      .filter((entry) => entry?.name)
      .map((entry) => [entry.name, String(entry.defaultText ?? "")]),
  );

  const layers = asLayers(mapping);
  const changed = [];

  for (const layer of layers) {
    if (layer.type !== LAYER_TYPES.TEXT) continue;

    const template = wording.get(layer.name);

    if (template === undefined || template === layer.text.content) continue;

    changed.push([layer.label || layer.name, layer.text.content, template]);
    layer.text.content = template;
  }

  if (changed.length === 0) {
    console.log("Every field already matches the template wording.");
    return;
  }

  await prisma.productMapping.update({
    where: { id: mapping.id },
    data: { layers: JSON.stringify(normalizeLayers(layers)) },
  });

  for (const [label, was, now] of changed) {
    console.log(`  ${label}`);
    console.log(`    was : ${JSON.stringify(was)}`);
    console.log(`    now : ${JSON.stringify(now)}`);
  }

  console.log(`\n${changed.length} field(s) restored from the Gelato template.`);
}

// ------------------------------------------------------------- print area

async function printArea(mapping, value) {
  await prisma.productMapping.update({
    where: { id: mapping.id },
    data: { printFileRequirements: value },
  });

  const geometry = resolvePrintGeometry({ ...mapping, printFileRequirements: value });

  console.log(`printFileRequirements = ${JSON.stringify(value)}`);
  console.log(`print area            = ${describePrintGeometry(geometry)}`);

  if (!hasPrintArea(geometry)) {
    console.log('\n  !! Still unresolved. Expected something like "204x100mm".');
  }
}

// ------------------------------------------------------------------- main

const [command, ...rest] = process.argv.slice(2);

try {
  switch (command) {
    case "show":
      show(await loadMapping(rest[0]));
      break;

    case "proof":
      await proof(await loadMapping(rest[0]));
      break;

    case "set":
      await set(await loadMapping(rest[0]), rest[1], rest.slice(2));
      break;

    case "print-area":
      await printArea(await loadMapping(rest[0]), rest[1]);
      break;

    case "ready":
      ready(await loadMapping(rest[0]));
      break;

    case "reseed-text":
      await reseedText(await loadMapping(rest[0]));
      break;

    default:
      console.log("Commands:");
      console.log("  show  [mappingId]");
      console.log("  proof [mappingId]");
      console.log("  set   <mappingId> <layer#> key=value ...");
      console.log("  ready [mappingId]");
      console.log("  reseed-text [mappingId]");
      console.log('  print-area <mappingId> "204x100mm"');
      console.log("");
      console.log("set keys: x y width height rotation size font colour weight align label");
  }
} finally {
  await prisma.$disconnect();
}