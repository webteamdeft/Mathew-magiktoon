/**
 * Prompt reads and deletes for the admin (SERVER ONLY).
 *
 * The delete guard lives in `prompt-usage.js` so the button and the action
 * agree; this module supplies the counts it decides on.
 */

import prisma from "../db.server.js";
import { asArray, toTrimmedString } from "./normalize.js";
import { canDeletePrompt, promptDeleteBlockedMessage } from "./prompt-usage.js";

/**
 * Every prompt for a shop, each carrying how many products depend on it.
 *
 * `usedBy` names the product mappings, so a refused delete can say exactly
 * where to go and fix it rather than leaving the merchant to search.
 */
export async function listPromptsWithUsage(shop) {
  const prompts = await prisma.prompt.findMany({
    where: { shop },
    orderBy: { updatedAt: "desc" },
    include: {
      _count: { select: { productMappings: true, productConfigurations: true } },
      productMappings: { select: { shopifyProductTitle: true, designLabel: true } },
    },
  });

  return asArray(prompts).map((prompt) => ({
    ...prompt,
    usedBy: asArray(prompt.productMappings)
      .map((mapping) => mapping.shopifyProductTitle || mapping.designLabel)
      .filter(Boolean),
    // The relation rows themselves are not needed by the page, and shipping
    // them would put every product title into the HTML twice.
    productMappings: undefined,
  }));
}

/**
 * Delete a prompt, unless a product still depends on it.
 *
 * @returns {Promise<{ ok: boolean, error?: string, name?: string }>}
 */
export async function deletePrompt(shop, id) {
  const promptId = toTrimmedString(id);

  if (!promptId) {
    return { ok: false, error: "Prompt ID is missing." };
  }

  const prompt = await prisma.prompt.findFirst({
    where: { id: promptId, shop },
    include: {
      _count: { select: { productMappings: true, productConfigurations: true } },
      productMappings: { select: { shopifyProductTitle: true, designLabel: true } },
    },
  });

  if (!prompt) {
    return { ok: false, error: "Prompt was not found for this store." };
  }

  const withUsage = {
    ...prompt,
    usedBy: asArray(prompt.productMappings)
      .map((mapping) => mapping.shopifyProductTitle || mapping.designLabel)
      .filter(Boolean),
  };

  // Re-checked here rather than trusting the disabled button: the page may be
  // stale, and a product assigned since it loaded must still be protected.
  if (!canDeletePrompt(withUsage)) {
    return { ok: false, error: promptDeleteBlockedMessage(withUsage) };
  }

  await prisma.prompt.delete({ where: { id: prompt.id } });

  return { ok: true, name: prompt.name };
}
