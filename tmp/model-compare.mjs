/**
 * The two candidate models, same prompt, same photo, same settings.
 *
 * The Client asked for "Gemini 3.1 Pro with the image option enabled". No such
 * image model exists — 3.1 Pro returns finishReason NO_IMAGE. But there IS a
 * 3.1-generation image model, and the question he actually needs answered is
 * whether its output is good enough, not what it is called.
 *
 * So: identical inputs, both models, at the resolution the mug needs. Nothing
 * to argue about afterwards except the pictures.
 */
import fs from "node:fs";
import path from "node:path";

for (const line of fs.readFileSync(".env", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

const { PrismaClient } = await import("@prisma/client");
const sharp = (await import("sharp")).default;
const { generatePersonalisedArtwork } = await import("../app/lib/gemini.server.js");

const prisma = new PrismaClient();
const mapping = await prisma.productMapping.findFirst({ include: { prompt: true } });
await prisma.$disconnect();

const dir = "../magiktoon-uploads/artwork/magiktoon-dev_myshopify_com";
const photo = fs.readFileSync(path.join(dir, fs.readdirSync(dir)[0]));

fs.mkdirSync("tmp/compare", { recursive: true });

const MODELS = ["gemini-3.1-flash-image", "gemini-3-pro-image"];
const results = [];

console.log(`prompt: ${mapping.prompt.name}`);
console.log(`settings: 21:9, 2K  (mug needs 2409 x 1181)\n`);

for (const model of MODELS) {
  const started = Date.now();
  try {
    const res = await generatePersonalisedArtwork({
      prompt: mapping.prompt.content,
      imageBase64: photo.toString("base64"),
      mimeType: "image/png",
      model,
      aspectRatio: "21:9",
      imageSize: "2K",
    });

    const buf = Buffer.from(res.base64, "base64");
    const meta = await sharp(buf).metadata();
    const secs = (Date.now() - started) / 1000;
    const file = `tmp/compare/${model}.png`;

    fs.writeFileSync(file, buf);
    results.push({ model, secs, meta, file });

    console.log(
      `  ${model.padEnd(26)} ${secs.toFixed(1).padStart(6)}s  ` +
        `${meta.width}x${meta.height}  ${(buf.length / 1024 / 1024).toFixed(1)}MB`,
    );
  } catch (e) {
    console.log(`  ${model.padEnd(26)}          FAILED ${e.status || ""}`);
  }
}

if (results.length === 2) {
  const [a, b] = results;
  console.log(`\n${a.model} is ${(b.secs / a.secs).toFixed(1)}x faster at the same size`);
}
