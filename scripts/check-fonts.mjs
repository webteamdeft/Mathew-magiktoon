/**
 * Can the print renderer actually draw the design faces?
 *
 * Run this on any machine that will produce print files — a developer's box, a
 * build, a deployed host. A font the renderer cannot find does not fail: it
 * substitutes a fallback and returns a perfectly valid image in the wrong
 * typeface, so this is the only thing that catches it before a customer does.
 *
 *   node scripts/check-fonts.mjs
 *
 * Exit code 1 when any family is missing, so CI or a deploy step can stop.
 */

import process from "node:process";

import { fontStatus, verifyFontsResolve, FONT_DIR } from "../app/lib/fonts.server.js";

const sharp = (await import("sharp")).default;

console.log(`font directory : ${FONT_DIR}`);
console.log(
  `fontconfig     : ${fontStatus.ok ? `configured, ${fontStatus.count} file(s)` : fontStatus.reason}`,
);
console.log("");

const result = await verifyFontsResolve(sharp);

for (const family of result.resolved) console.log(`  ok        ${family}`);
for (const family of result.ambiguous) console.log(`  probably  ${family}`);
for (const family of result.missing) console.log(`  MISSING   ${family}`);

console.log("");

if (result.ambiguous.length > 0) {
  console.log(
    `"probably" means the face draws exactly like the renderer's default, which ` +
      "cannot be told apart from being absent by drawing alone.",
  );
  console.log("");
}

if (result.ok) {
  const total = result.resolved.length + result.ambiguous.length;
  console.log(`All ${total} design faces resolve. Text prints as designed.`);
  process.exit(0);
}

console.log(
  `${result.missing.length} of ${result.missing.length + result.resolved.length} ` +
    "families are NOT available to the renderer.",
);
console.log("Text in those families will print in a fallback typeface instead.");
console.log("");
console.log("On Linux  : fontconfig reads the bundled directory, so this should pass;");
console.log("            a failure here means the files did not ship with the app.");
console.log("On Windows: librsvg uses the operating system's fonts and ignores the");
console.log("            bundled directory. Install the files in assets/fonts to");
console.log("            reproduce production output locally.");

process.exit(1);