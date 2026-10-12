/**
 * MagikToon — Gelato template image block.
 *
 * Fetches the designs mapped to the current Shopify product and shows the
 * selected one at full size. No image URL is hardcoded: everything comes from
 * the mapping configured in the app.
 *
 * Kept deliberately separate from personalisation.js so a merchant can place
 * the image in one column and the customise form in another, and so a product
 * page that only wants the image does not download the whole form's logic.
 */
(function () {
  "use strict";

  /** Emitted by the personalisation block when the shopper picks a design. */
  var DESIGN_EVENT = "mtc:design-change";

  function queryAll(root, selector) {
    return Array.prototype.slice.call(root.querySelectorAll(selector));
  }

  function show(node) {
    if (node) node.hidden = false;
  }

  function hide(node) {
    if (node) node.hidden = true;
  }

  /**
   * The image URL for one design.
   *
   * Always the app-proxy path when there is one: Gelato's own preview URLs are
   * presigned and expire after 24 hours, which shows up as a broken image a day
   * after everything looked fine.
   */
  function designImage(base, option) {
    if (!option) return "";

    return option.previewPath ? base + option.previewPath : option.previewUrl || "";
  }

  /**
   * Every image Gelato has for one design, as stable proxy paths.
   *
   * A design built from a store product carries a mockup gallery; one created
   * from a template id alone has a single preview. Either way the list is
   * whatever Gelato reports, never a fixed number.
   */
  function designImages(base, option) {
    if (!option) return [];

    if (Array.isArray(option.imagePaths) && option.imagePaths.length) {
      return option.imagePaths.map(function (path) {
        return base + path;
      });
    }

    var single = designImage(base, option);

    return single ? [single] : [];
  }

  function Preview(root) {
    this.root = root;
    this.productId = root.dataset.productId || "";
    this.proxyBase = (root.dataset.proxyBase || "/apps/magiktoon").replace(/\/$/, "");
    this.showThumbnails = root.dataset.showThumbnails !== "false";
    this.sideBySide = root.dataset.sideBySide !== "false";

    this.designMode =
      root.dataset.designMode === "true" ||
      Boolean(window.Shopify && window.Shopify.designMode);

    this.image = root.querySelector("[data-mtcv-image]");
    this.placeholder = root.querySelector("[data-mtcv-placeholder]");
    this.thumbs = root.querySelector("[data-mtcv-thumbs]");
    this.notice = root.querySelector("[data-mtcv-notice]");

    this.templates = [];
    this.selected = null;
    // Which image of the selected design is on screen; its thumbnail is hidden.
    this.currentIndex = 0;
  }

  Preview.prototype.setImage = function setImage(url, alt) {
    if (!this.image || !url) return;

    var self = this;

    this.image.onload = function () {
      show(self.image);
      hide(self.placeholder);
    };

    this.image.onerror = function () {
      hide(self.image);
      show(self.placeholder);
    };

    if (alt) this.image.alt = alt;

    this.image.src = url;
  };

  Preview.prototype.select = function select(mappingId) {
    var chosen = null;

    this.templates.forEach(function (option) {
      if (option.mappingId === mappingId) chosen = option;
    });

    if (!chosen) return;

    this.selected = chosen;
    // A design always opens on its primary image.
    this.currentIndex = 0;

    this.setImage(
      designImage(this.proxyBase, chosen),
      chosen.designLabel || chosen.templateName || chosen.productTitle
    );

    if (!this.thumbs) return;

    this.syncThumbnails();
  };

  /**
   * Build the thumbnail strip: mapped designs first, product photos after.
   *
   * The product photos are already in the markup from Liquid, so the designs
   * are inserted before them rather than the whole strip being rebuilt.
   */
  Preview.prototype.renderThumbnails = function renderThumbnails() {
    var self = this;

    if (!this.thumbs || !this.showThumbnails) return;

    var first = this.thumbs.firstChild;

    this.templates.forEach(function (option, index) {
      var label =
        option.designLabel || option.templateName || "Design " + (index + 1);

      // One thumbnail per image Gelato holds for this design, not one per
      // design: a mockup gallery of six shots should show six thumbnails.
      designImages(self.proxyBase, option).forEach(function (url, imageIndex) {
        var button = document.createElement("button");

        button.type = "button";
        button.className = "mtcv__thumb";
        button.setAttribute("role", "radio");
        button.setAttribute("aria-checked", "false");
        button.dataset.mappingId = option.mappingId;
        // Only the first image selects the design; the rest just change the view.
        button.dataset.imageIndex = String(imageIndex);
        button.dataset.imageUrl = url;

        var image = document.createElement("img");
        image.className = "mtcv__thumb-image";
        image.src = url;
        image.alt =
          imageIndex === 0 ? label : label + " view " + (imageIndex + 1);
        image.width = 160;
        image.height = 160;
        image.loading = "lazy";

        button.appendChild(image);
        self.thumbs.insertBefore(button, first);
      });
    });

    this.thumbs.addEventListener("click", function (event) {
      var button = event.target.closest(".mtcv__thumb");

      if (!button) return;

      if (button.dataset.mappingId) {
        var changingDesign =
          !self.selected || button.dataset.mappingId !== self.selected.mappingId;

        if (changingDesign) {
          // A different design: change what will be printed, and say so.
          self.select(button.dataset.mappingId);

          document.dispatchEvent(
            new CustomEvent(DESIGN_EVENT, {
              detail: {
                productId: self.productId,
                mappingId: button.dataset.mappingId
              }
            })
          );
        }

        // Another view of the design already selected: image only.
        if (!changingDesign) {
          self.currentIndex = Number(button.dataset.imageIndex);
        }

        self.setImage(button.dataset.imageUrl, button.querySelector("img").alt);
        self.markSelected(button);
        self.syncThumbnails();

        return;
      }

      // A product photo: change the view only. The design being printed is
      // unaffected, so `this.selected` is deliberately left alone.
      self.setImage(button.dataset.mtcvPhoto, button.querySelector("img").alt);
      self.markSelected(button);
    });

    this.syncThumbnails();
  };

  /**
   * Show the thumbnails that are worth showing.
   *
   * Whatever is currently shown large is hidden from the strip: a thumbnail of
   * the image you are already looking at is a dead control. So the strip
   * carries the OTHER views of the selected design — and the primary reappears
   * in it as soon as you move to another view, which is what makes it
   * reachable again.
   *
   * Every other design keeps only its primary, acting as the button that
   * switches to it.
   */
  Preview.prototype.syncThumbnails = function syncThumbnails() {
    var self = this;

    if (!this.thumbs) return;

    var visible = 0;

    queryAll(this.thumbs, ".mtcv__thumb").forEach(function (button) {
      var mappingId = button.dataset.mappingId;
      var index = Number(button.dataset.imageIndex);
      var isSelectedDesign =
        self.selected && mappingId === self.selected.mappingId;

      // A product photo has no mapping id; it is always available.
      var show = !mappingId
        ? true
        : isSelectedDesign
          ? index !== self.currentIndex
          : index === 0;

      button.hidden = !show;

      if (show) visible += 1;
    });

    this.thumbs.hidden = visible === 0;
  };

  /** Highlight one thumbnail, clearing the rest. */
  Preview.prototype.markSelected = function markSelected(active) {
    if (!this.thumbs) return;

    queryAll(this.thumbs, ".mtcv__thumb").forEach(function (button) {
      button.setAttribute("aria-checked", button === active ? "true" : "false");
    });
  };

  /**
   * Put the design image and the customize form side by side.
   *
   * Both are app blocks dropped into the same section slot, so the theme stacks
   * them in one column. Wrapping the pair in a grid is the only way to get the
   * approved two-column layout without asking the merchant to edit theme code.
   *
   * Only siblings are wrapped: if the merchant has already placed them in
   * separate columns, the theme's own layout is left alone.
   */
  Preview.prototype.pairWithForm = function pairWithForm() {
    if (!this.sideBySide) return;

    var form = document.querySelector("[data-mtc-root]");

    if (!form || form === this.root) return;
    if (this.root.closest(".mtcv-split")) return;

    // Two elements: the outer one measures the width the theme gives us, the
    // inner one is the grid. A container cannot query its own width.
    var wrapper = document.createElement("div");
    wrapper.className = "mtcv-split";

    var grid = document.createElement("div");
    grid.className = "mtcv-split__grid";
    wrapper.appendChild(grid);

    // Anchor the wrapper where the pair already begins, so it lands inside the
    // same theme container and inherits its width and alignment.
    var first =
      this.root.compareDocumentPosition(form) &
      Node.DOCUMENT_POSITION_FOLLOWING
        ? this.root
        : form;

    // Siblings are wrapped in place. When the theme has put the two blocks in
    // different containers they are moved together instead — without this, the
    // pair simply stacks and the approved two-column layout never appears.
    var anchor = first;

    if (this.root.parentElement !== form.parentElement) {
      // Climb to the highest ancestor that still contains only this block, so
      // the theme's own wrapper markup travels with it rather than being left
      // behind as an empty box.
      while (
        anchor.parentElement &&
        anchor.parentElement.children.length === 1 &&
        anchor.parentElement !== document.body
      ) {
        anchor = anchor.parentElement;
      }
    }

    anchor.parentElement.insertBefore(wrapper, anchor);

    // Image first, form second — left and right in the approved design.
    grid.appendChild(this.root);
    grid.appendChild(form);
  };

  /** In the theme editor, say why nothing is showing. */
  Preview.prototype.explain = function explain(message) {
    if (!this.designMode || !this.notice) return;

    this.notice.textContent = message;
    show(this.notice);
    show(this.root);
  };

  Preview.prototype.start = function start() {
    var self = this;

    if (!this.productId) return;

    fetch(
      this.proxyBase + "/mapping?product_id=" + encodeURIComponent(this.productId),
      { headers: { Accept: "application/json" } }
    )
      .then(function (response) {
        return response.json();
      })
      .then(function (payload) {
        if (!payload || !payload.ok || !payload.mapping) {
          self.explain(
            "This product has no active Gelato mapping yet. Add one under " +
              "Product mappings in the MagikToon app."
          );
          return;
        }

        self.templates = Array.isArray(payload.templates) && payload.templates.length
          ? payload.templates
          : [payload.mapping];

        self.selected = self.templates[0];

        // Build the strip first so the initial selection can highlight in it.
        self.renderThumbnails();
        self.select(self.selected.mappingId);
        self.pairWithForm();
        show(self.root);
      })
      .catch(function (error) {
        console.warn("[magiktoon] template image request failed", error);
        self.explain(
          "The MagikToon app could not be reached. Check the app proxy path " +
            "matches this block's setting."
        );
      });

    // Follow the personalisation block's own chooser.
    document.addEventListener(DESIGN_EVENT, function (event) {
      var detail = event.detail || {};

      if (detail.productId !== self.productId) return;
      if (self.selected && detail.mappingId === self.selected.mappingId) return;

      self.select(detail.mappingId);
    });

    // A customer's own design is a truer preview than the blank template.
    document.addEventListener("mtc:design-saved", function (event) {
      var detail = event.detail || {};

      if (detail.productId !== self.productId || !detail.previewUrl) return;

      self.setImage(detail.previewUrl, "Your saved design");
    });
  };

  function init() {
    queryAll(document, "[data-mtcv-root]").forEach(function (root) {
      if (root.dataset.mtcvReady === "true") return;

      root.dataset.mtcvReady = "true";
      new Preview(root).start();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  document.addEventListener("shopify:section:load", init);
})();
