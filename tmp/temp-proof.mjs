/**
 * Does lowering temperature make the model obey the composition instruction?
 *
 * The Client's prompt says the cabin should fill "roughly the right 45-50% of
 * the frame", leaving the left half open for the template's text. Our output
 * ignored that and the text collided with the subjects. He read it as the wrong
 * model; the hypothesis here is the wrong temperature.
 *
 * Same photo, same prompt, same seed. Only temperature changes — so anything
 * that differs is caused by it.
 */
import fs from "node:fs";

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
const photo = fs.readFileSync(`${dir}/${fs.readdirSync(dir)[0]}`);

fs.mkdirSync("tmp/temp", { recursive: true });

/**
 * How busy the left half is.
 *
 * The instruction reserves the left of the frame for text, so the measure is
 * how much visual detail sits there. High edge energy on the left means
 * subjects have spread into the space the text needs.
 */
async function leftHalfBusyness(buf) {
  const { width, height } = await sharp(buf).metadata();
  const left = await sharp(buf)
    .extract({ left: 0, top: 0, width: Math.floor(width / 2), height })
    .greyscale()
    .normalise()
    // Sobel-ish: standard deviation of a high-pass is a decent detail proxy.
    .convolve({ width: 3, height: 3, kernel: [-1, -1, -1, -1, 8, -1, -1, -1, -1] })
    .stats();

  return left.channels[0].stdev;
}

for (const temperature of [null, 0.2]) {
  const label = temperature === null ? "default (1.0)" : String(temperature);
  const started = Date.now();

  try {
    const res = await generatePersonalisedArtwork({
      prompt: mapping.prompt.content,
      imageBase64: photo.toString("base64"),
      mimeType: "image/png",
      model: "gemini-3-pro-image",
      aspectRatio: "21:9",
      imageSize: "2K",
      temperature,
      seed: 7,
    });

    const buf = Buffer.from(res.base64, "base64");
    const busy = await leftHalfBusyness(buf);
    fs.writeFileSync(`tmp/temp/t-${temperature === null ? "default" : temperature}.png`, buf);

    console.log(
      `  temperature ${label.padEnd(14)} ${((Date.now() - started) / 1000).toFixed(1).padStart(6)}s  ` +
        `left-half detail ${busy.toFixed(1)}`,
    );
  } catch (e) {
    console.log(`  temperature ${label.padEnd(14)} FAILED ${e.status || e.message.slice(0, 40)}`);
  }
}

console.log("\nLower left-half detail = more space left clear for the template text.");
