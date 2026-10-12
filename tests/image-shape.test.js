/**
 * The shape and size asked of the image model.
 *
 * Every figure here was measured against the live API, and the tests exist
 * because two of them are counter-intuitive enough to be "corrected" back into
 * bugs by someone reading the docs instead:
 *
 *   - "21:9" does not return 2.333. It returns 1536 x 672, which is 2.286.
 *     Picking the nearest shape to a print area only works against what the
 *     API actually returns.
 *   - `imageSize` is honoured by gemini-3-pro-image and IGNORED by
 *     gemini-2.5-flash-image, which returned 896 x 1152 with and without it.
 *     Sending it anyway would log a resolution the run never used.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_ASPECT_RATIO,
  SUPPORTED_ASPECT_RATIOS,
  aspectRatioForPrintArea,
  buildImageConfig,
  describeUpscale,
  modelHonoursImageSize,
  nearestAspectRatio,
} from "../app/lib/image-shape.js";

test("a mug wrap maps to the widest shape the API offers", () => {
  // 204 x 100 mm = 2.040. Not in the vocabulary; 21:9 (2.286) is the nearest
  // thing that exists. Before this, shape followed the customer's photo and a
  // portrait snapshot was cropped to a fraction of itself.
  assert.equal(nearestAspectRatio(204 / 100), "21:9");
});

test("a square print area maps to 1:1", () => {
  assert.equal(nearestAspectRatio(1), "1:1");
});

test("a portrait print area maps to a portrait shape", () => {
  assert.equal(nearestAspectRatio(0.75), "3:4");
});

test("every mapped value is one the API accepts", () => {
  // "2:1" is rejected outright by the API, so nothing may invent a ratio.
  const allowed = new Set(SUPPORTED_ASPECT_RATIOS.map((entry) => entry.value));

  for (const target of [0.4, 0.6, 0.9, 1.2, 1.6, 2.0, 2.5, 4.0]) {
    assert.ok(allowed.has(nearestAspectRatio(target)), `${target} produced an unsupported ratio`);
  }
});

test("a nonsense target falls back rather than throwing", () => {
  for (const bad of [0, -3, NaN, null, undefined, "wide"]) {
    assert.equal(nearestAspectRatio(bad), DEFAULT_ASPECT_RATIO);
  }
});

test("a design with no print area asks for no particular shape", () => {
  // Null, not a guess: the request then omits the parameter and behaves as it
  // did before, instead of cropping to a shape nobody chose.
  assert.equal(aspectRatioForPrintArea(null), null);
  assert.equal(aspectRatioForPrintArea({ width: 0, height: 0 }), null);
});

test("a print area gives the shape it prints at", () => {
  assert.equal(aspectRatioForPrintArea({ width: 2409, height: 1181 }), "21:9");
});

test("imageSize is sent only to the models that honour it", () => {
  // Measured, not inferred from the name. 3.1-flash was missing from the list
  // at first, so a design using it silently got 1584 x 672 and was upscaled.
  for (const model of ["gemini-3-pro-image", "gemini-3.1-flash-image"]) {
    assert.equal(
      buildImageConfig({ imageSize: "2K", model }).imageSize,
      "2K",
      model + " honours imageSize and must receive it",
    );
    assert.equal(modelHonoursImageSize(model), true);
  }

  const flash = buildImageConfig({ imageSize: "2K", model: "gemini-2.5-flash-image" });
  assert.equal(flash, null, "2.5-flash ignores imageSize, so it must not be recorded as used");
  assert.equal(modelHonoursImageSize("gemini-2.5-flash-image"), false);
});

test("gemini-3.1-pro is never sent an image request", () => {
  // It has no image variant. Asked for one it returns HTTP 200 with
  // finishReason NO_IMAGE and empty content — a silent nothing, which is why
  // it must not appear as a size-aware image model.
  assert.equal(modelHonoursImageSize("gemini-3.1-pro-preview"), false);
  assert.equal(modelHonoursImageSize("gemini-3.1-pro-image"), false);
});

test("aspectRatio is sent to every model", () => {
  for (const model of ["gemini-2.5-flash-image", "gemini-3-pro-image"]) {
    assert.equal(buildImageConfig({ aspectRatio: "21:9", model }).aspectRatio, "21:9");
  }
});

test("an unsupported ratio is dropped rather than sent and rejected", () => {
  assert.equal(buildImageConfig({ aspectRatio: "2:1", model: "gemini-3-pro-image" }), null);
});

test("nothing to configure produces no imageConfig at all", () => {
  assert.equal(buildImageConfig({}), null);
  assert.equal(buildImageConfig({ model: "gemini-2.5-flash-image" }), null);
});

test("artwork smaller than the print area is reported as upscaled", () => {
  // The silent failure: sharp enlarges without complaint and returns exactly
  // the right dimensions, so a soft print is the only symptom.
  const result = describeUpscale({ width: 896, height: 1152 }, { width: 2409, height: 1181 });

  assert.equal(result.upscaled, true);
  assert.ok(result.factor > 2.5, `expected a large factor, got ${result.factor}`);
  assert.match(result.detail, /upscaled/);
});

test("artwork larger than the print area is not reported", () => {
  const result = describeUpscale({ width: 3168, height: 1344 }, { width: 2409, height: 1181 });

  assert.equal(result.upscaled, false);
});

test("a missing print area reports nothing rather than dividing by zero", () => {
  assert.equal(describeUpscale({ width: 800, height: 600 }, null).upscaled, false);
  assert.equal(describeUpscale({}, { width: 2409, height: 1181 }).upscaled, false);
});

/**
 * Aspect ratio is CONFIGURED, never calculated.
 *
 * It was briefly derived from the print area, and the Client rejected that with
 * a better argument than the one behind it: the AI image is often only part of
 * the template. A 200 x 96 mm mug can carry 3:4 artwork inside a fixed layout of
 * text and graphics, and nothing in the print dimensions distinguishes the two.
 *
 * These pin the field's behaviour so it cannot quietly become derived again.
 */

