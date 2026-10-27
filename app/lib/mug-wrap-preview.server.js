/**
 * Step 4 stand-in preview: Gelato's own mockup photos of the design, with the
 * template's image layer swapped for the customer's generated image and any
 * text the customer edited rewritten in place. Everything else — the title,
 * the untouched text, the background — is Gelato's pixels, unchanged.
 *
 * Gelato's live render (`renderGelatoMockup`) is the real thing, but it can
 * take minutes, or not start at all when Gelato's queue is backed up. These
 * images are shown straight away and replaced by the live render if it lands.
 *
 * How: Gelato's API gives placeholder sizes but not positions, so positions
 * are read off the mockups themselves. The three angles of an 11oz mug
 * (handle left, back, handle right) are unrolled into one flat picture of the
 * print; in that flat picture the image layer is found (templates repeat it on
 * both sides) and so is each default text. The changes are drawn flat and
 * rolled back onto each photo. The template analysis is cached; a preview
 * only draws and projects.
 *
 * SERVER ONLY.
 */

import sharp from "sharp";
import { resolveTemplateImages } from "./gelato-preview.server.js";
import { readAsset, storeAsset } from "./storage.server.js";
import { asArray, toTrimmedString } from "./normalize.js";

/** Working width of each view; Gelato's originals are 2000px and up. */
const VIEW_WIDTH = 1000;

/** Flat print: an 11oz mug's wrap, 96mm tall, unrolled at a fixed scale. */
const FLAT_W = 1600;
const FLAT_H = Math.round((FLAT_W * 96) / 230);
const FLAT_ANGLE = 230 / 41; // radians of the body the flat picture spans

/** Where each angle's camera faces, as a wrap angle (0 = middle of the back). */
const SCENE_FACING = { left: -Math.PI / 2, back: 0, right: Math.PI / 2 };

/** The slider's order, as in the merchant's Gelato mockup selection. */
const SCENE_ORDER = ["left", "back", "right"];

/** How far the base's ellipse rises at the sides, as a fraction of the image. */
const BASE_CURVE = 0.025;

/** Usual framing per angle, for when a body cannot be measured. */
const SCENES = {
  right: { left: 0.225, right: 0.69, top: 0.215, bottom: 0.785 },
  left: { left: 0.3, right: 0.775, top: 0.215, bottom: 0.785 },
  back: { left: 0.295, right: 0.695, top: 0.225, bottom: 0.775 },
};

const analysisCache = new Map();
const ANALYSIS_TTL_MS = 6 * 60 * 60 * 1000;

function escapeXml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Which angle a view is, from where its handle is.
 *
 * In each angle there is a band beside the body that is the handle in one
 * angle and plain backdrop in the others. Measured against the backdrop at
 * the image edge, a handle of any colour stands out by 20+, backdrop by <5.
 */
export async function detectScene(buffer) {
  const size = 200;
  const { data } = await sharp(buffer)
    .resize(size, size, { fit: "fill" })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const difference = (x0, x1, referenceX) => {
    let sum = 0;
    let count = 0;

    for (let y = 70; y < 130; y += 1) {
      const r = (y * size + referenceX) * 3;

      for (let x = x0; x < x1; x += 1) {
        const p = (y * size + x) * 3;
        sum +=
          Math.abs(data[p] - data[r]) +
          Math.abs(data[p + 1] - data[r + 1]) +
          Math.abs(data[p + 2] - data[r + 2]);
        count += 1;
      }
    }

    return sum / count;
  };

  const leftBand = difference(24, 42, 4);
  const rightBand = difference(158, 172, size - 5);
  const floor = 10;

  if (rightBand > floor && rightBand > leftBand * 2.5) return "right";
  if (leftBand > floor && leftBand > rightBand * 2.5) return "left";
  return "back";
}

/**
 * Where the mug body is in this particular view, as fractions of the image.
 *
 * Gelato frames each colour variant slightly differently. The body is the
 * widest run of columns whose first non-backdrop pixel from the top is the
 * rim (the handle starts lower, the backdrop never).
 */
export async function detectBody(buffer, sceneName) {
  const size = 400;
  const fallback = SCENES[sceneName];
  const { data } = await sharp(buffer)
    .resize(size, size, { fit: "fill" })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const differs = (x, y) => {
    const p = (y * size + x) * 3;
    const r = (y * size + 2) * 3;
    return (
      Math.abs(data[p] - data[r]) +
        Math.abs(data[p + 1] - data[r + 1]) +
        Math.abs(data[p + 2] - data[r + 2]) >
      18
    );
  };

  const tops = [];
  for (let x = 0; x < size; x += 1) {
    let top = -1;
    for (let y = Math.round(size * 0.08); y < size * 0.5; y += 1) {
      if (differs(x, y)) {
        top = y / size;
        break;
      }
    }
    tops.push(top);
  }

  let best = [0, 0];
  let start = -1;

  for (let x = 0; x <= size; x += 1) {
    const isBody = x < size && tops[x] > 0.12 && tops[x] < 0.26;

    if (isBody && start < 0) start = x;

    if (!isBody && start >= 0) {
      if (x - start > best[1] - best[0]) best = [start, x];
      start = -1;
    }
  }

  const left = best[0] / size;
  const right = best[1] / size;
  const centre = Math.round((best[0] + best[1]) / 2);

  let bottom = -1;
  for (let y = Math.round(size * 0.95); y > size * 0.6; y -= 1) {
    if (differs(centre, y)) {
      bottom = y / size;
      break;
    }
  }

  if (right - left < 0.3 || right - left > 0.65 || bottom < 0) {
    return fallback;
  }

  // The print starts just below the rim's front edge.
  return { left, right, top: tops[centre] + 0.025, bottom };
}

/** Pixel geometry of one view, for mapping between it and the flat print. */
function geometryOf(body, width, height, facing) {
  const x0 = body.left * width;
  const x1 = body.right * width;

  return {
    x0,
    x1,
    y0: body.top * height,
    y1: body.bottom * height,
    cx: (x0 + x1) / 2,
    radius: (x1 - x0) / 2,
    facing,
    // The camera sits a little above the mug, so a ring around it shows as
    // an ellipse: a row rises by up to this many pixels toward the sides.
    ellipse: BASE_CURVE * height,
  };
}

