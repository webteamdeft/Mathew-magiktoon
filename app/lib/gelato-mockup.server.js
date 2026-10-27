/**
 * Gelato product mockups for the customer's own artwork (Milestone 5).
 *
 * SERVER ONLY.
 *
 * HOW, AND WHY THIS WAY
 * ---------------------
 * Gelato has no standalone "render a mockup" endpoint. Verified against the
 * live API: `POST /v1/templates/mockups` is not a route at all (the path
 * resolves as `/v1/templates/{id}` with "mockups" read as the id), and
 * `/v1/templates/{id}/mockups`, `/v3/mockups` and
 * `products:preview-from-template` all return 404.
 *
 * The one surface that works is `products:create-from-template`: a template
 * plus filled image placeholders produces a real store product, and Gelato
 * renders its preview — which IS the mockup, with the template's own design
 * applied. Measured at roughly five seconds.
 *
 * That leaves two consequences this module has to handle:
 *
 *   1. Every mockup creates a product in the merchant's Gelato store. Left
 *      alone, one product per customer preview would bury the store within a
 *      day. The product is deleted once its mockup has been copied out.
 *
 *   2. Gelato's preview URL is a presigned S3 link that expires in 24 hours,
 *      and it dies with the product anyway. The image is therefore fetched and
 *      stored as our own asset, served through the signed-URL route like every
 *      other customer file (NFR-09).
 */

import { getGelatoConfig } from "./env.server.js";
import { storeAsset } from "./storage.server.js";
import { asArray, firstString, toTrimmedString } from "./normalize.js";

const GELATO_ECOMMERCE_API = "https://ecommerce.gelatoapis.com/v1";

/** How long to wait for Gelato to render, and how often to look. */
const RENDER_TIMEOUT_MS = 60000;

/**
 * How long to keep polling after the gallery last grew.
 *
 * Gelato publishes its mockups one at a time, so "an image exists" is not "the
 * render has finished": the first angle landed at 83s in production while the
 * others were still rendering. Waiting is bounded by how long the count has
 * been STILL rather than by a fixed deadline, so a design that will only ever
 * have one mockup costs one settle window instead of the whole budget.
 *
 * The shorter window applies once Gelato reports a terminal status, which is
 * good evidence nothing further is coming. These are starting values: nothing
 * yet measures how long Gelato takes between its first and third image.
 */
const GALLERY_GROW_MS = 30000;
const GALLERY_SETTLE_MS = 10000;

/**
 * Statuses that mean Gelato has given up.
 *
 * Reaching one is final: continuing to poll for a preview that will never come
 * only makes the customer wait for a worse message.
 */
const FAILED_STATUSES = new Set(["publishing_error", "failed", "error"]);
const POLL_INTERVAL_MS = 2000;

function headers() {
  const { apiKey } = getGelatoConfig();

  return {
    "X-API-KEY": apiKey,
    Accept: "application/json",
    "Content-Type": "application/json",
  };
}

async function gelato(path, options = {}, fetchImpl = fetch) {
  const response = await fetchImpl(`${GELATO_ECOMMERCE_API}${path}`, {
    ...options,
    headers: { ...headers(), ...(options.headers || {}) },
  });

  const text = await response.text();

  let data;

  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  if (!response.ok) {
    const error = new Error(
      `Gelato E-commerce API ${response.status}: ${
        typeof data === "string" ? data : JSON.stringify(data)
      }`,
    );

    error.status = response.status;

    throw error;
  }

  return data;
}

/**
 * Which image placeholders to fill, and with what.
 *
 * A template can expose the same placeholder more than once — the 11oz mug
 * "twin image" template carries two, so the artwork has to be sent for each or
 * half the mug prints blank. Names come from the template itself; the mapping's
 * stored placeholder name is the fallback for a template we cannot read.
 */
