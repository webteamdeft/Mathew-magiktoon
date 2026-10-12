/**
 * The cart swap, driven against a fake DOM.
 *
 * This script only ever runs in a shopper's browser, on a theme we do not
 * control, at the one moment money is involved — so the behaviour that matters
 * is not "does it swap the picture" but "what does it do when it cannot".
 *
 * Two failures have already reached a real cart:
 *
 *   1. It painted a url signed on a hostname that no longer existed. The swap
 *      "succeeded", the image 404'd, and the shopper saw a broken picture of
 *      the thing they were buying.
 *   2. Preferring the rendered link over the proxy path meant that dead url
 *      was chosen even though a working one was available on the same line.
 *
 * Both are pinned here.
 */

import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import fs from "node:fs";

const SOURCE = fs.readFileSync(
  "extensions/magiktoon-personalization/assets/cart-mockup.js",
  "utf8",
);

/**
 * Enough DOM to run the script: rows carrying an image, an optional design
 * link, and an Image constructor whose success is decided per url.
 */
function browser({ cart = { items: [] }, reachable = () => true, links = [] } = {}) {
  const warnings = [];

  function makeImage(width, height) {
    return {
      tagName: "IMG",
      src: "product.jpg",
      clientWidth: width,
      clientHeight: height,
      naturalWidth: width,
      naturalHeight: height,
      attributes: {},
      getAttribute(name) {
        return this.attributes[name] ?? null;
      },
      setAttribute(name, value) {
        this.attributes[name] = value;
      },
      removeAttribute(name) {
        delete this.attributes[name];
      },
    };
  }

  // One cart row: a small icon and the product photo, so "largest image wins"
  // is actually exercised rather than assumed.
  const rows = (cart.items || []).map((item, index) => {
    const icon = makeImage(16, 16);
    const photo = makeImage(300, 300);
    const anchor = links[index]
      ? { href: links[index], getAttribute: () => links[index] }
      : null;

    const row = {
      item,
      images: [icon, photo],
      photo,
      anchor,
      querySelector: (sel) => (sel === "img" ? icon : null),
      querySelectorAll(sel) {
        if (sel === "img") return this.images;
        return anchor && sel.includes("uploads") ? [anchor] : [];
      },
    };

    if (anchor) anchor.parentElement = row;

    return row;
  });

  const document = {
    readyState: "complete",
    body: {},
    addEventListener() {},
    querySelector(sel) {
      const match = /data-cart-item-key="([^"]+)"/.exec(sel);
      if (!match) return null;
      return rows.find((row) => row.item.key === match[1]) || null;
    },
    querySelectorAll(sel) {
      if (sel.includes("uploads")) {
        return rows.map((row) => row.anchor).filter(Boolean);
      }
      return [];
    },
    createElement: () => ({}),
  };

  const context = {
    document,
    window: { MagikToonCart: { proxyBase: "/apps/magiktoon" }, setTimeout, clearTimeout },
    console: { warn: (message) => warnings.push(String(message)) },
    setTimeout,
    clearTimeout,
    Promise,
    Image: class {
      set src(url) {
        // Resolve on the microtask queue, as a real load would.
        Promise.resolve().then(() =>
          reachable(url) ? this.onload?.() : this.onerror?.(),
        );
      }
    },
    fetch: async () => ({ ok: true, json: async () => cart }),
  };

  context.window.MutationObserver = undefined;
  vm.createContext(context);
  vm.runInContext(SOURCE, context);

  return { rows, warnings };
}

/** Let the promise chain inside the script settle. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 10));

const ITEM = {
  key: "line-1",
  title: "Mug",
  variant_id: 1,
  properties: { _mt_customization_id: "cust_1" },
};

test("the design replaces the product photo when it loads", async () => {
  const { rows } = browser({ cart: { items: [ITEM] } });

  await settle();

  assert.equal(rows[0].photo.src, "/apps/magiktoon/preview-image/cust_1");
});

test("the largest image in the row is the one swapped, not the first", async () => {
  const { rows } = browser({ cart: { items: [ITEM] } });

  await settle();

  // The 16x16 icon comes first in the DOM and must be left alone.
  assert.equal(rows[0].images[0].src, "product.jpg");
});

test("a design that cannot be loaded leaves the product photo alone", async () => {
  // The failure that reached a real cart: the swap succeeded, the image 404'd,
  // and the shopper saw a broken picture instead of the mug.
  const { rows, warnings } = browser({
    cart: { items: [ITEM] },
    reachable: () => false,
  });

  await settle();

  assert.equal(rows[0].photo.src, "product.jpg", "the theme's photo must survive");
  assert.equal(rows[0].photo.getAttribute("data-mtc-design"), null);
  assert.match(warnings.join(" "), /could not be loaded/);
});

test("srcset is cleared, or the theme's photo returns at the next resize", async () => {
  const { rows } = browser({ cart: { items: [ITEM] } });

  rows[0].photo.setAttribute("srcset", "product-2x.jpg 2x");

  await settle();

  assert.equal(rows[0].photo.getAttribute("srcset"), null);
});

test("the proxy path is preferred over a rendered link that has expired", async () => {
  // Both are on the line. The link is a signed url from a hostname that no
  // longer resolves; the proxy path still does. Choosing the link was the bug.
  const dead = "https://old-tunnel.example/uploads/mockups/a.png?sig=x";

  const { rows } = browser({
    cart: { items: [ITEM] },
    links: [dead],
    reachable: (url) => !url.startsWith("https://old-tunnel"),
  });

  await settle();

  assert.equal(rows[0].photo.src, "/apps/magiktoon/preview-image/cust_1");
});

test("a line with no design of its own is never touched", async () => {
  const plain = { key: "line-2", title: "Plain mug", variant_id: 2, properties: {} };

  const { rows } = browser({ cart: { items: [plain] } });

  await settle();

  assert.equal(rows[0].photo.src, "product.jpg");
});
