/**
 * Figma design-spec reader for the approved Milestone 1 mockup.
 *
 * Read-only. Needs `FIGMA_TOKEN` in .env (a personal access token with
 * "File content: read-only"). The token is never printed.
 *
 *   node scripts/figma-spec.mjs                  # list pages and frames
 *   node scripts/figma-spec.mjs spec <nodeId>    # colours, type, spacing
 *   node scripts/figma-spec.mjs render <nodeId>… # PNG @2x into design/
 *
 * The file key comes from the approved design URL:
 *   https://www.figma.com/design/PhPhQZjVvpS3Vfr7L2fk7l/Mathew-G
 */

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

const FILE_KEY = process.env.FIGMA_FILE_KEY || "PhPhQZjVvpS3Vfr7L2fk7l";
const TOKEN = String(process.env.FIGMA_TOKEN || "").trim();

if (!TOKEN) {
  console.error(
    [
      "FIGMA_TOKEN is not set.",
      "",
      "  1. Figma → Settings → Security → Personal access tokens",
      "  2. Generate one with scope 'File content: read-only'",
      "  3. Add this line to .env (it is gitignored):",
      "",
      "       FIGMA_TOKEN=figd_xxxxxxxxxxxxxxxx",
      "",
    ].join("\n"),
  );
  process.exit(1);
}

async function figma(pathname) {
  const response = await fetch(`https://api.figma.com/v1${pathname}`, {
    headers: { "X-Figma-Token": TOKEN },
  });

  const text = await response.text();

  let data;

  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  if (!response.ok) {
    const message = typeof data === "string" ? data : JSON.stringify(data);

    if (response.status === 403) {
      throw new Error(
        `Figma ${response.status}: ${message}\n` +
          "The token is invalid, expired, or lacks access to this file.",
      );
    }

    throw new Error(`Figma ${response.status}: ${message}`);
  }

  return data;
}

/** `{r,g,b,a}` in 0..1 → `#rrggbb` (or `rgba()` when translucent). */
function toColor(color, opacity) {
  if (!color) return "";

  const channel = (value) =>
    Math.round(Math.min(Math.max(Number(value) || 0, 0), 1) * 255);

  const alpha = (color.a ?? 1) * (opacity ?? 1);

  const hex =
    "#" +
    [channel(color.r), channel(color.g), channel(color.b)]
      .map((value) => value.toString(16).padStart(2, "0"))
      .join("");

  return alpha >= 0.999 ? hex : `${hex} (alpha ${alpha.toFixed(2)})`;
}

function describeFills(fills) {
  return (Array.isArray(fills) ? fills : [])
    .filter((fill) => fill.visible !== false)
    .map((fill) => {
      if (fill.type === "SOLID") {
        return toColor(fill.color, fill.opacity);
      }

      if (String(fill.type).startsWith("GRADIENT")) {
        const stops = (fill.gradientStops || [])
          .map((stop) => toColor(stop.color))
          .join(" → ");

        return `${fill.type} ${stops}`;
      }

      return fill.type;
    })
    .filter(Boolean);
}

function round(value) {
  return typeof value === "number" ? Math.round(value * 100) / 100 : value;
}

/** Walk a node tree collecting the details that drive CSS. */
function collect(node, depth, out) {
  if (!node) return;

  const box = node.absoluteBoundingBox;

  const entry = {
    depth,
    id: node.id,
    name: node.name,
    type: node.type,
    width: box ? round(box.width) : null,
    height: box ? round(box.height) : null,
    fills: describeFills(node.fills),
    strokes: describeFills(node.strokes),
    strokeWeight: node.strokeWeight,
    radius:
      node.cornerRadius ??
      (node.rectangleCornerRadii ? node.rectangleCornerRadii.join("/") : null),
    layoutMode: node.layoutMode,
    itemSpacing: node.itemSpacing,
    padding: [
      node.paddingTop,
      node.paddingRight,
      node.paddingBottom,
      node.paddingLeft,
    ].some((value) => typeof value === "number")
      ? `${node.paddingTop || 0}/${node.paddingRight || 0}/` +
        `${node.paddingBottom || 0}/${node.paddingLeft || 0}`
      : null,
    text: node.type === "TEXT" ? node.characters : null,
    style: node.style
      ? {
          font: node.style.fontFamily,
          weight: node.style.fontWeight,
          size: round(node.style.fontSize),
          lineHeight: round(node.style.lineHeightPx),
          letterSpacing: round(node.style.letterSpacing),
          align: node.style.textAlignHorizontal,
          case: node.style.textCase,
        }
      : null,
  };

  out.push(entry);

  for (const child of node.children || []) {
    collect(child, depth + 1, out);
  }
}

function printEntry(entry) {
  const indent = "  ".repeat(entry.depth);
  const size =
    entry.width != null ? ` [${entry.width}×${entry.height}]` : "";

  console.log(`${indent}${entry.type}  "${entry.name}"${size}  (${entry.id})`);

  const detail = (label, value) => {
    if (value === null || value === undefined || value === "" ) return;
    if (Array.isArray(value) && value.length === 0) return;

    console.log(
      `${indent}    ${label}: ${Array.isArray(value) ? value.join(", ") : value}`,
    );
  };

  detail("fill", entry.fills);
  detail("stroke", entry.strokes);
  detail("strokeWeight", entry.strokeWeight);
  detail("radius", entry.radius);
  detail("layout", entry.layoutMode);
  detail("gap", entry.itemSpacing);
  detail("padding (t/r/b/l)", entry.padding);

  if (entry.style) {
    const s = entry.style;
    detail(
      "type",
      `${s.font} ${s.weight} ${s.size}px/${s.lineHeight}px` +
        (s.letterSpacing ? ` ls ${s.letterSpacing}` : "") +
        (s.align ? ` ${s.align}` : "") +
        (s.case && s.case !== "ORIGINAL" ? ` ${s.case}` : ""),
    );
  }

  if (entry.text) {
    const oneLine = entry.text.replace(/\s+/g, " ").trim();
    detail("text", `"${oneLine.slice(0, 90)}${oneLine.length > 90 ? "…" : ""}"`);
  }
}