export function buildImagePlaceholders(
  templateVariant,
  mapping,
  artworkUrl,
  backgroundUrl = "",
) {
  const fromTemplate = asArray(templateVariant?.imagePlaceholders)
    .map((placeholder) =>
      toTrimmedString(
        placeholder?.name || placeholder?.placeholderName || placeholder?.id,
      ),
    )
    .filter(Boolean);

  const backgroundName = toTrimmedString(backgroundUrl)
    ? toTrimmedString(mapping?.backgroundPlaceholderName)
    : "";

  const targetArtworkName = toTrimmedString(
    mapping?.gelatoPlaceholderName || mapping?.placeholderName || "",
  );

  const templateHasTarget = targetArtworkName && fromTemplate.some((name) =>
    name === targetArtworkName || name.includes(targetArtworkName) || targetArtworkName.includes(name)
  );

  const names = (fromTemplate.length > 0
    ? fromTemplate
    : [targetArtworkName || "ImageFront"].filter(Boolean)
  ).filter((name) => {
    if (backgroundName && name === backgroundName) return true;
    if (/bar\s*code|barcode|logo|lens/i.test(name)) return false;
    if (!backgroundUrl && /background|edge-to-edge/i.test(name)) return false;
    if (templateHasTarget) {
      return (
        name === targetArtworkName ||
        name.includes(targetArtworkName) ||
        targetArtworkName.includes(name)
      );
    }
    return true;
  });

  // Deduplicated: the same placeholder listed twice must not be sent twice
  // once one of them is the background.
  const seen = new Set();

  return names
    .filter((name) => {
      if (name !== backgroundName) return true;
      if (seen.has(name)) return false;
      seen.add(name);
      return true;
    })
    .map((name) => ({
      name,
      fileUrl: name === backgroundName ? backgroundUrl : artworkUrl,
      fitMethod: "slice",
    }));
}

/**
 * Text values to send with the mockup.
 *
 * Only names the template actually declares are sent: an unknown name is
 * rejected by Gelato and would fail the whole render over a stale field.
 */
export function buildTextPlaceholders(templateVariant, mapping, textValues) {
  const values = textValues && typeof textValues === "object" ? textValues : {};

  const declared = asArray(templateVariant?.textPlaceholders)
    .map((placeholder) => toTrimmedString(placeholder?.name))
    .filter(Boolean);

  // The wording each live text area ships with, by its current name.
  const liveDefaults = new Map(
    asArray(templateVariant?.textPlaceholders).map((placeholder) => [
      toTrimmedString(placeholder?.name),
      firstString(placeholder?.text, placeholder?.defaultText),
    ]),
  );

  const staleValueFor = staleTextResolver(mapping, values, declared);

  const known = declared.length > 0
    ? declared
    : asArray(mapping?.gelatoTextPlaceholders)
        .map((placeholder) => toTrimmedString(placeholder?.name))
        .filter(Boolean);

  const uniqueNames = Array.from(new Set(known));

  return uniqueNames
    .map((name) => {
      let val = toTrimmedString(values[name]);
      if (!val) {
        const matchingKey = Object.keys(values).find(
          (k) => k.toLowerCase().trim() === name.toLowerCase().trim()
        );
        if (matchingKey) val = toTrimmedString(values[matchingKey]);
      }
      if (!val) {
        val = staleValueFor(name, liveDefaults.get(name));
      }
      if (!val && uniqueNames.length === 1 && Object.values(values).length > 0) {
        val = toTrimmedString(Object.values(values)[0]);
      }
      // Left as the template has it: send nothing and let Gelato keep its own
      // wording. The storefront's single-line input strips line breaks, so
      // echoing an untouched multi-line default back would flatten it.
      if (val && sameWording(val, liveDefaults.get(name))) {
        return null;
      }
      return val ? { name, text: val } : null;
    })
    .filter(Boolean);
}

/** Wording compared without whitespace or case, as an input box returns it. */
function squashWording(value) {
  return toTrimmedString(value).replace(/\s+/g, "").toLowerCase();
}

