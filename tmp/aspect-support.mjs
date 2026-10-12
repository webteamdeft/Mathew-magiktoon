/**
 * Which aspectRatio values does the API actually accept?
 *
 * "2:1" was rejected outright, so this is a fixed vocabulary rather than any
 * ratio. The code has to map a print area onto the nearest SUPPORTED value, and
 * guessing that list would put an unprintable shape on a mug.
 *
 * Invalid values fail fast without generating, so the cost is only the ones
 * that work.
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

const CANDIDATES = ["1:1","2:3","3:2","3:4","4:3","4:5","5:4","9:16","16:9","21:9","2:1","1:2"];

const ok = [];
for (const ratio of CANDIDATES) {
  const gm = client.getGenerativeModel({
    model: "gemini-2.5-flash-image",
    generationConfig: { responseModalities: ["IMAGE"], imageConfig: { aspectRatio: ratio } },
  });
  try {
    const r = await gm.generateContent([
      { inlineData: { data: buffer.toString("base64"), mimeType: "image/png" } },
      { text: "A simple flat colour swatch." },
    ]);
    const part = (r.response.candidates || []).flatMap(c => c.content?.parts || []).find(p => p.inlineData?.data);
    if (!part) { console.log(`  ${ratio.padEnd(6)} accepted, no image`); continue; }
    const m = await sharp(Buffer.from(part.inlineData.data, "base64")).metadata();
    console.log(`  ${ratio.padEnd(6)} OK       ${String(m.width).padStart(4)}x${String(m.height).padEnd(4)} = ${(m.width/m.height).toFixed(3)}`);
    ok.push([ratio, m.width / m.height]);
  } catch (e) {
    console.log(`  ${ratio.padEnd(6)} REJECTED`);
  }
}

console.log("\nsupported:", ok.map(([r]) => JSON.stringify(r)).join(", "));
console.log("\nmug print area is 204x100mm = 2.040");
let best = ok[0];
for (const c of ok) if (Math.abs(c[1] - 2.04) < Math.abs(best[1] - 2.04)) best = c;
console.log("nearest supported:", best?.[0], "=", best?.[1].toFixed(3));
