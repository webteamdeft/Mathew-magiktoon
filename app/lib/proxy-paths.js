/**
 * Storefront paths for the app proxy endpoints.
 *
 * Client-safe: pure string handling, no credentials, no Prisma.
 */

import { toTrimmedString } from "./normalize.js";

/** The proxy prefix to assume when the storefront did not send one. */
export const DEFAULT_PROXY_BASE = "/apps/magiktoon";

/**
 * Normalize a storefront-supplied proxy prefix.
 *
 * Anything that is not a plain absolute path is rejected outright. The value
 * arrives in a query parameter, and the page POSTs the customer's artwork to
 * whatever it names — so an absolute URL, a protocol-relative `//host`, or a
 * `..` traversal must never survive.
 */
export function normalizeProxyBase(value) {
  const base = toTrimmedString(value).replace(/\/+$/, "");

  if (!base || base.startsWith("//") || !/^\/[A-Za-z0-9\-_/]*$/.test(base)) {
    return DEFAULT_PROXY_BASE;
  }

  return base;
}

/**
 * Where the customizer page should POST a saved design.
 *
 * MUST be a path the *browser* can reach on the shop domain, not the path this
 * app received. Shopify strips the proxy prefix before forwarding, so the app
 * sees `/customize` while the customer is on `/apps/<subpath>/customize`.
 * Deriving the target from the received path yields a bare `/customization`,
 * which the storefront answers with its 404 HTML page — and the page then fails
 * parsing that as JSON.
 */
export function customizationProxyPath(url) {
  const base = normalizeProxyBase(url?.searchParams?.get("proxy_base"));

  return `${base}/customization`;
}

/**
 * Where the customizer page should POST a photo for AI generation.
 *
 * Same reasoning as `customizationProxyPath`: it has to be the shop-domain
 * path, not the stripped path this app receives.
 */
export function generateProxyPath(url) {
  const base = normalizeProxyBase(url?.searchParams?.get("proxy_base"));

  return `${base}/generate`;
}

/** Where the customizer page should ask for a Gelato mockup. */
export function mockupProxyPath(url) {
  const base = normalizeProxyBase(url?.searchParams?.get("proxy_base"));

  return `${base}/mockup`;
}
