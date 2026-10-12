/**
 * MagikToon — the customer's own design as the cart line image.
 *
 * The cart shows the shop's product photo, which for a made-to-order item is a
 * plain mug. The shopper has just spent minutes on a design and then sees none
 * of it.
 *
 * HOW THE DESIGN IS FOUND
 * -----------------------
 * The line already carries it. The visible "Custom design" property renders as
 * a link to the approved image, and that link sits INSIDE the row it belongs
 * to. So the row is found by walking up from the link until an ancestor also
 * holds a product image — no theme-specific selectors, no cart fetch, and no
 * chance of pairing a design with the wrong line.
 *
 * That is a better signal than anything guessed from markup, and it is the one
 * the merchant can see on the page.
 *
 * A cart fetch remains as a fallback for themes that print properties as plain
 * text rather than links; there the hidden customization id is read from
 * /cart.js and the design served through a stable app-proxy path.
 *
 * NOTHING ELSE IS TOUCHED. No styles, no classes, no layout, no text — the
 * theme keeps its cart exactly as it built it, with one different picture in
 * it. A row that cannot be matched is left alone: a cart showing the stock
 * photo is where we started, a cart broken by an app is lost revenue.
 */
(function () {
  "use strict";

  var ID_PROPERTY = "_mt_customization_id";

  /** The visible property the theme renders as the design link. */
  var VISIBLE_PROPERTY = "Custom design";

  /** Our signed asset path. Every design link on the page carries it. */
  var ASSET_PATH = "/uploads/";

  var config = window.MagikToonCart || {};
  var proxyBase = String(config.proxyBase || "/apps/magiktoon").replace(/\/+$/, "");

  // Two different failures, reported once each. Sharing one flag meant
  // whichever happened first silenced the other, and they need opposite fixes:
  // one is the theme's markup, the other is the app being unreachable.
  var warnedUnreachable = false;
  var warnedUnmatched = false;

  function toArray(list) {
    return Array.prototype.slice.call(list || []);
  }

  /**
   * The product photo in a row, which is not reliably the first image in it.
   *
   * Rows open with spacers, badges and remove icons. Swapping the first image
   * found leaves the product untouched while reporting success, which is the
   * hardest kind of failure to notice.
   */
  function productImage(row) {
    var images = toArray(row.querySelectorAll("img"));

    if (images.length === 0) return null;

    var best = images[0];
    var bestArea = 0;

    images.forEach(function (image) {
      var width = image.clientWidth || image.naturalWidth || 0;
      var height = image.clientHeight || image.naturalHeight || 0;
      var area = width * height;

      if (area > bestArea) {
        bestArea = area;
        best = image;
      }
    });

    return best;
  }

  /**
   * The row a design link belongs to.
   *
   * The nearest ancestor that also holds an image. Climbing stops as soon as an
   * ancestor holds a SECOND design link, because that means we have left the
   * row and reached the cart — and swapping there would put one customer's
   * design onto every line.
   */
  function rowFor(anchor) {
    var node = anchor.parentElement;

    for (var steps = 0; node && steps < 10; steps += 1) {
      if (node.querySelectorAll('a[href*="' + ASSET_PATH + '"]').length > 1) return null;

      if (node.querySelector("img")) return node;

      node = node.parentElement;
    }

    return null;
  }

  /**
   * Put the design onto this row's product photo, but only once it has loaded.
   *
   * The design is fetched into a detached Image first and the row is left
   * completely alone until that succeeds. Assigning src directly is a one-way
   * door: the theme's own photo is gone the instant it is overwritten, and if
   * the design then fails to arrive the shopper is looking at a broken image in
   * their cart rather than the mug they are buying.
   *
   * It fails more often than it sounds. The url points at this app, so it
   * breaks whenever the app is unreachable, whenever a signed link has expired,
   * and — the case that started all this — whenever the address was signed on a
   * hostname that no longer exists.
   *
   * Losing the swap costs a nicer picture. Losing the picture costs the sale.
   *
   * @returns {Promise<boolean>} whether the row now carries the design.
   */
  function paint(row, url) {
    var image = productImage(row);

    if (!image) return Promise.resolve(false);

    // Already ours.
    if (image.getAttribute("data-mtc-design") === url) return Promise.resolve(true);

    return new Promise(function (resolve) {
      var probe = new Image();

      probe.onload = function () {
        // srcset wins over src in every browser, so it has to go or the theme's
        // own image comes straight back at the next resize.
        image.removeAttribute("srcset");
        image.removeAttribute("sizes");

        image.src = url;
        image.setAttribute("data-mtc-design", url);

        resolve(true);
      };

      probe.onerror = function () {
        if (!warnedUnreachable) {
          warnedUnreachable = true;
          console.warn(
            "[MagikToon] The custom design could not be loaded from " +
              url +
              " — the cart is showing the product photo instead. The app may be " +
              "unreachable, or the link may have expired.",
          );
        }

        resolve(false);
      };

      probe.src = url;
    });
  }

  /**
   * Swap using the design links the theme has already rendered.
   *
   * Returns how many lines were handled, so the caller knows whether the
   * fallback is needed at all.
   */
  function fromLinks() {
    var anchors = toArray(document.querySelectorAll('a[href*="' + ASSET_PATH + '"]'));

    return Promise.all(
      anchors.map(function (anchor) {
        var row = rowFor(anchor);

        return row ? paint(row, anchor.href) : false;
      }),
    ).then(function (results) {
      return results.filter(Boolean).length;
    });
  }

  /** Row lookup for the fallback path, by Shopify's own line key. */
  function findRowByKey(item, index) {
    var key = item.key;

    var selectors = [
      '[data-cart-item-key="' + key + '"]',
      '[data-line-item-key="' + key + '"]',
      '[data-key="' + key + '"]',
      '[data-variant-id="' + item.variant_id + '"]',
      '#CartItem-' + (index + 1),
      '#CartDrawer-Item-' + (index + 1)
    ];

    for (var i = 0; i < selectors.length; i += 1) {
      var found = document.querySelector(selectors[i]);
      if (found) return found;
    }

    var link = document.querySelector(
      'a[href*="/cart/change"][href*="line=' + (index + 1) + '"]',
    );

    if (link) {
      return link.closest("tr, li, .cart-item, .cart__row, [class*='cart-item']") || null;
    }

    var removeBtn = document.querySelector('cart-remove-button[data-index="' + (index + 1) + '"]');
    if (removeBtn) {
      return removeBtn.closest("tr, li, .cart-item, .cart__row, [class*='cart-item']") || null;
    }

    return null;
  }

  /**
   * The row for a cart item, located by the design link the theme rendered.
   *
   * The link is the most reliable row marker on the page — it is printed inside
   * the row it belongs to, whatever the theme calls its classes. So it is still
   * used, but only to say WHERE; what gets painted is the proxy url, not the
   * expiring address the link points at.
   */
  function rowForItem(item) {
    var href = (item.properties || {})[VISIBLE_PROPERTY];

    if (!href) return null;

    var anchors = toArray(document.querySelectorAll('a[href*="' + ASSET_PATH + '"]'));

    for (var i = 0; i < anchors.length; i += 1) {
      if (anchors[i].getAttribute("href") === href) return rowFor(anchors[i]);
    }

    // Fallback: if the theme renders it as plain text instead of a link.
    var filename = href.split('/').pop().split('?')[0];
    if (filename) {
      var elements = toArray(document.querySelectorAll('dd, span, div, p'));
      for (var j = 0; j < elements.length; j += 1) {
        if (elements[j].children.length === 0 && elements[j].textContent.indexOf(filename) !== -1) {
          var row = elements[j].closest("tr, li, .cart-item, .cart__row, [class*='cart-item']");
          if (row) return row;
        }
      }
    }

    return null;
  }

  /**
   * The primary path: the hidden customization id, served through the proxy.
   *
   * This is preferred over the rendered link because the link is a SIGNED,
   * EXPIRING url captured at the moment the design was approved, and it carries
   * the hostname the app answered on that day. Both go stale — a dev tunnel
   * changes on every restart, and a signed url expires on its own schedule.
   *
   * When that happens the link path does not fail loudly. It sets src to a dead
   * url and reports success, so the row is left showing nothing and the
   * fallback never runs. That was the bug: the swap was happening correctly,
   * onto an address that no longer resolved.
   *
   * The proxy path carries no hostname and no signature. It is resolved by
   * Shopify against whatever the app is currently reachable at, so it keeps
   * working across restarts and long after the signature would have lapsed.
   *
   * Returns how many rows were painted, so the caller knows whether to fall
   * back to the links at all.
   */
  function fromCart() {
    return fetch("/cart.js", { headers: { Accept: "application/json" } })
      .then(function (response) {
        return response.ok ? response.json() : null;
      })
      .then(function (cart) {
        if (!cart || !cart.items) return 0;

        var unmatched = [];

        var work = cart.items.map(function (item, index) {
          var id = (item.properties || {})[ID_PROPERTY];

          if (!id) return false;

          var url = proxyBase + "/preview-image/" + encodeURIComponent(id);
          var row = findRowByKey(item, index) || rowForItem(item);

          if (!row) {
            unmatched.push(item.title || item.key);
            return false;
          }

          return paint(row, url);
        });

        // Only rows we could not FIND are reported here. A row we found but
        // could not paint has already said so, in `paint`, with the reason —
        // and saying it twice for one line reads like two separate faults.
        //
        // Silence was the worst part of this: "the embed is off", "the theme
        // was not matched" and "this line has no design" all looked identical
        // from a cart.
        if (unmatched.length && !warnedUnmatched) {
          warnedUnmatched = true;
          console.warn(
            "[MagikToon] Found a custom design for " +
              unmatched.length +
              " cart line(s) but could not locate the row in this theme: " +
              unmatched.join(", ") +
              ". The image was left as the theme rendered it.",
          );
        }

        return Promise.all(work).then(function (results) {
          return results.filter(Boolean).length;
        });
      })
      .catch(function () {
        // A cart showing the stock photo is the state we started in.
        return 0;
      });
  }

  var running = false;

  function apply() {
    if (running) return;

    running = true;

    // The proxy path first, because it is the one that keeps resolving. The
    // rendered links are only consulted when no line carried a customization
    // id — an older design, or a cart written before the id was recorded.
    fromCart()
      .then(function (painted) {
        return painted === 0 ? fromLinks() : painted;
      })
      .then(function () {
        running = false;
      })
      .catch(function () {
        // Never leave the guard stuck: a cart redraws constantly, and a run
        // that threw must not stop every run after it.
        running = false;
      });
  }

  /**
   * Carts redraw constantly — quantity changes, drawer opens, section renders.
   * Watching the document catches all of it without knowing the theme, and the
   * data-mtc-design guard stops the observer retriggering on its own writes.
   */
  function watch() {
    if (!window.MutationObserver) return;

    var pending = null;

    new MutationObserver(function () {
      window.clearTimeout(pending);
      pending = window.setTimeout(apply, 120);
    }).observe(document.body, { childList: true, subtree: true });
  }

  function start() {
    apply();
    watch();

    // Themes announce cart changes in their own ways; these two are common and
    // harmless to listen for when they never fire.
    document.addEventListener("cart:updated", apply);
    document.addEventListener("cart:refresh", apply);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})();
