import test from "node:test";
import assert from "node:assert/strict";

process.env.GELATO_API_KEY = process.env.GELATO_API_KEY || "test-key";
process.env.GELATO_STORE_ID = process.env.GELATO_STORE_ID || "test-store";

const {
  buildImagePlaceholders,
  buildTextPlaceholders,
  pickTemplateVariant,
  renderGelatoMockup,
} = await import("../app/lib/gelato-mockup.server.js");

const ARTWORK = "https://app.example.com/uploads/generated/a.png?exp=1&sig=x";

const MAPPING = {
  id: "map_mug",
  gelatoTemplateId: "tpl_mug",
  gelatoVariantId: "var_white",
  gelatoPlaceholderName: "ImageFront",
  gelatoTextPlaceholders: [{ name: "Text 4" }],
};

/** The 11oz mug template: one variant, the SAME placeholder twice. */
const TEMPLATE = {
  id: "tpl_mug",
  variants: [
    {
      id: "var_white",
      title: "Ceramic White",
      imagePlaceholders: [
        { name: "art.png", printArea: "1" },
        { name: "art.png", printArea: "1" },
      ],
      textPlaceholders: [{ name: "Text 4", text: "AUGUST 2026" }],
    },
    { id: "var_black", title: "Ceramic Black", imagePlaceholders: [{ name: "art.png" }] },
  ],
};

test("a twin-image template gets the artwork in both placeholders", () => {
  // The mug template carries the same placeholder twice. Sending it once left
  // half the mug blank.
  const placeholders = buildImagePlaceholders(TEMPLATE.variants[0], MAPPING, ARTWORK);

  assert.equal(placeholders.length, 2);
  assert.ok(placeholders.every((entry) => entry.fileUrl === ARTWORK));
  assert.ok(placeholders.every((entry) => entry.fitMethod === "slice"));
});

test("a nominated placeholder carries the background instead of the artwork", () => {
  // The mug template lists the same placeholder twice. Naming it as the
  // background must not send the artwork to it as well.
  const withBackground = { ...MAPPING, backgroundPlaceholderName: "art.png" };

  const placeholders = buildImagePlaceholders(
    TEMPLATE.variants[0],
    withBackground,
    ARTWORK,
    "https://app.example.com/uploads/backgrounds/bg.png?exp=1&sig=y",
  );

  assert.equal(placeholders.length, 1, "the duplicate is collapsed");
  assert.match(placeholders[0].fileUrl, /backgrounds\/bg\.png/);
});

test("no background uploaded means the placeholder still takes the artwork", () => {
  // Honouring the nomination with no file would print an empty area.
  const withBackground = { ...MAPPING, backgroundPlaceholderName: "art.png" };

  const placeholders = buildImagePlaceholders(
    TEMPLATE.variants[0],
    withBackground,
    ARTWORK,
    "",
  );

  assert.equal(placeholders.length, 2);
  assert.ok(placeholders.every((entry) => entry.fileUrl === ARTWORK));
});

test("a background nominated on a placeholder the template lacks changes nothing", () => {
  const withBackground = { ...MAPPING, backgroundPlaceholderName: "not-in-template" };

  const placeholders = buildImagePlaceholders(
    TEMPLATE.variants[0],
    withBackground,
    ARTWORK,
    "https://app.example.com/uploads/backgrounds/bg.png",
  );

  assert.equal(placeholders.length, 2);
  assert.ok(placeholders.every((entry) => entry.fileUrl === ARTWORK));
});

test("a template we cannot read falls back to the mapped placeholder name", () => {
  const placeholders = buildImagePlaceholders(null, MAPPING, ARTWORK);

  assert.deepEqual(placeholders, [
    { name: "ImageFront", fileUrl: ARTWORK, fitMethod: "slice" },
  ]);
});

test("only text areas the template declares are sent", () => {
  // An unknown name is rejected by Gelato and would fail the whole render, so
  // a stale field must never reach it.
  const text = buildTextPlaceholders(TEMPLATE.variants[0], MAPPING, {
    "Text 4": "MATTHEW",
    "Deleted Field": "should not be sent",
  });

  assert.deepEqual(text, [{ name: "Text 4", text: "MATTHEW" }]);
});

