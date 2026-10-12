import test from "node:test";
import assert from "node:assert/strict";

import sharp from "sharp";

import {
  findUploadLayer,
  fixedImageLayers,
  normalizeLayers,
} from "../app/lib/layers.js";

const { composePrintFile } = await import("../app/lib/print-file.server.js");

/**
 * Fixed image layers — the parts of a design that are not the customer's photo.
 *
 * The client's templates put most of the design into these: "most of the text
 * on the right hand side will be a fixed image layer. Only the person's name
 * will be editable text."
 *
 * Gelato cannot supply their artwork. Template detail returns
 * `{name, width, height, printArea}` per image placeholder — no URL, no
 * coordinates — and one preview of the whole design. So each is uploaded
 * against the design, and has to reach both the page and the print file.
 */

function imageLayer(name, overrides = {}) {
  return {
    name,
    type: "image",
    x: 0.1,
    y: 0.1,
    width: 0.3,
    height: 0.2,
    ...overrides,
  };
}

// -------------------------------------------------------------------- model

test("an image layer carries the artwork uploaded for it", () => {
  const [layer] = normalizeLayers([
    imageLayer("logo.png", { imageKey: "layers/shop/a.png", imageName: "logo.png" }),
  ]);

  assert.equal(layer.imageKey, "layers/shop/a.png");
  assert.equal(layer.imageName, "logo.png");
});

test("a layer with no artwork reports empty, never undefined", () => {
  // The value is compared and serialised all over; undefined would read as
  // "not an image layer" in some places and "no artwork" in others.
  const [layer] = normalizeLayers([imageLayer("art.png")]);

  assert.equal(layer.imageKey, "");
  assert.equal(layer.imageName, "");
});

test("only image layers carry artwork", () => {
  const [layer] = normalizeLayers([
    { name: "Text 4", type: "text", imageKey: "layers/shop/a.png" },
  ]);

  assert.equal(layer.imageKey, undefined);
});

test("a layer carrying artwork is never the customer's upload slot", () => {
  // Otherwise a design whose first image layer is a logo would drop the
  // customer's photo on top of the logo and lose both.
  const layers = normalizeLayers([
    imageLayer("logo.png", { imageKey: "layers/shop/logo.png", zIndex: 1 }),
    imageLayer("photo.png", { zIndex: 2 }),
  ]);

  assert.equal(findUploadLayer(layers).name, "photo.png");
});

test("the editable slot still wins when nothing carries artwork", () => {
  const layers = normalizeLayers([
    imageLayer("first.png", { editable: false, zIndex: 1 }),
    imageLayer("second.png", { editable: true, zIndex: 2 }),
  ]);

  assert.equal(findUploadLayer(layers).name, "second.png");
});

test("a design that is entirely fixed has no upload slot at all", () => {
  const layers = normalizeLayers([
    imageLayer("logo.png", { imageKey: "layers/shop/logo.png" }),
  ]);

  assert.equal(findUploadLayer(layers), null);
});

test("fixed layers are listed in paint order", () => {
  const layers = normalizeLayers([
    imageLayer("top.png", { imageKey: "k2", zIndex: 9 }),
    imageLayer("photo.png", { zIndex: 5 }),
    imageLayer("under.png", { imageKey: "k1", zIndex: 2 }),
  ]);

  assert.deepEqual(
    fixedImageLayers(layers).map((layer) => layer.name),
    ["under.png", "top.png"],
  );
});

// -------------------------------------------------------------- print file

async function solid(colour, width = 200, height = 200) {
  return sharp({ create: { width, height, channels: 4, background: colour } })
    .png()
    .toBuffer();
}

const RED = { r: 255, g: 0, b: 0, alpha: 1 };
const GREEN = { r: 0, g: 200, b: 0, alpha: 1 };

function deps(overrides = {}) {
  const stored = [];

  return {
    stored,
    options: {
      read: async (key) => {
        if (key === "art") return solid(RED);
        if (key === "logo") return solid(GREEN);
        throw new Error(`no such key: ${key}`);
      },
      store: async (buffer, options) => {
        stored.push({ buffer, options });
        return `printfiles/demo/${stored.length}.png`;
      },
      env: {},
      ...overrides,
    },
  };
}

function design(layers) {
  return {
    id: "map_mug",
    printFileRequirements: "400x200",
    layers,
  };
}

test("a fixed layer is composited into the print file", async () => {
  const { options } = deps();

  const result = await composePrintFile(
    {
      shop: "demo.myshopify.com",
      mapping: design([
        imageLayer("photo.png", { zIndex: 1 }),
        imageLayer("logo.png", { imageKey: "logo", zIndex: 2 }),
      ]),
      artworkKey: "art",
    },
    options,
  );

  assert.equal(result.ok, true, result.error);
  assert.equal(result.fixedLayers, 1);
  assert.deepEqual(result.missingLayers, []);
});

test("the fixed layer sits OVER the artwork, not under it", async () => {
  // A logo or a barcode is part of the design; the customer's photo must not
  // cover it. The artwork fills the sheet, so a green pixel inside the layer's
  // box can only mean the layer was painted on top.
  const { options, stored } = deps();

  await composePrintFile(
    {
      shop: "demo.myshopify.com",
      mapping: design([
        imageLayer("photo.png", { zIndex: 1 }),
        // Covers the whole safe box, so its colour is unambiguous.
        imageLayer("logo.png", { imageKey: "logo", zIndex: 2, x: 0, y: 0, width: 1, height: 1 }),
      ]),
      artworkKey: "art",
    },
    options,
  );

  const { data, info } = await sharp(stored[0].buffer)
    .raw()
    .toBuffer({ resolveWithObject: true });

  // Sample the centre, which is inside the layer's box either way.
  const middle = (Math.floor(info.height / 2) * info.width + Math.floor(info.width / 2)) *
    info.channels;

  assert.ok(data[middle + 1] > 150, `expected the layer on top, got ${data[middle]},${data[middle + 1]},${data[middle + 2]}`);
});

test("a fixed layer whose artwork is missing is recorded, not fatal", async () => {
  // An incomplete print is bad; no print at all is worse. Either way the
  // reason has to be on the record.
  const { options } = deps();

  const result = await composePrintFile(
    {
      shop: "demo.myshopify.com",
      mapping: design([
        imageLayer("photo.png", { zIndex: 1 }),
        imageLayer("gone.png", { imageKey: "missing", zIndex: 2 }),
      ]),
      artworkKey: "art",
    },
    options,
  );

  assert.equal(result.ok, true, result.error);
  assert.equal(result.fixedLayers, 0);
  assert.deepEqual(result.missingLayers, ["gone.png"]);
});

test("a design with no fixed layers reports none, rather than omitting the field", async () => {
  const { options } = deps();

  const result = await composePrintFile(
    { shop: "demo.myshopify.com", mapping: design([imageLayer("photo.png")]), artworkKey: "art" },
    options,
  );

  assert.equal(result.ok, true, result.error);
  assert.equal(result.fixedLayers, 0);
  assert.deepEqual(result.missingLayers, []);
});
