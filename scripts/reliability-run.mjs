/**
 * The Milestone 4 reliability run (AC-05).
 *
 *   "50 runs across at least five different photos provided by the Client.
 *    Zero dirty failures are allowed... At most two clean failures are allowed
 *    across the 50. Every passing run must complete end to end within 40
 *    seconds, target 30."
 *
 * The milestone wording is that the Developer completes and documents the run
 * first, and the Client then repeats it and verifies personally. This script is
 * the first half: it drives the real generation path against real photos, times
 * every run, writes every output to disk for inspection, and produces a report.
 *
 * It deliberately CANNOT declare the gate passed on its own. A dirty failure is
 * a broken, distorted or misplaced result that still proceeded — no log can see
 * that, only a person looking at the images can. The report says so, and lists
 * the files to look at.
 *
 * Usage:
 *   node scripts/reliability-run.mjs --photos <dir> [options]
 *
 * Options:
 *   --photos <dir>       Directory of customer photos (JPEG/PNG). Required.
 *   --runs <n>           Number of runs. Default 50.
 *   --mapping <id>       Use a saved ProductMapping's prompt, model and
 *                        resolution, and record each run in GenerationLog so the
 *                        results show up on the admin "AI generations" page.
 *   --prompt <text>      Run without the database, using this prompt instead.
 *   --model <key>        Model to use with --prompt. Defaults to GEMINI_MODEL.
 *   --template <id>      Gelato template to render mockups from, for a
 *                        --prompt run. Lets the Milestone 5 gate be measured
 *                        without touching the shop's saved configuration.
 *   --resolution <2K>    Resolution to request with --prompt. Default 2K.
 *   --concurrency <n>    Parallel runs. Default 1 — sequential is the honest
 *                        measurement of one customer's experience.
 *   --out <dir>          Where to write outputs and the report.
 *                        Default ./reliability-run.
 *   --mockup             Also render the Gelato mockup for each run and time
 *                        the whole journey — upload to approved mockup. This is
 *                        the Milestone 5 gate; without it the run measures the
 *                        Milestone 4 gate, upload to returned artwork.
 *   --dry                Plan the run and exit without calling the model.
 */

import fs from "node:fs";
import path from "node:path";

import { CEILING_MS, evaluateGate, summarize } from "../app/lib/generation-stats.js";

// ---------------------------------------------------------------- arguments

function parseArgs(argv) {
  const args = { runs: 50, concurrency: 1, resolution: "2K", out: "reliability-run" };

  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];

    if (!flag.startsWith("--")) continue;

    const name = flag.slice(2);

    if (name === "dry" || name === "mockup") {
      args[name] = true;
      continue;
    }

    args[name] = argv[index + 1];
    index += 1;
  }

  args.runs = Number(args.runs) || 50;
  args.concurrency = Math.max(1, Number(args.concurrency) || 1);

  return args;
}

const args = parseArgs(process.argv.slice(2));

if (!args.photos) {
  console.error("A --photos directory is required. See the header of this file.");
  process.exit(1);
}

// Node does not load .env on its own, and this runs outside the app server.
for (const line of fs.readFileSync(".env", "utf8").split(/\r?\n/)) {
  const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (match && !process.env[match[1]]) process.env[match[1]] = match[2];
}

// ------------------------------------------------------------------- photos

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg"]);

const photos = fs
  .readdirSync(args.photos)
  .filter((name) => IMAGE_EXTENSIONS.has(path.extname(name).toLowerCase()))
  .map((name) => path.join(args.photos, name));

if (photos.length === 0) {
  console.error(`No JPEG or PNG files found in ${args.photos}.`);
  process.exit(1);
}

// AC-05 requires at least five different photos. Running 50 against one image
// proves nothing about the range of inputs real customers send.
if (photos.length < 5) {
  console.error(
    `Only ${photos.length} photo(s) found. AC-05 requires at least five different photos.`,
  );
  process.exit(1);
}

function mimeFor(file) {
  return path.extname(file).toLowerCase() === ".png" ? "image/png" : "image/jpeg";
}

function toDataUrl(file) {
  return `data:${mimeFor(file)};base64,${fs.readFileSync(file).toString("base64")}`;
}

// ----------------------------------------------------------------- the design

/** A mapping shaped the way `resolveGenerationConfig` expects. */
async function resolveMapping() {
  if (args.mapping) {
    const { default: prisma } = await import("../app/db.server.js");

    const mapping = await prisma.productMapping.findUnique({
      where: { id: args.mapping },
      include: { prompt: true, aiModel: true },
    });

    if (!mapping) {
      console.error(`No mapping found with id ${args.mapping}.`);
      process.exit(1);
    }

    return { mapping, logToDatabase: true };
  }

  if (!args.prompt) {
    console.error("Pass either --mapping <id> or --prompt <text>.");
    process.exit(1);
  }

  return {
    logToDatabase: false,
    mapping: {
      id: null,
      outputResolution: args.resolution,
      // Only needed for --mockup; the variant and placeholders are read from
      // the template itself.
      gelatoTemplateId: args.template || "",
      prompt: { id: null, name: "ad-hoc", content: args.prompt, status: "ACTIVE" },
      aiModel: args.model
        ? { id: null, modelKey: args.model, enabled: true, pricePerImage: null }
        : null,
    },
  };
}