/** View row of a flat row, at a column facing the camera by `cos` (0..1). */
function rowInView(geometry, fy, cos) {
  return (
    geometry.y0 +
    ((fy + 0.5) / FLAT_H) * (geometry.y1 - geometry.y0) -
    geometry.ellipse * (1 - cos)
  );
}

/** View column → flat column, or -1 when off the body. */
function flatColumnOf(geometry, x) {
  const s = (x + 0.5 - geometry.cx) / geometry.radius;
  if (s <= -1 || s >= 1) return -1;
  const u = 0.5 + (geometry.facing + Math.asin(s)) / FLAT_ANGLE;
  return u >= 0 && u < 1 ? u * FLAT_W : -1;
}

/** Flat column → view column, and how squarely that column faces the camera. */
function viewColumnOf(geometry, flatX) {
  const angle = ((flatX + 0.5) / FLAT_W - 0.5) * FLAT_ANGLE - geometry.facing;
  return { x: geometry.cx + geometry.radius * Math.sin(angle), facing: Math.cos(angle) };
}

/** Unroll part of one view into flat columns [from, to). */
function unrollColumns(view, from, to, minFacing = 0.35) {
  const { data, width, geometry } = view;
  const columns = new Map();

  for (let fx = from; fx < to; fx += 1) {
    const { x, facing } = viewColumnOf(geometry, fx);
    if (facing < minFacing) continue;

    const column = new Uint8Array(FLAT_H * 3);
    const vx = Math.round(x);

    for (let fy = 0; fy < FLAT_H; fy += 1) {
      const vy = Math.max(0, Math.min(view.height - 1, Math.round(rowInView(geometry, fy, facing))));
      const o = (vy * width + vx) * 3;
      column[fy * 3] = data[o];
      column[fy * 3 + 1] = data[o + 1];
      column[fy * 3 + 2] = data[o + 2];
    }

    columns.set(fx, { column, facing });
  }

  return columns;
}

/**
 * Fine-tune where a side view's camera faces, so its unrolled columns land on
 * the same flat columns as the back view's. Without this, text near the seam
 * between two angles appears twice and a patch misses it on one of them.
 */
function calibrateFacing(view, back) {
  if (!back) return;

  const reference = unrollColumns(back, 0, FLAT_W, 0.25);
  const nominal = view.geometry.facing;
  let best = { facing: nominal, score: Infinity };

  for (let offset = -0.35; offset <= 0.35; offset += 0.01) {
    view.geometry.facing = nominal + offset;

    const mine = unrollColumns(view, 0, FLAT_W, 0.25);
    let sum = 0;
    let count = 0;

    for (const [fx, { column }] of mine) {
      const other = reference.get(fx);
      if (!other) continue;

      for (let i = 0; i < column.length; i += 9) {
        sum += Math.abs(column[i] - other.column[i]);
        count += 1;
      }
    }

    // Too little overlap to judge is not a match.
    const score = count > FLAT_H * 10 ? sum / count : Infinity;
    if (score < best.score) best = { facing: view.geometry.facing, score };
  }

  view.geometry.facing = best.facing;

  // Then how far rows curve: text near the sides of a side view sits higher
  // than the flat model puts it, by up to the ellipse of a ring.
  const score = () => {
    const mine = unrollColumns(view, 0, FLAT_W, 0.25);
    let sum = 0;
    let count = 0;

    for (const [fx, { column }] of mine) {
      const other = reference.get(fx);
      if (!other) continue;

      for (let i = 0; i < column.length; i += 3) {
        sum += Math.abs(column[i] - other.column[i]);
        count += 1;
      }
    }

    return count > FLAT_H * 10 ? sum / count : Infinity;
  };

  let bestEllipse = { ellipse: view.geometry.ellipse, score: Infinity };
  for (let e = 0; e <= view.height * 0.08; e += 1) {
    view.geometry.ellipse = e;
    const result = score();
    if (result < bestEllipse.score) bestEllipse = { ellipse: e, score: result };
  }
  view.geometry.ellipse = bestEllipse.ellipse;

  // And settle the angle again now the rows line up.
  const settled = view.geometry.facing;
  let bestFacing = { facing: settled, score: Infinity };
  for (let offset = -0.06; offset <= 0.06; offset += 0.005) {
    view.geometry.facing = settled + offset;
    const result = score();
    if (result < bestFacing.score) bestFacing = { facing: view.geometry.facing, score: result };
  }
  view.geometry.facing = bestFacing.facing;
}

/** The whole print, each column from the angle that sees it most squarely. */
function buildFlat(views) {
  const flat = new Uint8Array(FLAT_W * FLAT_H * 3);
  const seen = new Float32Array(FLAT_W);

  for (const view of views) {
    for (const [fx, { column, facing }] of unrollColumns(view, 0, FLAT_W)) {
      if (facing <= seen[fx]) continue;
      seen[fx] = facing;

      for (let fy = 0; fy < FLAT_H; fy += 1) {
        const f = (fy * FLAT_W + fx) * 3;
        flat[f] = column[fy * 3];
        flat[f + 1] = column[fy * 3 + 1];
        flat[f + 2] = column[fy * 3 + 2];
      }
    }
  }

  return { flat, seen };
}

function luminanceOf(flat) {
  const lum = new Float32Array(FLAT_W * FLAT_H);
  for (let i = 0; i < lum.length; i += 1) {
    lum[i] = 0.299 * flat[i * 3] + 0.587 * flat[i * 3 + 1] + 0.114 * flat[i * 3 + 2];
  }
  return lum;
}

/**
 * Where the image layer is in the flat print.
 *
 * Gelato mug templates place the same image on both sides, symmetric about
 * the middle of the back. The spacing of the two copies is the horizontal
 * shift at which the print best matches itself. Their outer ends run behind
 * the handle, out of every view, so the width is read at the inner ends
 * instead: where image meets the panel between them, which is the strongest
 * vertical edge near where the placeholder's own shape puts it.
 */
