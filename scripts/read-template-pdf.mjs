/**
 * Read the print geometry out of a Gelato product template PDF.
 *
 * The template PDF is Gelato's own source of truth for a product's print file:
 * the MediaBox is the full file including bleed, and the TrimBox (when present)
 * is what survives cutting. Everything else we derived from the template API
 * has to agree with these numbers.
 */

import fs from "node:fs";
import zlib from "node:zlib";

const file = process.argv[2];

if (!file) {
  console.log("usage: node read-template-pdf.mjs <file.pdf>");
  process.exit(1);
}

const buffer = fs.readFileSync(file);
const PT_TO_MM = 25.4 / 72;

/** Raw text plus every FlateDecode stream we can inflate. */
function allText(buf) {
  const parts = [buf.toString("latin1")];

  let index = 0;

  for (;;) {
    const start = buf.indexOf("stream", index);
    if (start < 0) break;

    let from = start + 6;
    if (buf[from] === 13) from += 1;
    if (buf[from] === 10) from += 1;

    const end = buf.indexOf("endstream", from);
    if (end < 0) break;

    try {
      parts.push(zlib.inflateSync(buf.subarray(from, end)).toString("latin1"));
    } catch {
      // Not a flate stream, or an image. Skipped.
    }

    index = end + 9;
  }

  return parts.join("\n");
}

const text = allText(buffer);
const BOXES = ["MediaBox", "TrimBox", "BleedBox", "CropBox", "ArtBox"];
const seen = new Set();

console.log(`\n${file}\n${"=".repeat(file.length)}\n`);

for (const box of BOXES) {
  const pattern = new RegExp(`/${box}\\s*\\[([^\\]]+)\\]`, "g");

  let match;

  while ((match = pattern.exec(text))) {
    const numbers = match[1].trim().split(/\s+/).map(Number);

    if (numbers.length < 4 || numbers.some((n) => !Number.isFinite(n))) continue;

    const wPt = numbers[2] - numbers[0];
    const hPt = numbers[3] - numbers[1];

    if (wPt <= 0 || hPt <= 0) continue;

    const wMm = wPt * PT_TO_MM;
    const hMm = hPt * PT_TO_MM;

    const line =
      `${box.padEnd(9)}: ${wPt.toFixed(1)} x ${hPt.toFixed(1)} pt` +
      `  =  ${wMm.toFixed(2)} x ${hMm.toFixed(2)} mm` +
      `  @300dpi = ${Math.round((wMm * 300) / 25.4)} x ${Math.round((hMm * 300) / 25.4)} px` +
      `  (ratio ${(wMm / hMm).toFixed(3)})`;

    if (!seen.has(line)) {
      seen.add(line);
      console.log(line);
    }
  }
}

if (!seen.size) console.log("No page boxes found.");

// Any human-readable spec Gelato printed onto the sheet itself.
const notes = text.match(/[^\n]*\b(bleed|safe|trim|dpi|resolution|mm)\b[^\n]*/gi) || [];
const cleaned = [
  ...new Set(
    notes
      .map((n) => n.replace(/[^\x20-\x7E]/g, " ").replace(/\s+/g, " ").trim())
      .filter((n) => n.length > 8 && n.length < 160),
  ),
].slice(0, 25);

if (cleaned.length) {
  console.log("\nText on the sheet mentioning bleed / trim / size:\n");
  cleaned.forEach((n) => console.log("  " + n));
}

console.log();