// --------------------------------------------------------------------- run

const { mapping, logToDatabase } = await resolveMapping();

const outDir = path.resolve(args.out);
fs.mkdirSync(outDir, { recursive: true });

console.log("photos      :", photos.length, "in", args.photos);
console.log("measuring   :", args.mockup
  ? "upload -> Gelato mockup (Milestone 5 gate)"
  : "upload -> returned artwork (Milestone 4 gate)");
console.log("runs        :", args.runs);
console.log("concurrency :", args.concurrency);
console.log("logging     :", logToDatabase ? "GenerationLog (visible in admin)" : "off");
console.log("output      :", outDir);
console.log("");

if (args.dry) {
  console.log("Dry run — nothing was generated.");
  process.exit(0);
}

const { generateArtwork } = await import("../app/lib/generation.server.js");

// Loaded only when the Milestone 5 gate is being measured: rendering a mockup
// creates and deletes a Gelato product per run, which is not something to do
// by accident.
const { renderGelatoMockup } = args.mockup
  ? await import("../app/lib/gelato-mockup.server.js")
  : { renderGelatoMockup: null };

const { buildSignedAssetUrl, FULFILMENT_TTL_MS } = args.mockup
  ? await import("../app/lib/signed-urls.server.js")
  : { buildSignedAssetUrl: null, FULFILMENT_TTL_MS: 0 };

/** A no-op store, so a DB-free run cannot fail on logging. */
const noLogDb = { generationLog: { create: async () => null } };

const shop = process.env.RELIABILITY_SHOP || "reliability-run.local";
const results = [];

async function runOne(index) {
  const photo = photos[index % photos.length];
  const startedAt = Date.now();

  const result = await generateArtwork(
    {
      shop,
      mapping,
      imageDataUrl: toDataUrl(photo),
      generationType: "INITIAL",
      // One key per run: the harness is measuring the pipeline, not the rate
      // limiter, and 50 runs from one shopper is exactly what it exists to stop.
      rateKey: `reliability-${index}`,
    },
    logToDatabase ? {} : { db: noLogDb },
  );

  const label = String(index + 1).padStart(3, "0");

  let file = "";
  let mockupFile = "";
  let status = result.ok ? "SUCCESS" : result.code;
  let mockupError = "";

  if (result.ok) {
    const base64 = result.artwork.split(",")[1] || "";
    file = path.join(outDir, `run-${label}.png`);
    fs.writeFileSync(file, Buffer.from(base64, "base64"));
  }

  // Milestone 5 measures the journey the customer actually waits through:
  // upload, generate, and the Gelato mockup they approve. Timing therefore
  // keeps running until the mockup is in hand.
  if (args.mockup && result.ok && renderGelatoMockup) {
    let artworkUrl = "";

    try {
      artworkUrl = buildSignedAssetUrl(result.artworkKey, {
        ttlMs: FULFILMENT_TTL_MS,
        requireAbsolute: true,
      });
    } catch (error) {
      mockupError = error.message;
    }

    if (artworkUrl) {
      const mockup = await renderGelatoMockup({
        shop,
        mapping,
        artworkUrl,
        textValues: {},
      });

      if (mockup.ok) {
        const { readAsset } = await import("../app/lib/storage.server.js");
        mockupFile = path.join(outDir, `run-${label}-mockup.jpg`);
        fs.writeFileSync(mockupFile, await readAsset(mockup.key));
      } else {
        status = mockup.code || "PREVIEW_FAILED";
        mockupError = mockup.error;
      }
    } else {
      status = "PREVIEW_FAILED";
    }
  }

  const durationMs = Date.now() - startedAt;

  const row = {
    run: index + 1,
    photo: path.basename(photo),
    status,
    durationMs,
    estimatedCost: null,
    generationType: "INITIAL",
    modelKey: result.model || args.model || process.env.GEMINI_MODEL,
    resolution: result.resolution || args.resolution,
    file: file ? path.basename(file) : "",
    mockupFile: mockupFile ? path.basename(mockupFile) : "",
    error: mockupError || (result.ok ? "" : result.error),
  };

  results.push(row);

  // From the shared constant, not a literal. A gate run that disagreed with the
  // dashboard about where the ceiling is would be worse than having no flag.
  const flag = row.durationMs > CEILING_MS ? "  ⚠ OVER CEILING" : "";

  console.log(
    `run ${label}: ${row.status.padEnd(20)} ${(durationMs / 1000).toFixed(1)}s  ${row.photo}${flag}`,
  );

  return row;
}

