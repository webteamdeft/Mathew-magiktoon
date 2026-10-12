import test from "node:test";
import assert from "node:assert/strict";

import {
  MAPPING_STATUSES,
  designRefFor,
  fulfillmentMode,
  fulfillmentModeLabel,
  normalizeMappingInput,
  placeholderAspectRatio,
  statusTone,
  validateMapping,
  firstErrorMessage,
} from "../app/lib/mapping-validation.js";

function completeMapping(overrides = {}) {
  return normalizeMappingInput({
    shopifyProductId: "gid://shopify/Product/1001",
    shopifyProductTitle: "Classic Mug",
    gelatoProductId: "gp_mug",
    gelatoVariantId: "gv_mug_11oz",
    // The catalog UID is what Gelato resolves an order against, so a mapping
    // without one is not complete however well the rest is filled in.
    gelatoProductUid: "mug_product_msz_11-oz_mmat_ceramic-white_cl_4-0",
    gelatoTemplateId: "gt_mug",
    gelatoPlaceholderName: "ImageFront",
    gelatoPrintAreaName: "front",
    gelatoPreviewUrl: "https://cdn.example.com/mug.png",
    status: "ACTIVE",
    ...overrides,
  });
}

test("normalizeMappingInput derives the numeric product id", () => {
  const mapping = completeMapping();

  assert.equal(mapping.shopifyProductNumericId, "1001");
});

test("normalizeMappingInput defaults placeholder, print area and status", () => {
  const mapping = normalizeMappingInput({ shopifyProductId: "1" });

  assert.equal(mapping.gelatoPlaceholderName, "ImageFront");
  assert.equal(mapping.gelatoPrintAreaName, "front");
  assert.equal(mapping.status, "DRAFT");
});

test("normalizeMappingInput rejects an unknown status", () => {
  const mapping = normalizeMappingInput({ status: "NONSENSE" });

  assert.equal(mapping.status, "DRAFT");
  assert.equal(MAPPING_STATUSES.includes(mapping.status), true);
});

test("normalizeMappingInput reads a FormData instance", () => {
  const formData = new FormData();
  formData.set("shopifyProductId", "gid://shopify/Product/2002");
  formData.set("shopifyProductTitle", "Tote Bag");
  formData.set("status", "ACTIVE");

  const mapping = normalizeMappingInput(formData);

  assert.equal(mapping.shopifyProductTitle, "Tote Bag");
  assert.equal(mapping.shopifyProductNumericId, "2002");
  assert.equal(mapping.status, "ACTIVE");
});

test("a complete mapping validates", () => {
  const { valid, errors } = validateMapping(completeMapping());

  assert.equal(valid, true);
  assert.deepEqual(errors, {});
});

test("every required Gelato field is enforced", () => {
  const { valid, errors } = validateMapping(normalizeMappingInput({}));

  assert.equal(valid, false);
  assert.ok(errors.shopifyProductId);
  assert.ok(errors.gelatoProductUid);
});

test("a template ID alone saves as a draft, but cannot go on sale", () => {
  // Pasting a template ID is still a valid way to start a mapping — the
  // preview works from it. It just cannot be activated, because the Order API
  // will not resolve a template and every order would be parked unprinted.
  const templateOnly = {
    gelatoProductId: "",
    gelatoProductName: "",
    gelatoVariantId: "",
    gelatoVariantName: "",
    gelatoProductUid: "",
    gelatoTemplateId: "c12a3b45-6789-4def-0123-456789abcdef",
  };

  const draft = validateMapping(
    completeMapping({ ...templateOnly, status: "DRAFT" }),
  );

  assert.equal(draft.valid, true, JSON.stringify(draft.errors));

  const active = validateMapping(
    completeMapping({ ...templateOnly, status: "ACTIVE" }),
  );

  assert.equal(active.valid, false);
  assert.ok(active.errors.gelatoProductUid);
});

test("a catalog product UID is accepted instead of a template", () => {
  const { valid, errors } = validateMapping(
    completeMapping({
      gelatoTemplateId: "",
      gelatoProductUid: "mug_product_msz_11-oz_mmat_ceramic-white_cl_4-0",
    }),
  );

  assert.equal(valid, true, JSON.stringify(errors));
});

test("a product UID alone is enough to fulfil", () => {
  const { valid, errors } = validateMapping(
    completeMapping({
      gelatoTemplateId: "",
      gelatoProductUid: "mug_product_msz_11-oz_mmat_ceramic-white_cl_4-0",
    }),
  );

  assert.equal(valid, true, JSON.stringify(errors));
});

test("a mapping with no product UID cannot be activated", () => {
  // This is the state every live mapping was in: a template mapped, a preview
  // rendering, and every order silently parked in Gelato as an unprintable
  // draft. Saving it as a draft is fine; selling it is not.
  const { valid, errors } = validateMapping(
    completeMapping({ gelatoProductUid: "", status: "ACTIVE" }),
  );

  assert.equal(valid, false);
  assert.match(errors.gelatoProductUid, /never printed/i);
});

test("a template-only mapping can still be saved as a draft", () => {
  const { valid } = validateMapping(
    completeMapping({ gelatoProductUid: "", status: "DRAFT" }),
  );

  assert.equal(valid, true);
});

test("a mapping with neither a template nor a product UID is refused", () => {
  const { valid, errors } = validateMapping(
    completeMapping({ gelatoTemplateId: "", gelatoProductUid: "" }),
  );

  assert.equal(valid, false);
  assert.ok(errors.gelatoProductUid);
});

