import { readAsset } from "../lib/storage.server.js";
import { verifySignedAsset } from "../lib/signed-urls.server.js";

const CONTENT_TYPES = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

/**
 * GET /uploads/*?exp=…&sig=…
 *
 * Serves a stored asset only against a valid, unexpired HMAC signature
 * (NFR-09). An unsigned or stale link is refused even though the caller knows
 * the storage key.
 */
export async function loader({ params, request }) {
  const key = params["*"];
  console.log("[uploads] incoming GET for key:", key, "ua:", request.headers.get("user-agent"), "ip:", request.headers.get("x-forwarded-for"));

  if (!key) {
    return new Response("Missing upload key", { status: 400 });
  }

  const url = new URL(request.url);

  const verdict = verifySignedAsset(
    key,
    url.searchParams.get("exp"),
    url.searchParams.get("sig"),
  );

  if (!verdict.ok) {
    // 403 for every failure mode: distinguishing "expired" from "invalid"
    // would leak whether a key exists.
    return new Response(
      verdict.reason === "expired"
        ? "This link has expired."
        : "This link is not valid.",
      { status: 403 },
    );
  }

  try {
    const buffer = await readAsset(key);

    const extension = key.toLowerCase().split(".").pop();

    return new Response(buffer, {
      status: 200,
      headers: {
        "Content-Type": CONTENT_TYPES[extension] || "application/octet-stream",
        // Private: these are customer photos, never shared-cache material.
        "Cache-Control": "private, max-age=300",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    console.error("[uploads] failed:", error);

    return new Response("File not found", { status: 404 });
  }
}