export function findImageSlots(lum, seen, slotWidth) {
  const rowStep = 4;
  const valid = (fx) => fx >= 0 && fx < FLAT_W && seen[fx] > 0;

  let best = null;

  for (let shift = Math.round(slotWidth * 0.9); shift < FLAT_W * 0.8; shift += 4) {
    let diff = 0;
    let count = 0;

    for (let fx = 0; fx + shift < FLAT_W; fx += 4) {
      if (!valid(fx) || !valid(fx + shift)) continue;
      for (let fy = 0; fy < FLAT_H; fy += rowStep * 2) {
        diff += Math.abs(lum[fy * FLAT_W + fx] - lum[fy * FLAT_W + fx + shift]);
        count += 1;
      }
    }

    // Too little overlap to judge is not a match.
    if (count < (slotWidth / 4) * (FLAT_H / (rowStep * 2)) * 0.5) continue;

    const score = diff / count;
    if (!best || score < best.score) best = { shift, score };
  }

  if (!best || best.score > 40) return null;

  const middle = FLAT_W / 2;
  const leftCentre = middle - best.shift / 2;
  const rightCentre = middle + best.shift / 2;

  // How consistently a column is a vertical edge: the share of rows where the
  // strips just either side of it differ. A panel boundary runs the full
  // height; a line of text crosses only a few rows.
  const edgeAt = (fx) => {
    if (!valid(fx - 8) || !valid(fx + 8)) return 0;
    let rows = 0;
    let count = 0;
    for (let fy = 0; fy < FLAT_H; fy += rowStep) {
      let before = 0;
      let after = 0;
      for (let k = 2; k <= 8; k += 2) {
        before += lum[fy * FLAT_W + fx - k];
        after += lum[fy * FLAT_W + fx + k];
      }
      if (Math.abs(before - after) / 4 > 10) rows += 1;
      count += 1;
    }
    return rows / count;
  };

  // Without a clear boundary (an image on the same white as the panel), the
  // placeholder's shape decides; this is where it lands on Gelato's mugs.
  let half = slotWidth * 0.535;
  let strongest = 0.6;

  // The search spans what the measured spacing allows, not the placeholder
  // size: a background layer can make the printed panel wider than it.
  for (let h = best.shift * 0.25; h < best.shift * 0.5; h += 2) {
    const strength =
      (edgeAt(Math.round(leftCentre + h)) + edgeAt(Math.round(rightCentre - h))) / 2;
    if (strength > strongest) {
      strongest = strength;
      half = h;
    }
  }

  return [
    { x0: Math.max(0, leftCentre - half), x1: leftCentre + half },
    { x0: rightCentre - half, x1: Math.min(FLAT_W, rightCentre + half) },
  ];
}

/**
 * Ink boxes in the flat print outside the image layer: words, grouped into
 * lines, as candidate positions for the template's text.
 */
function inkWords(lum, seen, slots, vertical) {
  // Work in a frame where text runs left to right.
  const W = vertical ? FLAT_H : FLAT_W;
  const H = vertical ? FLAT_W : FLAT_H;
  // Vertical text reads top to bottom, letters turned clockwise: the frame's
  // x runs down the flat print and its y runs right to left across it.
  const at = (x, y) => (vertical ? lum[x * FLAT_W + (FLAT_W - 1 - y)] : lum[y * FLAT_W + x]);
  const flatX = (x, y) => (vertical ? FLAT_W - 1 - y : x);
  const inSlot = (fx) => slots.some((slot) => fx >= slot.x0 - 4 && fx < slot.x1 + 4);

  // Ink: clearly darker than the local background, taken as a high
  // percentile of a neighbourhood wide enough that even a large bold title
  // does not fill it.
  const ink = new Uint8Array(W * H);
  const block = 32;
  const reach = 96;

  for (let by = 0; by < H; by += block) {
    for (let bx = 0; bx < W; bx += block) {
      const values = [];
      for (let y = Math.max(0, by - reach); y < Math.min(H, by + block + reach); y += 4) {
        for (let x = Math.max(0, bx - reach); x < Math.min(W, bx + block + reach); x += 4) {
          values.push(at(x, y));
        }
      }
      values.sort((a, b) => a - b);
      const background = values[Math.floor(values.length * 0.9)];

      for (let y = by; y < Math.min(H, by + block); y += 1) {
        for (let x = bx; x < Math.min(W, bx + block); x += 1) {
          const fx = flatX(x, y);
          if (seen[fx] <= 0 || inSlot(fx)) continue;
          if (at(x, y) < background - 70) ink[y * W + x] = 1;
        }
      }
    }
  }

  // Connected components (4-neighbour) of ink.
  const label = new Int32Array(W * H).fill(-1);
  const components = [];

  for (let i = 0; i < ink.length; i += 1) {
    if (!ink[i] || label[i] >= 0) continue;

    const box = { x0: W, y0: H, x1: 0, y1: 0, pixels: 0 };
    const stack = [i];
    label[i] = components.length;

    while (stack.length) {
      const j = stack.pop();
      const x = j % W;
      const y = (j - x) / W;
      box.x0 = Math.min(box.x0, x);
      box.y0 = Math.min(box.y0, y);
      box.x1 = Math.max(box.x1, x + 1);
      box.y1 = Math.max(box.y1, y + 1);
      box.pixels += 1;

      for (const k of [j - 1, j + 1, j - W, j + W]) {
        if (k < 0 || k >= ink.length || !ink[k] || label[k] >= 0) continue;
        if ((k === j - 1 && x === 0) || (k === j + 1 && x === W - 1)) continue;
        label[k] = components.length;
        stack.push(k);
      }
    }

    if (box.pixels >= 6 && box.y1 - box.y0 >= 4) components.push(box);
  }

  // Letters → words: side by side, overlapping vertically, close together.
  components.sort((a, b) => a.x0 - b.x0);
  const words = [];

  for (const c of components) {
    const height = c.y1 - c.y0;
    const word = words.find((w) => {
      const overlap = Math.min(w.y1, c.y1) - Math.max(w.y0, c.y0);
      const lineHeight = Math.max(w.y1 - w.y0, height);
      return overlap > lineHeight * 0.4 && c.x0 - w.x1 < lineHeight * 0.35 && c.x0 >= w.x0;
    });

    if (word) {
      word.x0 = Math.min(word.x0, c.x0);
      word.y0 = Math.min(word.y0, c.y0);
      word.x1 = Math.max(word.x1, c.x1);
      word.y1 = Math.max(word.y1, c.y1);
      word.letters += 1;
    } else {
      words.push({ ...c, letters: 1 });
    }
  }

  return words.map((w) => ({ ...w, vertical }));
}

