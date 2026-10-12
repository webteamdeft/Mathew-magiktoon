import { redirect } from "react-router";

/**
 * Retired screen — permanently redirects to `/app/mappings`.
 *
 * This page used to write Gelato template selections into
 * `ProductConfiguration` / `GelatoTemplate`. Milestone 3 replaced both with
 * `ProductMapping`, which is the only table the storefront block and the
 * `orders/create` webhook read. Saving here therefore had no effect on the
 * storefront, which made it a trap: a merchant could enter a valid template ID,
 * see it saved, and still get "not-mapped" on the product page.
 *
 * The route is kept (rather than deleted) so existing bookmarks and any links
 * left in older builds land on the screen that works. The previous
 * implementation is archived beside this file as
 * `_legacy.app.templates.jsx.bak`.
 */
export async function loader() {
  return redirect("/app/mappings");
}

export async function action() {
  return redirect("/app/mappings");
}
