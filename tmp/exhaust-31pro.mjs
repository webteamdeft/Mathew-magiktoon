/**
 * Definitive test: can ANY 3.1-Pro-based model return an image?
 *
 * The Client has asked twice, so "not possible" has to survive scrutiny. This
 * tries every angle rather than one:
 *
 *   - both API versions (v1beta and v1alpha)
 *   - IMAGE alone and TEXT+IMAGE together
 *   - every plausible model name, including nano-banana-pro-preview
 *
 * Raw REST, so Google's own words come back unwrapped by the SDK.
 */
import fs from "node:fs";

for (const line of fs.readFileSync(".env", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

const KEY = process.env.GEMINI_API_KEY;
const PROMPT = "Generate an image: a wide cinematic desert road at sunset.";

const MODELS = [
  "gemini-3.1-pro-preview",
  "gemini-3.1-pro",
  "gemini-3.1-pro-image",
  "gemini-3.1-pro-image-preview",
  "gemini-3.1-pro-preview-image",
  "nano-banana-pro-preview",
  "nano-banana-pro",
];

const SHAPES = [
  ["v1beta", ["IMAGE"]],
  ["v1beta", ["TEXT", "IMAGE"]],
  ["v1alpha", ["IMAGE"]],
];

for (const model of MODELS) {
  const line = [];

  for (const [version, modalities] of SHAPES) {
    const url = `https://generativelanguage.googleapis.com/${version}/models/${model}:generateContent?key=${KEY}`;

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: PROMPT }] }],
          generationConfig: { responseModalities: modalities },
        }),
      });

      const body = await res.json();

      if (res.status === 404) { line.push(`${version}/${modalities.join("+")}: 404`); continue; }
      if (body.error) { line.push(`${version}/${modalities.join("+")}: ${res.status} ${String(body.error.message).slice(0,40)}`); continue; }

      const parts = (body.candidates || []).flatMap((c) => c.content?.parts || []);
      const hasImage = parts.some((p) => p.inlineData?.data);
      const finish = body.candidates?.[0]?.finishReason || "";

      line.push(`${version}/${modalities.join("+")}: ${hasImage ? "*** IMAGE ***" : "no image (" + finish + ")"}`);
    } catch (e) {
      line.push(`${version}/${modalities.join("+")}: ${e.message.slice(0, 30)}`);
    }
  }

  console.log(model.padEnd(30));
  line.forEach((l) => console.log("    " + l));
}
