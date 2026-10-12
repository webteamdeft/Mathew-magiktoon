/**
 * Does imageConfig work on the PRODUCTION model, not just Gemini 3 Pro?
 *
 * The aspect ratio and size parameters were proven on gemini-3-pro-image, but
 * every live generation runs gemini-2.5-flash-image. Wiring a parameter the
 * production model ignores would change nothing while looking like a fix.
 */
import fs from "node:fs";
import sharp from "sharp";
import { GoogleGenerativeAI } from "@google/generative-ai";

for (const line of fs.readFileSync(".env", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

const client = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const dir = "../magiktoon-uploads/artwork/magiktoon-dev_myshopify_com";
const buffer = fs.readFileSync(`${dir}/${fs.readdirSync(dir)[0]}`);

async function run(model, label, imageConfig) {
  const gm = client.getGenerativeModel({
    model,
    generationConfig: { responseModalities: ["IMAGE"], ...(imageConfig ? { imageConfig } : {}) },
  });
  const t = Date.now();
  try {
    const r = await gm.generateContent([
      { inlineData: { data: buffer.toString("base64"), mimeType: "image/png" } },
      { text: "Transform this into a polished editorial magazine-cover portrait." },
    ]);
    const part = (r.response.candidates || []).flatMap(c => c.content?.parts || []).find(p => p.inlineData?.data);
    if (!part) return console.log(`  ${label.padEnd(24)} NO IMAGE`);
    const m = await sharp(Buffer.from(part.inlineData.data, "base64")).metadata();
    console.log(`  ${label.padEnd(24)} ${((Date.now()-t)/1000).toFixed(1).padStart(5)}s  ${String(m.width).padStart(4)}x${String(m.height).padEnd(4)}  ratio ${(m.width/m.height).toFixed(3)}`);
  } catch (e) {
    console.log(`  ${label.padEnd(24)} FAILED: ${e.message.slice(0,120)}`);
  }
}

console.log("gemini-2.5-flash-image  (PRODUCTION MODEL)\n");
await run("gemini-2.5-flash-image", "no imageConfig", null);
await run("gemini-2.5-flash-image", "aspectRatio 21:9", { aspectRatio: "21:9" });
await run("gemini-2.5-flash-image", "aspectRatio 2:1", { aspectRatio: "2:1" });
await run("gemini-2.5-flash-image", "imageSize 2K", { imageSize: "2K" });
await run("gemini-2.5-flash-image", "2K + 21:9", { imageSize: "2K", aspectRatio: "21:9" });
