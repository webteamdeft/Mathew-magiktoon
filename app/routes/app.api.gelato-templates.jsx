import { authenticate } from "../shopify.server";
import { listGelatoTemplates } from "../lib/gelato.server";
import { asArray } from "../lib/normalize";

/**
 * GET /app/api/gelato-templates
 *
 * Admin-only template list used by the legacy `/app/templates` screen, which
 * has always fetched this path. (The Milestone 3 mapping form uses
 * `/app/api/gelato-products` and `/app/api/gelato-template/:id` instead.)
 */
export async function loader({ request }) {
  await authenticate.admin(request);

  try {
    const result = await listGelatoTemplates({ offset: 0, limit: 100 });

    return Response.json({
      ok: true,
      source: result?.source || "store-products",
      templates: asArray(result?.items),
    });
  } catch (error) {
    console.error("[app.api.gelato-templates]", error);

    return Response.json(
      {
        ok: false,
        error: error.message || "Gelato templates could not be loaded.",
        source: "error",
        templates: [],
      },
      { status: 502 },
    );
  }
}