/** Above this a text match is too poor to trust (about 0.4 likeness). */
const MAX_TEXT_SCORE = 2.2;

/** Size candidate crops and rendered text are compared at, per line. */
const SAMPLE_W = 96;
const SAMPLE_LINE_H = 24;

/** A string set in the preview font, trimmed to its ink. */
async function setText(text, align = "start") {
  const lines = String(text).split("\n");
  const size = 100;
  const width = size * 20;
  // Lines of a block share a left edge, a centre or a right edge.
  const x = align === "end" ? width - 10 : align === "middle" ? width / 2 : 10;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${size * 1.4 * lines.length + size}">` +
    `<g font-family="${FONT}" font-weight="700" font-size="${size}" fill="#000" text-anchor="${align}">` +
    lines.map((line, i) => `<text x="${x}" y="${size * (1 + i * 1.25)}">${escapeXml(line)}</text>`).join("") +
    `</g></svg>`;

  const trimmed = await sharp(Buffer.from(svg))
    .flatten({ background: "#fff" })
    .trim({ threshold: 40 })
    .toBuffer({ resolveWithObject: true });

  const sample = await sharp(trimmed.data)
    .greyscale()
    .resize(SAMPLE_W, SAMPLE_LINE_H * lines.length, { fit: "fill" })
    .raw()
    .toBuffer();

  return { aspect: trimmed.info.width / trimmed.info.height, sample };
}

/**
 * The text broken into `lines` lines, the way a text box narrower than the
 * wording wraps it: its own line breaks stay, and the longest line is split
 * at the word nearest its middle until there are enough ("Effortless grace,
 * / unforgettable presence" prints as "Effortless grace, / unforgettable /
 * presence").
 */
function rewrap(text, lines) {
  const out = String(text)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  while (out.length < lines) {
    let longest = -1;
    out.forEach((line, index) => {
      if (/\s/.test(line) && (longest < 0 || line.length > out[longest].length)) longest = index;
    });
    if (longest < 0) break;

    const words = out[longest].split(/\s+/);
    const half = out[longest].length / 2;
    let split = 1;
    let bestDistance = Infinity;
    for (let i = 1; i < words.length; i += 1) {
      const distance = Math.abs(words.slice(0, i).join(" ").length - half);
      if (distance < bestDistance) {
        bestDistance = distance;
        split = i;
      }
    }

    out.splice(longest, 1, words.slice(0, split).join(" "), words.slice(split).join(" "));
  }

  return out.join("\n");
}

/** How a string sets in the preview font: width per unit of cap height. */
async function aspectOf(text) {
  return (await setText(text)).aspect;
}

/** Normalised correlation of two equal-sized greyscale samples, -1..1. */
function correlation(a, b) {
  let meanA = 0;
  let meanB = 0;
  for (let i = 0; i < a.length; i += 1) {
    meanA += a[i];
    meanB += b[i];
  }
  meanA /= a.length;
  meanB /= b.length;

  let cross = 0;
  let varA = 0;
  let varB = 0;
  for (let i = 0; i < a.length; i += 1) {
    const da = a[i] - meanA;
    const db = b[i] - meanB;
    cross += da * db;
    varA += da * da;
    varB += db * db;
  }

  return varA > 0 && varB > 0 ? cross / Math.sqrt(varA * varB) : 0;
}

/** A flat box's pixels as a sample, turned so its text reads left to right. */
async function sampleOf(lum, box, lines) {
  const x0 = Math.max(0, Math.floor(box.x0));
  const y0 = Math.max(0, Math.floor(box.y0));
  const w = Math.max(1, Math.min(FLAT_W, Math.ceil(box.x1)) - x0);
  const h = Math.max(1, Math.min(FLAT_H, Math.ceil(box.y1)) - y0);
  const crop = Buffer.alloc(w * h);

  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      crop[y * w + x] = lum[(y0 + y) * FLAT_W + x0 + x];
    }
  }

  return sharp(crop, { raw: { width: w, height: h, channels: 1 } })
    .rotate(box.vertical ? -90 : 0)
    .resize(SAMPLE_W, SAMPLE_LINE_H * lines, { fit: "fill" })
    // Without this sharp hands back three channels, and the comparison with
    // the one-channel rendered text would read past its end.
    .greyscale()
    .raw()
    .toBuffer();
}

const FONT = "Playfair Display, Didot, Bodoni MT, Georgia, 'Times New Roman', serif";

/**
 * Where each default text sits in the flat print.
 *
 * Candidates are runs of words on one line (and stacks of lines, for text
 * with line breaks), horizontal or vertical. The winner is the one that,
 * compared pixel for pixel, looks most like the default text set in a similar
 * face — which tells "CARLA" from "Effortl" where outline alone would not.
 */
