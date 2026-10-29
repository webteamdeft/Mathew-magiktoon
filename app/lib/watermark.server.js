/**
 * The MagikPik watermark on what the shopper is shown.
 *
 * Two marks, agreed with the client:
 *   - the AI artwork: a faint logo repeated diagonally across it, so it cannot
 *     be cropped off a screenshot;
 *   - the product previews: one small logo in a corner, so the mug still looks
 *     clean.
 *
 * Never the print file. The clean artwork is stored before any of this runs,
 * and the cart saves that stored copy, not the one on screen.
 *
 * Every function here returns its input unchanged if marking fails: a missing
 * watermark is better than a preview the shopper never sees.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** app/lib -> the repo root -> assets/watermark */
export const WATERMARK_LOGO_PATH = path.resolve(
  HERE,
  "..",
  "..",
  "assets",
  "watermark",
  "magikpik-white.png",
);

/** The artwork shown on screen is a copy; this wide is plenty for a preview. */
const DISPLAY_MAX_WIDTH = 1400;

let logoPromise = null;

function loadLogo() {
  if (!logoPromise) {
    logoPromise = fs.readFile(WATERMARK_LOGO_PATH).catch((error) => {
      logoPromise = null;
      throw error;
    });
  }
  return logoPromise;
}

/** The logo at `width` px, its alpha scaled by `opacity`. */
async function logoAt(width, opacity) {
  const { data, info } = await sharp(await loadLogo())
    .resize({ width: Math.max(1, Math.round(width)) })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  for (let i = 3; i < data.length; i += 4) data[i] = Math.round(data[i] * opacity);

  return sharp(data, { raw: info }).png().toBuffer();
}

/**
 * A soft dark copy of the logo, laid under the white one so the mark still
 * shows on white mugs and pale artwork.
 */
async function shadowOf(logo, opacity, blur) {
  const { data, info } = await sharp(logo).ensureAlpha().raw().toBuffer({ resolveWithObject: true });

  for (let i = 0; i < data.length; i += 4) {
    data[i] = 0;
    data[i + 1] = 0;
    data[i + 2] = 0;
    data[i + 3] = Math.round(data[i + 3] * opacity);
  }

  return sharp(data, { raw: info }).blur(blur).png().toBuffer();
}

/**
 * The AI artwork as shown on screen: scaled down, with the logo repeated
 * diagonally across it at low opacity. Returns a JPEG data URL.
 */
export async function watermarkArtworkDataUrl(buffer) {
  try {
    const { data: base, info } = await sharp(buffer)
      .rotate()
      .resize({ width: DISPLAY_MAX_WIDTH, withoutEnlargement: true })
      .flatten({ background: "#ffffff" })
      .png()
      .toBuffer({ resolveWithObject: true });
    const { width } = info;

    // One tile: the logo with space round it, tilted. Repeating the tile
    // covers the image whatever its shape.
    const logoWidth = width * 0.3;
    const logo = await logoAt(logoWidth, 0.22);
    const shadow = await shadowOf(logo, 0.35, 2);
    const logoHeight = (await sharp(logo).metadata()).height;

    const tileWidth = Math.round(logoWidth * 1.6);
    const tileHeight = Math.round(logoHeight * 3.2);
    const left = Math.round((tileWidth - logoWidth) / 2);
    const top = Math.round((tileHeight - logoHeight) / 2);

    const tile = await sharp({
      create: { width: tileWidth, height: tileHeight, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    })
      .composite([
        { input: shadow, left: left + 2, top: top + 2 },
        { input: logo, left, top },
      ])
      .png()
      .toBuffer();

    const tilted = await sharp(tile)
      .rotate(-30, { background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer();

    const marked = await sharp(base)
      .composite([{ input: tilted, tile: true, gravity: "northwest" }])
      .jpeg({ quality: 88 })
      .toBuffer();

    return `data:image/jpeg;base64,${marked.toString("base64")}`;
  } catch (error) {
    console.warn("[watermark] artwork left unmarked:", error?.message);
    return null;
  }
}

/**
 * A product preview with one small logo in the bottom-right corner. Keeps the
 * image's own format.
 */
export async function markPreviewCorner(buffer) {
  try {
    const image = sharp(buffer);
    const { width, height, format } = await image.metadata();
    if (!width || !height) return buffer;

    const logo = await logoAt(width * 0.16, 0.85);
    const shadow = await shadowOf(logo, 0.6, 3);
    const { width: logoWidth, height: logoHeight } = await sharp(logo).metadata();
    const margin = Math.round(width * 0.03);
    const left = Math.max(0, width - logoWidth - margin);
    const top = Math.max(0, height - logoHeight - margin);

    const marked = image.composite([
      { input: shadow, left: Math.min(left + 2, width - logoWidth), top: Math.min(top + 2, height - logoHeight) },
      { input: logo, left, top },
    ]);

    return format === "png" ? marked.png().toBuffer() : marked.jpeg({ quality: 90 }).toBuffer();
  } catch (error) {
    console.warn("[watermark] preview left unmarked:", error?.message);
    return buffer;
  }
}
