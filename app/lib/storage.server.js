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

/**
 * Object storage, when configured.
 *
 * The local directory above only survives as long as the machine does. On
 * Render the container filesystem is rebuilt on every deploy, so artwork
 * written during one release was gone by the next: customization records
 * still pointed at `mockups/<shop>/<uuid>.jpg`, the file behind it no longer
 * existed, and every preview answered 404. Gelato is worse affected — it
 * fetches the print file asynchronously, so a restart between order and fetch
 * produced an order that printed nothing.
 *
 * Any S3-compatible endpoint works; Cloudflare R2 is the intended one. When
 * the variables are absent the local directory is used unchanged, which keeps
 * development working with no setup and no credentials.
 *
 * Keys are identical in both backends — the same `prefix/uuid.ext` string is
 * a path under the uploads directory or an object key in the bucket — so
 * switching backends needs no change to stored rows.
 */
const objectStorageConfig = {
  bucket: process.env.S3_BUCKET?.trim() || "",
  endpoint: process.env.S3_ENDPOINT?.trim() || "",
  accessKeyId: process.env.S3_ACCESS_KEY_ID?.trim() || "",
  secretAccessKey: process.env.S3_SECRET_ACCESS_KEY?.trim() || "",
  // R2 ignores the region but the SDK insists on one being present.
  region: process.env.S3_REGION?.trim() || "auto",
};

export function usingObjectStorage() {
  return Boolean(
    objectStorageConfig.bucket &&
      objectStorageConfig.endpoint &&
      objectStorageConfig.accessKeyId &&
      objectStorageConfig.secretAccessKey,
  );
}

let clientPromise = null;

/**
 * Imported lazily so a deployment with no bucket configured never loads the
 * AWS SDK, and so the module stays usable in tests that do not touch storage.
 */
async function getClient() {
  if (!clientPromise) {
    clientPromise = import("@aws-sdk/client-s3").then(
      ({ S3Client }) =>
        new S3Client({
          region: objectStorageConfig.region,
          endpoint: objectStorageConfig.endpoint,
          credentials: {
            accessKeyId: objectStorageConfig.accessKeyId,
            secretAccessKey: objectStorageConfig.secretAccessKey,
          },
          // R2 serves one bucket per host only under path-style addressing.
          forcePathStyle: true,
        }),
    );
  }

  return clientPromise;
}

function normalizeKey(key) {
  return String(key).replace(/\\/g, "/").replace(/^\/+/, "");
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
  const cleanPrefix = String(prefix)
    .replace(/\\/g, "/")
    .replace(/^\/+|\/+$/g, "")
    .replace(/[^a-zA-Z0-9/_-]/g, "_");

  const identifier = crypto.randomUUID();
  const extension = safeExtension(mimeType);
  const filename = `${identifier}${extension}`;

  if (usingObjectStorage()) {
    const key = `${cleanPrefix}/${filename}`;

    const [client, { PutObjectCommand }] = await Promise.all([
      getClient(),
      import("@aws-sdk/client-s3"),
    ]);

    await client.send(
      new PutObjectCommand({
        Bucket: objectStorageConfig.bucket,
        Key: key,
        Body: buffer,
        ContentType: mimeType,
      }),
    );

    return key;
  }

  await ensureUploadsDirectory();

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

  if (usingObjectStorage()) {
    const [client, { GetObjectCommand }] = await Promise.all([
      getClient(),
      import("@aws-sdk/client-s3"),
    ]);

    const result = await client.send(
      new GetObjectCommand({
        Bucket: objectStorageConfig.bucket,
        Key: normalizeKey(key),
      }),
    );

    return Buffer.from(await result.Body.transformToByteArray());
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

  if (usingObjectStorage()) {
    const [client, { DeleteObjectCommand }] = await Promise.all([
      getClient(),
      import("@aws-sdk/client-s3"),
    ]);

    await client.send(
      new DeleteObjectCommand({
        Bucket: objectStorageConfig.bucket,
        Key: normalizeKey(key),
      }),
    );

    return;
  }

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