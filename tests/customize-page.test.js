import test from "node:test";
import assert from "node:assert/strict";

import {
  renderCustomizePage,
  resolveProductNoun,
} from "../app/lib/customize-page.server.js";

const MAPPING = {
  mappingId: "map_1",
  textPlaceholders: [
    { name: "Text 4", defaultText: "AUGUST 2026", label: "AUGUST 2026" },
  ],
  shopifyProductId: "gid://shopify/Product/123",
  shopifyVariantId: "456",
  productTitle: "Classic Mug",
  productHandle: "classic-mug",
  previewUrl: "https://cdn.example.com/mug.png",
  templateName: "11oz Ceramic Mug",
  placeholderName: "ImageFront",
  printAreaName: "1",
  placeholderAspectRatio: 200 / 96,
  status: "ACTIVE",
};

function render(overrides = {}) {
  return renderCustomizePage({
    mapping: MAPPING,
    productId: "123",
    variantId: "456",
    returnUrl: "/products/classic-mug",
    customizationUrl: "/apps/magiktoon/customization",
    ...overrides,
  });
}

test("the page carries the product being customized through to the cart", () => {
  const html = render();
  const data = JSON.parse(
    /<script type="application\/json" id="mtcp-data">(.*?)<\/script>/s.exec(html)[1],
  );

  assert.equal(data.productId, "123");
  assert.equal(data.variantId, "456");
  assert.equal(data.mapping.mappingId, "map_1");
  assert.equal(data.customizationUrl, "/apps/magiktoon/customization");
});

test("the real placeholder shape reaches the browser", () => {
  const html = render();
  const data = JSON.parse(
    /<script type="application\/json" id="mtcp-data">(.*?)<\/script>/s.exec(html)[1],
  );

  // A mug placeholder is a wide banner, not the circle the mockup suggested.
  assert.equal(data.mapping.placeholderAspectRatio, 200 / 96);
});

test("style and script blocks are protected from the theme's Liquid engine", () => {
  const html = render();

  // Without {% raw %}, Liquid would try to parse the CSS and JS as tags.
  assert.equal((html.match(/\{% raw %\}/g) || []).length, 2);
  assert.equal((html.match(/\{% endraw %\}/g) || []).length, 2);

  const styleIndex = html.indexOf("<style>");
  const rawIndex = html.indexOf("{% raw %}");
  assert.ok(rawIndex < styleIndex, "the style block opens inside a raw block");
});

test("the back link returns to the product page", () => {
  const html = render();

  assert.ok(html.includes('href="/products/classic-mug"'));
  assert.ok(html.includes("Back to Classic Mug"));
});

test("markup is escaped so a product title cannot inject HTML", () => {
  const html = render({
    mapping: {
      ...MAPPING,
      productTitle: '<img src=x onerror="alert(1)">',
    },
  });

  assert.equal(html.includes('onerror="alert(1)"'), false);
  assert.ok(html.includes("&lt;img src=x"));
});

test("page data cannot close the script tag early", () => {
  const html = render({
    mapping: { ...MAPPING, templateName: "</script><script>alert(1)</script>" },
  });

  const block = /<script type="application\/json" id="mtcp-data">(.*?)<\/script>/s.exec(
    html,
  )[1];

  assert.equal(block.includes("</script>"), false);
  assert.equal(JSON.parse(block).mapping.templateName, "</script><script>alert(1)</script>");
});

test("the four steps of the approved design are all present", () => {
  const html = render({ product: { title: "Classic Mug", type: "Mug" } });

  for (const heading of [
    "Step 1. Upload Your Image",
    "Step 2. Add Your Text",
    "Step 3. Generate Your Artwork",
    "Step 4. Preview On The Product",
  ]) {
    assert.ok(html.includes(heading), `${heading} is missing`);
  }

  // Shopify's product type supplies the noun, so the heading reads as the
  // design does rather than repeating the whole product title.
  assert.ok(html.includes("Personalise Your Mug"));
  assert.ok(
    html.includes("Upload a photo and add a name to make it one of a kind."),
  );
});