test("blank text is left out so the template keeps its own wording", () => {
  const text = buildTextPlaceholders(TEMPLATE.variants[0], MAPPING, { "Text 4": "   " });

  assert.deepEqual(text, []);
});

test("the mapped variant is chosen, not merely the first", () => {
  assert.equal(pickTemplateVariant(TEMPLATE, MAPPING).id, "var_white");
  assert.equal(
    pickTemplateVariant(TEMPLATE, { gelatoVariantId: "var_black" }).id,
    "var_black",
  );
  // An unknown variant falls back rather than failing the preview.
  assert.equal(pickTemplateVariant(TEMPLATE, { gelatoVariantId: "gone" }).id, "var_white");
  assert.equal(pickTemplateVariant({ variants: [] }, MAPPING), null);
});

/** A fake Gelato that renders on the second poll. */
function fakeGelato({ previewAfter = 1, failCreate = false } = {}) {
  const calls = [];
  let polls = 0;

  return {
    calls,
    request: async (path, options = {}) => {
      calls.push({ path, method: options.method || "GET" });

      if (path.startsWith("/templates/")) return TEMPLATE;

      if (path.includes(":create-from-template")) {
        if (failCreate) throw new Error("Gelato E-commerce API 400: bad body");

        return { id: "prod_1", previewUrl: "" };
      }

      if (options.method === "DELETE") return {};

      polls += 1;

      return polls >= previewAfter
        ? { previewUrl: "https://gelato.example.com/preview.jpg" }
        : { previewUrl: "" };
    },
  };
}

function deps(gelato, overrides = {}) {
  let clock = 0;

  return {
    request: gelato.request,
    fetchImpl: async () => ({
      ok: true,
      arrayBuffer: async () => new ArrayBuffer(64),
      headers: { get: () => "image/jpeg" },
    }),
    store: async () => "mockups/shop/abc.jpg",
    wait: async () => {},
    now: () => (clock += 500),
    timeoutMs: 25000,
    ...overrides,
  };
}

test("a mockup is rendered, copied out of Gelato, and stored as our own asset", async () => {
  const gelato = fakeGelato();

  const result = await renderGelatoMockup(
    { shop: "demo.myshopify.com", mapping: MAPPING, artworkUrl: ARTWORK },
    deps(gelato),
  );

  assert.equal(result.ok, true);
  assert.equal(result.key, "mockups/shop/abc.jpg");

  // Gelato's own link is presigned for 24 hours and dies with the product, so
  // it must never be what gets persisted.
  assert.equal("previewUrl" in result, false);
});

test("the throwaway product is always deleted, even after a good render", async () => {
  const gelato = fakeGelato();

  await renderGelatoMockup(
    { shop: "demo.myshopify.com", mapping: MAPPING, artworkUrl: ARTWORK },
    deps(gelato),
  );

  const deletes = gelato.calls.filter((call) => call.method === "DELETE");

  assert.equal(deletes.length, 1, "one preview product, one delete");
  assert.match(deletes[0].path, /prod_1/);
});

test("a render that never produces a preview times out cleanly", async () => {
  const gelato = fakeGelato({ previewAfter: 9999 });

  const result = await renderGelatoMockup(
    { shop: "demo.myshopify.com", mapping: MAPPING, artworkUrl: ARTWORK },
    deps(gelato, { timeoutMs: 2000 }),
  );

  assert.equal(result.ok, false);
  assert.equal(result.code, "TIMED_OUT");
  // And still cleans up.
  assert.equal(gelato.calls.filter((call) => call.method === "DELETE").length, 1);
});

test("a design with no template cannot be previewed, and nothing is created", async () => {
  const gelato = fakeGelato();

  const result = await renderGelatoMockup(
    { shop: "demo.myshopify.com", mapping: { gelatoTemplateId: "" }, artworkUrl: ARTWORK },
    deps(gelato),
  );

  assert.equal(result.ok, false);
  assert.equal(result.code, "NOT_CONFIGURED");
  assert.equal(gelato.calls.length, 0);
});

test("a preview without artwork is refused before any Gelato call", async () => {
  const gelato = fakeGelato();

  const result = await renderGelatoMockup(
    { shop: "demo.myshopify.com", mapping: MAPPING, artworkUrl: "" },
    deps(gelato),
  );

  assert.equal(result.ok, false);
  assert.equal(result.code, "NO_ARTWORK");
  assert.equal(gelato.calls.length, 0);
});

