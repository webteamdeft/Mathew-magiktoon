/**
 * Create or update one Shopify -> Gelato mapping from the command line.
 *
 * The admin form is the normal way in; this exists so a mapping can be created
 * (and proved) without the embedded admin in the loop, which makes it possible
 * to tell a broken form apart from a broken mapping.
 *
 * Usage:
 *   node scripts/map-product.mjs --list
 *   node scripts/map-product.mjs --product <shopify-id> --template <gelato-template-id>
 *   node scripts/map-product.mjs --product <shopify-id> --gelato-product <gelato-product-id>
 *
 * Two ways to say what Gelato should print:
 *   --template <id>         Template flow. Artwork is placed by placeholder name.
 *   --gelato-product <id>   Catalog flow, for a Gelato store product that was
 *                           not built from a template. Artwork is placed by
 *                           print area against the variant's product UID.
 *
 * Options:
 *   --shop <domain>       Defaults to the only shop with a saved session.
 *   --title <text>        Shopify product title shown in admin.
 *   --variant <id>        Gelato variant to use (catalog flow; defaults to first).
 *   --placeholder <name>  Defaults to ImageFront.
 *   --print-area <name>   Defaults to front.
 *   --preview <url>       Overrides the preview image taken from Gelato.
 *   --status <status>     DRAFT | ACTIVE | DISABLED. Defaults to ACTIVE.
 *   --delete              Remove the mapping for --product instead of saving it.
 *   --refresh             Re-read every mapping's template from Gelato and
 *                         store the real placeholder dimensions.
 *   --area x,y,size       Move the print guide on the product photo, as
 *                         percentages, e.g. --area 30,26,46.
 */

import process from "node:process";

import prisma from "../app/db.server.js";
import {
  listMappings,
  saveMapping,
  deleteMapping,
  findMappingForProduct,
} from "../app/lib/mappings.server.js";
import {
  getGelatoStoreProduct,
  tryGetGelatoTemplateDetail,
} from "../app/lib/gelato-catalog.server.js";
import { resolveTemplateImages } from "../app/lib/gelato-preview.server.js";
import { asArray, firstString } from "../app/lib/normalize.js";

/**
 * `--area 30,26,46` → print-guide position and size as fractions.
 *
 * Returns an empty object when unset, so an existing mapping's guide is left
 * alone rather than reset to the defaults on every save.
 */
function parseArea(value) {
  const parts = String(value || "")
    .split(",")
    .map((part) => Number(part.trim()));

  if (parts.length !== 3 || parts.some((part) => !Number.isFinite(part))) {
    return {};
  }

  return {
    printAreaX: parts[0],
    printAreaY: parts[1],
    printAreaSize: parts[2],
  };
}

/** Print the outcome of a save, or the field errors that blocked it. */
function reportSave(result) {
  if (!result.ok) {
    console.error("The mapping was refused:");

    for (const [field, message] of Object.entries(result.errors || {})) {
      console.error(`  ${field}: ${message}`);
    }

    if (result.error) console.error(`  ${result.error}`);

    process.exitCode = 1;
    return;
  }

  console.log(
    `Saved. Product ${result.mapping.shopifyProductNumericId} is ${result.mapping.status} ` +
      `and prints through ${
        result.mapping.gelatoTemplateId
          ? `template ${result.mapping.gelatoTemplateId}`
          : `product UID ${result.mapping.gelatoProductUid}`
      }.`,
  );
}

/** Confirm the storefront's own lookup finds what we just wrote. */
function reportLookup(mapping) {
  console.log(
    mapping
      ? "Storefront lookup: found. The product page will now offer customisation."
      : "Storefront lookup: NOT found — set --status ACTIVE for the block to show.",
  );
}

function parseArgs(argv) {
  const args = {};

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (!token.startsWith("--")) continue;

    const key = token.slice(2);
    const next = argv[index + 1];

    if (!next || next.startsWith("--")) {
      args[key] = true;
    } else {
      args[key] = next;
      index += 1;
    }
  }

  return args;
}

