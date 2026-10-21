/**
 * Restores the shop's configuration rows after a deploy.
 *
 * The app's working configuration — AI models, prompts, product
 * configurations, mappings and Gelato templates — was created by hand in a
 * local SQLite database and existed nowhere else. A fresh deploy therefore
 * came up with empty tables: the model dropdown offered only "use the
 * default", and every storefront product answered "not mapped".
 *
 * `prisma/seed-data/config.json` is an export of those rows. This script
 * re-applies them, keyed on the original ids, so a rebuilt database comes back
 * with the shop already configured.
 *
 * Rows are written with `upsert ... update: {}`: a missing row is created, an
 * existing one is left exactly as it is. That matters because the admin UI can
 * edit prompts and mappings — re-running the seed must never overwrite a
 * change someone made in the app.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const here = path.dirname(fileURLToPath(import.meta.url));
const dataPath = path.join(here, "seed-data", "config.json");

/**
 * Prisma rejects an explicit `null` for a nullable `Json` column — it wants
 * `Prisma.DbNull` — while omitting the key leaves the column NULL either way.
 * Dropping nulls keeps the seed free of per-field special cases.
 */
function withoutNulls(row) {
  return Object.fromEntries(
    Object.entries(row).filter(([, value]) => value !== null),
  );
}

async function seedTable(label, model, rows) {
  let created = 0;

  for (const row of rows) {
    const data = withoutNulls(row);

    const before = await model.findUnique({ where: { id: data.id } });

    await model.upsert({
      where: { id: data.id },
      create: data,
      update: {},
    });

    if (!before) created += 1;
  }

  console.log(
    `[seed] ${label}: ${created} created, ${rows.length - created} already present`,
  );
}

async function main() {
  if (!fs.existsSync(dataPath)) {
    console.log("[seed] no seed-data/config.json — nothing to restore");

    return;
  }

  const data = JSON.parse(fs.readFileSync(dataPath, "utf8"));

  console.log(`[seed] restoring configuration for ${data.shop}`);

  // Order follows the foreign keys: a ProductConfiguration points at a Prompt
  // and an AiModel, and a GelatoTemplate cascades from a ProductConfiguration.
  await seedTable("aiModel", prisma.aiModel, data.aiModel ?? []);
  await seedTable("prompt", prisma.prompt, data.prompt ?? []);
  await seedTable(
    "productConfiguration",
    prisma.productConfiguration,
    data.productConfiguration ?? [],
  );
  await seedTable("productMapping", prisma.productMapping, data.productMapping ?? []);
  await seedTable("gelatoTemplate", prisma.gelatoTemplate, data.gelatoTemplate ?? []);
  await seedTable("shopSetting", prisma.shopSetting, data.shopSetting ?? []);
}

try {
  await main();
} catch (error) {
  // A failed seed must not stop the container from booting. An app that starts
  // unconfigured can still be fixed from the admin UI; an app that will not
  // start at all takes the storefront down with it.
  console.error("[seed] failed — the app will start without restored config");
  console.error(error);
} finally {
  await prisma.$disconnect();
}
