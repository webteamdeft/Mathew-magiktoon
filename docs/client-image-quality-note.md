# MagikToon — Image Quality: Findings and a Decision for You

Hi Matthew,

While testing the newer AI model we found two things worth bringing to you.
One we have fixed. The other needs a decision from you, because it involves a
trade-off against something we agreed in the contract.

---

## 1. Fixed — the artwork was being cropped far too heavily

**What was happening**

We were not telling the AI what shape to produce. It simply copied the shape of
whatever photo the customer uploaded.

Most people upload upright photos. A mug wrap is wide — roughly twice as wide as
it is tall. So the system was generating a tall image and then cutting most of
it away to fit the mug.

On a typical upload, **about 61% of the generated picture was being discarded.**

Nothing reported this. The customer approved one image and received a much
tighter crop of it on the mug.

**What we changed**

The system now asks the AI for the correct shape up front, taken automatically
from the product's actual print size. Nothing to configure — it reads the mug's
dimensions and asks for artwork that matches.

**Result: cropping has dropped from about 61% to about 11%.**

That remaining 11% is normal and necessary — a small margin is always trimmed
so there is no unprinted edge.

This is live now and applies to every product.

---

## 2. Needs your decision — print sharpness vs speed

**The situation**

A mug at proper print quality needs an image roughly 2409 pixels wide. The AI
model we currently use produces about 1536 pixels. We enlarge it to fit.

Enlarging always costs some sharpness. It will not look broken — but on close
inspection a print will be slightly softer than it could be.

We also found that the "1K / 2K / 4K" quality setting in the admin was not
actually doing anything. It was being sent to the AI as a written request rather
than as a real setting, and the AI was ignoring it. That is now wired up
properly — but here is the catch.

**The catch**

That quality setting only works on the newer model, **Gemini 3 Pro**. And Gemini
3 Pro is slow.

We agreed a limit in the contract: every generation must complete within **40
seconds**. Here is what we measured:

| | Time | Print quality |
|---|---|---|
| Current model | 18–21 seconds | Slightly soft |
| Gemini 3 Pro, standard | 30–46 seconds | Same as current |
| Gemini 3 Pro, high quality | **50 seconds** | Sharp |
| Gemini 3 Pro, highest | **80 seconds** | Very sharp |

For comparison, our full 50-run reliability test on the current model averaged
21 seconds, with the slowest at 29 — comfortably inside the limit.

**Gemini 3 Pro cannot deliver sharper prints and stay inside 40 seconds.** Those
two things are in direct conflict.

**We have not switched anything.** The store is running exactly as before, on
the fast model. This is your call to make, not ours.

---

## Your options

**Option 1 — Leave it as it is** *(what we would suggest for now)*

Fast, reliable, well inside the agreed limit. Prints are slightly softer than
ideal but perfectly saleable. Worth seeing a physical sample before spending
anything to change it.

**Option 2 — Accept a longer wait for sharper prints**

Move to Gemini 3 Pro at high quality. Prints become properly sharp, but
customers wait around 50 seconds instead of 20, and we would need to formally
raise the agreed 40-second limit to about 60.

**Option 3 — Different models for different products**

Fast model for smaller items, higher-quality model for large-format products
where softness is most visible. Best of both, slightly more to set up.

---

## What we recommend

**Order one mug through the live system and look at it.**

We can measure sharpness all day, but whether a 1.76× enlargement is visible on
a real ceramic mug is something only the physical product answers. If it looks
good, Option 1 costs you nothing. If it does not, we will know exactly what we
are buying with the extra wait.

Everything needed for Option 2 is already built. Switching is a settings change,
not development work — so nothing is lost by testing first.

---

## In short

- Cropping problem: **found and fixed**, live now, no action needed from you
- Quality setting: **was doing nothing**, now works properly
- Sharpness: **needs your decision**, and we suggest judging it on a real mug
  before changing anything

Happy to talk any of this through.

Kanny
