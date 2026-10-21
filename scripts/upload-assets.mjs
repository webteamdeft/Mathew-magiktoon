/**
 * Uploads locally stored artwork into the configured object storage bucket.
 *
 * Artwork used to live on whichever machine ran the app. Moving the app to
 * Render left the database rows intact but the files behind them behind, so
 * every preview of an existing customization answered 404. This copies them
 * across, preserving each key exactly, so the existing rows resolve without
 * being rewritten.
 *
 *   node scripts/upload-assets.mjs --dry-run
 *   node scripts/upload-assets.mjs
 *   node scripts/upload-assets.mjs --all
 *
 * By default only the files the database actually references are uploaded —
 * roughly 290 MB of the 1.5 GB on disk, the rest being superseded generations
 * nothing points at any more. `--all` copies the entire uploads directory.
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

import { PrismaClient } from "@prisma/client";

const UPLOADS_DIR = path.resolve(
  process.env.UPLOADS_DIR ||
    path.join(process.cwd(), "..", "magiktoon-uploads"),
);

const CONTENT_TYPES = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};

function parseArgs(argv) {
  return {
    all: argv.includes("--all"),
    dryRun: argv.includes("--dry-run"),
  };
}

function requireEnv(name) {
  const value = process.env[name]?.trim();

  if (!value) throw new Error(`Missing required environment variable: ${name}`);

  return value;
}

/** Every key the database points at, across both artwork and preview columns. */
async function referencedKeys() {
  const prisma = new PrismaClient();

  try {
    const keys = new Set();

    const customizations = await prisma.customization.findMany({
      select: { artworkKey: true, previewKey: true },
    });

    for (const row of customizations) {
      if (row.artworkKey) keys.add(row.artworkKey);
      if (row.previewKey) keys.add(row.previewKey);
    }

    return keys;
  } finally {
    await prisma.$disconnect();
  }
}

async function walk(directory, base = directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const full = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...(await walk(full, base)));
    } else {
      files.push(path.relative(base, full).replace(/\\/g, "/"));
    }
  }

  return files;
}

async function main() {
  const { all, dryRun } = parseArgs(process.argv.slice(2));

  const bucket = requireEnv("S3_BUCKET");
  const endpoint = requireEnv("S3_ENDPOINT");
  const accessKeyId = requireEnv("S3_ACCESS_KEY_ID");
  const secretAccessKey = requireEnv("S3_SECRET_ACCESS_KEY");

  if (!existsSync(UPLOADS_DIR)) {
    throw new Error(`Uploads directory not found: ${UPLOADS_DIR}`);
  }

  const keys = all
    ? new Set(await walk(UPLOADS_DIR))
    : await referencedKeys();

  console.log(`source   ${UPLOADS_DIR}`);
  console.log(`bucket   ${bucket}`);
  console.log(`mode     ${all ? "all files" : "files referenced by the database"}`);
  console.log(`files    ${keys.size}`);

  if (dryRun) console.log("\nDRY RUN — nothing will be uploaded\n");

  const { S3Client, PutObjectCommand } = await import("@aws-sdk/client-s3");

  const client = new S3Client({
    region: process.env.S3_REGION?.trim() || "auto",
    endpoint,
    credentials: { accessKeyId, secretAccessKey },
    forcePathStyle: true,
  });

  let uploaded = 0;
  let missing = 0;
  let bytes = 0;

  for (const key of keys) {
    const source = path.join(UPLOADS_DIR, key);

    let body;

    try {
      body = await fs.readFile(source);
    } catch {
      missing += 1;
      console.log(`  MISSING  ${key}`);

      continue;
    }

    if (!dryRun) {
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: body,
          ContentType:
            CONTENT_TYPES[path.extname(key).toLowerCase()] ||
            "application/octet-stream",
        }),
      );
    }

    uploaded += 1;
    bytes += body.length;

    if (uploaded % 25 === 0) {
      console.log(`  ${uploaded}/${keys.size} …`);
    }
  }

  console.log(
    `\n${dryRun ? "would upload" : "uploaded"} ${uploaded} files ` +
      `(${(bytes / 1048576).toFixed(1)} MB), ${missing} missing locally`,
  );
}

await main();