test("the mockups get a thumbnail row under the main image, hidden until there are some", () => {
  const html = render();

  assert.ok(html.includes('<div class="mtcp__thumbs" id="mtcp-thumbs" hidden></div>'));
  // Under the stage, above the zoom controls.
  assert.ok(html.indexOf('id="mtcp-thumbs"') > html.indexOf('id="mtcp-stage"'));
  assert.ok(html.indexOf('id="mtcp-thumbs"') < html.indexOf('id="mtcp-zoom-out"'));
});

test("Gelato's mockups replace the quick stand-ins instead of being added to them", () => {
  const html = render();

  assert.ok(!html.includes("urls.concat(state.mockup.views)"));
});

test("one text input is rendered per Gelato text area", () => {
  const html = render({
    mapping: {
      ...MAPPING,
      textPlaceholders: [
        { name: "Text 4", defaultText: "AUGUST 2026", label: "AUGUST 2026" },
        { name: "Copy of Text 4", defaultText: "MATTHEW", label: "MATTHEW" },
      ],
    },
  });

  const inputs = html.match(/<input[^>]*data-mtcp-text[^>]*>/g) || [];
  assert.equal(inputs.length, 2);

  // The Gelato name is what fulfilment matches on; the default wording is the
  // only human-readable clue to what the field is for, so it becomes the label.
  assert.ok(inputs[0].includes('data-name="Text 4"'));
  assert.ok(inputs[0].includes('value="AUGUST 2026"'));
  assert.ok(html.includes("MATTHEW"));
});

test("a design with no text areas omits Step 2 entirely", () => {
  const html = render({ mapping: { ...MAPPING, textPlaceholders: [] } });

  assert.equal(html.includes("Step 2. Add Your Text"), false);

  // The page script always contains the `[data-mtcp-text]` selector, so assert
  // on rendered inputs rather than on the raw string appearing anywhere.
  assert.equal((html.match(/<input[^>]*data-mtcp-text[^>]*>/g) || []).length, 0);
});

test("the heading finds the noun in the title with no product type", () => {
  // "Personalise Your Classic Mug" was the old behaviour; the noun alone
  // reads better and is what the title search now produces.
  assert.ok(render().includes("Personalise Your Mug"));
});

test("steps 3 and 4 render disabled, as the design shows them", () => {
  const html = render();

  // Generate is Gemini (Milestone 4); Preview on Product is the Gelato mockup
  // (Milestone 5). Both are stubs until those land.
  for (const id of ["mtcp-generate", "mtcp-preview"]) {
    const button = new RegExp(`<button[^>]*id="${id}"[^>]*>`).exec(html)[0];
    assert.ok(button.includes("disabled"), `${id} should be disabled`);
  }
});

test("add to cart starts blocked and is the only call to action", () => {
  const html = render();

  const cart = /<button[^>]*id="mtcp-cart"[^>]*>/.exec(html)[0];
  assert.ok(cart.includes("disabled"), "nothing can be bought without a photo");

  // The approved design has a single CTA: saving happens inside adding to cart.
  assert.equal(html.includes('id="mtcp-save"'), false);
  assert.equal(html.includes("Save Design"), false);
});

test("a missing product preview degrades instead of breaking the page", () => {
  const html = render({
    mapping: { ...MAPPING, previewUrl: "", productImageUrl: "" },
  });

  assert.ok(html.includes("Product preview unavailable"));
  assert.equal(html.includes('id="mtcp-product-img"'), false);
});

// ---------------------------------------------------------------------------
// The original Shopify product is the thing being sold. The Gelato template is
// only the design reference applied to it.
// ---------------------------------------------------------------------------

test("the hero image is the Shopify product, not the Gelato mockup", () => {
  const html = render({
    product: {
      title: "Classic Mug",
      imageUrl: "https://cdn.shopify.com/real-product.png",
    },
  });

  assert.ok(html.includes("https://cdn.shopify.com/real-product.png"));

  const stage = /<img class="mtcp__stage-img"[^>]*>/.exec(html)[0];
  assert.equal(stage.includes("cdn.example.com/mug.png"), false);
});

test("the page states the exact product, variant and price being bought", () => {
  const html = render({
    product: {
      title: "Classic Mug",
      imageUrl: "https://cdn.shopify.com/real-product.png",
      variantTitle: "Ceramic White",
      price: "£14.00",
    },
  });

  assert.ok(html.includes("You are buying"));
  assert.ok(html.includes("Classic Mug"));
  assert.ok(html.includes("Ceramic White"));
  assert.ok(html.includes("£14.00"));
});

