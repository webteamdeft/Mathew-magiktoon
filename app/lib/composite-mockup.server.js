import sharp from "sharp";
import { resolveTemplateImages } from "./gelato-preview.server.js";
import { storeAsset, readAsset } from "./storage.server.js";
import { buildSignedAssetUrl } from "./signed-urls.server.js";
import { asArray, toTrimmedString } from "./normalize.js";

// In-memory cache for downloaded template base images so repeated renders are instantaneous
const templateBufferCache = new Map();
const TEMPLATE_CACHE_TTL_MS = 2 * 60 * 60 * 1000;

async function getTemplateBuffer(templateUrl) {
  const cleanUrl = toTrimmedString(templateUrl);
  if (!cleanUrl) return null;

  const cacheKey = cleanUrl.split("?")[0];
  const cached = templateBufferCache.get(cacheKey);
  if (cached && Date.now() - cached.cachedAt < TEMPLATE_CACHE_TTL_MS) {
    return cached.buffer;
  }

  const response = await fetch(cleanUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch template image from ${cleanUrl}: HTTP ${response.status}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  templateBufferCache.set(cacheKey, { buffer, cachedAt: Date.now() });
  return buffer;
}

/**
 * Dynamically composites a generated artwork image onto a Gelato product mockup template.
 *
 * @param {Object} options
 * @param {string} options.shop
 * @param {Object} options.mapping
 * @param {Buffer|string} options.artworkBufferOrKey - Either Buffer, storage key, or URL
 * @param {string} [options.appBaseUrl]
 * @returns {Promise<{ ok: boolean, key: string, url: string, width: number, height: number }>}
 */
export async function compositeProductMockup({
  shop,
  mapping,
  artworkBufferOrKey,
  appBaseUrl = "",
}) {
  if (!mapping) {
    throw new Error("Product mapping is required for mockup compositing");
  }

  // 1. Resolve product mockup template image dynamically
  let templateImageUrl = "";
  try {
    const resolvedImages = await resolveTemplateImages(mapping);
    if (resolvedImages && resolvedImages.length > 0) {
      templateImageUrl = resolvedImages[0];
    }
  } catch (err) {
    console.warn("[MOCKUP-COMPOSITE] Could not resolve template gallery images:", err.message);
  }

  if (!templateImageUrl) {
    templateImageUrl = toTrimmedString(mapping.shopifyProductImageUrl) || toTrimmedString(mapping.gelatoPreviewUrl);
  }

  if (!templateImageUrl) {
    throw new Error("No template image found for product mapping");
  }

  console.log(`[MOCKUP-COMPOSITE] 🖼️ Using mockup template: ${templateImageUrl.slice(0, 100)}...`);
  const templateBuffer = await getTemplateBuffer(templateImageUrl);
  if (!templateBuffer) {
    throw new Error("Failed to load template base buffer");
  }

  // 2. Resolve artwork buffer
  let artworkBuffer;
  if (Buffer.isBuffer(artworkBufferOrKey)) {
    artworkBuffer = artworkBufferOrKey;
  } else if (typeof artworkBufferOrKey === "string") {
    const trimmed = artworkBufferOrKey.trim();
    if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
      const resp = await fetch(trimmed);
      if (!resp.ok) throw new Error(`Failed to fetch artwork from ${trimmed}: HTTP ${resp.status}`);
      artworkBuffer = Buffer.from(await resp.arrayBuffer());
    } else {
      artworkBuffer = await readAsset(trimmed);
    }
  }

  if (!artworkBuffer) {
    throw new Error("No artwork buffer provided for mockup compositing");
  }

  // 3. Inspect metadata
  const tMeta = await sharp(templateBuffer).metadata();
  const tW = tMeta.width || 2048;
  const tH = tMeta.height || 2048;

  // 4. Determine placement and printable area
  const layers = asArray(mapping.layers);
  const uploadLayer = layers.find(
    (l) => l.type === "IMAGE" && (l.layerRole === "PHOTO" || l.isUpload),
  );

  let targetX, targetY, targetW, targetH;

  if (uploadLayer && uploadLayer.width > 0 && uploadLayer.height > 0) {
    targetX = Math.round(uploadLayer.x * tW);
    targetY = Math.round(uploadLayer.y * tH);
    targetW = Math.round(uploadLayer.width * tW);
    targetH = Math.round(uploadLayer.height * tH);
  } else if (mapping.printAreaX > 0 && mapping.printAreaSize > 0.08) {
    const areaSize = Number(mapping.printAreaSize) || 0.44;
    const ratio = (mapping.gelatoPlaceholderWidth && mapping.gelatoPlaceholderHeight)
      ? (mapping.gelatoPlaceholderWidth / mapping.gelatoPlaceholderHeight)
      : 0.68;

    targetW = Math.round(tW * areaSize);
    targetH = Math.round(targetW / ratio);
    targetX = Math.round(tW * Number(mapping.printAreaX));
    targetY = Math.round(tH * Number(mapping.printAreaY));
  } else {
    // Standard Gelato 11oz Ceramic Mug front-face printable area bounds
    // (verified on 2048x2048 high-res Gelato template renders)
    targetW = Math.round(tW * 0.38);
    targetH = Math.round(tH * 0.56);
    targetX = Math.round(tW * 0.35);
    targetY = Math.round(tH * 0.20);
  }

  // 5. Subtle edge radius mask for clean cylindrical integration
  const cornerRadius = Math.round(Math.min(targetW, targetH) * 0.015);
  const maskSvg = `<svg width="${targetW}" height="${targetH}">
    <rect x="0" y="0" width="${targetW}" height="${targetH}" rx="${cornerRadius}" ry="${cornerRadius}" fill="white" />
  </svg>`;
  const maskBuffer = await sharp(Buffer.from(maskSvg)).png().toBuffer();

  const preparedArtwork = await sharp(artworkBuffer)
    .resize(targetW, targetH, { fit: "cover", position: "center" })
    .composite([{ input: maskBuffer, blend: "dest-in" }])
    .toBuffer();

  // 6. Composite onto template
  const compositedBuffer = await sharp(templateBuffer)
    .composite([
      {
        input: preparedArtwork,
        left: Math.max(0, targetX),
        top: Math.max(0, targetY),
      },
    ])
    .jpeg({ quality: 92 })
    .toBuffer();

  // 7. Store asset and return signed URL
  const cleanShop = toTrimmedString(shop).replace(/[^a-zA-Z0-9_-]/g, "_");
  const key = await storeAsset(compositedBuffer, {
    mimeType: "image/jpeg",
    prefix: `mockups/${cleanShop}`,
  });

  const url = buildSignedAssetUrl(key, { baseUrl: appBaseUrl });

  console.log(`[MOCKUP-COMPOSITE] ✅ Generated composited product mockup: ${key}`);

  return {
    ok: true,
    key,
    url,
    width: tW,
    height: tH,
    buffer: compositedBuffer,
  };
}

