import test from "node:test";
import assert from "node:assert/strict";

import {
  asArray,
  clampNumber,
  firstString,
  toNumericShopifyId,
  toShopifyGid,
  toTrimmedString,
} from "../app/lib/normalize.js";

test("asArray passes arrays through", () => {
  assert.deepEqual(asArray([1, 2]), [1, 2]);
});

test("asArray unwraps every documented external envelope", () => {
  assert.deepEqual(asArray({ items: ["a"] }), ["a"]);
  assert.deepEqual(asArray({ products: ["b"] }), ["b"]);
  assert.deepEqual(asArray({ templates: ["c"] }), ["c"]);
  assert.deepEqual(asArray({ data: ["d"] }), ["d"]);
  assert.deepEqual(asArray({ results: ["e"] }), ["e"]);
  assert.deepEqual(asArray({ nodes: ["f"] }), ["f"]);
});

test("asArray flattens GraphQL edges and drops empty nodes", () => {
  const value = { edges: [{ node: "x" }, { node: null }, {}] };

  assert.deepEqual(asArray(value), ["x"]);
});

test("asArray never throws on unusable input", () => {
  assert.deepEqual(asArray(null), []);
  assert.deepEqual(asArray(undefined), []);
  assert.deepEqual(asArray("a string"), []);
  assert.deepEqual(asArray(42), []);
  assert.deepEqual(asArray({ unexpected: true }), []);
});

test("firstString returns the first usable candidate", () => {
  assert.equal(firstString("", null, "  kept  ", "ignored"), "kept");
  assert.equal(firstString(null, undefined, 0), "0");
  assert.equal(firstString(null, undefined), "");
});

test("toTrimmedString tolerates non-strings", () => {
  assert.equal(toTrimmedString(null), "");
  assert.equal(toTrimmedString(undefined), "");
  assert.equal(toTrimmedString(12), "12");
  assert.equal(toTrimmedString("  a  "), "a");
});

test("toNumericShopifyId extracts the id from a GID", () => {
  assert.equal(toNumericShopifyId("gid://shopify/Product/1234"), "1234");
  assert.equal(toNumericShopifyId("1234"), "1234");
  assert.equal(toNumericShopifyId("gid://shopify/Product/not-numeric"), "");
  assert.equal(toNumericShopifyId(""), "");
});

test("toShopifyGid builds and passes through", () => {
  assert.equal(toShopifyGid("Product", "1234"), "gid://shopify/Product/1234");
  assert.equal(
    toShopifyGid("Product", "gid://shopify/Product/9"),
    "gid://shopify/Product/9",
  );
  assert.equal(toShopifyGid("Product", ""), "");
});

test("clampNumber bounds values and falls back on junk", () => {
  assert.equal(clampNumber(5, 0, 10, 1), 5);
  assert.equal(clampNumber(-5, 0, 10, 1), 0);
  assert.equal(clampNumber(50, 0, 10, 1), 10);
  assert.equal(clampNumber("nope", 0, 10, 7), 7);
  assert.equal(clampNumber(undefined, 0, 10, 7), 7);
});
