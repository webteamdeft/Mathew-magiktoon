/**
 * What has to be true before a design can be printed from a file we build.
 *
 * Option A sends Gelato one flat file and no template, so anything the design
 * needs and we do not hold is simply absent from the parcel. These tests pin
 * the difference between "empty because the customer fills it" and "empty
 * because nobody supplied it", which is the distinction the whole check rests
 * on and the one that is easiest to get backwards.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  READINESS,
  printReadiness,
  unsuppliedImageLayers,
  describeReadiness,
} from "../app/lib/print-readiness.js";

/** A design with a real print area, so geometry is never the thing failing. */
function design(layers) {
  return { printFileRequirements: "204x100mm", layers };
}

function imageLayer(name, imageKey = "") {
  return { name, type: "image", label: name, imageKey, x: 0, y: 0, width: 1, height: 1 };
}

function textLayer(name) {
  return { name, type: "text", label: name, text: { content: name } };
}

test("the layer holding the customer's photo is not reported as missing", () => {
  // It is SUPPOSED to be empty here: it is filled at order time.
  const layers = [imageLayer("Customer photo")];

  assert.deepEqual(unsuppliedImageLayers(layers), []);
  assert.equal(printReadiness(design(layers)).ready, true);
});

test("a second image layer with no artwork IS reported", () => {
  // Gelato declares it, we hold no file for it, so it would print as nothing.
  const layers = [imageLayer("Customer photo"), imageLayer("icon bar code v2.png")];

  const names = unsuppliedImageLayers(layers).map((layer) => layer.name);

  assert.deepEqual(names, ["icon bar code v2.png"]);

  const result = printReadiness(design(layers));

  assert.equal(result.ready, false);
  assert.equal(result.blockers[0].code, READINESS.MISSING_LAYER_ARTWORK);
  assert.match(result.blockers[0].detail, /icon bar code/);
});

test("a design element that HAS artwork is not a blocker", () => {
  const layers = [
    imageLayer("Customer photo"),
    imageLayer("icon bar code v2.png", "layer/abc.png"),
  ];

  assert.deepEqual(unsuppliedImageLayers(layers), []);
  assert.equal(printReadiness(design(layers)).ready, true);
});

test("with no print area the design is refused, whatever else is right", () => {
  const result = printReadiness({ layers: [imageLayer("Customer photo")] });

  assert.equal(result.ready, false);
  assert.equal(result.blockers[0].code, READINESS.NO_PRINT_AREA);
  // The message has to say where the number comes from; guessing one is how
  // every mug got printed at half size.
  assert.match(result.blockers[0].detail, /template PDF/i);
});

test("every image layer already carrying artwork leaves the photo nowhere to go", () => {
  const layers = [
    imageLayer("Front graphic", "layer/a.png"),
    imageLayer("Back graphic", "layer/b.png"),
  ];

  const codes = printReadiness(design(layers)).blockers.map((b) => b.code);

  assert.ok(codes.includes(READINESS.NO_UPLOAD_LAYER));
});

test("text layers are never treated as missing artwork", () => {
  const layers = [imageLayer("Customer photo"), textLayer("Text 1"), textLayer("Text 2")];

  assert.deepEqual(unsuppliedImageLayers(layers), []);
  assert.equal(printReadiness(design(layers)).ready, true);
});

test("several missing elements are all reported, not just the first", () => {
  const layers = [
    imageLayer("Customer photo"),
    imageLayer("barcode"),
    imageLayer("headline"),
  ];

  const result = printReadiness(design(layers));

  assert.equal(result.blockers.length, 2);
  assert.match(describeReadiness(result), /barcode/);
  assert.match(describeReadiness(result), /headline/);
});

test("a ready design says so plainly", () => {
  const result = printReadiness(design([imageLayer("Customer photo")]));

  assert.match(describeReadiness(result), /^Ready:/);
});