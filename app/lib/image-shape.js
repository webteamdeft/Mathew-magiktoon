/**
 * What shape and size to ask the image model for.
 *
 * WHY THIS EXISTS
 * ---------------
 * Nothing used to control either. The request carried only
 * `responseModalities: ["IMAGE"]`, and the admin's 1K / 2K / 4K setting was
 * appended to the PROMPT as a sentence — "Render the result at 2K resolution".
 *
 * Both were measured against the live API rather than assumed:
 *
 *   - Shape simply copied the customer's photo. Input ratio 0.785 in, 0.785
 *     out, exactly. So a portrait snapshot produced portrait artwork for a
 *     204 x 100 mm mug wrap, and the compositor then cropped most of it away.
 *   - Asking for "2K" in the prompt returned 848 x 1264. The long edge is
 *     supposed to be 2048. The setting did essentially nothing.
 *
 * A mug wrap at 300 DPI needs 2409 x 1181 pixels. Artwork was arriving around
 * 1162 on the long edge and being upscaled to reach it, which is why print
 * files looked soft.
 *
 * WHAT ACTUALLY WORKS
 * -------------------
 * `generationConfig.imageConfig`, and only some of it:
 *
 *   aspectRatio   works on gemini-2.5-flash-image AND gemini-3-pro-image
 *   imageSize     works on gemini-3-pro-image and gemini-3.1-flash-image —
 *                 measured as ignored on 2.5-flash, which returned 896 x 1152
 *                 with the parameter and without it
 *
 * So shape is fixed everywhere, and resolution on the two newer models. See
 * SIZE_AWARE_MODELS for which, with the measurements behind it, and
 * docs/model-performance.md for the speed each one costs.
 *
 * THE VOCABULARY IS FIXED
 * -----------------------
 * `aspectRatio` takes a closed set of strings, not any ratio. "2:1" is
 * REJECTED by the API outright — verified — so a print area has to be mapped
 * onto the nearest value that exists.
 *
 * Pure: no I/O, no SDK. Server and admin can both call it.
 */

import { toTrimmedString } from "./normalize.js";

/**
 * Aspect ratios the API accepts, with the ratio each one actually returns.
 *
 * The numbers are MEASURED, not computed from the label: "21:9" is 2.333 on
 * paper but the API returns 1536 x 672, which is 2.286. Choosing the nearest
 * shape to a print area only works if the figures describe what comes back.
 */
export const SUPPORTED_ASPECT_RATIOS = [
  { value: "9:16", ratio: 0.571 },
  { value: "3:4", ratio: 0.730 },
  { value: "1:1", ratio: 1.0 },
  { value: "5:4", ratio: 1.286 },
  { value: "4:3", ratio: 1.37 },
  { value: "3:2", ratio: 1.5 },
  { value: "16:9", ratio: 1.75 },
  { value: "21:9", ratio: 2.286 },
];

/** Used when a design has no print area to take a shape from. */
export const DEFAULT_ASPECT_RATIO = "1:1";

/**
 * The choices offered in the admin, widest to tallest.
 *
 * Only ratios the API accepts appear here, so a merchant cannot configure a
 * shape the model will refuse. "2:1" is the obvious trap — it reads like a
 * reasonable request for a mug wrap and is rejected outright by Google.
 *
 * The empty value is first and is not a shape: it means send nothing and let
 * the model follow the customer's photo, which is what every design did before
 * this field existed.
 */
export const ASPECT_RATIO_OPTIONS = [
  { label: "Not set — follow the uploaded photo", value: "" },
  { label: "21:9 — widest landscape", value: "21:9" },
  { label: "16:9 — landscape", value: "16:9" },
  { label: "3:2 — landscape", value: "3:2" },
  { label: "4:3 — landscape", value: "4:3" },
  { label: "5:4 — slight landscape", value: "5:4" },
  { label: "1:1 — square", value: "1:1" },
  { label: "3:4 — portrait", value: "3:4" },
  { label: "9:16 — tallest portrait", value: "9:16" },
];

/**
 * Keep a stored aspect ratio only if the API would accept it.
 *
 * Anything else becomes "" — send nothing — rather than a substituted value.
 * A design silently generating at a shape nobody chose is how the original
 * problem went unnoticed.
 */
export function normalizeAspectRatio(value) {
  const ratio = toTrimmedString(value);

  return SUPPORTED_ASPECT_RATIOS.some((entry) => entry.value === ratio) ? ratio : "";
}

/**
 * Sizes the API accepts. See SIZE_AWARE_MODELS for which models honour them.
 *
 * The long edges are measured: 2K returns 2528, not 2048.
 */
export const SUPPORTED_IMAGE_SIZES = ["1K", "2K", "4K"];

export const MEASURED_LONG_EDGE = { "1K": 1162, "2K": 2528, "4K": 4648 };

