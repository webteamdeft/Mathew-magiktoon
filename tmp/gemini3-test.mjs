/**
 * Run Gemini 3 Pro Image through the app's own generation path, and find out
 * what actually decides the output's aspect ratio.
 *
 * Two questions, answered by measurement rather than by reading the docs:
 *
 *   1. Does gemini-3-pro-image work through this app at all? Nothing has ever
 *      run on it — every generation to date used gemini-2.5-flash-image.
 *   2. What controls the shape of the image that comes back?
 *
 * For (2) the same input is sent three ways: as the app sends it today, with an
 * explicit instruction in the prompt, and with an aspectRatio passed as a real
 * API parameter. Whichever changes the output dimensions is the answer.
 */

import fs from "node:fs";
import path from "node:path";

import sharp from "sharp";
import { GoogleGenerativeAI } from "@google/generative-ai";

for (const line of fs.readFileSync(".env", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

const MODEL = "gemini-3-pro-image";
const OUT = path.join("tmp", "gemini3");
const UPLOADS = "../magiktoon-uploads";

fs.mkdirSync(OUT, { recursive: true });

const client = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const BASE_PROMPT =
  "Transform this photograph into a polished editorial magazine-cover " +
  "portrait: clean studio lighting, rich colour, sharp detail.";

/** Pick a few real images from storage to use as inputs. */
function inputs(count) {
  const dir = path.join(UPLOADS, "artwork", "magiktoon-dev_myshopify_com");

  return fs
    .readdirSync(dir)
    .filter((name) => /\.(png|jpe?g)$/i.test(name))
    .slice(0, count)
    .map((name) => path.join(dir, name));
}

/**
 * One generation.
 *
 * `imageConfig` is passed through untouched so an aspect ratio can be tried as
 * a real parameter rather than as a sentence in the prompt.
 */
async function generate({ file, prompt, imageConfig, label }) {
  const buffer = fs.readFileSync(file);
  const meta = await sharp(buffer).metadata();

  const generationConfig = { responseModalities: ["IMAGE"] };
  if (imageConfig) generationConfig.imageConfig = imageConfig;

  const model = client.getGenerativeModel({ model: MODEL, generationConfig });

  const startedAt = Date.now();

  try {
    const result = await model.generateContent([
      { inlineData: { data: buffer.toString("base64"), mimeType: "image/png" } },
      { text: prompt },
    ]);

    const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);

    const part = (result.response.candidates || [])
      .flatMap((candidate) => candidate.content?.parts || [])
      .find((p) => p.inlineData?.data);

    if (!part) {
      const finish = result.response.candidates?.[0]?.finishReason || "no image";
      console.log(`  ${label.padEnd(26)} ${seconds}s  NO IMAGE (${finish})`);
      return null;
    }

    const out = Buffer.from(part.inlineData.data, "base64");
    const outMeta = await sharp(out).metadata();
    const ratio = (outMeta.width / outMeta.height).toFixed(3);

    const name = `${label.replace(/[^a-z0-9]+/gi, "-")}.png`;
    fs.writeFileSync(path.join(OUT, name), out);

    console.log(
      `  ${label.padEnd(26)} ${seconds}s  ` +
        `in ${meta.width}x${meta.height} (${(meta.width / meta.height).toFixed(3)})  ->  ` +
        `out ${outMeta.width}x${outMeta.height} (${ratio})`,
    );

    return { ratio: Number(ratio), width: outMeta.width, height: outMeta.height };
  } catch (error) {
    console.log(`  ${label.padEnd(26)} FAILED: ${error.message.slice(0, 110)}`);
    return null;
  }
}

const files = inputs(2);

console.log(`model  : ${MODEL}`);
console.log(`inputs : ${files.length}\n`);

console.log("--- 1. Plain generations, exactly as the app sends them today ---");

for (const file of files) {
  await generate({
    file,
    prompt: BASE_PROMPT,
    label: `plain-${path.basename(file).slice(0, 8)}`,
  });
}

console.log("\n--- 2. Aspect ratio asked for IN THE PROMPT (what the app does) ---");

await generate({
  file: files[0],
  prompt: `${BASE_PROMPT}\n\nRender the result at 2K resolution, filling the frame, with no added text, borders or watermarks.`,
  label: "prompt-2K",
});

await generate({
  file: files[0],
  prompt: `${BASE_PROMPT}\n\nThe output image must be in a 21:9 wide landscape aspect ratio.`,
  label: "prompt-21x9",
});

console.log("\n--- 3. Aspect ratio as a real API PARAMETER ---");

await generate({
  file: files[0],
  prompt: BASE_PROMPT,
  imageConfig: { aspectRatio: "21:9" },
  label: "param-21x9",
});

await generate({
  file: files[0],
  prompt: BASE_PROMPT,
  imageConfig: { aspectRatio: "1:1" },
  label: "param-1x1",
});

console.log(`\nImages written to ${OUT}`);
