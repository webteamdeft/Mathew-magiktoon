/**
 * Print file compositor.
 *
 * WHY THIS EXISTS
 * ---------------
 * An order reaches Gelato as a bare catalog `productUid` plus one flat file.
 * Gelato support confirmed in writing that this is the whole story: "There is
 * no documented identifier that carries a template's composed design into the
 * order request", and there is no API for Personalization Studio. So the
 * template that produced the approved mockup is NOT applied to the order, and
 * the only way the printed item can match what the customer approved is for us
 * to build that file ourselves.
 *
 * WHAT IT DOES NOT SOLVE
 * ----------------------
 * A template can contribute assets we do not hold — the live 11oz mug template
 * declares a barcode graphic that exists only on Gelato's side, plus seven text
 * layers with no published font, size or position. For a design like that, no
 * file we build can be complete, and compositing would widen the gap with the
 * approved mockup rather than close it. That is why this is opt-in per
 * deployment (`PRINT_FILE_COMPOSITE`) rather than automatic: it is correct only
 * for designs reproducible from the artwork and background alone.
 *
 * A design with no configured print area is refused outright. See
 * `print-geometry.js` for why guessing one is dangerous.
 *
 * Server only: reads stored assets.
 */

// FIRST, and for its side effect only: it points fontconfig at the bundled
// design faces, and librsvg reads that configuration once, when sharp first
// draws text. Imported after sharp, the fonts would not be found and the wrong
// typeface would print without any error.
import { fontAvailability, primaryFamily } from "./fonts.server.js";

import sharpDefault from "sharp";

import { LAYER_TYPES, fixedImageLayers, normalizeLayers } from "./layers.js";
import { toTrimmedString } from "./normalize.js";
import { hasPrintArea, resolvePrintGeometry } from "./print-geometry.js";
import { unsuppliedImageLayers } from "./print-readiness.js";
import { readAsset, storeAsset } from "./storage.server.js";

export const PRINT_FILE_ERRORS = {
  NO_PRINT_AREA: "NO_PRINT_AREA",
  NO_ARTWORK: "NO_ARTWORK",
  UNREADABLE: "UNREADABLE",
  COMPOSE_FAILED: "COMPOSE_FAILED",
};

/**
 * Is the app allowed to build the print file itself at all?
 *
 * OFF by default, and that default is load-bearing — see the note above about
 * templates contributing assets we do not hold. Enabled per deployment, only
 * for designs proven reproducible from the artwork and background. Until then
 * the raw artwork is sent, which is what every existing order already does.
 */
export function printFileCompositingEnabled(env = process.env) {
  return toTrimmedString(env?.PRINT_FILE_COMPOSITE).toLowerCase() === "true";
}

/**
 * Is the app allowed to burn customer text into the print file?
 *
 * Off unless explicitly enabled. SOW 3.6 / FR-25 puts text through Gelato
 * Personalization Studio. Gelato has since confirmed no such API exists, which
 * means that clause cannot be satisfied as written — but changing it is the
 * Client's decision, so this stays a switch rather than a default.
 */
export function textCompositingEnabled(env = process.env) {
  return toTrimmedString(env?.PRINT_FILE_COMPOSITE_TEXT).toLowerCase() === "true";
}

/**
 * Is the app allowed to burn customer text into the ARTWORK, at generation?
 *
 * A different question from the one above, and deliberately a different switch.
 * Both draw the same wording; enabling both prints every field twice, which was
 * measured on the live mug design before these were separated.
 *
 * The print file is where text belongs, because only it knows the real print
 * geometry. Text drawn on the artwork is positioned against whatever shape the
 * model returned and is then cropped to fill the print area, so it cannot land
 * where the design intends.
 *
 * This exists only for showing the wording on the generated image itself,
 * before any mockup has been rendered. Off unless something needs that.
 */
export function generationTextCompositingEnabled(env = process.env) {
  return (
    toTrimmedString(env?.GENERATION_COMPOSITE_TEXT).toLowerCase() === "true"
  );
}

function escapeXml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

const SVG_ANCHOR = { left: "start", center: "middle", right: "end" };

/**
 * Draw the design's text layers as an SVG overlay the size of the print file.
 *
 * Layer coordinates are fractions, the same ones the storefront positions text
 * with, so the same numbers place it in the same place on the customer's
 * preview and on the file that prints.
 *
 * Those fractions address the SAFE area, not the whole sheet: the outer 4 mm is
 * trimmed away and the next 4 mm is where Gelato asks that nothing important
 * sits. Text is therefore inset by `safeInset` on every side.
 */
