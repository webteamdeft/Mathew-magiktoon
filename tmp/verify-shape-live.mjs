/**
 * The whole change, through the app's own generation path, against the live API.
 *
 * Unit tests prove the mapping; only this proves the parameter reaches Google
 * and comes back honoured. The design is the real 204 x 100 mm mug, so the
 * expected answer is 21:9 artwork wide enough not to be upscaled.
 */
import fs from "node:fs";
for (const line of fs.readFileSync(".env", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

const { PrismaClient } = await import("@prisma/client");
const sharp = (await import("sharp")).default;
const { generatePersonalisedArtwork } = await import("../app/lib/gemini.server.js");
const { resolvePrintGeometry, describePrintGeometry } = await import("../app/lib/print-geometry.js");
const { aspectRatioForPrintArea, describeUpscale } = await import("../app/lib/image-shape.js");

const p = new PrismaClient();
const mapping = await p.productMapping.findFirst();
await p.$disconnect();

const geometry = resolvePrintGeometry(mapping);
const aspectRatio = aspectRatioForPrintArea(geometry);

console.log(`print area  : ${describePrintGeometry(geometry)}`);
console.log(`target ratio: ${(geometry.width / geometry.height).toFixed(3)}`);
console.log(`asking for  : ${aspectRatio}\n`);

const dir = "../magiktoon-uploads/artwork/magiktoon-dev_myshopify_com";
const photo = fs.readFileSync(`${dir}/${fs.readdirSync(dir)[0]}`);
const before = await sharp(photo).metadata();
console.log(`input photo : ${before.width}x${before.height} (${(before.width/before.height).toFixed(3)})`);

const t = Date.now();
const result = await generatePersonalisedArtwork({
  prompt: "Transform this into a polished editorial magazine-cover portrait.",
  imageBase64: photo.toString("base64"),
  mimeType: "image/png",
  model: "gemini-2.5-flash-image",
  aspectRatio,
  imageSize: "2K",
});

const out = Buffer.from(result.base64, "base64");
const meta = await sharp(out).metadata();
fs.writeFileSync("tmp/shape-live.png", out);

console.log(`output      : ${meta.width}x${meta.height} (${(meta.width/meta.height).toFixed(3)})  in ${((Date.now()-t)/1000).toFixed(1)}s`);

const up = describeUpscale(meta, geometry);
console.log(`upscale     : ${up.upscaled ? up.detail : "none — artwork covers the print area"}`);
