/**
 * Restores a full database export into the database DATABASE_URL points at.
 *
 * Used to move the shop off the local SQLite file after the datasource became
 * Postgres. The export is deliberately NOT kept in this repository: order rows
 * carry `requestPayload.shippingAddress`, which holds customer names, street
 * addresses and email addresses, and this repository is public. Produce the
 * file locally and pass its path in.
 *
 *   node scripts/restore-from-export.mjs --file ~/magiktoon-full-export.json
 *   node scripts/restore-from-export.mjs --file ... --dry-run
 *
 * Rows are written with `upsert ... update: {}`, keyed on their original id:
 * a missing row is created, an existing row is left untouched. Re-running is
 * therefore safe, and a record edited in the admin UI is never overwritten.
 *
 * Sessions are not restored. They hold a Shopify access token, they expire,
 * and opening the app in admin mints a fresh one.
 */

import fs from "node:fs";

import { PrismaClient } from "@prisma/client";

/**
 * Insertion order follows the foreign keys: a ProductConfiguration points at a
 * Prompt and an AiModel, a GelatoTemplate cascades from a configuration, and
 * an order item points at a customization. Restoring out of order fails on a
 * constraint rather than silently dropping the reference.
 */
const ORDER = [
  "aiModel",
  "prompt",
  "productConfiguration",
  "productMapping",
  "gelatoTemplate",
  "shopSetting",
  "customization",
  "generationLog",
  "pendingOrder",
  "gelatoOrderItem",
];

function parseArgs(argv) {
  const args = { file: "", dryRun: false };

  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--file") args.file = argv[i + 1] ?? "";
    if (argv[i] === "--dry-run") args.dryRun = true;
  }

  return args;
}

/**
 * Prisma rejects an explicit `null` for a nullable `Json` column, wanting
 * `Prisma.DbNull` instead, while leaving the key out produces the same NULL.
 */
function withoutNulls(row) {
  return Object.fromEntries(
    Object.entries(row).filter(([, value]) => value !== null),
  );
}

async function restoreTable(prisma, name, rows, dryRun) {
  const model = prisma[name];

  if (!model) {
    console.log(`  ${name.padEnd(22)} skipped — no such model`);

    return;
  }

  let created = 0;
  let existing = 0;

  for (const row of rows) {
    const data = withoutNulls(row);

    const before = await model.findUnique({ where: { id: data.id } });

    if (before) {
      existing += 1;

      continue;
    }

    if (!dryRun) {
      await model.create({ data });
    }

    created += 1;
  }

  const verb = dryRun ? "would create" : "created";

  console.log(
    `  ${name.padEnd(22)} ${String(created).padStart(4)} ${verb}, ${existing} already present`,
  );
}

async function main() {
  const { file, dryRun } = parseArgs(process.argv.slice(2));

  if (!file) {
    throw new Error("Pass --file <path to export json>");
  }

  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set — refusing to guess a target");
  }

  if (!fs.existsSync(file)) {
    throw new Error(`No such export file: ${file}`);
  }

  const target = process.env.DATABASE_URL.replace(/:\/\/[^@]*@/, "://***@");

  console.log(`Restoring ${file}`);
  console.log(`into       ${target}`);

  if (dryRun) console.log("DRY RUN — nothing will be written\n");

  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  const tables = data.tables ?? {};

  const prisma = new PrismaClient();

  try {
    for (const name of ORDER) {
      await restoreTable(prisma, name, tables[name] ?? [], dryRun);
    }

    const unknown = Object.keys(tables).filter((t) => !ORDER.includes(t));

    if (unknown.length) {
      console.log(`\nNot restored (not in the known order): ${unknown.join(", ")}`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

await main();