export function buildTextOverlaySvg(mapping, textValues, geometry) {
  if (!hasPrintArea(geometry)) return "";

  const values = textValues && typeof textValues === "object" ? textValues : {};

  const { width, height, safeInset = 0 } = geometry;

  const boxWidth = Math.max(1, width - safeInset * 2);
  const boxHeight = Math.max(1, height - safeInset * 2);

  const drawn = normalizeLayers(mapping?.layers)
    .filter((layer) => layer.type === LAYER_TYPES.TEXT)
    .map((layer) => {
      const content =
        toTrimmedString(values[layer.name]) || toTrimmedString(layer.text?.content);

      if (!content) return "";

      const fontSize = Math.max(1, Math.round(layer.text.fontSize * boxWidth));
      const anchor = SVG_ANCHOR[layer.text.align] || "middle";

      const left = safeInset + layer.x * boxWidth;
      const span = layer.width * boxWidth;

      const x =
        anchor === "start" ? left : anchor === "end" ? left + span : left + span / 2;

      // SVG places text on its baseline, not its top edge.
      const y = safeInset + layer.y * boxHeight + fontSize;

      const rotation = layer.rotation
        ? ` transform="rotate(${layer.rotation} ${x.toFixed(2)} ${y.toFixed(2)})"`
        : "";

      // A layer's own newlines become separate lines rather than one run with a
      // literal newline character in it.
      const lines = content.split(/\r?\n/);
      const lineHeight = fontSize * (layer.text.lineHeight || 1.2);

      const spans = lines
        .map(
          (line, index) =>
            `<tspan x="${x.toFixed(2)}" y="${(y + index * lineHeight).toFixed(2)}">` +
            `${escapeXml(line)}</tspan>`,
        )
        .join("");

      return (
        `<text font-family="${escapeXml(layer.text.fontFamily)}"` +
        ` font-size="${fontSize}"` +
        ` font-weight="${escapeXml(layer.text.weight)}"` +
        ` fill="${escapeXml(layer.text.color)}"` +
        ` text-anchor="${anchor}"${rotation}>${spans}</text>`
      );
    })
    .filter(Boolean);

  if (drawn.length === 0) return "";

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">` +
    drawn.join("") +
    `</svg>`
  );
}

/**
 * Draw the design's text onto a piece of artwork, at the artwork's own size.
 *
 * Distinct from the print file: no print area, no bleed, no resizing. The image
 * comes back the same pixel dimensions it went in as, with the wording over it,
 * so nothing is cropped, stretched or letterboxed.
 *
 * Returns the original buffer untouched when the design has no text to draw, so
 * a caller can use it unconditionally.
 */
export async function composeArtworkText(
  buffer,
  mapping,
  textValues,
  { sharp = sharpDefault } = {},
) {
  const meta = await sharp(buffer).metadata();

  if (!meta.width || !meta.height) return buffer;

  const svg = buildTextOverlaySvg(mapping, textValues, {
    // Not a print geometry: the artwork is the whole canvas, and the layer
    // fractions address it directly, which is what makes the result match the
    // preview the customer is looking at.
    source: "artwork",
    width: meta.width,
    height: meta.height,
    safeInset: 0,
  });

  if (!svg) return buffer;

  return sharp(buffer)
    .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
    .toColourspace("srgb")
    .png()
    .toBuffer();
}

/**
 * Build the file this design actually prints.
 *
 * Layers are stacked the way the mockup stacks them — background underneath,
 * artwork over it — and both cover the whole sheet, so no unprinted edge can
 * appear after trimming.
 *
 * Output is sRGB PNG carrying its DPI, which is what Gelato asks for.
 *
 * @returns {Promise<{ ok: boolean, key?: string, mimeType?: string,
 *                     width?: number, height?: number, bytes?: number,
 *                     geometry?: object, hasBackground?: boolean,
 *                     textComposited?: boolean, code?: string, error?: string }>}
 */
