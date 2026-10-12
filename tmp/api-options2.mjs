/**
 * Settle which request options the image model accepts.
 *
 * A first pass gave contradictory answers — the same config both accepted and
 * rejected across two runs — because the API returns transient 503s under load.
 * A parameter that is genuinely unsupported returns 400 INVALID_ARGUMENT and
 * says so; anything 5xx is retried rather than recorded as a verdict.
 */
import fs from "node:fs";
import { GoogleGenerativeAI } from "@google/generative-ai";

for (const line of fs.readFileSync(".env", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

const client = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const dir = "../magiktoon-uploads/artwork/magiktoon-dev_myshopify_com";
const buffer = fs.readFileSync(`${dir}/${fs.readdirSync(dir)[0]}`);

async function probe(label, modelOpts, attempt = 1) {
  try {
    const gm = client.getGenerativeModel({ model: "gemini-3-pro-image", ...modelOpts });
    await gm.generateContent([
      { inlineData: { data: buffer.toString("base64"), mimeType: "image/png" } },
      { text: "A simple flat two-colour geometric pattern." },
    ]);
    console.log(`  ${label.padEnd(34)} SUPPORTED`);
  } catch (e) {
    const status = e.status || 0;
    if (status >= 500 && attempt < 4) {
      await new Promise((r) => setTimeout(r, 4000 * attempt));
      return probe(label, modelOpts, attempt + 1);
    }
    if (status === 400) {
      console.log(`  ${label.padEnd(34)} NOT SUPPORTED (400)`);
    } else {
      console.log(`  ${label.padEnd(34)} inconclusive (${status || "network"} after ${attempt})`);
    }
  }
}

const base = { responseModalities: ["IMAGE"] };

console.log("gemini-3-pro-image — request options\n");
await probe("temperature", { generationConfig: { ...base, temperature: 0.2 } });
await probe("seed", { generationConfig: { ...base, seed: 42 } });
await probe("systemInstruction", {
  generationConfig: base,
  systemInstruction: "You are an illustration engine. Output an image only.",
});
