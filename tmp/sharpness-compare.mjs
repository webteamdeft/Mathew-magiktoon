/**
 * Why the printed image looks soft, shown at 1:1 rather than argued about.
 *
 * The mug needs 2409 x 1181. Whatever the model returns is scaled to reach
 * that, and scaling up invents pixels. This builds the SAME crop from both
 * models at full print resolution so the difference is visible rather than
 * described.
 */
import fs from "node:fs";
for (const line of fs.readFileSync(".env", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const sharp = (await import("sharp")).default;
const { generatePersonalisedArtwork } = await import("../app/lib/gemini.server.js");

const NEED = { width: 2409, height: 1181 };
const dir = "../magiktoon-uploads/artwork/magiktoon-dev_myshopify_com";
const photo = fs.readFileSync(`${dir}/${fs.readdirSync(dir)[0]}`);

const PROMPT =
  "Transform this into a cinematic wide landscape scene, sharp detail, rich colour.";

async function make(model, imageSize) {
  const t = Date.now();
  const r = await generatePersonalisedArtwork({
    prompt: PROMPT,
    imageBase64: photo.toString("base64"),
    mimeType: "image/png",
    model,
    aspectRatio: "21:9",
    imageSize,
  });
  const buf = Buffer.from(r.base64, "base64");
  const m = await sharp(buf).metadata();
  const factor = Math.max(NEED.width / m.width, NEED.height / m.height);
  console.log(
    `  ${model.padEnd(24)} ${((Date.now()-t)/1000).toFixed(1).padStart(5)}s  ` +
    `${m.width}x${m.height}  -> print upscale ${factor.toFixed(2)}x`,
  );
  return { buf, meta: m, factor };
}

console.log(`Print file needs ${NEED.width}x${NEED.height}\n`);

const flash = await make("gemini-2.5-flash-image", "2K");
const pro   = await make("gemini-3-pro-image", "2K");

// Same region of each, at true print resolution, side by side.
async function tile(entry, label) {
  const scaled = await sharp(entry.buf)
    .resize(NEED.width, NEED.height, { fit: "cover" })
    .toBuffer();
  // A 700x420 window from the middle, at 1:1 — no further scaling.
  return sharp(scaled)
    .extract({ left: 850, top: 380, width: 700, height: 420 })
    .composite([{
      input: Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg" width="700" height="420">
           <rect x="0" y="0" width="700" height="40" fill="#000" opacity="0.72"/>
           <text x="12" y="28" font-size="22" font-family="sans-serif" fill="#fff">${label}</text>
         </svg>`),
      top: 0, left: 0,
    }])
    .toBuffer();
}

const a = await tile(flash, `Flash  ${flash.meta.width}x${flash.meta.height}  upscaled ${flash.factor.toFixed(2)}x`);
const b = await tile(pro,   `Gemini 3 Pro  ${pro.meta.width}x${pro.meta.height}  upscale ${pro.factor.toFixed(2)}x`);

await sharp({ create: { width: 1416, height: 420, channels: 3, background: "#222" } })
  .composite([{ input: a, left: 0, top: 0 }, { input: b, left: 716, top: 0 }])
  .jpeg({ quality: 92 })
  .toFile("tmp/gemini3/sharpness.jpg");

console.log("\nwrote tmp/gemini3/sharpness.jpg — same region, both at true print size");
