import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from "@google/generative-ai";
// Explicit extension: Vite resolves it either way, but the test runner loads
// these files through Node's own ESM loader, which does not.
import { getGeminiConfig } from "./env.server.js";
import { buildImageConfig } from "./image-shape.js";

let client;

function getClient() {
  const { apiKey } = getGeminiConfig();

  if (!client) {
    client = new GoogleGenerativeAI(apiKey);
  }

  return client;
}

/**
 * Generate artwork from a customer photo.
 *
 * @param {object} params
 * @param {string} params.prompt
 * @param {string} params.imageBase64
 * @param {string} [params.mimeType]
 * @param {string} [params.model] The model to run, chosen per design in admin
 *   (Milestone 4). Falls back to the app-wide default when a design has none,
 *   so an unconfigured product keeps working rather than failing outright.
 */
export async function generatePersonalisedArtwork({
  prompt,
  imageBase64,
  mimeType = "image/png",
  model: requestedModel = "",
  aspectRatio = "",
  imageSize = "",
  temperature = null,
  seed = null,
}) {
  const { model: defaultModel } = getGeminiConfig();

  const model = String(requestedModel || "").trim() || defaultModel;

  // The shape and size of the image, as real parameters.
  //
  // Until this was added the request carried neither, and the consequences were
  // measured rather than guessed: output copied the customer's photo exactly
  // (0.785 in, 0.785 out), so portrait snapshots produced portrait artwork for
  // a 2:1 mug wrap and most of it was then cropped away. The admin's 1K/2K/4K
  // setting was a sentence in the prompt and returned 848 x 1264 for "2K".
  //
  // `buildImageConfig` drops anything the chosen model does not honour, so a
  // value never appears in the log for a run that ignored it.
  const imageConfig = buildImageConfig({ aspectRatio, imageSize, model });

  const generativeModel = getClient().getGenerativeModel({
    model,
    safetySettings: [
      {
        category: HarmCategory.HARM_CATEGORY_HARASSMENT,
        threshold: HarmBlockThreshold.BLOCK_NONE,
      },
      {
        category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
        threshold: HarmBlockThreshold.BLOCK_NONE,
      },
      {
        category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
        threshold: HarmBlockThreshold.BLOCK_NONE,
      },
      {
        category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
        threshold: HarmBlockThreshold.BLOCK_NONE,
      },
    ],
    // Ask for an image, explicitly.
    //
    // Without this the model is free to answer in prose, and it does: a live
    // run against a real customer photo came back as "I can transform this
    // image into a bold, colorful cartoon..." with no image attached, which the
    // caller can only treat as a failed generation. Under the 50-run gate only
    // two clean failures are allowed across the whole run, so a model that
    // sometimes chats instead of drawing fails the milestone on its own.
    //
    // Measured over four consecutive live runs on the same photo: 0/4 reliable
    // without this line, 4/4 with it.
    generationConfig: {
      responseModalities: ["IMAGE"],
      ...(imageConfig ? { imageConfig } : {}),
      // Omitted entirely when unset, so an unconfigured design keeps the
      // model default rather than being pinned to a value nobody chose.
      ...(temperature === null || temperature === undefined ? {} : { temperature }),
      ...(seed === null || seed === undefined ? {} : { seed }),
    },
  });

  const result =
    await generativeModel.generateContent([
      {
        inlineData: {
          data: imageBase64,
          mimeType,
        },
      },
      {
        text: prompt,
      },
    ]);

  const response = result.response;

  const candidates = response.candidates || [];

  const parts = candidates.flatMap(
    (candidate) => candidate.content?.parts || []
  );

  const imagePart = parts.find(
    (part) => part.inlineData?.data
  );

  if (!imagePart) {
    throw new Error(
      "Gemini did not return an image"
    );
  }

  return {
    base64: imagePart.inlineData.data,
    mimeType:
      imagePart.inlineData.mimeType || "image/png",
    model,
  };
}
