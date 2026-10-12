/**
 * Whether a prompt is safe to delete.
 *
 * Client-safe: pure functions, so the button state in the admin and the guard
 * in the action are decided by the same rule and cannot drift.
 *
 * Why a guard at all: `Prompt` is referenced by `ProductMapping.promptId` and
 * `ProductConfiguration.promptId`, both `onDelete: SetNull`. Deleting a prompt
 * that is in use therefore succeeds quietly and leaves the product pointing at
 * nothing — generation stops working on a live storefront with no error and no
 * trace of what changed. Refusing the delete is the only version of this that
 * a merchant can understand.
 */

function count(value) {
  const parsed = Number(value);

  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
}

/** Mappings and configurations that reference this prompt, counted separately. */
export function promptUsage(prompt) {
  const counts = prompt?._count || {};

  const mappings = count(counts.productMappings);
  const configurations = count(counts.productConfigurations);

  return {
    mappings,
    configurations,
    total: mappings + configurations,
    // Only mappings carry a product title, so only they can be named.
    names: (prompt?.usedBy || []).filter(Boolean),
  };
}

/** How many product configurations reference this prompt. */
export function promptUsageCount(prompt) {
  return promptUsage(prompt).total;
}

/** A prompt in use by nothing can be deleted. */
export function canDeletePrompt(prompt) {
  return promptUsageCount(prompt) === 0;
}

function plural(n, word) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/**
 * Why a delete was refused, in words a merchant can act on.
 *
 * The two reference tables are reported separately rather than summed into one
 * number: naming a single product mapping while claiming "4 products" reads as
 * a bug, and sends the merchant looking for three products that do not exist.
 */
export function promptDeleteBlockedMessage(prompt) {
  const usage = promptUsage(prompt);

  if (usage.total === 0) return "";

  const parts = [];

  if (usage.mappings > 0) {
    const named = usage.names.length > 0 ? ` (${usage.names.join(", ")})` : "";

    parts.push(`${plural(usage.mappings, "product mapping")}${named}`);
  }

  if (usage.configurations > 0) {
    parts.push(plural(usage.configurations, "product configuration"));
  }

  return (
    `"${prompt?.name || "This prompt"}" is used by ${parts.join(" and ")}. ` +
    "Assign a different prompt there first, or those products would stop " +
    "generating with no warning."
  );
}

/** Short label for the list, e.g. "Used by 2 products". */
export function promptUsageLabel(prompt) {
  const usage = promptUsage(prompt);

  if (usage.total === 0) return "Not in use";

  return `Used by ${plural(usage.total, "product")}`;
}
