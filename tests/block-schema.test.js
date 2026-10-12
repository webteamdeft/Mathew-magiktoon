import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

/**
 * Validate the theme app extension's `{% schema %}`.
 *
 * WHY THIS EXISTS
 * ---------------
 * `shopify theme check` does NOT validate app-block schema. Only the CLI
 * bundler does, and it only runs during `shopify app dev` / `deploy` — so an
 * invalid schema passes every local check and then blocks the dev server with
 * a one-line error, sometimes minutes later.
 *
 * That has already happened twice:
 *   · `"presets"` — a theme *section* key, not valid on an app block
 *   · `"default": ""` — a present-but-blank default, which Shopify rejects
 *
 * Both were avoidable. These tests make the schema fail here instead.
 */

const EXTENSION = new URL(
  "../extensions/magiktoon-personalization/",
  import.meta.url,
);

/** Every app block in the extension, so a new one cannot skip these checks. */
const BLOCKS = readdirSync(new URL("blocks/", EXTENSION))
  .filter((name) => name.endsWith(".liquid"))
  .map((name) => {
    const source = readFileSync(new URL(`blocks/${name}`, EXTENSION), "utf8");

    return {
      name,
      source,
      schema: JSON.parse(/{% schema %}([\s\S]*?){% endschema %}/.exec(source)[1]),
    };
  });

/** The only keys a theme app extension block schema accepts. */
const ALLOWED_KEYS = new Set([
  "name",
  "target",
  "javascript",
  "stylesheet",
  "settings",
  "available_if",
  "enabled_on",
  "disabled_on",
]);

/** Settings that carry no value, so need no id or label. */
const CONTENT_TYPES = new Set(["header", "paragraph"]);

test("every block is discovered", () => {
  assert.ok(BLOCKS.length >= 2, "expected the form block and the image block");
});

/**
 * Shopify accepts two targets, and the difference is not cosmetic.
 *
 *   "section" — a block a merchant drags into a template.
 *   "body"    — an app embed, loaded on every page whether or not a merchant
 *                places it. The cart block has to be one: a cart is rendered
 *                by the theme and by a drawer that can open anywhere, so there
 *                is nowhere to drop a section block.
 *
 * Anything else is a typo, and the bundler accepts it silently.
 */
const TARGETS = new Set(["section", "body"]);

test("each schema is valid JSON with a name and a real target", () => {
  for (const block of BLOCKS) {
    assert.equal(typeof block.schema.name, "string", block.name);
    assert.ok(block.schema.name.length > 0, block.name);
    assert.ok(
      TARGETS.has(block.schema.target),
      `${block.name}: target "${block.schema.target}" is neither "section" nor "body".`,
    );
  }
});

test("the cart block is an app embed, not a section block", () => {
  // A section block would only run where a merchant had placed it, and there
  // is nowhere to place one in a cart drawer.
  const cart = BLOCKS.find((block) => block.name.includes("cart-mockup"));

  assert.ok(cart, "the cart block should be discovered");
  assert.equal(cart.schema.target, "body");
});

test("no key outside the app-block schema is used", () => {
  for (const block of BLOCKS) {
    for (const key of Object.keys(block.schema)) {
      assert.ok(
        ALLOWED_KEYS.has(key),
        `${block.name}: "${key}" is not valid on a theme app extension block. ` +
          `"presets" in particular is a theme *section* key and breaks the bundler.`,
      );
    }
  }
});

test("no setting carries a blank default", () => {
  // Shopify rejects `"default": ""` outright: omit the key instead, and use
  // `placeholder` if the field needs a hint.
  for (const block of BLOCKS) {
    for (const setting of block.schema.settings || []) {
      if (!("default" in setting)) continue;

      assert.notEqual(
        setting.default,
        "",
        `${block.name}: "${setting.id}" has a blank default; omit the key instead`,
      );
      assert.notEqual(setting.default, null, `${block.name}: "${setting.id}" is null`);
    }
  }
});

test("every value-bearing setting has an id and a label", () => {
  for (const block of BLOCKS) {
    for (const setting of block.schema.settings || []) {
      if (CONTENT_TYPES.has(setting.type)) continue;

      assert.ok(setting.id, `${block.name}: a ${setting.type} setting has no id`);
      assert.ok(setting.label, `${block.name}: "${setting.id}" has no label`);
    }
  }
});

test("setting ids are unique within each block", () => {
  for (const block of BLOCKS) {
    const ids = (block.schema.settings || [])
      .filter((setting) => setting.id)
      .map((setting) => setting.id);

    assert.equal(new Set(ids).size, ids.length, `${block.name}: duplicate setting id`);
  }
});

test("every setting a block reads is declared in its schema", () => {
  // A `block.settings.x` with no matching setting is silently empty forever.
  for (const block of BLOCKS) {
    const referenced = new Set(
      [...block.source.matchAll(/block\.settings\.([a-z0-9_]+)/g)].map((m) => m[1]),
    );

    const declared = new Set((block.schema.settings || []).map((s) => s.id));

    for (const id of referenced) {
      assert.ok(
        declared.has(id),
        `${block.name}: block.settings.${id} is used but not declared`,
      );
    }
  }
});

test("the assets each schema names actually exist", () => {
  for (const block of BLOCKS) {
    for (const asset of [block.schema.javascript, block.schema.stylesheet]) {
      if (!asset) continue;

      assert.doesNotThrow(
        () => readFileSync(new URL(`assets/${asset}`, EXTENSION)),
        `${block.name}: ${asset} is missing`,
      );
    }
  }
});
