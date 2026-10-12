/**
 * Prove the Gelato submission path against the REAL API, without printing.
 *
 * Everything up to this point has been exercised with stubbed HTTP. That proves
 * our logic and nothing about whether Gelato accepts our payload. This script
 * closes that gap by submitting a **draft** order: Gelato validates it in full
 * — product UIDs, template ids, placeholder names, artwork URLs, address — but
 * never sends it to production and never charges for it.
 *
 * It also checks the one thing no stub can: that the signed artwork URL is
 * reachable from the public internet, because Gelato's servers must fetch it.
 *
 * Usage:
 *   node scripts/verify-gelato-order.mjs              # dry run, no API call
 *   node scripts/verify-gelato-order.mjs --submit     # submit a DRAFT order
 *   node scripts/verify-gelato-order.mjs --submit --product 7932917743693
 *   node scripts/verify-gelato-order.mjs --base-url https://xyz.trycloudflare.com
 *
 * A draft is never produced. Nothing here can create a real print job.
 */

import "dotenv/config";
import process from "node:process";

import prisma from "../app/db.server.js";
import {
  buildGelatoOrderItem,
  buildGelatoOrderPayload,
  buildGelatoShippingAddress,
  createGelatoOrder,
} from "../app/lib/gelato-orders.server.js";
import { buildFulfilmentArtworkUrl } from "../app/lib/customizations.server.js";
import { asArray, firstString } from "../app/lib/normalize.js";

/** A deliverable address Gelato will accept for validation purposes. */
const TEST_ADDRESS = {
  first_name: "Magiktoon",
  last_name: "Verification",
  address1: "1 Test Street",
  city: "London",
  zip: "SW1A 1AA",
  country_code: "GB",
  phone: "+442079460000",
};

function parseArgs(argv) {
  const args = {};

  for (let i = 0; i < argv.length; i += 1) {
    if (!argv[i].startsWith("--")) continue;

    const key = argv[i].slice(2);
    const next = argv[i + 1];

    if (!next || next.startsWith("--")) {
      args[key] = true;
    } else {
      args[key] = next;
      i += 1;
    }
  }

  return args;
}

function heading(text) {
  console.log(`\n${text}\n${"─".repeat(text.length)}`);
}

function ok(text) {
  console.log(`  ok    ${text}`);
}

function bad(text) {
  console.log(`  FAIL  ${text}`);
}

/**
 * Gelato downloads the artwork itself, so a URL that resolves only from this
 * machine is not good enough — it has to be publicly served.
 */
async function checkArtworkReachable(url) {
  if (!url) {
    bad("no artwork URL was produced");
    return false;
  }

  if (/localhost|127\.0\.0\.1/i.test(url)) {
    bad(`artwork URL is local, so Gelato cannot fetch it: ${url}`);
    return false;
  }

  try {
    const response = await fetch(url, { method: "GET" });

    if (!response.ok) {
      bad(`artwork URL returned HTTP ${response.status}`);
      console.log(`        ${url}`);
      return false;
    }

    const type = response.headers.get("content-type") || "";

    if (!type.startsWith("image/")) {
      bad(`artwork URL served "${type}" rather than an image`);
      return false;
    }

    ok(`artwork is publicly reachable (${type})`);
    return true;
  } catch (error) {
    bad(`artwork URL could not be fetched: ${error.message}`);
    return false;
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  heading("Customization");

  const where = args.product
    ? { shopifyProductId: { contains: String(args.product) } }
    : {};

  const customization = await prisma.customization.findFirst({
    where,
    include: { productMapping: true },
    orderBy: { createdAt: "desc" },
  });

  if (!customization) {
    console.log(
      "No saved customization found. Save one from the storefront first.",
    );
    return;
  }

  const mapping = customization.productMapping;

  console.log(`  product   ${mapping.shopifyProductTitle}`);
  console.log(`  design    ${mapping.gelatoTemplateName || mapping.gelatoProductName}`);
  console.log(`  template  ${customization.gelatoTemplateId || "(catalog flow)"}`);
  console.log(`  uid       ${customization.gelatoProductUid || "-"}`);
  console.log(`  variant   ${customization.gelatoVariantId || "-"}`);
  console.log(`  placeholder ${customization.gelatoPlaceholderName}`);
  console.log(`  print area  ${customization.gelatoPrintAreaName}`);

  heading("Artwork");

  // Same requirement as the live webhook: Gelato fetches this itself, so it
  // must be absolute and publicly served.
  const baseUrl =
    firstString(args["base-url"], process.env.SHOPIFY_APP_URL) || "";

  let artworkUrl = "";

  try {
    artworkUrl = buildFulfilmentArtworkUrl(customization, { baseUrl });
  } catch (error) {
    bad(error.message);
    console.log("");
    console.log("  Pass --base-url https://<your-tunnel>.trycloudflare.com,");
    console.log("  or set SHOPIFY_APP_URL in .env, then run this again.");
    process.exitCode = 1;
    return;
  }

  const reachable = await checkArtworkReachable(artworkUrl);

  heading("Payload");

  let payload;

  try {
    const item = buildGelatoOrderItem({
      itemReferenceId: `verify-${customization.id}`,
      gelatoTemplateId: customization.gelatoTemplateId,
      gelatoProductUid: customization.gelatoProductUid,
      gelatoVariantId: customization.gelatoVariantId,
      placeholderName: customization.gelatoPlaceholderName,
      printAreaName: customization.gelatoPrintAreaName,
      artworkUrl,
      quantity: 1,
    });

    payload = buildGelatoOrderPayload({
      orderReferenceId: `magiktoon-verify-${customization.id}`,
      currency: "GBP",
      items: [item],
      shippingAddress: buildGelatoShippingAddress({
        shipping_address: TEST_ADDRESS,
        email: "verification@example.com",
      }),
      // Never a production order from this script.
      orderType: "draft",
    });

    ok(`payload built for the ${item.templateId ? "TEMPLATE" : "CATALOG"} flow`);
    console.log(JSON.stringify(payload, null, 2));
  } catch (error) {
    bad(`payload could not be built: ${error.message}`);
    process.exitCode = 1;
    return;
  }

  if (!args.submit) {
    heading("Next step");
    console.log("  Dry run only. Re-run with --submit to send this as a DRAFT");
    console.log("  order, which Gelato validates but never produces.");
    return;
  }

  if (!reachable) {
    heading("Refusing to submit");
    console.log("  The artwork URL is not publicly reachable, so Gelato would");
    console.log("  reject or silently fail to print it. Fix that first.");
    process.exitCode = 1;
    return;
  }

  heading("Submitting draft order to Gelato");

  try {
    const result = await createGelatoOrder(payload);

    ok(`Gelato accepted the order`);
    console.log(`        id     ${result.gelatoOrderId}`);
    console.log(`        status ${result.status}`);
    console.log(
      `        type   ${firstString(result.raw?.orderType, "draft")} — not produced`,
    );

    heading("Result");
    console.log("  The submission path is proven against the real Gelato API.");
    console.log("  Delete the draft from your Gelato dashboard when done.");
  } catch (error) {
    bad(`Gelato rejected the order: ${error.message}`);

    const detail = asArray(error?.body?.errors);

    for (const entry of detail) {
      console.log(`        ${JSON.stringify(entry)}`);
    }

    process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    console.error(`\n${error.message}`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
