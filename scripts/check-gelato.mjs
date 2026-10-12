/**
 * Gelato connection and template diagnostic.
 *
 * Read-only. Uses GELATO_API_KEY / GELATO_STORE_ID from .env and prints the
 * exact values you need to paste into Admin -> Product mappings.
 *
 *   node scripts/check-gelato.mjs                 # list store products
 *   node scripts/check-gelato.mjs <templateId>    # + inspect one template
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Minimal .env loader so this runs outside the Shopify CLI.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const envPath = path.join(root, ".env");

if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);

    if (match && !process.env[match[1]]) {
      process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
    }
  }
}

const { listGelatoStoreProducts, getGelatoStoreProduct, getGelatoTemplateDetail } =
  await import("../app/lib/gelato-catalog.server.js");

const templateArgument = String(process.argv[2] || "").trim();

function heading(text) {
  console.log(`\n${text}`);
  console.log("─".repeat(text.length));
}

function redact(value) {
  const raw = String(value || "");

  return raw.length <= 8 ? "(set)" : `${raw.slice(0, 4)}…${raw.slice(-4)}`;
}

heading("Credentials");
console.log(`GELATO_API_KEY   ${process.env.GELATO_API_KEY ? redact(process.env.GELATO_API_KEY) : "MISSING"}`);
console.log(`GELATO_STORE_ID  ${process.env.GELATO_STORE_ID || "MISSING"}`);

if (!process.env.GELATO_API_KEY || !process.env.GELATO_STORE_ID) {
  console.error("\nBoth values must be set in .env before this can run.");
  process.exit(1);
}

let exitCode = 0;

heading("Store products");

try {
  const { items } = await listGelatoStoreProducts({ limit: 100 });

  if (items.length === 0) {
    console.log("No products found in this Gelato store.");
    console.log("Create a product in Gelato and connect it to this store first.");
  }

  for (const product of items) {
    // The list payload omits templateId, so always read the detail endpoint.
    let detail = product;

    try {
      detail = await getGelatoStoreProduct(product.id);
    } catch (error) {
      console.log(`    (detail unavailable: ${error.message})`);
    }

    console.log(`\n• ${detail.title}`);
    console.log(`    Gelato product ID  : ${detail.id}`);
    console.log(`    Template ID        : ${detail.templateId || "NONE — not built from a template"}`);
    console.log(`    Linked Shopify ID  : ${detail.externalId || "(not linked)"}`);
    console.log(`    Preview URL        : ${(detail.previewUrl || "(none)").split("?")[0]}`);

    const variants = detail.variants;

    if (variants.length > 0) {
      console.log(`    Variants (${variants.length}):`);

      for (const variant of variants) {
        console.log(`      - ${variant.title}`);
        console.log(`          variant ID  : ${variant.id}`);
        console.log(`          product UID : ${variant.productUid || "(none)"}`);
      }
    }
  }
} catch (error) {
  exitCode = 1;
  console.error(`\nFAILED: ${error.message}`);
  console.error("\nA 401/403 means the API key is wrong or lacks store access.");
  console.error("A 404 means GELATO_STORE_ID does not match a store on this key.");
}

if (templateArgument) {
  heading(`Template ${templateArgument}`);

  try {
    const template = await getGelatoTemplateDetail(templateArgument);

    console.log(`Name        : ${template.name}`);
    console.log(`Product UID : ${template.productUid || "(none)"}`);
    console.log(`Preview URL : ${template.previewUrl || "(none)"}`);

    console.log(`\nImage placeholders (${template.placeholders.length}):`);

    if (template.placeholders.length === 0) {
      console.log("  (none returned — the mapping form will fall back to manual entry)");
    }

    for (const placeholder of template.placeholders) {
      const size =
        placeholder.width && placeholder.height
          ? ` ${placeholder.width}×${placeholder.height}px`
          : "";

      console.log(`  - name "${placeholder.name}"  print area "${placeholder.printArea}"${size}`);
    }

    console.log(`\nPrint areas : ${template.printAreas.join(", ")}`);
    console.log(`Variants (${template.variants.length}):`);

    for (const variant of template.variants) {
      console.log(`  - ${variant.title}  →  variant ID ${variant.id}`);
    }

    console.log("\nPaste these into Admin → Product mappings → Add mapping:");
    console.log(`  Gelato template ID : ${template.id}`);
    console.log(`  Image placeholder  : ${template.placeholders[0]?.name || "ImageFront"}`);
    console.log(`  Print area         : ${template.placeholders[0]?.printArea || "front"}`);
    console.log(`  Preview image URL  : ${template.previewUrl || "(set one manually)"}`);
  } catch (error) {
    exitCode = 1;
    console.error(`\nFAILED: ${error.message}`);
    console.error("\nA 404 means this template ID does not exist on this API key.");
    console.error("Template IDs come from the store product's `templateId`, listed above —");
    console.error("they are not the Shopify product ID and not the Gelato product UID.");
  }
}

console.log("");
process.exit(exitCode);
