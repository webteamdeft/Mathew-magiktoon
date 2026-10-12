import {
  Link,
  Outlet,
  useLoaderData,
  useRouteError,
} from "react-router";

import {
  AppProvider as ShopifyAppProvider,
} from "@shopify/shopify-app-react-router/react";

import { boundary } from "@shopify/shopify-app-react-router/server";

import {
  AppProvider as PolarisAppProvider,
} from "@shopify/polaris";

import polarisTranslations from "@shopify/polaris/locales/en.json";

import { authenticate } from "../shopify.server";

/**
 * Renders every Polaris `url` prop as a React Router link.
 *
 * Polaris otherwise emits a plain `<a href>`, which inside the embedded admin
 * iframe triggers a *full document load* of that path. Such a request carries
 * none of the App Bridge query parameters (`embedded`, `shop`, `host`,
 * `id_token`), so `authenticate.admin` cannot identify the session and answers
 * with the App Bridge bootstrap document instead of the page — which the
 * merchant sees as a button that does nothing.
 *
 * Routing through React Router keeps the navigation client-side, so the session
 * token is never dropped. External links must stay real anchors.
 */
function PolarisLink({ children, url = "", external, target, ...rest }) {
  const isExternal =
    external || target === "_blank" || /^(https?:)?\/\//i.test(url);

  if (isExternal) {
    return (
      <a
        href={url}
        target={target || "_blank"}
        rel="noopener noreferrer"
        {...rest}
      >
        {children}
      </a>
    );
  }

  return (
    <Link to={url} {...rest}>
      {children}
    </Link>
  );
}

export async function loader({ request }) {
  await authenticate.admin(request);

  return Response.json({
    apiKey: process.env.SHOPIFY_API_KEY || "",
  });
}

export default function AppLayout() {
  const { apiKey } = useLoaderData();

  return (
    <ShopifyAppProvider
      embedded
      apiKey={apiKey}
    >
      <PolarisAppProvider
        i18n={polarisTranslations}
        linkComponent={PolarisLink}
      >
        <s-app-nav>
          <s-link href="/app">
            Home
          </s-link>

          <s-link href="/app/mappings">
            Product mappings
          </s-link>

          <s-link href="/app/orders">
            Gelato orders
          </s-link>

          <s-link href="/app/products">
            Products
          </s-link>

          <s-link href="/app/prompts">
            Prompts
          </s-link>

          <s-link href="/app/generations">
            AI generations
          </s-link>
        </s-app-nav>

        <Outlet />
      </PolarisAppProvider>
    </ShopifyAppProvider>
  );
}

/**
 * Required by `authenticate.admin`.
 *
 * When the embedded session token is missing or stale, `authenticate.admin`
 * does not return an error — it *throws a Response* whose body is the App
 * Bridge bootstrap script, so the browser can load App Bridge and fetch a fresh
 * token. React Router needs a boundary to render that thrown Response. Without
 * one it surfaces as the confusing
 *
 *   ErrorResponseImpl { status: 200, data: '<script … app-bridge.js>' }
 *
 * and every embedded admin page fails instead of silently re-authenticating.
 */
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

/**
 * Propagates the `Content-Security-Policy: frame-ancestors` header Shopify
 * requires, including on error responses. Without it the admin iframe refuses
 * to display the app.
 */
export const headers = (headersArgs) => boundary.headers(headersArgs);