export async function composePrintFile(
  { shop, mapping, artworkKey, artworkBuffer, textValues },
  {
    read = readAsset,
    store = storeAsset,
    sharp = sharpDefault,
    env = process.env,
  } = {},
) {
  const geometry = resolvePrintGeometry(mapping);

  // Refusing is the whole point. A guessed print area produces a parcel that is
  // wrong in a way nobody can see until it arrives.
  if (!hasPrintArea(geometry)) {
    return {
      ok: false,
      code: PRINT_FILE_ERRORS.NO_PRINT_AREA,
      error:
        "This design has no print area configured. Read it from the product's " +
        'Gelato template PDF and record it on the design, for example "204x100mm".',
      geometry,
    };
  }

  const { width, height } = geometry;

  let artwork = artworkBuffer;

  if (!artwork) {
    const key = toTrimmedString(artworkKey);

    if (!key) {
      return {
        ok: false,
        code: PRINT_FILE_ERRORS.NO_ARTWORK,
        error: "This design has no artwork to print.",
      };
    }

    try {
      artwork = await read(key);
    } catch (error) {
      return {
        ok: false,
        code: PRINT_FILE_ERRORS.UNREADABLE,
        error: `The artwork could not be read: ${error.message}`,
      };
    }
  }

  // A background is optional throughout (SOW 3.5), so one we cannot read is
  // treated as absent rather than failing the order.
  let background = null;
  const backgroundKey = toTrimmedString(mapping?.backgroundImageKey);

  if (backgroundKey) {
    try {
      background = await read(backgroundKey);
    } catch {
      background = null;
    }
  }

  try {
    const layers = [];

    if (background) {
      layers.push({
        input: await sharp(background).resize(width, height, { fit: "cover" }).toBuffer(),
        top: 0,
        left: 0,
      });
    }

    layers.push({
      input: await sharp(artwork).resize(width, height, { fit: "cover" }).toBuffer(),
      top: 0,
      left: 0,
    });

    // Fixed image layers sit OVER the artwork: a logo, a barcode or a block of
    // set wording is part of the design, not something the customer's photo
    // should cover. Painted in the stack order the merchant arranged.
    //
    // Positioned against the same safe box as text, so the two agree. A layer
    // whose artwork cannot be read is recorded and skipped rather than failing
    // the order — an incomplete print is bad, no print at all is worse, and
    // either way the reason is on the record.
    const box = {
      width: Math.max(1, width - geometry.safeInset * 2),
      height: Math.max(1, height - geometry.safeInset * 2),
    };

    const missingLayers = [];

    for (const layer of fixedImageLayers(mapping?.layers)) {
      let artwork = null;

      try {
        artwork = await read(layer.imageKey);
      } catch {
        missingLayers.push(layer.name);
        continue;
      }

      const layerWidth = Math.max(1, Math.round(layer.width * box.width));
      const layerHeight = Math.max(1, Math.round(layer.height * box.height));

      let rendered = sharp(artwork).resize(layerWidth, layerHeight, {
        // "contain" because these are designed elements at a known shape;
        // cropping one to fill its box would cut the design.
        fit: "contain",
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      });

      if (layer.rotation) {
        rendered = rendered.rotate(layer.rotation, {
          background: { r: 0, g: 0, b: 0, alpha: 0 },
        });
      }

      layers.push({
        input: await rendered.toBuffer(),
        left: Math.round(geometry.safeInset + layer.x * box.width),
        top: Math.round(geometry.safeInset + layer.y * box.height),
      });
    }

    const withText = textCompositingEnabled(env);

    // A face the renderer cannot find is substituted silently — the same
    // wording in a different typeface, discovered on a parcel. Reported rather
    // than hidden.
    //
    // Measured, not inferred from the font being a web font: the files now ship
    // in assets/fonts, so on a host where fontconfig picks them up nothing is
    // substituted at all, and saying otherwise would be a false alarm on every
    // order.
    const availability = withText ? await fontAvailability(sharp) : null;

    const substitutedFonts = availability
      ? [
          ...new Set(
            normalizeLayers(mapping?.layers)
              .filter(
                (layer) =>
                  layer.type === LAYER_TYPES.TEXT &&
                  availability.missing.includes(primaryFamily(layer.text.fontFamily)),
              )
              .map((layer) => layer.text.fontFamily),
          ),
        ]
      : [];

    if (withText) {
      const svg = buildTextOverlaySvg(mapping, textValues, geometry);

      if (svg) layers.push({ input: Buffer.from(svg), top: 0, left: 0 });
    }

    const buffer = await sharp({
      create: {
        width,
        height,
        channels: 4,
        // Opaque white, not transparent white. A print file has no such thing
        // as "no colour": whatever the artwork does not cover is simply not
        // printed, and arrives as a bare band of ceramic down the side of the
        // mug. Artwork saved before this was fixed can be 25% opaque or less,
        // and a transparent sheet under it would have printed every one of
        // those gaps.
        //
        // White is the mug, so a gap now prints as the product rather than as a
        // defect, and `flatten` below guarantees it even if a layer arrives
        // with an alpha channel of its own.
        background: { r: 255, g: 255, b: 255, alpha: 1 },
      },
    })
      .composite(layers)
      .flatten({ background: { r: 255, g: 255, b: 255 } })
      .toColourspace("srgb")
      // Gelato reads the print size from the file, so the DPI has to travel
      // with it — a 300 DPI file tagged as 72 prints at four times the size.
      .withMetadata({ density: geometry.dpi })
      .png()
      .toBuffer();

    const key = await store(buffer, {
      mimeType: "image/png",
      prefix: `printfiles/${toTrimmedString(shop) || "shop"}`,
    });

    // Design elements Gelato declares but nobody has supplied. The file is
    // still produced — a mug printed without its barcode graphic beats an order
    // that never ships — but an incomplete print must never leave here looking
    // like a complete one.
    const unsupplied = unsuppliedImageLayers(mapping?.layers).map(
      (layer) => layer.label || layer.name,
    );

    if (unsupplied.length > 0) {
      console.warn(
        `[print-file] ${unsupplied.join(", ")} — no artwork supplied, so ` +
          "this element is absent from the print file.",
      );
    }

    return {
      ok: true,
      key,
      mimeType: "image/png",
      width,
      height,
      bytes: buffer.length,
      geometry,
      hasBackground: Boolean(background),
      fixedLayers: fixedImageLayers(mapping?.layers).length - missingLayers.length,
      missingLayers,
      unsuppliedLayers: unsupplied,
      complete: unsupplied.length === 0 && missingLayers.length === 0,
      textComposited: withText,
      substitutedFonts,
    };
  } catch (error) {
    return {
      ok: false,
      code: PRINT_FILE_ERRORS.COMPOSE_FAILED,
      error: `The print file could not be built: ${error.message}`,
    };
  }
}