test("a Gelato failure becomes a customer-safe message, not an API error", async () => {
  const gelato = fakeGelato({ failCreate: true });

  const result = await renderGelatoMockup(
    { shop: "demo.myshopify.com", mapping: MAPPING, artworkUrl: ARTWORK },
    deps(gelato),
  );

  assert.equal(result.ok, false);
  assert.equal(result.code, "PREVIEW_FAILED");
  assert.doesNotMatch(result.error, /400|Gelato E-commerce|API/);
});

/**
 * "The preview took too long to generate."
 *
 * Measured against the live API: a clean render produces a previewUrl in about
 * ten seconds, well inside the 25 second timeout. But when Gelato cannot
 * download the artwork we sent it, the product goes to `publishing_error` at
 * around twenty seconds — and the loop used to ignore `status` entirely, so a
 * failure Gelato had already reported became a timeout, and the customer was
 * told the wrong thing about their own design.
 */

/** A Gelato that accepts the product, then reports it could not publish it. */
function failingGelato(publishingErrors = []) {
  const calls = [];

  return {
    calls,
    request: async (path, options = {}) => {
      calls.push({ path, method: options.method || "GET" });

      if (path.startsWith("/templates/")) return TEMPLATE;
      if (path.includes(":create-from-template")) return { id: "prod_1", previewUrl: "" };
      if (options.method === "DELETE") return {};

      return { previewUrl: "", status: "publishing_error", publishingErrors };
    },
  };
}

test("a publishing error ends the wait instead of running down the clock", async () => {
  const gelato = failingGelato();

  const result = await renderGelatoMockup(
    { shop: "demo.myshopify.com", mapping: MAPPING, artworkUrl: ARTWORK },
    deps(gelato),
  );

  assert.equal(result.ok, false);
  assert.equal(result.code, "PREVIEW_FAILED");
  assert.doesNotMatch(result.error, /too long/, "this was not a timeout");
  assert.match(result.detail, /publishing_error/);
});

test("Gelato's own reason is carried through for the log", async () => {
  // Without it the only record is "preview failed", and the actual cause —
  // usually an artwork URL Gelato could not fetch — is lost.
  const gelato = failingGelato([{ message: "Could not download file" }]);

  const result = await renderGelatoMockup(
    { shop: "demo.myshopify.com", mapping: MAPPING, artworkUrl: ARTWORK },
    deps(gelato),
  );

  assert.equal(result.detail, "Could not download file");
});

test("the throwaway product is still deleted when publishing fails", async () => {
  const gelato = failingGelato();

  await renderGelatoMockup(
    { shop: "demo.myshopify.com", mapping: MAPPING, artworkUrl: ARTWORK },
    deps(gelato),
  );

  assert.equal(gelato.calls.filter((call) => call.method === "DELETE").length, 1);
});

test("artwork this app cannot fetch is refused before Gelato is touched", async () => {
  // If we cannot reach our own signed URL then neither can Gelato, and the
  // only symptom would be a 25 second wait ending in the wrong message. The
  // usual cause in development is a tunnel that has stopped or rotated.
  const gelato = fakeGelato();

  const result = await renderGelatoMockup(
    { shop: "demo.myshopify.com", mapping: MAPPING, artworkUrl: ARTWORK },
    deps(gelato, {
      fetchImpl: async () => {
        throw new Error("getaddrinfo ENOTFOUND old-tunnel.trycloudflare.com");
      },
    }),
  );

  assert.equal(result.ok, false);
  assert.equal(result.code, "ARTWORK_UNREACHABLE");
  assert.match(result.detail, /ENOTFOUND/);
  assert.equal(gelato.calls.length, 0, "nothing was created in Gelato");
});

test("artwork that answers with an error is refused just as clearly", async () => {
  const gelato = fakeGelato();

  const result = await renderGelatoMockup(
    { shop: "demo.myshopify.com", mapping: MAPPING, artworkUrl: ARTWORK },
    deps(gelato, { fetchImpl: async () => ({ ok: false, status: 403 }) }),
  );

  assert.equal(result.code, "ARTWORK_UNREACHABLE");
  assert.match(result.detail, /403/);
  assert.equal(gelato.calls.length, 0);
});