const { ASPECT_RATIO_OPTIONS, normalizeAspectRatio } = await import(
  "../app/lib/image-shape.js"
);

test("a configured ratio is kept exactly as chosen", () => {
  for (const ratio of ["21:9", "3:4", "1:1", "16:9"]) {
    assert.equal(normalizeAspectRatio(ratio), ratio);
  }
});

test("unset means send nothing, not a substituted shape", () => {
  // The model then follows the customer's photo, which is visibly unset rather
  // than quietly guessed.
  for (const empty of ["", null, undefined, "   "]) {
    assert.equal(normalizeAspectRatio(empty), "");
  }
});

test("a ratio the API rejects is dropped rather than sent", () => {
  // "2:1" reads like a reasonable request for a mug wrap and is refused
  // outright by Google. Sending it would fail the whole generation.
  assert.equal(normalizeAspectRatio("2:1"), "");
  assert.equal(normalizeAspectRatio("202:96"), "");
  assert.equal(normalizeAspectRatio("25:12"), "");
});

test("every option offered in the admin is one the API accepts", () => {
  // A merchant must not be able to choose a shape the model will refuse.
  for (const option of ASPECT_RATIO_OPTIONS) {
    if (option.value === "") continue;
    assert.equal(
      normalizeAspectRatio(option.value),
      option.value,
      `${option.value} is offered but would be dropped`,
    );
  }
});

test("the admin list leads with the unset choice", () => {
  assert.equal(ASPECT_RATIO_OPTIONS[0].value, "");
  assert.match(ASPECT_RATIO_OPTIONS[0].label, /not set/i);
});

test("the print-area suggestion stays a suggestion", () => {
  // Still exported for the admin hint, and still correct — but nothing in the
  // generation path may call it. A 200 x 96 template suggesting 21:9 must not
  // override a design whose artwork area is 3:4.
  assert.equal(aspectRatioForPrintArea({ width: 2409, height: 1181 }), "21:9");
  assert.equal(normalizeAspectRatio("3:4"), "3:4");
});

/**
 * Prompt adherence and reproducibility.
 *
 * Neither was configurable, so every request ran at Google's default
 * temperature of 1.0 — the most inventive setting available. The Client's own
 * prompt says "the cabin fills roughly the right 45-50% of the frame", leaving
 * the left half clear for the template's text, and the model spread the
 * composition across the whole width so the text landed on the subjects.
 *
 * He read that as the wrong model. Temperature was the obvious next suspect —
 * and testing did NOT bear it out: 1.0 against 0.2 on the same photo and seed
 * moved left-half detail 70.2 to 67.6, inside noise, and the low run dropped a
 * required subject. Seed did not reproduce either: two runs at seed 12345 gave
 * different images.
 *
 * These tests therefore cover the PLUMBING — range, type, and that unset means
 * unset — not an effect on output quality that has not been demonstrated.
 */

const { normalizeTemperature, normalizeSeed } = await import(
  "../app/lib/generation-config.js"
);

test("unset means send nothing, so the model default stands", () => {
  // A design saved before these fields existed must behave exactly as it did.
  for (const empty of ["", null, undefined]) {
    assert.equal(normalizeTemperature(empty), null);
    assert.equal(normalizeSeed(empty), null);
  }
});

test("temperature is clamped to the range the API accepts", () => {
  // Outside 0-2 the request is rejected, and a rejected request costs a
  // customer their generation.
  assert.equal(normalizeTemperature(0), 0);
  assert.equal(normalizeTemperature(0.2), 0.2);
  assert.equal(normalizeTemperature(2), 2);
  assert.equal(normalizeTemperature(-5), 0, "below range clamps up");
  assert.equal(normalizeTemperature(99), 2, "above range clamps down");
});

test("zero temperature survives, rather than being treated as unset", () => {
  // 0 is the most useful value here — the most literal reading of a prompt —
  // and is exactly the one a falsy check would throw away.
  assert.equal(normalizeTemperature(0), 0);
  assert.notEqual(normalizeTemperature(0), null);
});

test("a seed must be a whole number, not a fraction", () => {
  assert.equal(normalizeSeed(42), 42);
  assert.equal(normalizeSeed("1234"), 1234);
  assert.equal(normalizeSeed(0), 0, "zero is a valid seed");
  assert.equal(normalizeSeed(1.5), null);
  assert.equal(normalizeSeed(-1), null);
  assert.equal(normalizeSeed("abc"), null);
});