/** The shop to act on: whatever is in --shop, else the only saved session. */
async function resolveShop(requested) {
  if (typeof requested === "string" && requested.trim()) {
    return requested.trim();
  }

  const sessions = await prisma.session.findMany({
    select: { shop: true },
    distinct: ["shop"],
  });

  const shops = asArray(sessions).map((session) => session.shop);

  if (shops.length === 0) {
    throw new Error(
      "No shop session found. Run `npm run dev` and open the app once, then retry.",
    );
  }

  if (shops.length > 1) {
    throw new Error(
      `Several shops are installed (${shops.join(", ")}). Pass --shop <domain>.`,
    );
  }

  return shops[0];
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const shop = await resolveShop(args.shop);

  console.log(`Shop: ${shop}\n`);

  // ---- List -----------------------------------------------------------
  if (args.list) {
    const mappings = await listMappings(shop);

    if (mappings.length === 0) {
      console.log("No mappings saved. The storefront will answer 'not-mapped'.");
      return;
    }

    for (const mapping of mappings) {
      console.log(
        [
          `  ${mapping.status.padEnd(8)}`,
          `product ${mapping.shopifyProductNumericId}`,
          `template ${mapping.gelatoTemplateId || "-"}`,
          `uid ${mapping.gelatoProductUid || "-"}`,
          `${mapping.gelatoPlaceholderName}/${mapping.gelatoPrintAreaName}`,
          `"${mapping.shopifyProductTitle}"`,
        ].join("  "),
      );
    }

    console.log(`\n${mappings.length} mapping(s).`);
    return;
  }

  // ---- Refresh --------------------------------------------------------
  // Re-reads every saved mapping's template from Gelato and stores the real
  // placeholder dimensions. Mappings created before those columns existed have
  // none, so the storefront falls back to a square guide — which on a mug is
  // visibly wrong.
  if (args.refresh) {
    const mappings = await listMappings(shop);
    let updated = 0;

    for (const mapping of mappings) {
      if (!mapping.gelatoTemplateId) {
        console.log(`  skip  ${mapping.shopifyProductTitle} (catalog flow)`);
        continue;
      }

      const detail = await tryGetGelatoTemplateDetail(mapping.gelatoTemplateId);

      if (!detail.ok) {
        console.log(`  fail  ${mapping.shopifyProductTitle}: ${detail.error}`);
        continue;
      }

      const placeholder =
        asArray(detail.template.placeholders).find(
          (item) => item.name === mapping.gelatoPlaceholderName,
        ) || asArray(detail.template.placeholders)[0];

      if (!placeholder?.width || !placeholder?.height) {
        console.log(
          `  skip  ${mapping.shopifyProductTitle}: Gelato reported no dimensions`,
        );
        continue;
      }

      // How many images Gelato actually has for this design.
      const images = await resolveTemplateImages({ ...mapping, id: mapping.id });

      await prisma.productMapping.update({
        where: { id: mapping.id },
        data: {
          gelatoImageCount: Math.max(1, images.length),
          gelatoPlaceholderName: placeholder.name,
          gelatoPrintAreaName: placeholder.printArea,
          gelatoPlaceholderWidth: placeholder.width,
          gelatoPlaceholderHeight: placeholder.height,
          gelatoTextPlaceholders: asArray(detail.template.textPlaceholders),
        },
      });

      updated += 1;

      const textCount = asArray(detail.template.textPlaceholders).length;

      console.log(
        `  ok    ${mapping.shopifyProductTitle}: ${placeholder.name} ` +
          `${placeholder.width} x ${placeholder.height}, ` +
          `${textCount} text area${textCount === 1 ? "" : "s"}, ` +
          `${images.length} image${images.length === 1 ? "" : "s"} ` +
          `(ratio ${(placeholder.width / placeholder.height).toFixed(2)})`,
      );
    }

    console.log(`\n${updated} mapping(s) refreshed from Gelato.`);
    return;
  }

  const productId = firstString(args.product);

  if (!productId) {
    console.log(
      "Nothing to do. Pass --list, or --product <id> --template <id>.\n" +
        "See the header of this file for every option.",
    );
    return;
  }

  // ---- Delete ---------------------------------------------------------
  if (args.delete) {
    const existing = await findMappingForProduct(shop, productId, {
      activeOnly: false,
    });

    if (!existing) {
      console.log(`No mapping found for product ${productId}.`);
      return;
    }

    await deleteMapping(shop, existing.id);
    console.log(`Deleted the mapping for product ${productId}.`);
    return;
  }

  // ---- Save -----------------------------------------------------------
  const templateId = firstString(args.template);
  const gelatoProductId = firstString(args["gelato-product"]);

  if (!templateId && !gelatoProductId) {
    throw new Error(
      "Pass --template <gelato-template-id>, or --gelato-product <gelato-product-id>\n" +
        "for a Gelato store product that was not built from a template.\n" +
        "Run `node scripts/check-gelato.mjs` to see what your account holds.",
    );
  }

  // Catalog flow: the Gelato product is not built from a template, so the
  // catalog product UID on its variant is what identifies the print.
  if (!templateId) {
    console.log(`Fetching Gelato store product ${gelatoProductId} ...`);

    const product = await getGelatoStoreProduct(gelatoProductId);
    const variants = asArray(product.variants);
    const chosen =
      variants.find((item) => item.id === firstString(args.variant)) ||
      variants[0];

    if (!chosen?.productUid) {
      throw new Error(
        `That Gelato product has no variant carrying a product UID, so there is ` +
          `nothing for Gelato to print against.`,
      );
    }

    console.log(`  name        ${product.title}`);
    console.log(
      `  variants    ${variants.map((item) => item.title).join(", ") || "none"}`,
    );
    console.log(`  using       ${chosen.title}`);
    console.log(`  product uid ${chosen.productUid}\n`);

    const existingCatalog = await findMappingForProduct(shop, productId, {
      activeOnly: false,
    });

    const saved = await saveMapping(
      shop,
      {
        shopifyProductId: productId,
        shopifyProductTitle: firstString(
          args.title,
          existingCatalog?.shopifyProductTitle,
          product.title,
          `Shopify product ${productId}`,
        ),
        gelatoProductId: product.id,
        gelatoProductName: product.title,
        gelatoProductUid: chosen.productUid,
        gelatoVariantId: chosen.id,
        gelatoVariantName: chosen.title,
        gelatoPlaceholderName:
          firstString(args.placeholder, chosen.imagePlaceholders?.[0]?.name) ||
          "ImageFront",
        gelatoPrintAreaName: firstString(args["print-area"]) || "front",
        gelatoPreviewUrl:
          firstString(
            args.preview,
            product.previewUrl,
            chosen.previewUrl,
            existingCatalog?.gelatoPreviewUrl,
          ) || "https://cdn.shopify.com/s/images/admin/no-image-compact.gif",
        status: firstString(args.status) || "ACTIVE",
        ...parseArea(args.area),
      },
      { id: existingCatalog?.id || "" },
    );

    reportSave(saved);

    const readBack = await findMappingForProduct(shop, productId);
    reportLookup(readBack);
    return;
  }

  console.log(`Fetching Gelato template ${templateId} ...`);

  const detail = await tryGetGelatoTemplateDetail(templateId);

  if (!detail.ok) {
    throw new Error(
      `Gelato rejected that template ID: ${detail.error}\n` +
        "Check it is a template ID from the same Gelato account as GELATO_API_KEY.",
    );
  }

  const template = detail.template;
  const placeholder = asArray(template.placeholders)[0];
  const variant = asArray(template.variants)[0];

  console.log(`  name        ${template.name}`);
  console.log(
    `  placeholders ${asArray(template.placeholders)
      .map((item) => `${item.name} (${item.printArea})`)
      .join(", ") || "none reported"}`,
  );
  console.log(`  print areas ${asArray(template.printAreas).join(", ")}`);
  console.log(`  product uid ${template.productUid || variant?.productUid || "-"}\n`);

  const existing = await findMappingForProduct(shop, productId, {
    activeOnly: false,
  });

  const previewUrl =
    firstString(args.preview, template.previewUrl, existing?.gelatoPreviewUrl) ||
    // An ACTIVE mapping must carry a preview; fall back to a placeholder rather
    // than failing validation on a field the merchant can fix later in admin.
    "https://cdn.shopify.com/s/images/admin/no-image-compact.gif";

  const result = await saveMapping(
    shop,
    {
      shopifyProductId: productId,
      shopifyProductTitle: firstString(
        args.title,
        existing?.shopifyProductTitle,
        `Shopify product ${productId}`,
      ),
      gelatoTemplateId: template.id || templateId,
      gelatoTemplateName: template.name,
      gelatoProductUid: firstString(template.productUid, variant?.productUid),
      gelatoVariantId: firstString(variant?.id),
      gelatoVariantName: firstString(variant?.title),
      gelatoPlaceholderName: firstString(placeholder?.name) || "ImageFront",
      gelatoPrintAreaName: firstString(placeholder?.printArea) || "front",
      gelatoPlaceholderWidth: placeholder?.width ?? "",
      gelatoPlaceholderHeight: placeholder?.height ?? "",
      gelatoPreviewUrl: previewUrl,
      status: firstString(args.status) || "ACTIVE",
      ...parseArea(args.area),
    },
    { id: existing?.id || "" },
  );

  reportSave(result);

  // Prove it the same way the storefront asks for it.
  reportLookup(await findMappingForProduct(shop, productId));
}

main()
  .catch((error) => {
    console.error(`\n${error.message}`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