async function locateTexts(lum, seen, slots, placeholders) {
  const words = [
    ...inkWords(lum, seen, slots, false),
    ...inkWords(lum, seen, slots, true),
  ];

  // Words on the same line, in reading order. Measured against the line as a
  // whole — its full height and its rightmost ink — not the last word added:
  // a dot or a letter's counter between two words would otherwise split
  // "TIMELESS STYLE" into two lines and neither would match.
  const sameLine = (l, box) => {
    const height = Math.max(l.y1 - l.y0, box.y1 - box.y0);
    const overlap = Math.min(l.y1, box.y1) - Math.max(l.y0, box.y0);
    return (
      l.vertical === box.vertical &&
      overlap > Math.min(l.y1 - l.y0, box.y1 - box.y0) * 0.5 &&
      box.x0 - l.x1 < height * 1.5 &&
      l.x0 - box.x1 < height * 1.5
    );
  };

  let lines = [];
  for (const word of words.sort((a, b) => a.x0 - b.x0)) {
    const line = lines.find((l) => sameLine(l, word));
    if (line) {
      line.words.push(word);
      line.x0 = Math.min(line.x0, word.x0);
      line.x1 = Math.max(line.x1, word.x1);
      line.y0 = Math.min(line.y0, word.y0);
      line.y1 = Math.max(line.y1, word.y1);
    } else {
      lines.push({ vertical: word.vertical, x0: word.x0, x1: word.x1, y0: word.y0, y1: word.y1, words: [word] });
    }
  }

  // Lines that only met once both had grown are one line.
  for (let merged = true; merged; ) {
    merged = false;
    for (let i = 0; i < lines.length && !merged; i += 1) {
      for (let j = i + 1; j < lines.length && !merged; j += 1) {
        if (!sameLine(lines[i], lines[j])) continue;
        const a = lines[i];
        const b = lines[j];
        lines[i] = {
          vertical: a.vertical,
          x0: Math.min(a.x0, b.x0),
          x1: Math.max(a.x1, b.x1),
          y0: Math.min(a.y0, b.y0),
          y1: Math.max(a.y1, b.y1),
          words: [...a.words, ...b.words].sort((p, q) => p.x0 - q.x0),
        };
        lines = lines.filter((_, k) => k !== j);
        merged = true;
      }
    }
  }

  const lettersIn = (run) => run.reduce((sum, word) => sum + word.letters, 0);

  const candidates = [];
  for (const line of lines) {
    for (let i = 0; i < line.words.length; i += 1) {
      for (let j = i; j < line.words.length; j += 1) {
        const run = line.words.slice(i, j + 1);
        candidates.push({
          vertical: line.vertical,
          lines: 1,
          letters: lettersIn(run),
          x0: run[0].x0,
          x1: run[run.length - 1].x1,
          y0: Math.min(...run.map((w) => w.y0)),
          y1: Math.max(...run.map((w) => w.y1)),
        });
      }
    }
  }

  // Stacks of whole lines, for multi-line text.
  const wholeLines = lines
    .map((l) => ({
      vertical: l.vertical,
      letters: lettersIn(l.words),
      x0: l.words[0].x0,
      x1: l.words[l.words.length - 1].x1,
      y0: l.y0,
      y1: l.y1,
    }))
    .sort((a, b) => a.y0 - b.y0);

  for (let i = 0; i < wholeLines.length; i += 1) {
    let stack = { ...wholeLines[i], lines: 1 };
    for (let j = i + 1; j < wholeLines.length && stack.lines < 4; j += 1) {
      const next = wholeLines[j];
      const height = next.y1 - next.y0;
      const overlapX = Math.min(stack.x1, next.x1) - Math.max(stack.x0, next.x0);
      if (next.vertical !== stack.vertical || next.y0 - stack.y1 > height * 1.2 || overlapX <= 0) break;
      stack = {
        vertical: stack.vertical,
        lines: stack.lines + 1,
        letters: stack.letters + next.letters,
        x0: Math.min(stack.x0, next.x0),
        x1: Math.max(stack.x1, next.x1),
        y0: stack.y0,
        y1: next.y1,
      };
      candidates.push({ ...stack });
    }
  }

  const found = {};

  for (const placeholder of placeholders) {
    const text = toTrimmedString(placeholder.defaultText);
    if (!text) continue;

    const lineCount = text.split("\n").length;
    // Punctuation is often too small to count as a letter.
    const expectedLetters = text.replace(/[^\p{L}\p{N}]/gu, "").length;
    let best = null;

    // Gelato wraps long lines to fit the text box, so a two-line default can
    // print as three. The text is compared as it would wrap to the candidate's
    // line count.
    const settings = new Map();
    const setAs = async (lines, align) => {
      const key = `${lines}:${align}`;
      if (!settings.has(key)) settings.set(key, await setText(rewrap(text, lines), align));
      return settings.get(key);
    };

    for (const c of candidates) {
      if (!expectedLetters) continue;
      if (c.lines < lineCount || c.lines > (lineCount > 1 ? lineCount + 2 : 1)) continue;

      const shapeOf = await setAs(c.lines, "start");
      const shapeError = Math.abs(Math.log((c.x1 - c.x0) / (c.y1 - c.y0) / shapeOf.aspect));
      const letterError = Math.abs(Math.log(c.letters / expectedLetters));
      if (shapeError >= 0.5) continue;

      // Shape narrows it down; what the ink looks like decides. Letter count
      // only nudges: serif letters that touch merge into one blob. A block of
      // several lines is compared left-, centre- and right-aligned, since its
      // ragged edge is as much a part of how it looks as its letters.
      const box = toFlatBox(c);
      const sample = await sampleOf(lum, box, c.lines);
      const alignments = c.lines > 1 ? ["start", "middle", "end"] : ["middle"];
      let likeness = -1;
      let align = "middle";
      for (const option of alignments) {
        const value = correlation(sample, (await setAs(c.lines, option)).sample);
        if (value > likeness) {
          likeness = value;
          align = option;
        }
      }

      const score = shapeError + letterError * 0.3 + (1 - likeness) * 3;
      if (!best || score < best.score) best = { ...box, align, score };
    }

    // A weak match is no match: better to leave the template's wording than
    // to paint the customer's over something else.
    if (best && best.score < MAX_TEXT_SCORE) found[placeholder.name] = best;
  }

  // Gelato's mockups are sometimes rendered with other wording than the
  // template's defaults ("Jitesh & Mitra" for "Chris & Amanda"), so none of
  // the defaults is there to find. Then the layout decides: the prominent
  // lines on the panel, in reading order, are the text fields in order — but
  // only when the counts agree, never as a guess.
  const withText = placeholders.filter((p) => toTrimmedString(p.defaultText));
  if (Object.keys(found).length === 0 && withText.length > 0) {
    const byLayout = textLinesInOrder(words, slots, withText.length);
    if (byLayout) {
      withText.forEach((placeholder, index) => {
        found[placeholder.name] = { ...byLayout[index], byLayout: true };
      });
    }
  }

  return found;
}