function sameWording(a, b) {
  const left = squashWording(a);

  return Boolean(left) && left === squashWording(b);
}

/**
 * Find a customer's value that was submitted under a text area's OLD name.
 *
 * Renaming text layers in Gelato (say "Copy of Copy of Text 4" to "Name") does
 * not touch the design saved here, so the storefront keeps submitting the old
 * names. Gelato has no area by those names, so every value was dropped and the
 * mockup printed the template's defaults whatever the customer typed.
 *
 * The rename keeps each area's default wording, which is also on the saved
 * design, so an old name is matched to its new one through that wording. Each
 * old name is used at most once, and only names the template no longer has are
 * considered, so a design that is in step with its template is unaffected.
 */
function staleTextResolver(mapping, values, liveNames) {
  const live = new Set(liveNames);

  // Old name -> the wording it was saved with.
  const savedWording = new Map();

  for (const layer of asArray(mapping?.layers)) {
    if (layer?.type === "text" && toTrimmedString(layer?.name)) {
      savedWording.set(toTrimmedString(layer.name), layer?.text?.content);
    }
  }

  for (const placeholder of asArray(mapping?.gelatoTextPlaceholders)) {
    const name = toTrimmedString(placeholder?.name);

    if (name && !savedWording.has(name)) {
      savedWording.set(name, placeholder?.defaultText);
    }
  }

  const used = new Set();

  return (liveName, liveWording) => {
    const wanted = squashWording(liveWording);

    if (!wanted) return "";

    for (const [oldName, value] of Object.entries(values)) {
      const name = toTrimmedString(oldName);

      if (live.has(name) || used.has(name)) continue;
      if (squashWording(savedWording.get(name)) !== wanted) continue;

      used.add(name);
      return toTrimmedString(value);
    }

    return "";
  };
}

