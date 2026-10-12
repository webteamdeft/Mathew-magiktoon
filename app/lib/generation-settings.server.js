/**
 * The prompt and model choices an admin can attach to a design (Milestone 4).
 *
 * SERVER ONLY.
 */

import prisma from "../db.server.js";
import { asArray, toTrimmedString } from "./normalize.js";
import { RESOLUTION_OPTIONS } from "./generation-config.js";

export { RESOLUTION_OPTIONS };

/**
 * Prompts and AI models this shop can pick from, as Polaris `Select` options.
 *
 * Draft prompts are listed but labelled, so the admin can see that a design is
 * pointing at one — `resolveGenerationConfig` refuses to run a draft, and a
 * silently missing entry would make that look like a bug rather than a choice.
 *
 * Disabled models are omitted entirely: there is no reason to newly assign one,
 * and an assignment that already exists falls back to the default model.
 */
export async function listGenerationOptions(shop) {
  const [prompts, models] = await Promise.all([
    prisma.prompt.findMany({
      where: { shop },
      orderBy: [{ status: "asc" }, { name: "asc" }],
      select: { id: true, name: true, status: true },
    }),
    prisma.aiModel.findMany({
      where: { shop, enabled: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true, modelKey: true, pricePerImage: true },
    }),
  ]);

  return {
    // Keyed by id so the mapping form can tell whether the prompt it points at
    // will actually run, without re-reading the database.
    promptsById: Object.fromEntries(
      asArray(prompts).map((prompt) => [
        prompt.id,
        { name: prompt.name, status: toTrimmedString(prompt.status).toUpperCase() },
      ]),
    ),
    promptOptions: [
      { label: "— No prompt (cannot generate) —", value: "" },
      ...asArray(prompts).map((prompt) => ({
        value: prompt.id,
        label:
          toTrimmedString(prompt.status).toUpperCase() === "ACTIVE"
            ? prompt.name
            : `${prompt.name} (${toTrimmedString(prompt.status).toLowerCase()} — will not run)`,
      })),
    ],
    modelOptions: [
      { label: "— Use the default model —", value: "" },
      ...asArray(models).map((model) => ({
        value: model.id,
        label: model.pricePerImage
          ? `${model.name} (${model.modelKey})`
          : `${model.name} (${model.modelKey}) — no rate set`,
      })),
    ],
    resolutionOptions: RESOLUTION_OPTIONS,
  };
}