const queue = Array.from({ length: args.runs }, (unused, index) => index);

async function worker() {
  while (queue.length > 0) {
    await runOne(queue.shift());
  }
}

const startedAt = Date.now();

await Promise.all(Array.from({ length: args.concurrency }, worker));

const wallClockMs = Date.now() - startedAt;

// ------------------------------------------------------------------ report

results.sort((a, b) => a.run - b.run);

const stats = summarize(results);
const verdict = evaluateGate(results, { requiredRuns: args.runs });

const byPhoto = new Map();

for (const row of results) {
  const entry = byPhoto.get(row.photo) || { runs: 0, failures: 0, slowest: 0 };

  entry.runs += 1;
  if (row.status !== "SUCCESS") entry.failures += 1;
  entry.slowest = Math.max(entry.slowest, row.durationMs);

  byPhoto.set(row.photo, entry);
}

const seconds = (value) => (Number.isFinite(value) ? `${(value / 1000).toFixed(1)}s` : "—");

const report = [
  `# Reliability run — Milestone ${args.mockup ? "5" : "4"} (AC-05)`,
  "",
  args.mockup
    ? "Measured from upload to the **Gelato mockup the customer approves**."
    : "Measured from upload to the **AI artwork returned to the page**.",
  "",
  `- Runs: **${stats.runs}**`,
  `- Photos: **${photos.length}** distinct`,
  `- Model: \`${results[0]?.modelKey || "(unknown)"}\``,
  `- Resolution: \`${results[0]?.resolution || "(unknown)"}\``,
  `- Wall clock: ${(wallClockMs / 1000 / 60).toFixed(1)} minutes at concurrency ${args.concurrency}`,
  "",
  "## Result",
  "",
  verdict.passed
    ? "**Log checks PASSED.** Every recorded run is inside the ceiling and the clean-failure allowance was not exceeded."
    : "**Log checks FAILED.**",
  "",
  ...verdict.reasons.map((reason) => `- ${reason}`),
  "",
  "> A dirty failure — a broken, distorted, empty or misplaced result that still",
  "> proceeded — cannot be detected from a log. Every output image is saved in",
  "> this folder and must be looked at before the gate can be called passed.",
  "> Under AC-05 a single dirty failure fails the whole run.",
  "",
  "## Timing",
  "",
  "| Measure | Value |",
  "| --- | --- |",
  `| Successful runs | ${stats.successes} of ${stats.runs} |`,
  `| Clean failures | ${stats.failures} (at most 2 allowed) |`,
  `| Median | ${seconds(stats.durations.p50)} |`,
  `| 95th percentile | ${seconds(stats.durations.p95)} |`,
  `| Slowest | ${seconds(stats.durations.slowest)} |`,
  `| Within the 30s target | ${stats.durations.withinTarget} of ${stats.durations.count} |`,
  `| Over the 40s ceiling | ${stats.durations.overCeiling} |`,
  "",
  "## By photo",
  "",
  "| Photo | Runs | Failures | Slowest |",
  "| --- | ---: | ---: | ---: |",
  ...Array.from(byPhoto.entries()).map(
    ([photo, entry]) =>
      `| ${photo} | ${entry.runs} | ${entry.failures} | ${seconds(entry.slowest)} |`,
  ),
  "",
  "## Every run",
  "",
  "| # | Photo | Status | Time | Artwork | Mockup |",
  "| ---: | --- | --- | ---: | --- | --- |",
  ...results.map(
    (row) =>
      `| ${row.run} | ${row.photo} | ${row.status}${row.error ? ` — ${row.error}` : ""} | ${seconds(row.durationMs)} | ${row.file || "—"} | ${row.mockupFile || "—"} |`,
  ),
  "",
].join("\n");

const reportPath = path.join(outDir, "REPORT.md");

fs.writeFileSync(reportPath, report);
fs.writeFileSync(path.join(outDir, "runs.json"), JSON.stringify(results, null, 2));

console.log("");
console.log("=".repeat(64));
console.log("runs            :", stats.runs);
console.log("successes       :", stats.successes);
console.log("clean failures  :", stats.failures, "(at most 2 allowed)");
console.log("median          :", seconds(stats.durations.p50));
console.log("p95             :", seconds(stats.durations.p95));
console.log("slowest         :", seconds(stats.durations.slowest));
console.log("over 40s ceiling:", stats.durations.overCeiling);
console.log("");
console.log(verdict.passed ? "LOG CHECKS: PASSED" : "LOG CHECKS: FAILED");

for (const reason of verdict.reasons) {
  console.log("  -", reason);
}


console.log("");
console.log("Still required: look at every image in", outDir);
console.log("A single dirty failure fails the gate (AC-05).");
console.log("Report:", reportPath);

process.exitCode = verdict.passed ? 0 : 1;