test("the product UID decides printability, not the template", () => {
  // Verified against the live Order API: a templateId is never resolved.
  assert.equal(
    fulfillmentMode({ gelatoTemplateId: "gt_1", gelatoProductUid: "mug_uid" }),
    "catalog",
  );
  assert.equal(fulfillmentMode({ gelatoProductUid: "mug_uid" }), "catalog");
  assert.equal(fulfillmentMode({ gelatoTemplateId: "gt_1" }), "template-only");
  assert.equal(fulfillmentMode({}), "none");
});

test("fulfillmentModeLabel says plainly whether a design can be fulfilled", () => {
  assert.equal(
    fulfillmentModeLabel({ gelatoTemplateId: "gt" }),
    "Template only — cannot fulfil",
  );
  assert.equal(fulfillmentModeLabel({ gelatoProductUid: "uid" }), "Ready to fulfil");
  assert.equal(fulfillmentModeLabel({}), "Not printable");
});

test("an active mapping needs a preview image", () => {
  const { valid, errors } = validateMapping(
    completeMapping({ gelatoPreviewUrl: "" }),
  );

  assert.equal(valid, false);
  assert.ok(errors.gelatoPreviewUrl);
});

test("a draft mapping may have no preview yet", () => {
  const { valid } = validateMapping(
    completeMapping({ gelatoPreviewUrl: "", status: "DRAFT" }),
  );

  assert.equal(valid, true);
});

test("the preview must be an http(s) URL", () => {
  const { valid, errors } = validateMapping(
    completeMapping({ gelatoPreviewUrl: "javascript:alert(1)" }),
  );

  assert.equal(valid, false);
  assert.ok(errors.gelatoPreviewUrl);
});

test("placeholder dimensions are kept as numbers", () => {
  const mapping = completeMapping({
    gelatoPlaceholderWidth: "200",
    gelatoPlaceholderHeight: "96",
  });

  assert.equal(mapping.gelatoPlaceholderWidth, 200);
  assert.equal(mapping.gelatoPlaceholderHeight, 96);
});

test("unusable placeholder dimensions become null, never zero", () => {
  // A zero would collapse the print guide's aspect ratio rather than falling
  // back to a square, so junk has to be rejected outright.
  for (const junk of ["", "abc", "0", "-5", null, undefined]) {
    const mapping = completeMapping({
      gelatoPlaceholderWidth: junk,
      gelatoPlaceholderHeight: junk,
    });

    assert.equal(mapping.gelatoPlaceholderWidth, null, `width for ${junk}`);
    assert.equal(mapping.gelatoPlaceholderHeight, null, `height for ${junk}`);
  }
});

test("placeholderAspectRatio reports the real print shape", () => {
  // The mug template Gelato actually returns is 200 x 96 — nothing like a circle.
  assert.equal(
    placeholderAspectRatio({
      gelatoPlaceholderWidth: 200,
      gelatoPlaceholderHeight: 96,
    }),
    200 / 96,
  );
});

test("placeholderAspectRatio is null when Gelato reports no dimensions", () => {
  assert.equal(placeholderAspectRatio({}), null);
  assert.equal(placeholderAspectRatio(null), null);
  assert.equal(
    placeholderAspectRatio({ gelatoPlaceholderWidth: 200 }),
    null,
    "one dimension alone describes no shape",
  );
});

test("a design is identified by its template, or its product UID", () => {
  assert.equal(designRefFor({ gelatoTemplateId: "tpl_1" }), "tpl_1");
  assert.equal(designRefFor({ gelatoProductUid: "mug_uid" }), "uid:mug_uid");
  assert.equal(designRefFor({}), "");
});

test("a template design and a catalog design can never collide", () => {
  // Namespacing the catalog reference stops a product UID that happens to look
  // like a template id from overwriting a real template mapping.
  assert.notEqual(
    designRefFor({ gelatoTemplateId: "abc" }),
    designRefFor({ gelatoProductUid: "abc" }),
  );
});

test("one product can carry several designs, each with its own ref", () => {
  const first = normalizeMappingInput({
    shopifyProductId: "gid://shopify/Product/1001",
    gelatoTemplateId: "tpl_mug_a",
  });

  const second = normalizeMappingInput({
    shopifyProductId: "gid://shopify/Product/1001",
    gelatoTemplateId: "tpl_mug_b",
  });

  assert.equal(first.shopifyProductId, second.shopifyProductId);
  assert.notEqual(first.designRef, second.designRef);
});

test("design label and sort order survive normalization", () => {
  const mapping = completeMapping({ designLabel: "  Classic  ", sortOrder: "2" });

  assert.equal(mapping.designLabel, "Classic");
  assert.equal(mapping.sortOrder, 2);
});

test("a junk sort order falls back to zero rather than NaN", () => {
  assert.equal(completeMapping({ sortOrder: "abc" }).sortOrder, 0);
  assert.equal(completeMapping({ sortOrder: "" }).sortOrder, 0);
});

test("statusTone maps each status to a Polaris tone", () => {
  assert.equal(statusTone("ACTIVE"), "success");
  assert.equal(statusTone("DISABLED"), "critical");
  assert.equal(statusTone("DRAFT"), "attention");
});

test("firstErrorMessage surfaces something to show the merchant", () => {
  assert.equal(firstErrorMessage({ a: "first", b: "second" }), "first");
  assert.equal(firstErrorMessage({}), "");
  assert.equal(firstErrorMessage(null), "");
});
