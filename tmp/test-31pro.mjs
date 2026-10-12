/**
 * Can gemini-3.1-pro return an image?
 *
 * The Client is asking for "Gemini 3.1 Pro with the image option enabled",
 * which is how it appears in Gemini's web app. Through the API the naming is
 * different: every image-capable model ends in -image, and no
 * gemini-3.1-pro-image is published. So this asks the API directly rather than
 * reasoning from the names.
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
const photo = fs.readFileSync(`${dir}/${fs.readdirSync(dir)[0]}`);

const CANDIDATES = [
  "gemini-3.1-pro-preview",
  "gemini-3.1-pro-image",        // does it exist unlisted?
  "gemini-3.1-pro-image-preview",
  "gemini-3.1-flash-image",
  "gemini-3-pro-image",          // what we use now
];

for (const model of CANDIDATES) {
  const started = Date.now();
  try {
    const gm = client.getGenerativeModel({
      model,
      generationConfig: {
        responseModalities: ["IMAGE"],
        imageConfig: { aspectRatio: "21:9" },
      },
    });

    const res = await gm.generateContent([
      { inlineData: { data: photo.toString("base64"), mimeType: "image/png" } },
      { text: "Transform this into a wide cinematic illustration." },
    ]);

    const parts = (res.response.candidates || []).flatMap((c) => c.content?.parts || []);
    const image = parts.find((p) => p.inlineData?.data);
    const secs = ((Date.now() - started) / 1000).toFixed(1);

    if (!image) {
      const text = parts.find((p) => p.text)?.text || "";
      console.log(`  ${model.padEnd(30)} ${secs.padStart(6)}s  NO IMAGE — replied in text: "${text.slice(0, 55)}"`);
      continue;
    }

    const meta = await sharp(Buffer.from(image.inlineData.data, "base64")).metadata();
    console.log(`  ${model.padEnd(30)} ${secs.padStart(6)}s  IMAGE ${meta.width}x${meta.height}`);
  } catch (e) {
    const status = e.status || "";
    const msg = String(e.message).replace(/\s+/g, " ");
    const reason = /not found|not supported|does not exist/i.test(msg)
      ? "does not exist"
      : msg.slice(0, 70);
    console.log(`  ${model.padEnd(30)}          ${status} ${reason}`);
  }
}