test("choosing a design never changes the product or variant", () => {
  const second = {
    ...MAPPING,
    mappingId: "map_2",
    templateName: "Wrap-around Mug",
    designLabel: "Wrap-around",
  };

  const html = render({ templates: [MAPPING, second] });
  const data = JSON.parse(
    /<script type="application\/json" id="mtcp-data">(.*?)<\/script>/s.exec(html)[1],
  );

  assert.equal(data.templates.length, 2);

  // One product id and one variant id for the whole page: the chooser only
  // swaps `state.mapping`, which carries no Shopify identity of its own.
  assert.equal(data.productId, "123");
  assert.equal(data.variantId, "456");
});

test("the design chooser appears only when there is a choice to make", () => {
  assert.equal(render().includes('id="mtcp-designs"'), false);

  const html = render({
    templates: [MAPPING, { ...MAPPING, mappingId: "map_2", designLabel: "Wrap" }],
  });

  assert.ok(html.includes('id="mtcp-designs"'));
  assert.ok(html.includes('role="radiogroup"'));
  assert.ok(html.includes("Wrap"));
});

test("each design carries its own print guide", () => {
  const html = render({
    mapping: { ...MAPPING, printArea: { x: 0.28, y: 0.34, size: 0.46 } },
  });

  const data = JSON.parse(
    /<script type="application\/json" id="mtcp-data">(.*?)<\/script>/s.exec(html)[1],
  );

  assert.deepEqual(data.mapping.printArea, { x: 0.28, y: 0.34, size: 0.46 });
  // The page-level value is only the fallback for a design without one.
  assert.deepEqual(data.printArea, { x: 0.28, y: 0.34, size: 0.46 });
});

test("a design with no print guide falls back rather than collapsing", () => {
  const withoutArea = { ...MAPPING };
  delete withoutArea.printArea;

  const html = render({ mapping: withoutArea });

  const data = JSON.parse(
    /<script type="application\/json" id="mtcp-data">(.*?)<\/script>/s.exec(html)[1],
  );

  assert.ok(data.printArea.size > 0, "a zero-size guide would be undraggable");
});

test("the selected design is the one marked as checked", () => {
  const second = { ...MAPPING, mappingId: "map_2", designLabel: "Wrap" };

  const html = render({ mapping: second, templates: [MAPPING, second] });

  const checked = /data-mapping-id="map_2"/.test(html);
  assert.ok(checked);

  const buttons = html.match(/<button type="button" class="mtcp__design"[\s\S]*?>/g);
  const checkedCount = buttons.filter((b) => b.includes('aria-checked="true"')).length;

  assert.equal(checkedCount, 1, "exactly one design is selected");
});

// ---------------------------------------------------------------------------
// The two images are deliberately swapped between the two surfaces:
//   product page  → Gelato template fills the gallery
//   customizer    → original Shopify product photo is the base
// Getting these the wrong way round is an easy regression, so it is pinned.
// ---------------------------------------------------------------------------

test("the customizer base image is the Shopify product, never the template", () => {
  const html = render({
    mapping: {
      ...MAPPING,
      previewUrl: "https://gelato.example.com/template.png",
      productImageUrl: "https://cdn.shopify.com/from-mapping.png",
    },
    product: {
      title: "Classic Mug",
      imageUrl: "https://cdn.shopify.com/live-product.png",
    },
  });

  const stage = /<img class="mtcp__stage-img"[^>]*>/.exec(html)[0];

  assert.ok(stage.includes("https://cdn.shopify.com/live-product.png"));
  assert.equal(stage.includes("gelato.example.com"), false);
});

test("the theme's own product image outranks the one stored on the mapping", () => {
  // The mapping's copy is a snapshot taken when the merchant mapped it; the
  // theme's is current.
  const html = render({
    mapping: { ...MAPPING, productImageUrl: "https://cdn.shopify.com/stale.png" },
    product: { title: "Classic Mug", imageUrl: "https://cdn.shopify.com/fresh.png" },
  });

  const stage = /<img class="mtcp__stage-img"[^>]*>/.exec(html)[0];

  assert.ok(stage.includes("fresh.png"));
  assert.equal(stage.includes("stale.png"), false);
});

