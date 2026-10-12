import test from "node:test";
import assert from "node:assert/strict";

import {
  canDeletePrompt,
  promptDeleteBlockedMessage,
  promptUsageCount,
  promptUsageLabel,
} from "../app/lib/prompt-usage.js";

function prompt(overrides = {}) {
  return {
    name: "ICONE magazine",
    _count: { productMappings: 0, productConfigurations: 0 },
    usedBy: [],
    ...overrides,
  };
}

test("a prompt nothing depends on can be deleted", () => {
  assert.equal(canDeletePrompt(prompt()), true);
  assert.equal(promptUsageCount(prompt()), 0);
  assert.equal(promptUsageLabel(prompt()), "Not in use");
  assert.equal(promptDeleteBlockedMessage(prompt()), "");
});

test("a prompt a product mapping uses cannot be deleted", () => {
  // promptId is onDelete:SetNull, so deleting this would succeed silently and
  // leave a live product unable to generate.
  const inUse = prompt({
    _count: { productMappings: 1, productConfigurations: 0 },
    usedBy: ["11oz Mug"],
  });

  assert.equal(canDeletePrompt(inUse), false);
  assert.match(promptDeleteBlockedMessage(inUse), /11oz Mug/);
  assert.match(promptDeleteBlockedMessage(inUse), /1 product mapping/);
});

test("a prompt only a product configuration uses is still protected", () => {
  const inUse = prompt({
    _count: { productMappings: 0, productConfigurations: 2 },
  });

  assert.equal(canDeletePrompt(inUse), false);
  assert.equal(promptUsageCount(inUse), 2);
});

test("usage across both tables is counted together", () => {
  const inUse = prompt({
    _count: { productMappings: 2, productConfigurations: 1 },
    usedBy: ["11oz Mug", "Organic Tote Bag"],
  });

  assert.equal(promptUsageCount(inUse), 3);
  assert.equal(promptUsageLabel(inUse), "Used by 3 products");
});

test("the refusal names where the prompt is used, not just that it is", () => {
  const message = promptDeleteBlockedMessage(
    prompt({
      _count: { productMappings: 2, productConfigurations: 0 },
      usedBy: ["11oz Mug", "Framed Print"],
    }),
  );

  assert.match(message, /11oz Mug, Framed Print/);
  assert.match(message, /stop generating/i);
});

test("mappings and configurations are reported separately, never summed", () => {
  // Only mappings carry a product title. Claiming "4 products" while naming
  // one sends the merchant hunting for three that do not exist.
  const message = promptDeleteBlockedMessage(
    prompt({
      _count: { productMappings: 1, productConfigurations: 3 },
      usedBy: ["Framed Print or Canvas"],
    }),
  );

  assert.match(message, /1 product mapping \(Framed Print or Canvas\)/);
  assert.match(message, /3 product configurations/);
  assert.doesNotMatch(message, /4 product/);
});

test("a count with no product names still explains itself", () => {
  const message = promptDeleteBlockedMessage(
    prompt({ _count: { productMappings: 0, productConfigurations: 1 }, usedBy: [] }),
  );

  assert.match(message, /1 product configuration/);
  assert.doesNotMatch(message, /\(/);
});

test("a prompt with no counts loaded is treated as unused rather than crashing", () => {
  assert.equal(promptUsageCount({}), 0);
  assert.equal(promptUsageCount(null), 0);
  assert.equal(canDeletePrompt(undefined), true);
});
