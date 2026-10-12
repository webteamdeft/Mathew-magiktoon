import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const currentFile = fileURLToPath(import.meta.url);
const currentDirectory = path.dirname(currentFile);

/**
 * Where customer uploads live.
 *
 * Deliberately OUTSIDE the app directory. Vite serves the project root in dev
 * and intercepts any request whose path resolves to a real file there, so an
 * `uploads/` folder inside the project was answered with
 *
 *   403 Restricted — outside of Vite serving allow list
 *
 * before `routes/uploads.$.jsx` ever ran. Keeping user data out of the served
 * source tree fixes that, and is the right shape for production regardless:
 * these files are not application assets.
 *
 * `UPLOADS_DIR` overrides it, which is how a deployment points at a mounted
 * volume rather than a sibling folder.
 */
const uploadsDirectory = path.resolve(
  process.env.UPLOADS_DIR || path.join(currentDirectory, "../../../magiktoon-uploads"),
);

async function ensureUploadsDirectory() {
  await fs.mkdir(uploadsDirectory, {
    recursive: true,
  });
}

function safeExtension(mimeType) {
  if (mimeType === "image/png") return ".png";
  if (mimeType === "image/jpeg") return ".jpg";
  return "";
}

export async function storeAsset(
  buffer,
  {
    mimeType = "application/octet-stream",
    prefix = "uploads",
  } = {}
) {
  await ensureUploadsDirectory();

  const cleanPrefix = String(prefix)
    .replace(/\\/g, "/")
    .replace(/^\/+|\/+$/g, "")
    .replace(/[^a-zA-Z0-9/_-]/g, "_");

  const identifier = crypto.randomUUID();
  const extension = safeExtension(mimeType);
  const filename = `${identifier}${extension}`;

  const relativeDirectory = cleanPrefix
    .replace(/\//g, path.sep);

  const destinationDirectory = path.join(
    uploadsDirectory,
    relativeDirectory
  );

  await fs.mkdir(destinationDirectory, {
    recursive: true,
  });

  const relativeKey = path.join(
    relativeDirectory,
    filename
  );

  const absolutePath = path.join(
    uploadsDirectory,
    relativeKey
  );

  await fs.writeFile(absolutePath, buffer);

  return relativeKey.replace(/\\/g, "/");
}

// NOTE: there is deliberately no `getTemporaryUrl` here any more. It returned
// an unsigned, non-expiring `/uploads/<key>` path, which NFR-09 forbids — any
// leaked link granted permanent access to a customer photo. Asset URLs are now
// minted exclusively by `signed-urls.server.js`, which HMAC-signs them with an
// expiry, and `routes/uploads.$.jsx` refuses anything unsigned.

export async function readAsset(key) {
  if (!key) {
    throw new Error("Storage key is missing");
  }

  const normalizedKey = key.replace(/\\/g, "/");
  const absolutePath = path.resolve(
    uploadsDirectory,
    normalizedKey
  );

  if (!absolutePath.startsWith(uploadsDirectory)) {
    throw new Error("Invalid storage key");
  }

  return fs.readFile(absolutePath);
}

export async function deleteAsset(key) {
  if (!key) return;

  const normalizedKey = key.replace(/\\/g, "/");
  const absolutePath = path.resolve(
    uploadsDirectory,
    normalizedKey
  );

  if (!absolutePath.startsWith(uploadsDirectory)) {
    throw new Error("Invalid storage key");
  }

  await fs.rm(absolutePath, {
    force: true,
  });
}