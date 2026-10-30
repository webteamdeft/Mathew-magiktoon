/**
 * MagikToon Personalisation — product page block.
 *
 * Shows the mapped Gelato designs, links to the full-page customizer at
 * `/apps/<subpath>/customize`, surfaces a design already saved in this browser,
 * and keeps the theme's add-to-cart locked until one exists.
 *
 * The editor is rendered by the app on its own page, so no upload, placement or
 * canvas code belongs here.
 */
(function () {
  "use strict";

  /** localStorage key holding the design saved for one product. */
  function storageKey(productId) {
    return "mtc:design:" + productId;
  }

  function query(root, selector) {
    return root.querySelector(selector);
  }

  function queryAll(root, selector) {
    return Array.prototype.slice.call(root.querySelectorAll(selector));
  }

  function show(node) {
    if (node) node.hidden = false;
  }

  function hide(node) {
    if (node) node.hidden = true;
  }

  /** Private browsing throws; nothing was stored to remove. */
  function forget(key) {
    try {
      window.localStorage.removeItem(key);
    } catch (error) {
      return;
    }
  }

  /**
   * The theme's own add-to-cart controls. Themes vary, so several shapes are
   * covered; anything unmatched stays enabled, since a missed guard beats
   * disabling an unrelated button.
   */
  var CART_CONTROLS = [
    'form[action*="/cart/add"] [type="submit"]',
    'form[action*="/cart/add"] button[name="add"]',
    "[data-mtc-guarded]",
    ".product-form__submit",
    ".shopify-payment-button__button"
  ].join(",");

  /**
   * The image URL for one design.
   *
   * Prefers the stable app-proxy path: Gelato's own preview URLs are presigned
   * and expire in 24 hours, which shows up as a silently broken image.
   */
  function designImage(base, option) {
    if (!option) return "";

    return option.previewPath ? base + option.previewPath : option.previewUrl || "";
  }

  /**
   * Tell the standalone template-image block what changed.
   *
   * The two blocks are placed in different columns and know nothing about each
   * other, so they agree through events rather than by reaching across the DOM.
   */
  function announce(name, detail) {
    document.dispatchEvent(new CustomEvent(name, { detail: detail }));
  }

  function Block(root) {
    this.root = root;
    this.dataset = root.dataset;

    this.productId = this.dataset.productId || "";
    this.variantId = this.dataset.variantId || "";
    this.productHandle = this.dataset.productHandle || "";
    this.productTitle = this.dataset.productTitle || "this product";
    this.productImage = this.dataset.productImage || "";
    this.productType = this.dataset.productType || "";
    this.variantTitle = this.dataset.variantTitle || "";
    this.price = this.dataset.price || "";
    this.proxyBase = (this.dataset.proxyBase || "/apps/magiktoon").replace(/\/$/, "");
    this.requireCustomization = this.dataset.blockRequired !== "false";
    this.showSavedDesign = this.dataset.showSavedDesign === "true";
    this.guardMessage =
      this.dataset.guardMessage ||
      "Please customise your photo before adding this product to your cart.";

    this.designMode =
      this.dataset.designMode === "true" ||
      Boolean(window.Shopify && window.Shopify.designMode);

    this.elements = {
      intro: query(root, "[data-mtc-intro]"),
      template: query(root, "[data-mtc-template]"),
      designs: query(root, "[data-mtc-designs]"),
      templateImage: query(root, "[data-mtc-template-image]"),
      templateName: query(root, "[data-mtc-template-name]"),
      templateMeta: query(root, "[data-mtc-template-meta]"),
      saved: query(root, "[data-mtc-saved]"),
      savedImage: query(root, "[data-mtc-saved-image]"),
      savedMeta: query(root, "[data-mtc-saved-meta]"),
      open: query(root, "[data-mtc-open]"),
      help: query(root, "[data-mtc-help]"),
      guard: query(root, "[data-mtc-guard]"),
      setupNotice: query(root, "[data-mtc-setup-notice]")
    };

    this.mapping = null;
    this.templates = [];
    this.saved = null;
  }

  /**
   * The full-page customizer. The product and variant here are the ones the
   * customer will actually buy; `mapping_id` names only the design applied.
   */
  Block.prototype.customizeUrl = function customizeUrl(mappingId) {
    var params = new URLSearchParams();

    params.set("product_id", this.productId);

    if (this.variantId) params.set("variant_id", this.variantId);
    if (mappingId) params.set("mapping_id", mappingId);

    // The page posts back through the proxy, and only the storefront knows the
    // prefix — Shopify strips it before the app ever sees the request.
    params.set("proxy_base", this.proxyBase);

    // Display-only, so the page can name the exact product, variant and price.
    if (this.productTitle) params.set("product_title", this.productTitle);
    if (this.productImage) params.set("product_image", this.productImage);
    if (this.variantTitle) params.set("variant_title", this.variantTitle);
    if (this.price) params.set("price", this.price);
    if (this.productType) params.set("product_type", this.productType);

    if (this.productHandle) {
      params.set("return_to", "/products/" + this.productHandle);
    }

    return this.proxyBase + "/customize?" + params.toString();
  };

  /**
   * Wire the variant option buttons.
   *
   * Selecting an option changes which Shopify VARIANT the design is attached
   * to. The product is unchanged, and so is the design — only the variant id
   * carried into the customizer moves.
   */
  Block.prototype.bindVariants = function bindVariants() {
    var data = query(this.root, "[data-mtc-variants]");
    var self = this;

    if (!data) return;

    try {
      this.variants = JSON.parse(data.textContent);
    } catch (error) {
      console.warn("[magiktoon] variant data unreadable", error);
      return;
    }

    this.chosen = [];

    queryAll(this.root, "[data-mtc-option]").forEach(function (group, index) {
      var selected = query(group, ".mtc__option-value.is-selected");

      self.chosen[index] = selected ? selected.dataset.mtcOptionValue : "";
    });

    queryAll(this.root, ".mtc__option-value").forEach(function (button) {
      button.addEventListener("click", function () {
        var index = Number(button.dataset.optionIndex);

        self.chosen[index] = button.dataset.mtcOptionValue;

        queryAll(
          button.closest("[data-mtc-option]"),
          ".mtc__option-value"
        ).forEach(function (sibling) {
          sibling.classList.toggle("is-selected", sibling === button);
        });

        self.applyVariant();
      });
    });
  };

  /** Match the chosen options to a variant, and follow it. */
  Block.prototype.applyVariant = function applyVariant() {
    var self = this;
    var match = null;

    (this.variants || []).forEach(function (variant) {
      var same = self.chosen.every(function (value, index) {
        return !value || variant.options[index] === value;
      });

      if (same && !match) match = variant;
    });

    if (!match) return;

    this.variantId = String(match.id);

    var price = query(this.root, "[data-mtc-price]");

    if (price && match.price) {
      // Liquid renders money server-side; without a formatter here, showing the
      // raw minor units would be worse than leaving the original in place.
      price.textContent = formatMoney(match.price);
    }

    if (this.elements.open && this.mapping) {
      this.elements.open.href = this.customizeUrl(this.mapping.mappingId);
    }
  };

  /**
   * Format Shopify's minor-unit price using the shop's own locale settings when
   * they are available, and a plain decimal otherwise.
   */
  function formatMoney(cents) {
    var amount = Number(cents) / 100;

    try {
      var currency =
        (window.Shopify && window.Shopify.currency && window.Shopify.currency.active) ||
        "USD";

      return new Intl.NumberFormat(undefined, {
        style: "currency",
        currency: currency
      }).format(amount);
    } catch (error) {
      return amount.toFixed(2);
    }
  }

  /** Keep the theme's add-to-cart locked until a design exists. */
  Block.prototype.applyGuard = function applyGuard() {
    if (!this.requireCustomization || this.designMode) {
      return;
    }

    var unlocked = Boolean(this.saved);
    var self = this;

    queryAll(document, CART_CONTROLS).forEach(function (control) {
      if (self.root.contains(control)) return;

      control.disabled = !unlocked;

      if (unlocked) {
        control.removeAttribute("aria-disabled");
        control.classList.remove("mtc-locked");
      } else {
        control.setAttribute("aria-disabled", "true");
        control.classList.add("mtc-locked");
      }
    });

    if (unlocked) {
      hide(this.elements.guard);
    } else if (this.elements.guard) {
      this.elements.guard.textContent = this.guardMessage;
      show(this.elements.guard);
    }
  };

  /**
   * Let the customer pick between the designs this product offers. Choosing one
   * never changes the product or variant bought — only the print template.
   */
  Block.prototype.renderChooser = function renderChooser() {
    var list = this.elements.designs;
    var self = this;

    if (!list || this.templates.length < 2) return;

    list.innerHTML = "";

    this.templates.forEach(function (option, index) {
      var button = document.createElement("button");

      button.type = "button";
      button.className = "mtc__design";
      button.setAttribute("role", "radio");
      button.setAttribute(
        "aria-checked",
        option.mappingId === self.mapping.mappingId ? "true" : "false"
      );
      button.dataset.mappingId = option.mappingId;

      var thumbUrl = designImage(self.proxyBase, option);

      if (thumbUrl) {
        var thumb = document.createElement("img");
        thumb.className = "mtc__design-image";
        thumb.src = thumbUrl;
        thumb.alt = "";
        thumb.width = 120;
        thumb.height = 120;
        thumb.loading = "lazy";
        button.appendChild(thumb);
      }

      var name = document.createElement("span");
      name.className = "mtc__design-name";
      name.textContent =
        option.designLabel || option.templateName || "Design " + (index + 1);
      button.appendChild(name);

      list.appendChild(button);
    });

    list.addEventListener("click", function (event) {
      var button = event.target.closest(".mtc__design");
      if (!button) return;

      self.templates.forEach(function (option) {
        if (option.mappingId === button.dataset.mappingId) self.mapping = option;
      });

      Array.prototype.forEach.call(
        list.querySelectorAll(".mtc__design"),
        function (node) {
          node.setAttribute(
            "aria-checked",
            node.dataset.mappingId === button.dataset.mappingId ? "true" : "false"
          );
        }
      );

      self.renderTemplate();

      announce("mtc:design-change", {
        productId: self.productId,
        mappingId: self.mapping.mappingId
      });

      if (self.elements.open) {
        self.elements.open.href = self.customizeUrl(self.mapping.mappingId);
      }
    });

    show(list);
  };

  Block.prototype.renderTemplate = function renderTemplate() {
    var mapping = this.mapping;

    if (!mapping) return;

    var image = this.elements.templateImage;

    var templateUrl = designImage(this.proxyBase, mapping);

    if (image && templateUrl) {
      image.src = templateUrl;
      image.alt = mapping.productTitle || this.productTitle;
    } else {
      hide(image);
    }

    if (this.elements.templateName) {
      this.elements.templateName.textContent =
        mapping.templateName || mapping.productTitle || this.productTitle;
    }

    if (this.elements.templateMeta) {
      var parts = [];

      if (mapping.placeholderName) parts.push(mapping.placeholderName);
      if (mapping.printAreaName) parts.push("Print area: " + mapping.printAreaName);

      this.elements.templateMeta.textContent = parts.join(" · ");
    }

    // The merchant can suppress this card when the dedicated image block
    // already shows the design, which is the default.
    if (!this.elements.template.hasAttribute("data-mtc-suppressed")) {
      show(this.elements.template);
    }
  };

  Block.prototype.renderSaved = function renderSaved() {
    var image = this.elements.savedImage;
    var panel = this.elements.saved;

    // Behaviour first, presentation second: unlocking add-to-cart and telling
    // the image block about a design must happen whether or not the panel is
    // shown, so neither is behind the visibility check below.
    this.applyGuard();

    if (this.saved) {
      announce("mtc:design-saved", {
        productId: this.productId,
        previewUrl: this.saved.previewUrl || ""
      });

      if (this.elements.open) {
        this.elements.open.textContent = "Review or change your design";
      }
    }

    // The approved design has no saved-design panel on the product page: the
    // customizer is where a design is reviewed.
    if (!this.showSavedDesign || !this.saved) {
      hide(panel);
      return;
    }

    if (image) {
      // A preview minted against an old dev tunnel no longer resolves; show no
      // thumbnail rather than a broken-image icon.
      if (this.saved.previewUrl) {
        image.onerror = function () { hide(image); };
        image.src = this.saved.previewUrl;
        show(image);
      } else {
        hide(image);
      }
    }

    if (this.elements.savedMeta) {
      this.elements.savedMeta.textContent =
        "Reference " + this.saved.customizationId + " · tap below to review or replace it.";
    }

    show(panel);
  };

  /**
   * Restore a design saved in this browser, confirming it still exists
   * server-side — a record the server has forgotten would put a design in the
   * cart that fulfilment cannot resolve.
   */
  Block.prototype.restoreSaved = function restoreSaved() {
    var raw = null;
    var self = this;

    try {
      raw = window.localStorage.getItem(storageKey(this.productId));
    } catch (error) {
      return Promise.resolve();
    }

    if (!raw) return Promise.resolve();

    var cached;

    try {
      cached = JSON.parse(raw);
    } catch (error) {
      this.forgetSaved();
      return Promise.resolve();
    }

    if (!cached || !cached.customizationId) {
      this.forgetSaved();
      return Promise.resolve();
    }

    return fetch(
      this.proxyBase +
        "/customization?id=" +
        encodeURIComponent(cached.customizationId),
      { headers: { Accept: "application/json" } }
    )
      .then(function (response) {
        return response.json();
      })
      .then(function (payload) {
        if (!payload || !payload.ok) {
          self.forgetSaved();
          return;
        }

        self.saved = {
          customizationId: payload.customizationId,
          previewUrl: payload.previewUrl || cached.previewUrl || "",
          properties: payload.properties || cached.properties || {}
        };

        self.renderSaved();
      })
      .catch(function (error) {
        // The cache is NOT trusted here. An unconfirmed design showed "Your
        // design is ready" to customers who had never uploaded anything in
        // this session, and unlocked add-to-cart on a record fulfilment might
        // not be able to resolve. Staying silent is the safer failure.
        console.warn("[magiktoon] saved design not confirmed", error);
        self.saved = null;
      });
  };

  Block.prototype.forgetSaved = function forgetSaved() {
    this.saved = null;
    forget(storageKey(this.productId));
  };

  Block.prototype.showSetupNotice = function showSetupNotice(message) {
    if (!this.designMode || !this.elements.setupNotice) return;

    this.elements.setupNotice.textContent = message;
    show(this.elements.setupNotice);
    show(this.root);
  };

  Block.prototype.loadMapping = function loadMapping() {
    if (!this.productId) {
      return Promise.resolve({ mapping: null, reason: "no-product" });
    }

    return fetch(
      this.proxyBase + "/mapping?product_id=" + encodeURIComponent(this.productId),
      { headers: { Accept: "application/json" } }
    )
      .then(function (response) {
        return response.json();
      })
      .then(function (payload) {
        if (payload && payload.ok && payload.mapping) {
          var templates = Array.isArray(payload.templates) ? payload.templates : [];

          return {
            mapping: payload.mapping,
            templates: templates.length > 0 ? templates : [payload.mapping],
            reason: ""
          };
        }

        return {
          mapping: null,
          templates: [],
          reason: (payload && payload.reason) || "unavailable"
        };
      })
      .catch(function (error) {
        console.warn("[magiktoon] mapping request failed", error);
        return { mapping: null, templates: [], reason: "error" };
      });
  };

  Block.prototype.start = function start() {
    var self = this;

    this.loadMapping().then(function (result) {
      if (!result.mapping) {
        self.showSetupNotice(
          result.reason === "not-mapped"
            ? "This product has no active Gelato mapping yet. Add one under Product mappings in the MagikToon app."
            : "The MagikToon app could not be reached. Check that the app proxy path matches this block's setting."
        );
        return;
      }

      self.mapping = result.mapping;
      self.templates = result.templates;

      self.renderTemplate();
      self.renderChooser();
      show(self.elements.intro);
      show(self.root);

      if (self.elements.open) {
        self.elements.open.href = self.customizeUrl(self.mapping.mappingId);
      }

      self.applyGuard();

      self.restoreSaved().then(function () {
        self.applyGuard();
      });
    });
  };

  Block.prototype.followImageBlock = function followImageBlock() {
    var self = this;

    document.addEventListener("mtc:design-change", function (event) {
      var detail = event.detail || {};

      if (detail.productId !== self.productId) return;
      if (!self.mapping || detail.mappingId === self.mapping.mappingId) return;

      self.templates.forEach(function (option) {
        if (option.mappingId === detail.mappingId) self.mapping = option;
      });

      self.renderTemplate();

      if (self.elements.open) {
        self.elements.open.href = self.customizeUrl(self.mapping.mappingId);
      }
    });
  };

  /** "Read more" after the summary opens Product details and scrolls to it. */
  function bindReadMore(root) {
    var link = query(root, "[data-mtc-read-more]");
    var details = query(root, "[data-mtc-product-details]");
    if (!link || !details) return;

    link.addEventListener("click", function (event) {
      event.preventDefault();
      details.open = true;
      details.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  function init() {
    queryAll(document, "[data-mtc-root]").forEach(function (root) {
      if (root.dataset.mtcReady === "true") return;

      root.dataset.mtcReady = "true";
      bindReadMore(root);

      var block = new Block(root);
      block.bindVariants();
      block.followImageBlock();
      block.start();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  // Re-run when a merchant drops the block in, or the theme swaps a section.
  document.addEventListener("shopify:section:load", init);
  document.addEventListener("shopify:block:select", init);
})();
