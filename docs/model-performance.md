# Image model performance and output control

Measured against the live Google API, not taken from documentation. Every
figure below came from a real generation on the MagikToon dev store.

Date of measurement: 2026-09-03
Design under test: His Fashion ICON 11oz Ceramic Mug — print area 204 × 100 mm
(2409 × 1181 px at 300 DPI, ratio 2.040)

---

## 1. Speed — why the production model has not changed

The Milestone 4 acceptance criterion is **every passing run within 40 seconds**
(target 30).

| Model | Setting | Time | Output |
|---|---|---|---|
| `gemini-2.5-flash-image` | default | 18–21 s | 896 × 1152 |
| `gemini-3-pro-image` | default | 30–46 s | 912 × 1162 |
| `gemini-3-pro-image` | `imageSize: 2K` | 49.8 s | 1696 × 2528 |
| `gemini-3-pro-image` | `imageSize: 4K` | 79.9 s | 3648 × 4648 |

For reference, the 50-run reliability gate on `gemini-2.5-flash-image` measured
median 21.3 s, p95 27.6 s, slowest 28.7 s, none over the ceiling.

**Gemini 3 Pro breaches the 40-second ceiling at every useful quality setting.**
At its default it is borderline and sometimes over; at the resolutions that
would actually improve print output it is 50–80 seconds.

The production model therefore remains `gemini-2.5-flash-image`. This is the
Client's decision to change, not ours, and it is a genuine trade — the ceiling
was agreed in the SOW.

---

## 2. Output shape — fixed

### What was wrong

The request carried no aspect ratio at all. `generationConfig` contained only
`responseModalities: ["IMAGE"]`, so the model copied the shape of whatever
photo the customer uploaded. Measured: input ratio 0.785 in, 0.785 out, exactly.

A portrait snapshot therefore produced portrait artwork for a 2.040 mug wrap,
and the compositor cropped it to fit:

```
BEFORE  artwork 1883x2400 (0.785)  ->  61.5% of the picture discarded
AFTER   artwork 1536x672  (2.286)  ->  10.8% discarded
```

Nothing reported this. The customer simply received a worse crop than the
artwork they approved.

### The fix

`generationConfig.imageConfig.aspectRatio`, derived from the design's print
geometry rather than configured by hand. See `app/lib/image-shape.js`.

**Works on both models**, verified on `gemini-2.5-flash-image` and
`gemini-3-pro-image`.

### The vocabulary is closed

`aspectRatio` accepts a fixed set of strings, not arbitrary ratios. Verified by
sending each candidate to the live API:

| Value | Returned | Ratio |
|---|---|---|
| `9:16` | 768 × 1344 | 0.571 |
| `3:4` | 864 × 1184 | 0.730 |
| `1:1` | 1024 × 1024 | 1.000 |
| `5:4` | 1152 × 896 | 1.286 |
| `4:3` | 1184 × 864 | 1.370 |
| `3:2` | 1248 × 832 | 1.500 |
| `16:9` | 1344 × 768 | 1.750 |
| `21:9` | 1536 × 672 | 2.286 |

`2:1` and `1:2` are **rejected** by the API.

Note `21:9` returns 2.286, not the 2.333 its name implies. The nearest-shape
calculation uses measured ratios for this reason.

A 204 × 100 mm mug (2.040) maps to `21:9`.

---

## 3. Output resolution — NOT fixed, and cannot be on the current model

### What was wrong

The admin's 1K / 2K / 4K setting was appended to the **prompt** as a sentence:

> `Render the result at 2K resolution, filling the frame...`

Asking for "2K" returned 848 × 1264. The long edge should be 2048. The setting
did essentially nothing.

### What we found

`generationConfig.imageConfig.imageSize` is the real parameter, and it is
honoured by `gemini-3-pro-image` **only**:

| Model | `imageSize` | Output |
|---|---|---|
| `gemini-2.5-flash-image` | none | 896 × 1152 |
| `gemini-2.5-flash-image` | `2K` | 896 × 1152 — **ignored** |
| `gemini-3-pro-image` | `1K` | 912 × 1162 |
| `gemini-3-pro-image` | `2K` | 1696 × 2528 |
| `gemini-3-pro-image` | `4K` | 3648 × 4648 |

### The consequence

A mug wrap needs 2409 × 1181. On the production model the best available is
1536 × 672, so every print file is **upscaled about 1.76×**.

Upscaling is silent: sharp enlarges without complaint and returns a file of
exactly the right dimensions. The only symptom is a soft print, and nobody sees
it until the parcel arrives. `describeUpscale` now logs it at generation time:

```
[generation] artwork 1536x672 is smaller than the 2409x1181 print area
             and will be upscaled 1.76x (model gemini-2.5-flash-image)
```

`imageSize` is wired through and is dropped for any model that ignores it, so a
resolution is never recorded against a run that did not honour it. It takes
effect the moment the model is switched — no further work needed.

---

## 4. The decision in front of the Client

| | Sharp print | Within 40 s |
|---|---|---|
| `gemini-2.5-flash-image` | no — 1.76× upscale | yes, comfortably |
| `gemini-3-pro-image` at 2K | yes — 3168 × 1344 | no — ~50 s |

Three ways out, none of them free:

1. **Stay as we are.** Fast, reliable, slightly soft print.
2. **Raise the ceiling** to about 60 seconds and move to Gemini 3 Pro at 2K.
   Requires amending the agreed SOW criterion.
3. **Split by product.** Keep the fast model where print size is small, use the
   Pro model for large-format items where softness shows most.

Not our call. Documented so it can be made on evidence.
