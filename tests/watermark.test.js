import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";

import {
  markPreviewCorner,
  watermarkArtworkDataUrl,
} from "../app/lib/watermark.server.js";

function solid(width, height, colour) {
  return sharp({ create: { width, height, channels: 3, background: colour } }).jpeg().toBuffer();
}

test("the artwork shown on screen is a watermarked, scaled-down JPEG", async () => {
  const url = await watermarkArtworkDataUrl(await solid(1883, 2400, "#203040"));

  assert.ok(url.startsWith("data:image/jpeg;base64,"));
  const shown = Buffer.from(url.split(",")[1], "base64");
  const { width, height } = await sharp(shown).metadata();
  assert.equal(width, 1400);
  assert.equal(height, Math.round((2400 * 1400) / 1883));

  // The logo lightens parts of a flat dark image.
  const { channels } = await sharp(shown).stats();
  assert.ok(channels[0].max > 0x20 + 20);
});

test("a preview gets one mark, in its bottom-right corner", async () => {
  const marked = await markPreviewCorner(await solid(1000, 1000, "#ffffff"));
  const { data, info } = await sharp(marked).raw().toBuffer({ resolveWithObject: true });

  const changed = (x0, y0, x1, y1) => {
    for (let y = y0; y < y1; y += 2) {
      for (let x = x0; x < x1; x += 2) {
        if (data[(y * info.width + x) * info.channels] < 235) return true;
      }
    }
    return false;
  };

  assert.ok(changed(800, 900, 1000, 1000));
  assert.ok(!changed(0, 0, 500, 500));
});

test("an image that can't be read is left as it was", async () => {
  const junk = Buffer.from("not an image");

  assert.equal(await markPreviewCorner(junk), junk);
  assert.equal(await watermarkArtworkDataUrl(junk), null);
});