/** Default command: list every page and its top-level frames. */
async function listFrames() {
  const file = await figma(`/files/${FILE_KEY}?depth=2`);

  console.log(`File   : ${file.name}`);
  console.log(`Edited : ${file.lastModified}`);
  console.log(`Key    : ${FILE_KEY}`);

  for (const page of file.document?.children || []) {
    console.log(`\n── Page: ${page.name} (${page.id})`);

    const frames = (page.children || []).filter((node) =>
      ["FRAME", "COMPONENT", "COMPONENT_SET", "SECTION", "GROUP"].includes(node.type),
    );

    if (frames.length === 0) {
      console.log("   (no frames)");
      continue;
    }

    for (const frame of frames) {
      const box = frame.absoluteBoundingBox;
      const size = box ? `${round(box.width)}×${round(box.height)}` : "?";

      // Width is the quickest signal for which breakpoint a frame targets.
      const hint =
        box && box.width <= 600
          ? "  ← mobile?"
          : box && box.width >= 1200
            ? "  ← desktop?"
            : "";

      console.log(`   ${frame.type.padEnd(14)} ${size.padEnd(12)} ${frame.name}${hint}`);
      console.log(`   ${"".padEnd(14)} ${"".padEnd(12)} id: ${frame.id}`);
    }
  }

  console.log(
    "\nNext: node scripts/figma-spec.mjs spec <nodeId>" +
      "   |   node scripts/figma-spec.mjs render <nodeId>…",
  );
}

/** Dump the full style spec for one node. */
async function specForNode(nodeId) {
  const data = await figma(
    `/files/${FILE_KEY}/nodes?ids=${encodeURIComponent(nodeId)}`,
  );

  const wrapper = data.nodes?.[nodeId];

  if (!wrapper?.document) {
    throw new Error(`Node ${nodeId} was not found in this file.`);
  }

  const entries = [];
  collect(wrapper.document, 0, entries);

  console.log(`Spec for "${wrapper.document.name}" (${nodeId})`);
  console.log(`${entries.length} nodes\n`);

  entries.forEach(printEntry);

  // A palette summary is far more useful than hunting through the tree.
  const palette = new Map();

  for (const entry of entries) {
    for (const fill of entry.fills) {
      if (fill.startsWith("#")) {
        palette.set(fill, (palette.get(fill) || 0) + 1);
      }
    }
  }

  console.log("\n── Palette (most used first)");
  [...palette.entries()]
    .sort((a, b) => b[1] - a[1])
    .forEach(([color, count]) => console.log(`   ${color}   ×${count}`));

  const fonts = new Map();

  for (const entry of entries) {
    if (!entry.style) continue;

    const key =
      `${entry.style.font} ${entry.style.weight} ` +
      `${entry.style.size}px/${entry.style.lineHeight}px`;

    fonts.set(key, (fonts.get(key) || 0) + 1);
  }

  console.log("\n── Type styles (most used first)");
  [...fonts.entries()]
    .sort((a, b) => b[1] - a[1])
    .forEach(([style, count]) => console.log(`   ${style}   ×${count}`));
}

/** Render nodes to PNG @2x and save them under design/. */
async function renderNodes(nodeIds) {
  const ids = nodeIds.join(",");

  const data = await figma(
    `/images/${FILE_KEY}?ids=${encodeURIComponent(ids)}&format=png&scale=2`,
  );

  if (data.err) {
    throw new Error(`Figma render failed: ${data.err}`);
  }

  const outputDirectory = path.join(root, "design");
  await fsp.mkdir(outputDirectory, { recursive: true });

  for (const [nodeId, url] of Object.entries(data.images || {})) {
    if (!url) {
      console.log(`   ${nodeId}: no image returned`);
      continue;
    }

    const response = await fetch(url);

    if (!response.ok) {
      console.log(`   ${nodeId}: download failed (HTTP ${response.status})`);
      continue;
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    const filename = `${nodeId.replace(/[^a-zA-Z0-9]/g, "-")}.png`;
    const filePath = path.join(outputDirectory, filename);

    await fsp.writeFile(filePath, buffer);

    console.log(`   saved design/${filename}  (${Math.round(buffer.length / 1024)} KB)`);
  }
}

const [command, ...rest] = process.argv.slice(2);

try {
  if (!command || command === "list") {
    await listFrames();
  } else if (command === "spec") {
    if (!rest[0]) throw new Error("Usage: figma-spec.mjs spec <nodeId>");
    await specForNode(rest[0]);
  } else if (command === "render") {
    if (rest.length === 0) throw new Error("Usage: figma-spec.mjs render <nodeId>…");
    await renderNodes(rest);
  } else {
    throw new Error(`Unknown command "${command}". Use list, spec, or render.`);
  }
} catch (error) {
  console.error(`\n${error.message}`);
  process.exitCode = 1;
}
