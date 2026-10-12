import { Buffer } from "node:buffer";

import { authenticate } from "../shopify.server";
import { storeAsset } from "../lib/storage.server";
import { buildSignedAssetUrl } from "../lib/signed-urls.server";

/** The approved design states JPEG or PNG, up to 30MB. */
const MAX_BYTES = 30 * 1024 * 1024;
const ALLOWED = new Set(["image/png", "image/jpeg", "image/jpg", "image/webp"]);

/**
 * POST /app/api/background
 *
 * Stores an image a design needs and returns its storage key: the optional
 * background layer (SOW section 3.5), or the artwork for a fixed image layer.
 *
 * Both are merchant uploads that Gelato cannot supply — template detail names
 * a placeholder but never publishes its artwork — so they share one endpoint
 * and differ only in where they are filed.
 *
 * The key, not a URL, is what the mapping form keeps: asset URLs are signed and
 * expire, so persisting one would leave a dead link on the record (NFR-09).
 * The URL returned here is only for the preview thumbnail in the form.
 */
export async function action({ request }) {
  const { session } = await authenticate.admin(request);

  if (request.method !== "POST") {
    return Response.json({ ok: false, error: "Use POST." }, { status: 405 });
  }

  let formData;

  try {
    formData = await request.formData();
  } catch (error) {
    console.error("[background] upload could not be read:", error);

    return Response.json(
      { ok: false, error: "The upload could not be read. Try a smaller file." },
      { status: 400 },
    );
  }

  // "background" unless told otherwise, so callers written before fixed image
  // layers existed keep working unchanged.
  const kind = String(formData.get("kind") || "background").toLowerCase();
  const isLayer = kind === "layer";
  const noun = isLayer ? "Layer images" : "Background images";

  const file = formData.get("file");

  if (!file || typeof file.arrayBuffer !== "function") {
    return Response.json({ ok: false, error: "Choose an image to upload." }, { status: 400 });
  }

  if (!ALLOWED.has(String(file.type).toLowerCase())) {
    return Response.json(
      { ok: false, error: noun + " must be PNG, JPEG or WebP." },
      { status: 400 },
    );
  }

  if (Number(file.size) > MAX_BYTES) {
    return Response.json(
      { ok: false, error: noun + " must be 30MB or smaller." },
      { status: 400 },
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  if (buffer.length === 0) {
    return Response.json({ ok: false, error: "That file is empty." }, { status: 400 });
  }

  const key = await storeAsset(buffer, {
    mimeType: String(file.type).toLowerCase() === "image/jpg" ? "image/jpeg" : file.type,
    prefix: `${isLayer ? "layers" : "backgrounds"}/${String(session.shop).replace(/[^a-zA-Z0-9_-]/g, "_")}`,
  });

  return Response.json({
    ok: true,
    key,
    name: String(file.name || kind),
    // Preview only. The form stores the key and re-signs when it needs to show
    // the image again.
    url: buildSignedAssetUrl(key),
  });
}