/** The template variant this mapping prints, or the template's only one. */
export function pickTemplateVariant(template, mapping) {
  const variants = asArray(
    template?.variants ||
    template?.templateVariants ||
    template?.template?.variants ||
    template?.template?.templateVariants,
  );

  if (variants.length === 0) return null;

  const wanted = toTrimmedString(mapping?.gelatoVariantId || mapping?.variantId);

  return (
    variants.find(
      (variant) =>
        variant.id === wanted ||
        variant.templateVariantId === wanted ||
        variant.variantId === wanted ||
        variant.uid === wanted,
    ) ||
    variants.find((v) => /white/i.test(v.title || v.name || "")) ||
    variants[0]
  );
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Render a Gelato mockup of the customer's artwork on this design.
 *
 * @returns {Promise<{ ok: boolean, key?: string, mimeType?: string,
 *                     code?: string, error?: string, durationMs: number }>}
 */
export async function renderGelatoMockup(
  {
    shop,
    mapping,
    artworkUrl,
    backgroundUrl = "",
    textValues = {},
    timeoutMs: optTimeoutMs,
  },
  deps = {},
) {
  const {
    request = gelato,
    fetchImpl = fetch,
    store = storeAsset,
    now = () => Date.now(),
    wait = sleep,
    timeoutMs = optTimeoutMs || RENDER_TIMEOUT_MS,
  } = deps;

  const startedAt = now();
  const templateId = toTrimmedString(mapping?.gelatoTemplateId);

  if (!templateId) {
    return {
      ok: false,
      code: "NOT_CONFIGURED",
      error: "This design has no Gelato template to preview.",
      durationMs: 0,
    };
  }

  if (!toTrimmedString(artworkUrl)) {
    return {
      ok: false,
      code: "NO_ARTWORK",
      error: "Generate your artwork before previewing it on the product.",
      durationMs: 0,
    };
  }

  // Gelato downloads the artwork itself. If this app cannot fetch its own
  // signed URL then neither can Gelato, and the only symptom would be a
  // 25 second wait ending in "took too long" — which tells the customer
  // nothing and sends us looking in the wrong place.
  //
  // The usual cause in development is the tunnel: no SHOPIFY_APP_URL, or an
  // address that has rotated since the app started.
  try {
    console.log(`[mockup] Step 1/5: Probing artwork URL reachability: ${artworkUrl}`);
    const probe = await fetchImpl(artworkUrl, { method: "GET" });
    console.log(`[mockup] Step 1/5: Artwork probe status: ${probe.status}`);

    if (!probe.ok && probe.status >= 400 && probe.status < 500) {
      console.error(`[mockup] Artwork unreachable: HTTP ${probe.status}`);
      return {
        ok: false,
        code: "ARTWORK_UNREACHABLE",
        error: "Your artwork could not be reached for the preview. Please try again.",
        detail: `the artwork URL answered ${probe.status}`,
        durationMs: now() - startedAt,
      };
    }
  } catch (error) {
    console.warn("[mockup] Step 1/5: Artwork probe error:", error.message);

    return {
      ok: false,
      code: "ARTWORK_UNREACHABLE",
      error: "Your artwork could not be reached for the preview. Please try again.",
      detail: error.message,
      durationMs: now() - startedAt,
    };
  }

  let productId = "";

  try {
    console.log(`[MOCKUP-STEP 2/5] 📋 Fetching template ${templateId} & picking variant from Gelato...`);
    const template = await request(`/templates/${encodeURIComponent(templateId)}`);
    const variant = pickTemplateVariant(template, mapping);

    if (!variant) {
      console.error(`[MOCKUP-STEP 2/5] ❌ Template ${templateId} variant not found for mapping ${mapping?.id}`);
      return {
        ok: false,
        code: "NOT_CONFIGURED",
        error: "This design is not ready to preview yet.",
        durationMs: now() - startedAt,
      };
    }
    const variantId = variant.id || variant.templateVariantId || variant.variantId;
    console.log(`[MOCKUP-STEP 2/5] ✅ Picked variant: ID=${variantId}, Title="${variant.title || variant.name || "Default"}"`);

    const imagePlaceholders = buildImagePlaceholders(
      variant,
      mapping,
      artworkUrl,
      backgroundUrl,
    );
    const textPlaceholders = buildTextPlaceholders(variant, mapping, textValues);

    console.log(`[MOCKUP-STEP 3/5] 📤 Submitting product creation to Gelato API:`);
    console.log(`  ↳ Store ID: ${getGelatoConfig().storeId}`);
    console.log(`  ↳ Template ID: ${templateId}, Variant ID: ${variantId}`);
    console.log(`  ↳ Image placeholders (${imagePlaceholders.length}):`, imagePlaceholders.map((p) => `${p.name} -> ${p.fileUrl?.slice(0, 80)}...`));
    console.log(`  ↳ Text placeholders (${textPlaceholders.length}):`, textPlaceholders.map((t) => `${t.name} -> "${t.text}"`));

    const created = await request(
      `/stores/${encodeURIComponent(getGelatoConfig().storeId)}/products:create-from-template`,
      {
        method: "POST",
        body: JSON.stringify({
          templateId,
          title: `MagikToon preview — do not publish (${shop})`,
          description: "Temporary product used to render a customer preview.",
          isVisibleInTheOnlineStore: false,
          salesChannels: [],
          tags: ["magiktoon-preview"],
          metadata: [
            { key: "previewScenes", value: JSON.stringify(["default", "front", "right"]) },
            { key: "primaryPreviewScene", value: "right" },
            { key: "previewFileType", value: "jpeg" },
          ],
          variants: [
            {
              templateVariantId: variant.templateVariantId || variant.id,
              imagePlaceholders,
              textPlaceholders,
            },
          ],
        }),
      },
    );

    productId = toTrimmedString(
      created?.id ||
      created?.productId ||
      created?.product?.id ||
      created?.uid ||
      created?.data?.id,
    );

    if (!productId) {
      console.error("[MOCKUP-STEP 3/5] ❌ Gelato create-from-template failed to return an ID. Response:", JSON.stringify(created));
      return {
        ok: false,
        code: "PREVIEW_FAILED",
        error: "Please try ‘Preview on Product’ again.",
        detail: created?.message || created?.error || "Gelato create-from-template failed to return a product ID",
        durationMs: now() - startedAt,
      };
    }

    console.log(`[MOCKUP-STEP 3/5] ✅ Gelato accepted product! Product ID: ${productId}, Initial status: "${created?.status || "created"}"`);

    // Gelato renders asynchronously; the preview appears on the product a few
    // seconds after it is created.
    let previewUrl =
      toTrimmedString(created?.previewUrl) ||
      toTrimmedString(created?.preview_url) ||
      toTrimmedString(asArray(created?.productImages)[0]?.fileUrl) ||
      toTrimmedString(asArray(created?.productImages)[0]?.url);

    let latestProduct = null;
    let firstSawPreviewAt = 0;
    let pollCount = 0;
    // `gelatoImageCount` is recorded when the merchant SAVES the mapping, which
    // is before Gelato has rendered anything — so it is almost always 1, and
    // nothing updates it afterwards. Trusting it made this loop stop at the
    // first image of every render: one angle in the slider, no thumbnails to
    // cycle, and the "standard mockups are missing" report. A count above 1 was
    // set deliberately and is honoured; 1 or absent means "not yet known", and
    // the renderer aims for the three angles it can actually use.
    const storedImageCount = Number(mapping?.gelatoImageCount) || 0;
    const targetMockupCount = storedImageCount > 1 ? Math.min(3, storedImageCount) : 3;

    // When the gallery last gained an image, so a stalled render is told apart
    // from a slow one.
    let lastGrowthAt = 0;
    let seenImageCount = 0;

    while (now() - startedAt < timeoutMs) {
      await wait(POLL_INTERVAL_MS);
      pollCount++;

      const product = await request(
        `/stores/${encodeURIComponent(getGelatoConfig().storeId)}/products/${productId}`,
      );
      latestProduct = product;

      const images = asArray(product?.productImages || product?.images);
      const firstVariant = asArray(product?.variants || product?.productVariants)[0];
      const variantImages = asArray(firstVariant?.productImages || firstVariant?.images);

      previewUrl =
        toTrimmedString(product?.previewUrl) ||
        toTrimmedString(product?.preview_url) ||
        toTrimmedString(images[0]?.fileUrl) ||
        toTrimmedString(images[0]?.url) ||
        toTrimmedString(images.find((img) => img?.fileUrl || img?.url)?.fileUrl) ||
        toTrimmedString(images.find((img) => img?.fileUrl || img?.url)?.url) ||
        toTrimmedString(firstVariant?.previewUrl) ||
        toTrimmedString(variantImages[0]?.fileUrl) ||
        toTrimmedString(variantImages[0]?.url);

      if ((previewUrl || images.length > 0) && !firstSawPreviewAt) {
        firstSawPreviewAt = now();
      }

      if (images.length > seenImageCount) {
        seenImageCount = images.length;
        lastGrowthAt = now();
      }

      const status = toTrimmedString(product?.status).toLowerCase();
      const elapsedSec = Math.round((now() - startedAt) / 1000);

      console.log(
        `[MOCKUP-STEP 4/5] ⏳ Polling Gelato (poll #${pollCount}, ${elapsedSec}s elapsed): status="${status}", previewUrl=${previewUrl ? "FOUND" : "false (rendering in cloud...)"}, images=${images.length}, variantImages=${variantImages.length}`,
      );

      // If mockups are not ready yet, explain clearly in logs
      if (!previewUrl && images.length === 0 && status === "created") {
        console.log(`  ↳ Gelato render queue in progress: raytracing scenes in Gelato cloud...`);
      }

      // Break if all requested mockups are ready
      if (images.length >= targetMockupCount || images.length >= 3) {
        console.log(`[MOCKUP-STEP 4/5] 🎯 Target mockup count (${images.length}/${targetMockupCount}) reached!`);
        break;
      }

      // Short of the target, so the question is whether more are still coming.
      // Both exits below wait on the gallery having STOPPED growing rather than
      // on a deadline from the first image: the old rule gave Gelato ten
      // seconds from the first mockup to produce the rest, which on an
      // eighty-second render was never long enough for the second and third.
      const terminal = status === "active" || status === "completed";
      const stillFor = now() - (lastGrowthAt || firstSawPreviewAt);

      if ((images.length > 0 || previewUrl) && terminal && stillFor >= GALLERY_SETTLE_MS) {
        console.log(`[MOCKUP-STEP 4/5] 🎯 Gelato status is '${status}' with ${images.length} images and the gallery has settled!`);
        break;
      }

      if (firstSawPreviewAt && (images.length > 0 || previewUrl) && stillFor >= GALLERY_GROW_MS) {
        console.log(`[MOCKUP-STEP 4/5] 🎯 Gallery stopped growing at ${images.length} image(s), proceeding to download.`);
        break;
      }

      // If Gelato reported a failure, but we already have mockups, don't fail — use what was generated
      if (FAILED_STATUSES.has(status)) {
        if (images.length > 0 || previewUrl) {
          break;
        }

        const reasons = asArray(product?.publishingErrors)
          .map((entry) => toTrimmedString(entry?.message) || toTrimmedString(entry))
          .filter(Boolean);

        console.error(`[MOCKUP-STEP 4/5] ❌ Gelato reported failure status "${status}":`, reasons);

        return {
          ok: false,
          code: "PREVIEW_FAILED",
          error: "The preview could not be generated. Please try again.",
          detail: reasons.length ? reasons.join("; ") : `Gelato reported "${status}"`,
          durationMs: now() - startedAt,
        };
      }
    }

    if (!previewUrl) {
      console.warn(`[MOCKUP-STEP 4/5] ⚠️ Live polling timeout (${Math.round((now() - startedAt) / 1000)}s) reached with previewUrl still false.`);
      return {
        ok: false,
        code: "TIMED_OUT",
        error: "The preview took too long to generate. Please try again.",
        durationMs: now() - startedAt,
      };
    }

    // Collect all unique mockup URLs from the product
    const candidateUrls = [];
    const seenUrls = new Set();
    const addCandidate = (url, isPrimary = false) => {
      const trimmed = toTrimmedString(url);
      if (!trimmed) return;
      const stripped = trimmed.split("?")[0];
      if (seenUrls.has(stripped)) return;
      seenUrls.add(stripped);
      candidateUrls.push({ url: trimmed, isPrimary });
    };

    if (previewUrl) addCandidate(previewUrl, true);

    const allProductImages = asArray(
      latestProduct?.productImages || latestProduct?.images || created?.productImages,
    );
    for (const img of allProductImages) {
      addCandidate(img?.fileUrl || img?.url, Boolean(img?.isPrimary));
    }

    const allVariants = asArray(
      latestProduct?.variants || latestProduct?.productVariants || created?.variants,
    );
    for (const v of allVariants) {
      if (v?.previewUrl) addCandidate(v.previewUrl, false);
      for (const vImg of asArray(v?.productImages || v?.images)) {
        addCandidate(vImg?.fileUrl || vImg?.url, Boolean(vImg?.isPrimary));
      }
    }

    // Download and store each available mockup in parallel
    console.log(`[MOCKUP-STEP 5/5] 📥 Found ${candidateUrls.length} candidate mockup URLs from Gelato, downloading & storing in parallel...`);
    const storedMockups = (
      await Promise.all(
        candidateUrls.map(async (item, idx) => {
          try {
            console.log(`  ↳ Fetching mockup #${idx + 1} from Gelato CDN: ${item.url.slice(0, 100)}...`);
            const response = await fetchImpl(item.url);
            if (response.ok) {
              const buffer = Buffer.from(await response.arrayBuffer());
              const mimeType = response.headers?.get?.("content-type") || "image/jpeg";
              const key = await store(buffer, {
                mimeType: mimeType.includes("png") ? "image/png" : "image/jpeg",
                prefix: `mockups/${toTrimmedString(shop).replace(/[^a-zA-Z0-9_-]/g, "_")}`,
              });
              console.log(`  ✅ Successfully saved mockup #${idx + 1} to storage: ${key}`);
              return {
                key,
                mimeType,
                isPrimary: item.isPrimary,
              };
            } else {
              console.warn(`  ⚠️ Gelato CDN answered HTTP ${response.status} for mockup #${idx + 1}`);
            }
          } catch (err) {
            console.warn(`  ❌ Failed to fetch/store mockup #${idx + 1}:`, err.message);
          }
          return null;
        }),
      )
    ).filter(Boolean);

    if (storedMockups.length === 0) {
      console.error("[MOCKUP-STEP 5/5] ❌ Failed to store any mockups from candidate URLs");
      return {
        ok: false,
        code: "PREVIEW_FAILED",
        error: "The preview could not be loaded. Please try again.",
        durationMs: now() - startedAt,
      };
    }

    const primaryMockup = storedMockups.find((m) => m.isPrimary) || storedMockups[0];
    console.log(`[MOCKUP-STEP 5/5] 🎉 Gelato live render complete! Stored ${storedMockups.length} mockups in ${now() - startedAt}ms. Primary: ${primaryMockup.key}`);

    return {
      ok: true,
      key: primaryMockup.key,
      mimeType: primaryMockup.mimeType,
      mockups: storedMockups,
      durationMs: now() - startedAt,
    };
  } catch (error) {
    console.error("[mockup] failed:", error?.message);

    return {
      ok: false,
      code: "PREVIEW_FAILED",
      error: "Preview generation failed. Please try again.",
      durationMs: now() - startedAt,
    };
  } finally {
    if (productId) {
      deleteMockupProduct(productId, { request }).catch((err) => {
        console.warn("[mockup] background cleanup failed:", err?.message);
      });
    }
  }
}

/**
 * Should the throwaway product be removed after its mockup is copied out?
 *
 * Deleting is the default, and deliberately so: this runs once per customer
 * preview, so keeping them would add a product to the merchant's Gelato store
 * every time anybody clicks the button. `GELATO_DELETE_AFTER_MOCKUP=false` is
 * an explicit opt-out for debugging a render, not a setting to leave on.
 *
 * Note this reads the variable directly rather than through `getGelatoConfig`,
 * whose default is off — that default predates this flow and would silently
 * turn "clean up after yourself" into "never clean up".
 */
export function shouldDeleteMockupProduct(env = process.env) {
  const raw = env.GELATO_DELETE_AFTER_MOCKUP;

  if (raw === undefined || raw === null || raw === "") return true;

  return String(raw).trim().toLowerCase() !== "false";
}

/**
 * Remove the throwaway product a mockup was rendered from.
 */
export async function deleteMockupProduct(productId, { request = gelato } = {}) {
  const id = toTrimmedString(productId);

  if (!id) return { ok: true, deleted: false };

  if (!shouldDeleteMockupProduct()) {
    console.warn(
      "[mockup] GELATO_DELETE_AFTER_MOCKUP is off, so preview product " +
        `${id} is being kept. One product per customer preview will build up ` +
        "in the Gelato store.",
    );

    return { ok: true, deleted: false };
  }

  try {
    await request(
      `/stores/${encodeURIComponent(getGelatoConfig().storeId)}/products/${id}`,
      { method: "DELETE" },
    );

    return { ok: true, deleted: true };
  } catch (error) {
    // A leftover product is untidy, not broken: the customer already has their
    // mockup, so this must never turn a good preview into a failure.
    console.error("[mockup] could not delete preview product", id, error?.message);

    return { ok: false, deleted: false };
  }
}
