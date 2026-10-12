import { authenticate } from "../shopify.server";
import { getGelatoStoreProduct } from "../lib/gelato-catalog.server";
import { asArray } from "../lib/normalize";

/**
 * GET /app/api/gelato-product/:productId
 *
 * Admin-only. Returns one Gelato store product with its variants so the
 * mapping form can offer a variant select.
 */
export async function loader({ request, params }) {
  await authenticate.admin(request);

  const productId = String(params.productId || "").trim();

  if (!productId) {
    return Response.json(
      { ok: false, error: "A Gelato product ID is required.", product: null },
      { status: 400 },
    );
  }

  try {
    const product = await getGelatoStoreProduct(productId);

    return Response.json({
      ok: true,
      product: { ...product, variants: asArray(product?.variants) },
    });
  } catch (error) {
    console.error("[app.api.gelato-product]", error);

    return Response.json(
      {
        ok: false,
        error: error.message || "That Gelato product could not be loaded.",
        product: null,
      },
      { status: 502 },
    );
  }
}