/**
 * Models that honour `imageSize`. Everything else silently ignores it.
 *
 * Membership is MEASURED, never assumed from the name. Each was sent the
 * parameter and its output dimensions compared:
 *
 *   gemini-3-pro-image       2K -> 3168 x 1344 in 65.0s   honoured
 *   gemini-3.1-flash-image   2K -> 3168 x 1344 in 30.9s   honoured
 *   gemini-2.5-flash-image   2K ->  896 x 1152            IGNORED
 *
 * The 3.1 flash model was missing from this list at first, which meant a
 * design configured to use it silently received 1584 x 672 — below the
 * 2409 x 1181 a mug needs — and was upscaled. Same failure the whole module
 * exists to prevent, one model along.
 *
 * gemini-3.1-pro is NOT here and cannot be: it has no image variant. Asked for
 * an image it returns HTTP 200 with finishReason NO_IMAGE and empty content.
 */
const SIZE_AWARE_MODELS = ["gemini-3-pro-image", "gemini-3.1-flash-image"];

export function modelHonoursImageSize(model) {
  return SIZE_AWARE_MODELS.includes(toTrimmedString(model));
}

/**
 * The supported aspect ratio closest to a target.
 *
 * Nearest by ratio rather than by name. A 204 x 100 mm mug is 2.040, which is
 * not in the list at all — "21:9" (2.286) is the closest thing that exists, and
 * the small remainder is cropped by the compositor instead of two thirds of the
 * picture being cropped, which is what happened when the shape was left to
 * follow whatever photo the customer uploaded.
 *
 * @param {number} target width / height
 * @returns {string} an aspect ratio the API will accept
 */
export function nearestAspectRatio(target) {
  const wanted = Number(target);

  if (!Number.isFinite(wanted) || wanted <= 0) return DEFAULT_ASPECT_RATIO;

  let best = SUPPORTED_ASPECT_RATIOS[0];

  for (const candidate of SUPPORTED_ASPECT_RATIOS) {
    if (Math.abs(candidate.ratio - wanted) < Math.abs(best.ratio - wanted)) {
      best = candidate;
    }
  }

  return best.value;
}

/**
 * The shape the PRINT AREA alone would suggest. A hint for the admin, never the
 * value sent to the model.
 *
 * This was briefly used as the real setting and the Client rejected it, with a
 * better argument than the one behind it:
 *
 *   "the whole template is 200x96, but in that case the AI image is 3:4 and the
 *    rest is text and fixed images. This can't be a calculated field."
 *
 * Exactly so. The print area describes the finished product, not the portion of
 * it the AI draws, and nothing in those dimensions distinguishes the two. A mug
 * whose template is 2.08:1 may want 3:4 artwork sitting inside a fixed layout.
 *
 * Kept because showing "your print area is 2.08:1, closest available is 21:9"
 * beside the field is useful when a design IS full-bleed. It informs the
 * merchant's choice; it does not make it.
 *
 * @param {object} geometry from `resolvePrintGeometry`
 * @returns {string|null}
 */
export function aspectRatioForPrintArea(geometry) {
  const width = Number(geometry?.width);
  const height = Number(geometry?.height);

  if (!(width > 0) || !(height > 0)) return null;

  return nearestAspectRatio(width / height);
}

/**
 * Build the `imageConfig` for a request.
 *
 * `imageSize` is omitted for a model that ignores it. Sending it anyway would
 * be harmless but would put a value in the log that the run did not honour, and
 * the whole reason this module exists is that a setting appeared to work while
 * doing nothing.
 *
 * @returns {object|null} null when there is nothing to send
 */
export function buildImageConfig({ aspectRatio = "", imageSize = "", model = "" } = {}) {
  const config = {};

  const shape = toTrimmedString(aspectRatio);

  if (shape && SUPPORTED_ASPECT_RATIOS.some((entry) => entry.value === shape)) {
    config.aspectRatio = shape;
  }

  const size = toTrimmedString(imageSize).toUpperCase();

  if (size && SUPPORTED_IMAGE_SIZES.includes(size) && modelHonoursImageSize(model)) {
    config.imageSize = size;
  }

  return Object.keys(config).length > 0 ? config : null;
}

/**
 * Is the artwork big enough for the print file, or will it be upscaled?
 *
 * Upscaling is the failure this is here to make visible. It does not error, it
 * does not warn, and the only symptom is a soft print nobody sees until the
 * parcel arrives.
 *
 * @returns {{ upscaled: boolean, factor: number, detail: string }}
 */
export function describeUpscale({ width, height }, geometry) {
  const haveW = Number(width);
  const haveH = Number(height);
  const needW = Number(geometry?.width);
  const needH = Number(geometry?.height);

  if (!(haveW > 0) || !(needW > 0)) {
    return { upscaled: false, factor: 1, detail: "" };
  }

  // `cover` scales by whichever edge falls shortest.
  const factor = Math.max(needW / haveW, needH / haveH);

  if (factor <= 1) {
    return { upscaled: false, factor, detail: "" };
  }

  return {
    upscaled: true,
    factor,
    detail:
      `artwork ${haveW}x${haveH} is smaller than the ${needW}x${needH} print ` +
      `area and will be upscaled ${factor.toFixed(2)}x`,
  };
}
