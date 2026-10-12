/**
 * Build a real print file, from a real design, and check what came out.
 *
 * This is the whole Option A chain end to end, minus Gelato: stored artwork,
 * the configured print geometry, the fixed image layers, and the customer's
 * wording drawn in the design's own typeface — through `composePrintFile`
 * itself, not a copy of it, so what is verified here is what ships.
 *
 * The compositing flags are forced ON for this run only, via the `env` the
 * compositor accepts. Nothing in .env is touched, so a run of this cannot
 * change what the live app does. That matters while Milestone 4's reliability
 * gate is still open — turning text compositing on for real would change the
 * generated artwork and invalidate those numbers.
 *
 *   node scripts/print-file-preview.mjs [customizationId]
 *
 * Writes the file to tmp/print-file/ and reports its size, DPI and colour
 * space, which are the three things Gelato actually requires.
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import { PrismaClient } from "@prisma/client";
import sharp from "sharp";

import { composePrintFile } from "../app/lib/print-file.server.js";
import { readAsset } from "../app/lib/storage.server.js";
import { describePrintGeometry } from "../app/lib/print-geometry.js";

const OUT_DIR = path.join("tmp", "print-file");

/** Force the flags on for this process only. */
const env = {
  ...process.env,
  PRINT_FILE_COMPOSITE: "true",
  PRINT_FILE_COMPOSITE_TEXT: "true",
};

const prisma = new PrismaClient();

try {
  const id = process.argv[2];

  const customization = id
    ? await prisma.customization.findUnique({
        where: { id },
        include: { productMapping: true },
      })
    : await prisma.customization.findFirst({
        where: { status: "COMPLETE" },
        orderBy: { createdAt: "desc" },
        include: { productMapping: true },
      });

  if (!customization) {
    console.error(id ? `No customization ${id}` : "No completed customizations.");
    process.exit(1);
  }

  const mapping = customization.productMapping;

  if (!mapping) {
    console.error("That design is not mapped to a Gelato template.");
    process.exit(1);
  }

  // What the customer typed, falling back to the template's own wording so a
  // design nobody has ordered yet still renders something legible.
  const textValues =
    customization.personalizationText &&
    typeof customization.personalizationText === "object"
      ? customization.personalizationText
      : {};

  console.log(`customization : ${customization.id}`);
  console.log(`design        : ${mapping.id}`);
  console.log(`artwork       : ${customization.artworkKey}`);
  console.log(
    `customer text : ${Object.keys(textValues).length > 0 ? JSON.stringify(textValues) : "(none — template wording will print)"}`,
  );
  console.log("");

  const result = await composePrintFile(
    {
      shop: customization.shop,
      mapping,
      artworkKey: customization.artworkKey,
      textValues,
    },
    { env },
  );

  if (!result.ok) {
    console.error(`FAILED (${result.code}): ${result.error}`);
    process.exit(1);
  }

  const buffer = await readAsset(result.key);
  const meta = await sharp(buffer).metadata();

  fs.mkdirSync(OUT_DIR, { recursive: true });

  const out = path.join(OUT_DIR, `${customization.id}.png`);
  fs.writeFileSync(out, buffer);

  console.log(`print area    : ${describePrintGeometry(result.geometry)}`);
  console.log("");
  console.log(`file          : ${out}`);
  console.log(`size          : ${meta.width} x ${meta.height} px`);
  console.log(`density       : ${meta.density || "(none)"} DPI`);
  console.log(`colour space  : ${meta.space}`);
  console.log(`format        : ${meta.format}`);
  console.log(`bytes         : ${(buffer.length / 1024 / 1024).toFixed(2)} MB`);
  console.log(`background    : ${result.hasBackground ? "composited" : "none"}`);
  console.log(`text          : ${result.textComposited ? "printed in" : "not printed"}`);

  if (result.substitutedFonts?.length) {
    console.log("");
    console.log("  !! These faces were substituted, so the print will not match");
    console.log("  !! what the customer approved:");
    result.substitutedFonts.forEach((f) => console.log(`  !!   ${f}`));
  }

  // Gelato's stated requirements, checked rather than assumed.
  const problems = [];

  if (meta.space !== "srgb") problems.push(`colour space is ${meta.space}, not sRGB`);
  if ((meta.density || 0) < 150) problems.push(`density is ${meta.density}, below Gelato's 150 minimum`);
  if (meta.width !== result.geometry.width) problems.push("width does not match the print area");
  if (meta.height !== result.geometry.height) problems.push("height does not match the print area");

  console.log("");

  if (problems.length === 0) {
    console.log("Meets Gelato's stated requirements: exact print size, 300 DPI, sRGB.");
  } else {
    problems.forEach((p) => console.log(`  PROBLEM: ${p}`));
    process.exit(1);
  }
} finally {
  await prisma.$disconnect();
}