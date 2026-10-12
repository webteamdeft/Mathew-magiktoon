import { authenticate } from "../shopify.server";
import { getGelatoTemplateDetail } from "../lib/gelato-catalog.server";
import { asArray } from "../lib/normalize";

/**
 * GET /app/api/gelato-template/:templateId
 *
 * Admin-only. Returns a template's variants, image placeholders and print
 * areas so the mapping form can validate against real Gelato values instead of
 * a hard-coded list.
 */
export async function loader({ request, params }) {
  await authenticate.admin(request);

  const templateId = String(params.templateId || "").trim();

  if (!templateId) {
    return Response.json(
      { ok: false, error: "A Gelato template ID is required.", template: null },
      { status: 400 },
    );
  }

  try {
    const template = await getGelatoTemplateDetail(templateId);

    return Response.json({
      ok: true,
      template: {
        id: template.id,
        name: template.name,
        // Present when the template is pinned to one catalog product; used to
        // prefill the mapping so the template flow can still fall back.
        productUid: template.productUid,
        previewUrl: template.previewUrl,
        variants: asArray(template.variants),
        placeholders: asArray(template.placeholders),
        printAreas: asArray(template.printAreas),
        // Editable text areas defined in the template, if any.
        textPlaceholders: asArray(template.textPlaceholders),
      },
    });
  } catch (error) {
    console.error("[app.api.gelato-template]", error);

    return Response.json(
      {
        ok: false,
        error: error.message || "That Gelato template could not be loaded.",
        template: null,
      },
      { status: 502 },
    );
  }
}