/**
 * The panel's prominent text lines in reading order, as flat boxes — exactly
 * `count` of them, or null. "Prominent" is at least half the height of the
 * tallest line, which leaves out small print such as a logo's caption.
 */
function textLinesInOrder(words, slots, count) {
  const panel =
    slots.length === 2 ? { x0: slots[0].x1, x1: slots[1].x0 } : { x0: 0, x1: FLAT_W };
  const margin = 10;

  for (const vertical of [false, true]) {
    // Words in the panel, in the text-runs-left-to-right frame. Anything
    // touching the panel's sides or the rim is a seam or an edge, not text.
    const inPanel = words
      .filter((word) => word.vertical === vertical && word.y1 - word.y0 >= 12)
      .filter((word) => {
        const box = toFlatBox({ ...word, lines: 1 });
        return (
          box.x0 > panel.x0 + margin &&
          box.x1 < panel.x1 - margin &&
          box.y0 > margin &&
          box.y1 < FLAT_H - margin
        );
      })
      .sort((a, b) => (a.y0 + a.y1) / 2 - (b.y0 + b.y1) / 2);

    // Words whose middles share a band make one line, whatever their letters'
    // heights ("J" drops below the line, "e" stops short of it).
    const lines = [];
    for (const word of inPanel) {
      const middle = (word.y0 + word.y1) / 2;
      const line = lines.find((l) => middle >= l.y0 && middle <= l.y1);
      if (line) {
        line.x0 = Math.min(line.x0, word.x0);
        line.x1 = Math.max(line.x1, word.x1);
        line.y0 = Math.min(line.y0, word.y0);
        line.y1 = Math.max(line.y1, word.y1);
      } else {
        lines.push({ vertical, x0: word.x0, x1: word.x1, y0: word.y0, y1: word.y1 });
      }
    }

    if (lines.length === 0) continue;

    const tallest = Math.max(...lines.map((l) => l.y1 - l.y0));
    const prominent = lines.filter((l) => l.y1 - l.y0 >= tallest * 0.5);

    if (prominent.length !== count) continue;

    // In reading order: down the frame, which for vertical text is right to
    // left across the flat print.
    return prominent
      .sort((a, b) => a.y0 - b.y0)
      .map((line) => toFlatBox({ ...line, lines: 1 }));
  }

  return null;
}

/** A box found in the text-runs-left-to-right frame, back in flat pixels. */
function toFlatBox(box) {
  if (!box.vertical) return { ...box };

  // Vertical frame: x runs down the flat print, y runs right to left.
  return {
    vertical: true,
    lines: box.lines,
    x0: FLAT_W - box.y1,
    x1: FLAT_W - box.y0,
    y0: box.x0,
    y1: box.x1,
  };
}

/**
 * Read a template off its mockups: one view per angle, their geometry, the
 * flat print, and where the image layer and each default text are.
 */
async function analyseTemplate(mapping, urls, fetchImpl) {
  const loaded = (
    await Promise.all(
      urls.map(async (url) => {
        try {
          const response = await fetchImpl(url);
          if (!response.ok) return null;
          const buffer = Buffer.from(await response.arrayBuffer());
          return { buffer, scene: await detectScene(buffer) };
        } catch (error) {
          console.warn("[mug-wrap] view failed:", error?.message);
          return null;
        }
      }),
    )
  ).filter(Boolean);

  // One view per angle. The gallery handed in has already been narrowed to the
  // shopper's own variant where Gelato attributes its shots, so the first of
  // each angle is that colourway's. Where it could not be narrowed — an
  // unattributed gallery, or a variant Gelato has no shots for — this is still
  // the primary colour, and the preview can show a colour the shopper did not
  // choose. The cure for that is in Gelato: publish each angle per variant.
  const picked = SCENE_ORDER.map((scene) => loaded.find((view) => view.scene === scene)).filter(
    Boolean,
  );

  const views = await Promise.all(
    picked.map(async ({ buffer, scene }) => {
      const body = await detectBody(buffer, scene);
      const { data, info } = await sharp(buffer)
        .resize({ width: VIEW_WIDTH })
        .removeAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });

      return {
        scene,
        data,
        width: info.width,
        height: info.height,
        geometry: geometryOf(body, info.width, info.height, SCENE_FACING[scene]),
      };
    }),
  );

  const back = views.find((view) => view.scene === "back");
  const sides = views.filter((view) => view !== back);
  for (const view of sides) calibrateFacing(view, back);

  // Same camera for every angle, so the back's rows curve the same way.
  if (back && sides.length > 0) {
    back.geometry.ellipse =
      sides.reduce((sum, view) => sum + view.geometry.ellipse / view.height, 0) / sides.length * back.height;
  }

  const { flat, seen } = buildFlat(views);
  const lum = luminanceOf(flat);

  // The image placeholder's own shape gives the layer's width.
  const placeholder = asArray(mapping?.layers).find((layer) => layer?.type === "image");
  const aspect =
    Number(mapping?.gelatoPlaceholderWidth) > 0 && Number(mapping?.gelatoPlaceholderHeight) > 0
      ? Number(mapping.gelatoPlaceholderWidth) / Number(mapping.gelatoPlaceholderHeight)
      : placeholder?.width > 0 && placeholder?.height > 0
        ? placeholder.width / placeholder.height
        : 75.33 / 96;

  const slots = findImageSlots(lum, seen, aspect * FLAT_H) || [];
  const texts = await locateTexts(lum, seen, slots, asArray(mapping?.gelatoTextPlaceholders));

  return { views, flat, slots, texts };
}

async function analysisFor(mapping, { loadImages, fetchImpl, variantId = "" }) {
  const urls = asArray(await loadImages(mapping, { variantId })).slice(0, 12);
  if (urls.length === 0) return null;

  const key = `${mapping?.id}|${urls.map((url) => url.split("?")[0]).join("|")}`;
  const cached = analysisCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.analysis;

  const analysis = await analyseTemplate(mapping, urls, fetchImpl);
  analysisCache.set(key, { analysis, expiresAt: Date.now() + ANALYSIS_TTL_MS });
  return analysis;
}

