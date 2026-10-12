/**
 * App proxy request helpers.
 *
 * Every storefront call goes through Shopify's app proxy, which signs the
 * request. `authenticate.public.appProxy` verifies that signature, so these
 * routes never trust a raw `shop` query parameter on its own.
 *
 * SERVER ONLY.
 */

import { authenticate } from "../shopify.server.js";
import { toTrimmedString } from "./normalize.js";

/**
 * Authenticate a storefront proxy request and resolve the shop domain.
 *
 * @returns {Promise<{ ok: boolean, shop: string, error?: string, status?: number }>}
 */
export async function authenticateStorefrontRequest(request) {
  try {
    const context = await authenticate.public.appProxy(request);

    const url = new URL(request.url);

    const shop =
      toTrimmedString(context?.session?.shop) ||
      toTrimmedString(url.searchParams.get("shop"));

    if (!shop) {
      return {
        ok: false,
        shop: "",
        status: 401,
        error: "This shop is not installed.",
      };
    }

    return { ok: true, shop };
  } catch (error) {
    // `authenticate.public.appProxy` throws a Response for a bad signature.
    if (error instanceof Response) {
      return {
        ok: false,
        shop: "",
        status: error.status || 401,
        error: "The request signature could not be verified.",
      };
    }

    console.error("[app-proxy] authentication failed:", error);

    return {
      ok: false,
      shop: "",
      status: 500,
      error: "The request could not be authenticated.",
    };
  }
}

/** JSON response with the permissive CORS the storefront needs. */
export function storefrontJson(body, init = {}) {
  return Response.json(body, {
    ...init,
    headers: {
      "Cache-Control": "no-store",
      ...(init.headers || {}),
    },
  });
}
