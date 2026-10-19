import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";

const { detectScene, detectBody, renderMugWrapPreviews } = await import(
  "../app/lib/mug-wrap-preview.server.js"
);

/**
 * A stand-in for a Gelato mug shot: light backdrop, a grey-edged white body
 * and, optionally, a dark handle on one side.
 */
async function mugShot({ handle = "right", body = [0.25, 0.7] } = {}) {
  const size = 1000;
  const [left, right] = body.map((fraction) => fraction * size);
  const handleX = handle === "right" ? right : handle === "left" ? left - 160 : -1000;

  const svg = `<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
    <rect width="${size}" height="${size}" fill="#f2f2f2"/>
    <rect x="${left}" y="190" width="${right - left}" height="600" fill="#ffffff" stroke="#9a9a9a" stroke-width="6"/>
    <rect x="${handleX}" y="300" width="160" height="320" rx="80" fill="none" stroke="#202060" stroke-width="40"/>
  </svg>`;

  return sharp(Buffer.from(svg)).jpeg().toBuffer();
}

const ARTWORK = await sharp({
  create: { width: 600, height: 300, channels: 3, background: "#cc2200" },
})
  .jpeg()
  .toBuffer();

test("the scene follows the handle", async () => {
  assert.equal(await detectScene(await mugShot({ handle: "right" })), "right");
  assert.equal(
    await detectScene(await mugShot({ handle: "left", body: [0.3, 0.75] })),
    "left",
  );
  assert.equal(await detectScene(await mugShot({ handle: "none", body: [0.3, 0.7] })), "back");
});

test("the body is found where this view frames it", async () => {
  const body = await detectBody(await mugShot({ body: [0.28, 0.74] }), "right");

  assert.ok(Math.abs(body.left - 0.28) < 0.02, `left ${body.left}`);
  assert.ok(Math.abs(body.right - 0.74) < 0.02, `right ${body.right}`);
});

test("one view per angle is wrapped and stored, left-back-right", async () => {
  const shots = [
    await mugShot({ handle: "right" }),
    await mugShot({ handle: "none", body: [0.3, 0.7] }),
    // A second colour of the same angle: dropped.
    await mugShot({ handle: "right" }),
  ];
  const stored = new Map();

  const result = await renderMugWrapPreviews(
    { shop: "shop.myshopify.com", mapping: { id: "m" }, artworkKey: "art", textValues: { Name: "PRIYA" } },
    {
      loadImages: async () => ["https://gelato/0.jpg", "https://gelato/1.jpg", "https://gelato/2.jpg"],
      read: async () => ARTWORK,
      fetchImpl: async (url) => ({
        ok: true,
        arrayBuffer: async () => shots[Number(url.slice(-5, -4))],
      }),
      store: async (buffer, { prefix }) => {
        const key = `${prefix}/${stored.size + 1}.jpg`;
        stored.set(key, buffer);
        return key;
      },
    },
  );

  assert.deepEqual(
    result.map((item) => item.scene),
    ["back", "right"],
  );
  assert.ok(result.every((item) => item.key.startsWith("mockups/shop_myshopify_com/")));

  // The artwork landed on the body: the side view is red where the photo is.
  const { data, info } = await sharp(stored.get(result[1].key)).raw().toBuffer({ resolveWithObject: true });
  const p = (Math.round(info.height / 2) * info.width + Math.round(info.width * 0.5)) * info.channels;
  assert.ok(data[p] > 150 && data[p + 1] < 90, `pixel ${data[p]},${data[p + 1]},${data[p + 2]}`);
});

test("no Gelato views means no stand-ins", async () => {
  const result = await renderMugWrapPreviews(
    { shop: "s", mapping: {}, artworkKey: "art" },
    { loadImages: async () => [], read: async () => ARTWORK },
  );

  assert.deepEqual(result, []);
});

test("the image layer is found as the design repeated on both sides", async () => {
  const { findImageSlots } = await import("../app/lib/mug-wrap-preview.server.js");
  const W = 1600;
  const H = Math.round((W * 96) / 230);
  const lum = new Float32Array(W * H).fill(235);
  const seen = new Float32Array(W).fill(1);

  // A textured "photo" 560 wide, centred 476 either side of the middle,
  // on a plain panel; its inner edges are at 604 and 996.
  // Blotchy, non-repeating texture, so only the true spacing matches.
  const photo = (x, y) => {
    const h = Math.imul((x >> 4) * 73856093 ^ (y >> 4) * 19349663, 2654435761) >>> 0;
    return 40 + (h % 160);
  };
  for (const start of [44, 996]) {
    for (let y = 0; y < H; y += 1) {
      for (let x = 0; x < 560; x += 1) lum[y * W + start + x] = photo(x, y);
    }
  }

  const slots = findImageSlots(lum, seen, 524);

  assert.ok(slots, "slots found");
  assert.ok(Math.abs(slots[0].x1 - 604) <= 8, `left inner edge ${slots[0].x1}`);
  assert.ok(Math.abs(slots[1].x0 - 996) <= 8, `right inner edge ${slots[1].x0}`);
});
