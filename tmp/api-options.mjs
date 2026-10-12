/**
 * What can actually be configured on the image request?
 *
 * The Client asks whether we are telling Gemini "create an image" the way its
 * web UI does, and what else is available. Answering from documentation would
 * repeat the mistake that produced the aspect-ratio bug, so each option is sent
 * to the live API and either accepted or rejected.
 *
 * An unsupported field fails fast without generating, so only the accepted ones
 * cost anything.
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

async function probe(label, modelOpts) {
  try {
    const gm = client.getGenerativeModel({ model: "gemini-3-pro-image", ...modelOpts });
    const r = await gm.generateContent([
      { inlineData: { data: buffer.toString("base64"), mimeType: "image/png" } },
      { text: "A simple flat two-colour geometric pattern." },
    ]);
    const part = (r.response.candidates || []).flatMap(c => c.content?.parts || []).find(p => p.inlineData?.data);
    if (!part) return console.log(`  ${label.padEnd(34)} ACCEPTED (no image on this prompt)`);
    const m = await sharp(Buffer.from(part.inlineData.data, "base64")).metadata();
    console.log(`  ${label.padEnd(34)} ACCEPTED  ${m.width}x${m.height}`);
  } catch (e) {
    const msg = e.message.replace(/\s+/g, " ").slice(0, 90);
    console.log(`  ${label.padEnd(34)} REJECTED  ${msg}`);
  }
}

const base = { responseModalities: ["IMAGE"] };

console.log("Options tested against gemini-3-pro-image\n");
await probe("responseModalities IMAGE (current)", { generationConfig: base });
await probe("+ temperature 0.2", { generationConfig: { ...base, temperature: 0.2 } });
await probe("+ topP 0.8", { generationConfig: { ...base, topP: 0.8 } });
await probe("+ seed 42", { generationConfig: { ...base, seed: 42 } });
await probe("+ systemInstruction", {
  generationConfig: base,
  systemInstruction: "You are an illustration engine. Output an image only.",
});
await probe("+ imageConfig aspectRatio 3:4", {
  generationConfig: { ...base, imageConfig: { aspectRatio: "3:4" } },
});
