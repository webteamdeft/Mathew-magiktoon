/**
 * Does the admin's 1K / 2K / 4K setting actually change the output size?
 *
 * It is currently expressed as a sentence in the prompt. The first run of this
 * came back 848x1264 for "2K", so the answer looked like no. This checks
 * whether imageSize works as a real parameter instead, because print quality
 * depends on it: a 204x100mm mug wrap at 300 DPI needs 2409x1181 pixels, and
 * anything smaller is being upscaled to reach it.
 */
import fs from "node:fs";
import sharp from "sharp";
import { GoogleGenerativeAI } from "@google/generative-ai";

for (const line of fs.readFileSync(".env", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

const client = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const file = "../magiktoon-uploads/artwork/magiktoon-dev_myshopify_com/" +
  fs.readdirSync("../magiktoon-uploads/artwork/magiktoon-dev_myshopify_com")[0];
const buffer = fs.readFileSync(file);

async function run(label, imageConfig) {
  const model = client.getGenerativeModel({
    model: "gemini-3-pro-image",
    generationConfig: { responseModalities: ["IMAGE"], ...(imageConfig ? { imageConfig } : {}) },
  });
  const t = Date.now();
  try {
    const r = await model.generateContent([
      { inlineData: { data: buffer.toString("base64"), mimeType: "image/png" } },
      { text: "Transform this into a polished editorial magazine-cover portrait." },
    ]);
    const part = (r.response.candidates || []).flatMap(c => c.content?.parts || []).find(p => p.inlineData?.data);
    if (!part) return console.log(`  ${label.padEnd(28)} NO IMAGE`);
    const m = await sharp(Buffer.from(part.inlineData.data, "base64")).metadata();
    console.log(`  ${label.padEnd(28)} ${((Date.now()-t)/1000).toFixed(1)}s  ${m.width}x${m.height}  longEdge=${Math.max(m.width,m.height)}`);
  } catch (e) {
    console.log(`  ${label.padEnd(28)} FAILED: ${e.message.slice(0,100)}`);
  }
}

console.log("Needed for a 204x100mm mug at 300 DPI: 2409 x 1181\n");
await run("no imageConfig", null);
await run("imageSize 1K", { imageSize: "1K" });
await run("imageSize 2K", { imageSize: "2K" });
await run("imageSize 4K", { imageSize: "4K" });
await run("2K + 21:9", { imageSize: "2K", aspectRatio: "21:9" });