/**
 * The changes, drawn flat:
 *   - `image`: the generated image in each image slot (RGBA);
 *   - `text`: each edited text, ink only (RGBA);
 *   - `erase`: the boxes whose old wording is wiped first.
 * Each is transparent or empty where nothing changes.
 */
async function drawChanges(analysis, artwork, changedTexts) {
  const blank = () =>
    sharp({
      create: { width: FLAT_W, height: FLAT_H, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    });

  const layers = [];
  const textLayers = [];
  const erase = [];

  for (const slot of analysis.slots) {
    const width = Math.round(slot.x1 - slot.x0);
    // Gelato's "slice" fit: fill the placeholder, crop the overflow.
    const image = await sharp(artwork)
      .resize(width, FLAT_H, { fit: "cover", position: "centre" })
      .ensureAlpha()
      .toBuffer();
    layers.push({ input: image, left: Math.max(0, Math.round(slot.x0)), top: 0 });
  }

  for (const { box, text } of changedTexts) {
    const pad = Math.round((box.vertical ? box.x1 - box.x0 : box.y1 - box.y0) * 0.35);
    const patch = {
      x0: Math.max(0, Math.floor(box.x0 - pad)),
      y0: Math.max(0, Math.floor(box.y0 - pad)),
      x1: Math.min(FLAT_W, Math.ceil(box.x1 + pad)),
      y1: Math.min(FLAT_H, Math.ceil(box.y1 + pad)),
    };
    // Wrapped like the wording it replaces: the input box flattens line
    // breaks, so a three-line block would otherwise get one squeezed line.
    const lines = rewrap(text, Math.max(1, box.lines || 1)).split("\n");

    // Same cap height as the wording it replaces; narrower if it must be to
    // stay within the panel.
    const capHeight = box.vertical ? box.x1 - box.x0 : box.y1 - box.y0;
    const lineCap = capHeight / (lines.length * 1.25 - 0.25);
    let fontSize = lineCap / 0.72;
    const aspect = await aspectOf(text);
    const room = (box.vertical ? FLAT_H : FLAT_W * 0.3) * 0.95;
    const runLength = aspect * capHeight;
    if (runLength > room) fontSize *= room / runLength;

    const length = box.vertical ? box.y1 - box.y0 : box.x1 - box.x0;
    const span = Math.max(length, Math.min(room, runLength)) + pad * 2;
    const cx = (box.x0 + box.x1) / 2;
    const cy = (box.y0 + box.y1) / 2;

    const area = box.vertical
      ? { x0: patch.x0, x1: patch.x1, y0: Math.max(0, cy - span / 2), y1: Math.min(FLAT_H, cy + span / 2) }
      : { x0: Math.max(0, cx - span / 2), x1: Math.min(FLAT_W, cx + span / 2), y0: patch.y0, y1: patch.y1 };

    const w = Math.round(area.x1 - area.x0);
    const h = Math.round(area.y1 - area.y0);
    const step = fontSize * 1.25;
    const firstOffset = -((lines.length - 1) * step) / 2;
    const transform = box.vertical ? `rotate(90 ${w / 2} ${h / 2})` : "";

    // Wiped a little wider along the line than the new text needs: on the
    // steep sides of a mug a small misalignment leaves slivers of old letters.
    erase.push(
      box.vertical
        ? { ...area, y0: Math.max(0, area.y0 - pad), y1: Math.min(FLAT_H, area.y1 + pad), vertical: true }
        : { ...area, x0: Math.max(0, area.x0 - pad), x1: Math.min(FLAT_W, area.x1 + pad), vertical: false },
    );

    // Set the way the old wording was: a right-aligned block keeps its right
    // edge, a left-aligned one its left.
    const anchor = !box.vertical && box.align ? box.align : "middle";
    const anchorX =
      anchor === "start" ? box.x0 - area.x0 : anchor === "end" ? box.x1 - area.x0 : w / 2;

    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">` +
      `<g transform="${transform}" font-family="${FONT}" font-weight="700" font-size="${fontSize.toFixed(1)}" ` +
      `fill="#151515" text-anchor="${anchor}" dominant-baseline="central">` +
      lines
        .map(
          (line, i) =>
            `<text x="${anchorX}" y="${h / 2 + firstOffset + i * step}">${escapeXml(line)}</text>`,
        )
        .join("") +
      `</g></svg>`;

    textLayers.push({ input: Buffer.from(svg), left: Math.round(area.x0), top: Math.round(area.y0) });
  }

  return {
    image: await blank().composite(layers).raw().toBuffer(),
    text: await blank().composite(textLayers).raw().toBuffer(),
    erase,
  };
}

/**
 * The view's own surface where old wording was, blended across from just
 * outside the box — above and below it for a line of text, either side of it
 * for vertical text. Keeps this view's shading and colour, so the patch does
 * not show.
 */
function erasedPixel(view, box, x, fx, fy, k, cos) {
  const { data, width, geometry } = view;
  const rowOf = (flatY, c = cos) =>
    Math.max(0, Math.min(view.height - 1, Math.round(rowInView(geometry, flatY, c))));

  let from;
  let to;
  let t;

  if (!box.vertical) {
    const above = Math.max(0, rowOf(box.y0 - 3));
    const below = Math.min(view.height - 1, rowOf(box.y1 + 2));
    from = data[(above * width + x) * 3 + k];
    to = data[(below * width + x) * 3 + k];
    t = (fy - box.y0) / Math.max(1, box.y1 - box.y0);
  } else {
    const clampX = (value) => Math.max(0, Math.min(width - 1, Math.round(value)));
    const left = viewColumnOf(geometry, box.x0 - 3);
    const right = viewColumnOf(geometry, box.x1 + 2);
    from = data[(rowOf(fy, Math.max(0, left.facing)) * width + clampX(left.x)) * 3 + k];
    to = data[(rowOf(fy, Math.max(0, right.facing)) * width + clampX(right.x)) * 3 + k];
    t = (fx - box.x0) / Math.max(1, box.x1 - box.x0);
  }

  // One side landing on another line's ink would smear it across the patch
  // as a streak; the lighter side is the surface.
  if (Math.abs(from - to) > 40) return Math.max(from, to);

  return from * (1 - t) + to * t;
}

/**
 * Roll the flat changes onto one view. Only changed pixels are touched: old
 * wording is wiped from this view's own surface, the generated image goes in
 * with the shading of a curved mug, and the new wording is inked on top.
 */
async function projectOntoView(view, changes) {
  const { width, height, geometry } = view;
  const out = Buffer.from(view.data);
  const { image, text, erase } = changes;
  const feather = Math.max(2, Math.round(width * 0.003));
  const x0 = Math.ceil(geometry.x0);
  const x1 = Math.floor(geometry.x1);
  const y0 = Math.round(geometry.y0);
  const y1 = Math.round(geometry.y1);

  for (let x = x0; x < x1; x += 1) {
    const fx = flatColumnOf(geometry, x);
    if (fx < 0) continue;

    const s = (x + 0.5 - geometry.cx) / geometry.radius;
    const lit = 0.82 + 0.18 * Math.sqrt(1 - s * s);
    const edge = Math.min(1, (x - x0) / feather, (x1 - 1 - x) / feather);
    const cos = Math.sqrt(1 - s * s);
    const rise = geometry.ellipse * (1 - cos);
    const yStart = Math.max(0, Math.round(y0 - rise));
    const yEnd = Math.min(height, Math.round(y1 - rise));
    const col = Math.min(FLAT_W - 1, Math.floor(fx));

    const wipes = erase.filter((box) => fx >= box.x0 && fx < box.x1);

    for (let y = yStart; y < yEnd; y += 1) {
      const fy = Math.min(FLAT_H - 1, Math.max(0, Math.floor(((y + rise - y0) / (y1 - y0)) * FLAT_H)));
      const c = (fy * FLAT_W + col) * 4;
      const o = (y * width + x) * 3;

      const wipe = wipes.find((box) => fy >= box.y0 && fy < box.y1);
      if (wipe) {
        for (let k = 0; k < 3; k += 1) {
          out[o + k] = Math.round(erasedPixel(view, wipe, x, fx, fy, k, cos));
        }
      }

      const vEdge = Math.min(1, (y - yStart) / feather, (yEnd - 1 - y) / feather);
      const rim = Math.max(0, Math.min(edge, vEdge));

      const imageAlpha = (image[c + 3] / 255) * rim;
      if (imageAlpha > 0) {
        for (let k = 0; k < 3; k += 1) {
          out[o + k] = Math.round(out[o + k] * (1 - imageAlpha) + image[c + k] * lit * imageAlpha);
        }
      }

      const inkAlpha = (text[c + 3] / 255) * rim;
      if (inkAlpha > 0) {
        for (let k = 0; k < 3; k += 1) {
          out[o + k] = Math.round(out[o + k] * (1 - inkAlpha) + text[c + k] * inkAlpha);
        }
      }
    }
  }

  return sharp(out, { raw: { width, height, channels: 3 } }).jpeg({ quality: 88 }).toBuffer();
}

/**
 * Render the customer's design onto the selected Gelato mockups of a mapping:
 * one per angle (handle left, back, handle right).
 *
 * @returns {Promise<Array<{ key: string, scene: string }>>} stored images in
 *   SCENE_ORDER. Empty when the mockups could not be read.
 */
export async function renderMugWrapPreviews(
  { shop, mapping, artworkKey, textValues = {}, variantId = "" },
  { loadImages = resolveTemplateImages, read = readAsset, store = storeAsset, fetchImpl = fetch } = {},
) {
  const analysis = await analysisFor(mapping, { loadImages, fetchImpl, variantId });
  if (!analysis || analysis.views.length === 0) return [];

  const values = textValues && typeof textValues === "object" ? textValues : {};

  // Only text the customer changed is redrawn; the rest stays Gelato's. Where
  // the mockup shows other wording than the template's (found by layout),
  // every field is redrawn, since the photo's wording is not what prints.
  const changedTexts = asArray(mapping?.gelatoTextPlaceholders)
    .map((placeholder) => {
      const box = analysis.texts[placeholder.name];
      if (!box) return null;

      const fallback = toTrimmedString(placeholder.defaultText);
      const value = toTrimmedString(values[placeholder.name]) || (box.byLayout ? fallback : "");
      // The input box drops line breaks, so an untouched multi-line default
      // comes back without them; that is not an edit.
      const same = value.replace(/\s+/g, "") === fallback.replace(/\s+/g, "");
      if (!value || (!box.byLayout && same)) return null;
      return { box, text: value };
    })
    .filter(Boolean);

  // Text the customer changed but whose place on the photos could not be found
  // (Gelato's photos can carry other wording than the template, so there is
  // nothing to match). Drawing the preview anyway shows the OLD wording as if
  // it were their design. Better no quick preview: the page then waits for
  // Gelato's own render, which sets the text itself.
  const undrawable = asArray(mapping?.gelatoTextPlaceholders).some((placeholder) => {
    if (analysis.texts[placeholder.name]) return false;
    const value = toTrimmedString(values[placeholder.name]);
    const fallback = toTrimmedString(placeholder.defaultText);
    return Boolean(value) && value.replace(/\s+/g, "") !== fallback.replace(/\s+/g, "");
  });

  if (undrawable) return [];

  const artwork = await read(artworkKey);
  const changes = await drawChanges(analysis, artwork, changedTexts);
  const prefix = `mockups/${toTrimmedString(shop).replace(/[^a-zA-Z0-9_-]/g, "_")}`;

  const results = await Promise.all(
    analysis.views.map(async (view) => {
      try {
        const image = await projectOntoView(view, changes);
        const key = await store(image, { mimeType: "image/jpeg", prefix });
        return { key, scene: view.scene };
      } catch (error) {
        console.warn("[mug-wrap] view failed:", error?.message);
        return null;
      }
    }),
  );

  return results.filter(Boolean);
}

/** Exposed for diagnostics and tests. */
export async function analyseMockups(mapping, deps = {}) {
  return analysisFor(mapping, {
    loadImages: deps.loadImages || resolveTemplateImages,
    fetchImpl: deps.fetchImpl || fetch,
    variantId: deps.variantId || "",
  });
}
