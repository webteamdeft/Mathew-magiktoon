import test from "node:test";
import assert from "node:assert/strict";

import { customizationProxyPath } from "../app/lib/proxy-paths.js";

/**
 * Regression cover for a live failure.
 *
 * The customizer page posts its design back through the app proxy. Shopify
 * strips the proxy prefix before forwarding, so the app sees `/customize` while
 * the customer is really on `/apps/<subpath>/customize`. Deriving the POST
 * target from the path the app received produced a bare `/customization`, which
 * the storefront answers with its 404 HTML page — and the page failed with
 * "Unexpected token '<', "<!DOCTYPE "... is not valid JSON".
 */
function url(path, params = "") {
  return new URL(`https://app.example.com${path}${params}`);
}

test("the POST target is a storefront path, not the stripped app path", () => {
  const path = customizationProxyPath(
    url("/customize", "?proxy_base=/apps/magiktoon"),
  );

  assert.equal(path, "/apps/magiktoon/customization");
});

test("a missing proxy base falls back to the documented default", () => {
  assert.equal(customizationProxyPath(url("/customize")), "/apps/magiktoon/customization");
});

test("a custom proxy prefix is honoured", () => {
  assert.equal(
    customizationProxyPath(url("/customize", "?proxy_base=/tools/personalise")),
    "/tools/personalise/customization",
  );
});

test("a trailing slash does not produce a doubled path", () => {
  assert.equal(
    customizationProxyPath(url("/customize", "?proxy_base=/apps/magiktoon/")),
    "/apps/magiktoon/customization",
  );
});

test("the result is never the bare path that caused the HTML response", () => {
  for (const base of ["", "/", "//", "not-a-path"]) {
    const path = customizationProxyPath(
      url("/customize", `?proxy_base=${encodeURIComponent(base)}`),
    );

    assert.notEqual(path, "/customization", `base ${JSON.stringify(base)}`);
    assert.ok(path.startsWith("/apps/"), `base ${JSON.stringify(base)}`);
  }
});

test("an absolute URL cannot be smuggled in as the proxy base", () => {
  // Otherwise the design, artwork included, would be POSTed to another host.
  for (const hostile of [
    "https://evil.example.com",
    "//evil.example.com",
    "/apps/magiktoon/../../evil",
  ]) {
    const path = customizationProxyPath(
      url("/customize", `?proxy_base=${encodeURIComponent(hostile)}`),
    );

    assert.equal(path.startsWith("/"), true);
    assert.equal(path.includes(".."), false);
    assert.equal(/^https?:|^\/\//.test(path), false, hostile);
  }
});
