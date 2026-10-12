/**
 * Run real generations on Gemini 3 Pro, through the app's own path.
 *
 * Not raw API calls: `generateArtwork` is what the storefront uses, so these
 * appear on the AI Generated page with their model, duration and cost exactly
 * as a customer's generation would. That is what the Client asked to see.
 *
 * The mapping's model is switched for the run and restored afterwards in a
 * finally block, so a crash cannot leave the live product on a model that
 * breaches the agreed 40-second ceiling.
 */
import fs from "node:fs";
for (const line of fs.readFileSync(".env", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

const { PrismaClient } = await import("@prisma/client");
const sharp = (await import("sharp")).default;
const { generateArtwork } = await import("../app/lib/generation.server.js");

const prisma = new PrismaClient();
const PRO = "gemini-3-pro-image";

const mapping = await prisma.productMapping.findFirst({ include: { prompt: true, aiModel: true } });
const proModel = await prisma.aiModel.findFirst({ where: { modelKey: PRO } });

if (!proModel) { console.error(`${PRO} is not registered.`); process.exit(1); }

const originalModelId = mapping.aiModelId;
const originalPromptId = mapping.promptId;

// Prompts that actually specify a landscape ratio — the Client's own.
const prompts = await prisma.prompt.findMany({ where: { status: "ACTIVE" } });
const wide = prompts.filter((p) => /21:9|2:1|landscape/i.test(p.content));

console.log(`model  : ${PRO}`);
console.log(`prompts: ${wide.length} with landscape instructions\n`);

const dir = "../magiktoon-uploads/artwork/magiktoon-dev_myshopify_com";
const photos = fs.readdirSync(dir).filter((f) => /\.png$/i.test(f)).slice(0, 3);

const results = [];

try {
  await prisma.productMapping.update({
    where: { id: mapping.id },
    data: { aiModelId: proModel.id },
  });

  let n = 0;

  for (const prompt of wide.slice(0, 3)) {
    const photo = photos[n % photos.length];
    n += 1;

    await prisma.productMapping.update({
      where: { id: mapping.id },
      data: { promptId: prompt.id },
    });

    const fresh = await prisma.productMapping.findUnique({
      where: { id: mapping.id },
      include: { prompt: true, aiModel: true },
    });

    const buffer = fs.readFileSync(`${dir}/${photo}`);
    const dataUrl = `data:image/png;base64,${buffer.toString("base64")}`;

    const startedAt = Date.now();
    const result = await generateArtwork({
      shop: mapping.shop,
      mapping: fresh,
      imageDataUrl: dataUrl,
      rateKey: `pro-test-${n}`,
    }, {
      // Raised FOR THIS TEST ONLY, so the Client can see real Gemini 3 Pro
      // output. The app default stays 34s, deliberately under the agreed 40s
      // ceiling — which is exactly why this model times out in production.
      timeoutMs: 180000,
    });
    const seconds = (Date.now() - startedAt) / 1000;

    if (!result.ok) {
      console.log(`  ${prompt.name.slice(0, 30).padEnd(32)} ${seconds.toFixed(1)}s  FAILED ${result.code}`);
      results.push({ prompt: prompt.name, seconds, ok: false });
      continue;
    }

    const meta = await sharp(Buffer.from(result.artwork.split(",")[1], "base64")).metadata();
    const ratio = (meta.width / meta.height).toFixed(3);
    fs.writeFileSync(`tmp/gemini3/run-${n}.png`, Buffer.from(result.artwork.split(",")[1], "base64"));
    const over = seconds > 40 ? "  << OVER 40s" : "";

    console.log(
      `  ${prompt.name.slice(0, 30).padEnd(32)} ${seconds.toFixed(1).padStart(5)}s  ` +
      `${meta.width}x${meta.height} (${ratio})${over}`,
    );

    results.push({ prompt: prompt.name, seconds, ratio: Number(ratio), ok: true });
  }
} finally {
  await prisma.productMapping.update({
    where: { id: mapping.id },
    data: { aiModelId: originalModelId, promptId: originalPromptId },
  });
  console.log(`\nmapping restored to ${mapping.aiModel?.modelKey || "(default)"}`);
  await prisma.$disconnect();
}

const ok = results.filter((r) => r.ok);
if (ok.length) {
  const times = ok.map((r) => r.seconds).sort((a, b) => a - b);
  console.log(`\n${ok.length}/${results.length} succeeded`);
  console.log(`median ${times[Math.floor(times.length / 2)].toFixed(1)}s, slowest ${times.at(-1).toFixed(1)}s`);
  console.log(`over the 40s ceiling: ${ok.filter((r) => r.seconds > 40).length} of ${ok.length}`);
}
