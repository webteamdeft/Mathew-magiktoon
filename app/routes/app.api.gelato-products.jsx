import { authenticate } from "../shopify.server";
import { listGelatoStoreProducts } from "../lib/gelato-catalog.server";
import { asArray } from "../lib/normalize";

/**
 * GET /app/api/gelato-products
 *
 * Admin-only. Returns the connected Gelato store's products. The API key stays
 * on the server; only normalized catalog data crosses the wire.
 */
export async function loader({ request }) {
  await authenticate.admin(request);

  try {
    const result = await listGelatoStoreProducts({ offset: 0, limit: 100 });

    return Response.json({
      ok: true,
      products: asArray(result?.items),
    });
  } catch (error) {
    console.error("[app.api.gelato-products]", error);

    return Response.json(
      {
        ok: false,
        error: error.message || "Gelato products could not be loaded.",
        products: [],
      },
      { status: 502 },
    );
  }
}
