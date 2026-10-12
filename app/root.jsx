import { Links, Meta, Outlet, Scripts, ScrollRestoration } from "react-router";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";
import appStyles from "./styles/app.css?url";

export const links = () => [
  { rel: "stylesheet", href: polarisStyles, "data-mt-stylesheet": "polaris" },
  { rel: "stylesheet", href: appStyles, "data-mt-stylesheet": "app" },
];

const criticalStyles = `
  html, body {
    margin: 0;
    background: #f1f2f3;
    color: #202223;
    font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  }

  a {
    color: #005bd3;
  }

  .Polaris-Page {
    font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  }

  .mt-page-shell {
    max-width: 1180px;
    margin: 0 auto;
  }

  .mt-page-hero {
    display: grid;
    grid-template-columns: minmax(0, 1.35fr) minmax(280px, .75fr);
    gap: 20px;
    align-items: stretch;
    padding: 24px;
    border: 1px solid #dfe7e3;
    border-radius: 12px;
    background: linear-gradient(135deg, #ffffff 0%, #f4faf7 62%, #edf5ff 100%);
    box-shadow: 0 10px 30px rgba(32, 34, 35, .05);
  }

  .mt-page-hero h1 {
    margin: 0;
    color: #202223;
    font-size: 34px;
    line-height: 1.12;
    letter-spacing: 0;
  }

  .mt-page-hero p {
    max-width: 680px;
    margin: 0;
    color: #5c5f62;
    font-size: 14px;
    line-height: 1.55;
  }

  .mt-hero-copy,
  .mt-hero-panel,
  .mt-product-card,
  .mt-list-row {
    display: flex;
    flex-direction: column;
  }

  .mt-hero-copy {
    justify-content: center;
    gap: 14px;
  }

  .mt-hero-panel {
    justify-content: space-between;
    gap: 16px;
    padding: 18px;
    border: 1px solid #dfe7e3;
    border-radius: 10px;
    background: rgba(255, 255, 255, .84);
  }

  .mt-list-row {
    gap: 12px;
    padding: 14px;
    border: 1px solid #edf0f1;
    border-radius: 10px;
    background: #f7f8f8;
  }

  .mt-product-preview {
    width: 100%;
    height: 160px;
    object-fit: contain;
    border: 1px solid #edf0f1;
    border-radius: 8px;
    background: #f6f6f7;
  }

  @media (max-width: 900px) {
    .mt-page-hero {
      grid-template-columns: 1fr;
      padding: 20px;
    }

    .mt-page-hero h1 {
      font-size: 28px;
    }
  }
`;

const stylesheetWatchdog = `
  (() => {
    const stylesheets = ${JSON.stringify([polarisStyles, appStyles])};

    function ensureStylesheets() {
      for (const href of stylesheets) {
        const absoluteHref = new URL(href, window.location.href).href;
        const exists = Array.from(document.querySelectorAll('link[rel="stylesheet"]'))
          .some((link) => link.href === absoluteHref);

        if (!exists) {
          const link = document.createElement("link");
          link.rel = "stylesheet";
          link.href = href;
          link.dataset.mtStylesheet = "restored";
          document.head.appendChild(link);
        }
      }
    }

    ensureStylesheets();
    window.addEventListener("focus", ensureStylesheets);
    document.addEventListener("visibilitychange", ensureStylesheets);

    new MutationObserver(ensureStylesheets).observe(document.head, {
      childList: true,
      subtree: true,
    });
  })();
`;

export default function App() {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <link rel="preconnect" href="https://cdn.shopify.com/" />
        <link
          rel="stylesheet"
          href="https://cdn.shopify.com/static/fonts/inter/v4/styles.css"
        />
        <style dangerouslySetInnerHTML={{ __html: criticalStyles }} />
        <Meta />
        <Links />
        <script dangerouslySetInnerHTML={{ __html: stylesheetWatchdog }} />
      </head>
      <body>
        <Outlet />
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}