test("a product with no image of its own still renders a base", () => {
  const html = render({
    mapping: {
      ...MAPPING,
      productImageUrl: "",
      previewUrl: "https://gelato.example.com/template.png",
    },
    product: { title: "Classic Mug", imageUrl: "" },
  });

  // Last resort only: showing the template beats showing an empty stage.
  const stage = /<img class="mtcp__stage-img"[^>]*>/.exec(html)[0];
  assert.ok(stage.includes("gelato.example.com/template.png"));
});

/**
 * The progress display shown while artwork is generated.
 *
 * It exists because a spinning circle is fine for two seconds and wrong for
 * fifty: it says "busy" but never "getting somewhere", so a long wait reads as
 * a frozen page and the customer reloads — losing the generation they have
 * already waited through.
 */

test("a progress bar is rendered, hidden until generation starts", () => {
  const html = render();

  assert.match(html, /id="mtcp-progress" hidden/, "must not show before Generate is pressed");
  assert.match(html, /role="progressbar"/, "real semantics, not a decorative div");
  assert.match(html, /aria-valuemin="0"/);
});

test("the wait is narrated in words and in seconds", () => {
  // Two different reassurances. The words say a stage changed; the counter
  // says time is passing at all, which is what answers "has it frozen?".
  const html = render();

  assert.match(html, /id="mtcp-progress-stage"/);
  assert.match(html, /id="mtcp-progress-time"/);
  assert.match(html, /aria-live="polite"/, "a screen reader hears each stage once");
});

test("the page is told how long to expect, but never which model", () => {
  // The duration paces the bar. Which model a shop runs is its own business
  // and has no reason to reach a customer's browser.
  const html = render({
    mapping: { ...MAPPING, expectedGenerationMs: 45000 },
  });

  const data = JSON.parse(
    /<script type="application\/json" id="mtcp-data">(.*?)<\/script>/s.exec(html)[1],
  );

  assert.equal(data.expectedGenerationMs, 45000);
  assert.doesNotMatch(html, /gemini-3-pro-image/, "the model name must not leak");
});

test("a design with no estimate still gets a usable one", () => {
  // A design mapped before this field existed must not divide by nothing.
  const html = render();

  const data = JSON.parse(
    /<script type="application\/json" id="mtcp-data">(.*?)<\/script>/s.exec(html)[1],
  );

  assert.ok(data.expectedGenerationMs > 0);
});



/**
 * Which noun the panel heading uses.
 *
 * Reported from the live site: the heading read "Personalise Your Print
 * Material". Gelato stamps that product type onto everything it publishes
 * into Shopify, and the heading trusted it. The noun is in the title.
 */
test("the noun comes from the title when Gelato's generic type is all there is", () => {
  assert.equal(
    resolveProductNoun("Her Fashion Icon Mug, 11oz Ceramic", "Print Material"),
    "Mug",
  );
});

test("a longer noun wins over a shorter one it contains", () => {
  assert.equal(resolveProductNoun("Custom Tote Bag, Natural Cotton", ""), "Tote Bag");
  assert.equal(resolveProductNoun("Clear Phone Case for iPhone", ""), "Phone Case");
});

test("a plural in the title still yields the singular noun", () => {
  assert.equal(
    resolveProductNoun("Birthday Superhero Cards | A6 Folded, Pack of 10", ""),
    "Card",
  );
});

test("nouns match whole words only", () => {
  // "Print" inside "Fingerprint" and "Cap" inside "Capsule" both used to be
  // the kind of thing a bare substring search gets wrong.
  assert.equal(resolveProductNoun("Fingerprint Keepsake Capsule", ""), "Product");
});

test("a product type a shopper would recognise is still used", () => {
  assert.equal(resolveProductNoun("Something Unrecognisable", "Ceramic Mug"), "Ceramic Mug");
});

test("nothing recognisable anywhere gives a vague but never wrong noun", () => {
  assert.equal(resolveProductNoun("Something Unrecognisable", "Print Material"), "Product");
  assert.equal(resolveProductNoun("", ""), "Product");
});
