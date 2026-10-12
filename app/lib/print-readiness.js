/**
 * Is this design ready to be fulfilled under Option A?
 *
 * Option A means we send Gelato ONE flat file and that file has to carry the
 * entire design, because Gelato's Order API applies no template to it. Anything
 * the design needs and we do not hold simply will not be printed — and it will
 * not be printed silently, because a compositor given nine layers and handed
 * seven produces a perfectly valid image of seven layers.
 *
 * That is the failure this guards. It is not a validation of our code; it is a
 * statement of what the design is still missing, so it can be asked for rather
 * than discovered on a parcel.
 *
 * The live 11oz mug is the worked example. Gelato declares two image
 * placeholders on it: the customer's photo, and "icon bar code v2.png" — a
 * graphic that exists only on Gelato's side. The template's own headline
 * artwork is not published at all. So the merchant has to supply the fixed
 * design as artwork before this design can be printed from a file we build.
 *
 * Pure: no I/O, no database. Server and admin can both call it.
 */

import { LAYER_TYPES, findUploadLayer, normalizeLayers } from "./layers.js";
import { toTrimmedString } from "./normalize.js";
import { hasPrintArea, resolvePrintGeometry } from "./print-geometry.js";

/** Why a design cannot be fulfilled from a file we build. */
export const READINESS = {
  NO_PRINT_AREA: "NO_PRINT_AREA",
  NO_UPLOAD_LAYER: "NO_UPLOAD_LAYER",
  MISSING_LAYER_ARTWORK: "MISSING_LAYER_ARTWORK",
};

/**
 * Image layers that are part of the design but hold no artwork.
 *
 * The layer the customer's photo goes into is excluded — that one is filled at
 * order time and is supposed to be empty here. Everything else that Gelato
 * declares is a design element the print file needs and does not have.
 */
export function unsuppliedImageLayers(layers) {
  const normalized = normalizeLayers(layers);
  const upload = findUploadLayer(normalized);
  const uploadName = upload ? upload.name : "";

  return normalized.filter(
    (layer) =>
      layer.type === LAYER_TYPES.IMAGE &&
      layer.name !== uploadName &&
      !toTrimmedString(layer.imageKey),
  );
}

/**
 * Everything standing between this design and a printable file.
 *
 * @returns {{ ready: boolean, blockers: Array<{code: string, detail: string}>,
 *             geometry: object }}
 */
export function printReadiness(mapping) {
  const geometry = resolvePrintGeometry(mapping);
  const layers = normalizeLayers(mapping?.layers);
  const blockers = [];

  if (!hasPrintArea(geometry)) {
    blockers.push({
      code: READINESS.NO_PRINT_AREA,
      detail:
        "No print area is configured. Read the size from the product's Gelato " +
        'template PDF and record it on the design, for example "204x100mm".',
    });
  }

  if (!findUploadLayer(layers)) {
    blockers.push({
      code: READINESS.NO_UPLOAD_LAYER,
      detail:
        "No layer is waiting for the customer's photo. Every image layer has " +
        "artwork of its own, so the generated image has nowhere to go.",
    });
  }

  for (const layer of unsuppliedImageLayers(layers)) {
    // Both names, when they differ. The label is what the merchant renamed it
    // to and can be as vague as "Artwork (print area 1)"; the Gelato name is
    // the one that identifies it inside the template, which is where the file
    // has to be fetched from.
    const label = toTrimmedString(layer.label);
    const named =
      label && label !== layer.name ? `"${label}" (${layer.name})` : `"${layer.name}"`;

    blockers.push({
      code: READINESS.MISSING_LAYER_ARTWORK,
      detail:
        `The design element ${named} has no artwork. Gelato holds it inside ` +
        "the template and does not publish the file, so it must be uploaded " +
        "here or it will not be printed.",
    });
  }

  return { ready: blockers.length === 0, blockers, geometry };
}

/** One line per blocker, for a log or a script. */
export function describeReadiness(result) {
  if (result.ready) return "Ready: every element of this design is available.";

  return result.blockers.map((blocker) => `${blocker.code}: ${blocker.detail}`).join("\n");
}