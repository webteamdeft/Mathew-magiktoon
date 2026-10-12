/**
 * Make the design faces available to the print renderer.
 *
 * The customizer loads its fonts from Google Fonts, in the customer's browser.
 * The print file is drawn on the server by librsvg, which has neither a browser
 * nor a network: it asks fontconfig for a family, and fontconfig only knows
 * about fonts installed on the machine.
 *
 * None of them were, and the failure is silent — a missing family falls through
 * to the next name in the stack and renders happily. Measured before this
 * existed, by hashing the same word rendered in different faces:
 *
 *   'Playfair Display', Georgia, serif   b5bce87ae9d6
 *   Georgia, 'Times New Roman', serif    b5bce87ae9d6   <- same pixels
 *   'Anton', Impact, sans-serif          233b6a2b6303
 *   'Bebas Neue', Impact, sans-serif     233b6a2b6303   <- same pixels
 *
 * So the customer approved one typeface and the mug would have been printed in
 * another, with nothing anywhere reporting it.
 *
 * The fix is to ship the files (assets/fonts) and point fontconfig at them. The
 * config is generated at runtime rather than committed because it has to carry
 * an absolute path, which differs between a developer's machine and a deploy.
 * It is written to the temp directory so a read-only app directory still works.
 *
 * Import this for its side effect before anything renders text.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** app/lib -> the repo root -> assets/fonts */
export const FONT_DIR = path.resolve(HERE, "..", "..", "assets", "fonts");

function escapeXml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Point fontconfig at the bundled fonts.
 *
 * Returns what happened so a caller can log it. Never throws: a print file in
 * the wrong typeface is a problem, but refusing to produce one at all is worse.
 */
function configureFontconfig() {
  if (!fs.existsSync(FONT_DIR)) {
    return { ok: false, reason: `no font directory at ${FONT_DIR}` };
  }

  const files = fs
    .readdirSync(FONT_DIR)
    .filter((name) => /\.(ttf|otf|ttc)$/i.test(name));

  if (files.length === 0) {
    return { ok: false, reason: `no font files in ${FONT_DIR}` };
  }

  // Fontconfig needs somewhere writable for its cache; the app directory may
  // not be on a deployed host.
  const cacheDir = path.join(os.tmpdir(), "magiktoon-fontconfig");

  try {
    fs.mkdirSync(cacheDir, { recursive: true });

    const conf =
      '<?xml version="1.0"?>\n' +
      '<!DOCTYPE fontconfig SYSTEM "urn:fontconfig:fonts.dtd">\n' +
      "<fontconfig>\n" +
      `  <dir>${escapeXml(FONT_DIR)}</dir>\n` +
      `  <cachedir>${escapeXml(cacheDir)}</cachedir>\n` +
      // Keep the system's own fonts too, so a stack's fallback still resolves

      "  <include ignore_missing=\"yes\">/etc/fonts/fonts.conf</include>\n" +
      "</fontconfig>\n";

    const confPath = path.join(cacheDir, "fonts.conf");
    fs.writeFileSync(confPath, conf);

    // FONTCONFIG_FILE names the config directly, which is unambiguous;
    // FONTCONFIG_PATH is set too because some builds look for the directory.
    process.env.FONTCONFIG_FILE = confPath;
    process.env.FONTCONFIG_PATH = cacheDir;

    return { ok: true, count: files.length, dir: FONT_DIR };
  } catch (error) {
    return { ok: false, reason: error.message };
  }
}

export const fontStatus = configureFontconfig();

if (!fontStatus.ok) {
  console.warn(
    `[fonts] design faces unavailable to the renderer (${fontStatus.reason}). ` +
    "Text will print in a fallback typeface, not the one the customer saw.",
  );
}

/**
 * Ask the renderer which families it can actually draw.
 *
 * Pointing fontconfig at a directory is not proof that it worked. It does not
 * work everywhere: librsvg resolves fonts through fontconfig on Linux — where
 * the print file is actually produced — but through the operating system's own
 * font list on Windows, which ignores this directory entirely. Measured, not
 * assumed: on a Windows machine every bundled family renders as its fallback
 * while OS-installed families render distinctly.
 *
 * So the answer has to come from a render, not from configuration. Each family
 * is drawn alone and drawn again behind a face that certainly exists; identical
 * pixels mean the family was never found and the fallback was substituted.
 *
 * This is the check that stops the original failure repeating. The danger was
 * never that a font was missing — it was that nothing said so, and a mug came
 * back in the wrong typeface with every log line green.
 *
 * @returns {Promise<{ ok: boolean, resolved: string[], missing: string[] }>}
 */
export async function verifyFontsResolve(sharp) {
  const { createHash } = await import("node:crypto");

  const draw = async (family) => {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="520" height="120">' +
      `<text x="10" y="90" font-size="72" font-family="${escapeXml(family)}"` +
      ">Handgloves 123</text></svg>";

    const png = await sharp(Buffer.from(svg)).png().toBuffer();

    return createHash("sha1").update(png).digest("hex");
  };

  // A name no font can have, so whatever it draws is the renderer's default.
  const fallback = await draw("MagikToonNoSuchFace");

  const families = fs
    .readdirSync(FONT_DIR)
    .filter((name) => /\.(ttf|otf|ttc)$/i.test(name))
    .map((name) => name.replace(/\.(ttf|otf|ttc)$/i, ""))
    // "PlayfairDisplay" is the file; "Playfair Display" is the family.
    .map((name) => name.replace(/-(Regular|Bold|Italic)$/i, ""))
    .map((name) => name.replace(/([a-z])([A-Z])/g, "$1 $2"));

  const unique = [...new Set(families)];
  const drawn = new Map();

  for (const family of unique) drawn.set(family, await draw(family));

  // Which families produced the same pixels as which.
  const byHash = new Map();

  for (const [family, hash] of drawn) {
    byHash.set(hash, [...(byHash.get(hash) || []), family]);
  }

  const resolved = [];
  const missing = [];
  const ambiguous = [];

  for (const [family, hash] of drawn) {
    // Two real faces cannot draw the same pixels, so a collision between
    // families means at least one of them was substituted. This is the case
    // that matters: fonts that did not ship all collapse together here.
    if (byHash.get(hash).length > 1) {
      missing.push(family);
      continue;
    }

    // Matching the renderer's default face, and nothing else, cannot be
    // resolved by drawing. Either this family is missing and fell back to the
    // default, or the default IS this family.
    //
    // Reported rather than guessed either way. Measured on Windows, where the
    // default face turned out to BE Montserrat and an earlier version of this
    // check called Montserrat missing while it was being used correctly — so
    // calling it missing is as wrong as calling it fine.
    if (hash === fallback) {
      ambiguous.push(family);
      continue;
    }

    resolved.push(family);
  }

  return { ok: missing.length === 0, resolved, missing, ambiguous };
}

/** The first family in a CSS stack — the one actually asked for. */
export function primaryFamily(stack) {
  return String(stack || "")
    .split(",")[0]
    .trim()
    .replace(/^['"]|['"]$/g, "");
}

let availability = null;

/**
 * Which families this machine can draw, measured once and remembered.
 *
 * Every print file would otherwise re-render nine probes to answer a question
 * whose answer cannot change while the process is alive.
 */
export async function fontAvailability(sharp) {
  if (!availability) {
    availability = verifyFontsResolve(sharp).catch((error) => {
      // Never let a diagnostic stop a print file being produced.
      console.warn("[fonts] availability could not be measured:", error.message);
      return { ok: true, resolved: [], missing: [] };
    });
  }

  return availability;
}