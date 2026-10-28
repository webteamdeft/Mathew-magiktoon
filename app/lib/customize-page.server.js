/**
 * The dedicated full-page customizer served over the app proxy.
 *
 * WHY A SERVER-RENDERED LIQUID PAGE
 * ---------------------------------
 * The customizer is a page in its own right, not a modal over the product page.
 * Responding with `Content-Type: application/liquid` makes Shopify render this
 * body *inside the merchant's own theme layout*, so the store header, footer,
 * fonts and colours wrap the editor and it reads as part of the shop rather
 * than as an embedded widget.
 *
 * Because the body is processed as Liquid, every `<style>` and `<script>` is
 * wrapped in `{% raw %}` so the theme's Liquid engine leaves the CSS and JS
 * untouched.
 *
 * All page data is emitted as a single JSON script tag rather than interpolated
 * into JS, so nothing the merchant or customer typed can break out into code.
 *
 * SERVER ONLY.
 */

import {
  LAYER_TYPES,
  editableTextLayers,
  googleFontsHref,
  normalizeLayers,
} from "./layers.js";
import { toTrimmedString } from "./normalize.js";

/**
 * Where the print guide sits on the product image, as fractions.
 *
 * These match the theme block's defaults. They describe the artwork's position
 * on the *mockup*, not the print file — Gelato places the artwork inside the
 * template placeholder itself, so an imperfect on-screen offset never reaches
 * the printer.
 */
const PRINT_AREA = { x: 0.3, y: 0.32, size: 0.3 };

/**
 * The image URL for one design.
 *
 * Gelato's preview URLs are presigned and expire in 24 hours, so the stable
 * app-proxy path is preferred wherever one exists.
 */
export function designImage(proxyBase, option) {
  if (!option) return "";

  return option.previewPath
    ? `${proxyBase || "/apps/magiktoon"}${option.previewPath}`
    : option.previewUrl || "";
}

/** HTML-escape a value for safe interpolation into markup. */
function escapeHtml(value) {
  return toTrimmedString(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Serialize page data for a `<script type="application/json">` tag.
 *
 * `<` is escaped so a string containing `</script>` cannot close the tag early.
 */
function toJsonScript(value) {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

const STYLES = `
:root {
  --mtc-accent: #f4451d;
  --mtc-accent-hover: #dc3c17;
  --mtc-accent-soft: #fbd7cc;
  --mtc-ink: #101010;
  --mtc-body: #5c5c5c;
  --mtc-muted: #8c8c8c;
  --mtc-surface: #ffffff;
  --mtc-stage: #fdf4f1;
  --mtc-border: #e4e4e4;
  --mtc-border-strong: #d2d2d2;
  --mtc-success: #0f7b4f;
  --mtc-success-soft: #e7f5ee;
  --mtc-critical: #b42318;
  --mtc-critical-soft: #fdeceb;
  --mtc-radius: 16px;
  --mtc-radius-sm: 10px;
  --mtc-pill: 999px;
}

.mtcp {
  box-sizing: border-box;
  color: var(--mtc-ink);
  margin: 0 auto;
  max-width: 1440px;
  padding: 32px 24px 64px;
  width: 100%;
}

.mtcp *, .mtcp *::before, .mtcp *::after { box-sizing: inherit; }

.mtcp__breadcrumb {
  align-items: center;
  background: none;
  border: none;
  color: var(--mtc-body);
  cursor: pointer;
  display: inline-flex;
  font: inherit;
  gap: 8px;
  margin-bottom: 20px;
  padding: 8px 0;
  text-decoration: none;
}

.mtcp__breadcrumb:hover { color: var(--mtc-accent); }

.mtcp__head { margin-bottom: 28px; }

.mtcp__title {
  font-size: clamp(26px, 4vw, 38px);
  font-weight: 700;
  letter-spacing: -0.01em;
  line-height: 1.15;
  margin: 0 0 8px;
}

.mtcp__sub { color: var(--mtc-body); margin: 0; }

/* ---- layout ---- */

/*
 * Product preview on the left (sticky), customization panel on the right.
 * The layout switches to two columns on larger screens to keep the product
 * visible at all times while the user scrolls through the customization options.
 */
.mtcp__layout {
  display: grid;
  gap: 44px;
  grid-template-columns: minmax(0, 1fr);
  align-items: start;
}

@media (min-width: 990px) {
  .mtcp__layout {
    grid-template-columns: 50% 1fr;
    gap: 48px;
  }
}

@media (min-width: 1200px) {
  .mtcp__layout {
    grid-template-columns: 52% 1fr;
    gap: 52px;
  }
}

.mtcp__stage-col { 
  margin-inline: auto; 
  width: 100%; 
}

@media (min-width: 990px) {
  .mtcp__stage-col {
    position: sticky;
    top: 32px;
  }
}

/* Full-width form rows under a full-width stage are hard to scan. */
.mtcp__panel-col,
.mtcp__layout .mtcp__panel {
  margin-inline: auto;
  max-width: 760px;
  width: 100%;
}

@media (min-width: 990px) {
  .mtcp__layout .mtcp__panel {
    max-width: none;
    padding-bottom: 32px;
  }
}

.mtcp__stage {
  /* Text layer sizes are fractions of the product image width, expressed in
     container-query units, so the stage must be the container they measure
     against. Backticks are avoided in here: this block is a JS template
     literal, and one would end the string. */
  container-type: inline-size;
  /* All product previews displayed in landscape (16:9) orientation */
  aspect-ratio: 16 / 9;
  background: var(--mtc-stage);
  border-radius: var(--mtc-radius);
  overflow: hidden;
  position: relative;
  margin-inline: auto;
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}

.mtcp__stage-img,
.mtcp__stage-mockup,
.mtcp__stage-view {
  display: block;
  height: 100%;
  width: 100%;
  object-fit: contain;
  object-position: center;
  margin: 0 auto;
}

.mtcp__stage-mockup,
.mtcp__stage-view {
  position: absolute;
  inset: 0;
  z-index: 5;
  object-fit: contain;
  object-position: center;
}

.mtcp__stage-mockup[hidden],
.mtcp__stage-view[hidden] {
  display: none !important;
}

.mtcp__stage.is-mockup .mtcp__area,
.mtcp__stage.is-viewing .mtcp__area {
  display: none !important;
}


/*
 * The whole stage is the drag surface, not just the guide: a mug's print area
 * is a narrow band, and grabbing a few millimetres of it is not usable.
 */
.mtcp__stage {
  cursor: grab;
  touch-action: none;
}

.mtcp__stage.is-dragging { cursor: grabbing; }
.mtcp__stage:focus-visible { outline: 2px solid var(--mtc-accent); outline-offset: 3px; }

.mtcp__area {
  /* A ring of shadow dims everything outside the printable area, so the guide
     reads as a window onto the print rather than a box drawn on the photo. */
  border: 2px dashed var(--mtc-accent);
  border-radius: 8px;
  box-shadow: 0 0 0 9999px rgba(255, 255, 255, 0.55);
  overflow: hidden;
  pointer-events: none;
  position: absolute;
}

/*
 * Nothing to position, so nothing to mark out.
 *
 * The stage is showing a Gelato mockup of the finished design; a dashed print
 * area over the top of it is marking a boundary on a picture that has already
 * been printed.
 */
.mtcp__area.is-quiet {
  border-color: transparent;
  box-shadow: none;
}

.mtcp__area.is-quiet::after { display: none; }

.mtcp__area::after {
  border: 1px solid rgba(255, 255, 255, 0.85);
  content: "";
  inset: 2px;
  pointer-events: none;
  position: absolute;
}

.mtcp__art {
  left: 50%;
  pointer-events: none;
  position: absolute;
  top: 50%;
  transform: translate(-50%, -50%);
  user-select: none;
}

/* A template text layer drawn over the product. */
/*
 * A fixed image layer: part of the design that is not the customer's photo —
 * a logo, a barcode, a block of set wording saved as artwork.
 *
 * "contain" rather than "cover": these are designed elements at a known shape,
 * and cropping one to fill a box would cut the design.
 */
.mtcp__layer-img {
  object-fit: contain;
  pointer-events: none;
  position: absolute;
  transform-origin: center;
}

.mtcp__area-empty {
  align-content: center;
  color: var(--mtc-body);
  display: grid;
  font-size: 13px;
  gap: 6px;
  inset: 0;
  justify-items: center;
  padding: 8px;
  position: absolute;
  text-align: center;
}

.mtcp__zoom {
  align-items: center;
  display: flex;
  gap: 12px;
  justify-content: center;
  margin-top: 16px;
}

.mtcp__zoom-btn {
  background: var(--mtc-surface);
  border: 1.5px solid var(--mtc-border-strong);
  border-radius: 50%;
  cursor: pointer;
  font-size: 20px;
  height: 40px;
  line-height: 1;
  width: 40px;
}

.mtcp__zoom-btn:hover:not(:disabled) {
  border-color: var(--mtc-accent);
  color: var(--mtc-accent);
}

.mtcp__zoom-btn:disabled { cursor: not-allowed; opacity: 0.45; }

.mtcp__zoom-val {
  color: var(--mtc-body);
  font-size: 14px;
  font-variant-numeric: tabular-nums;
  min-width: 56px;
  text-align: center;
}

.mtcp__hint {
  color: var(--mtc-muted);
  font-size: 13px;
  margin: 12px 0 0;
  text-align: center;
}

/* ---- panel ---- */

.mtcp__panel { display: grid; gap: 32px; }

.mtcp__panel-head { display: grid; gap: 8px; margin-bottom: 8px; }

.mtcp__panel-title {
  font-size: 28px;
  font-weight: 800;
  letter-spacing: -0.02em;
  margin: 0;
}

.mtcp__panel-sub {
  color: var(--mtc-body);
  font-size: 16px;
  margin: 0;
}

/* Steps styled as boxed cards for better visual hierarchy and modern look. */
.mtcp__step {
  display: grid;
  gap: 16px;
  justify-items: start;
  background: var(--mtc-surface);
  border: 1px solid var(--mtc-border);
  border-radius: var(--mtc-radius);
  padding: 24px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.03);
}

.mtcp__step-title {
  font-size: 18px;
  font-weight: 700;
  margin: 0 0 4px;
}

.mtcp__help {
  color: var(--mtc-body);
  font-size: 14px;
  margin: 0;
}

.mtcp__buying {
  border-top: 1px solid var(--mtc-border);
  color: var(--mtc-muted);
  font-size: 13px;
  margin: 0;
  padding-top: 16px;
}

.mtcp__card-head {
  align-items: center;
  display: flex;
  gap: 12px;
  margin-bottom: 16px;
}

.mtcp__badge {
  align-items: center;
  background: var(--mtc-accent);
  border-radius: 50%;
  color: #fff;
  display: flex;
  flex: none;
  font-size: 14px;
  font-weight: 700;
  height: 28px;
  justify-content: center;
  width: 28px;
}

.mtcp__card-title { font-size: 17px; font-weight: 700; margin: 0; }

.mtcp__product {
  align-items: center;
  display: grid;
  gap: 16px;
  grid-template-columns: 72px 1fr;
}

.mtcp__product-img {
  aspect-ratio: 1 / 1;
  border: 1px solid var(--mtc-border);
  border-radius: var(--mtc-radius-sm);
  display: block;
  height: auto;
  object-fit: cover;
  width: 100%;
}

.mtcp__product-name { font-weight: 600; margin: 0 0 2px; }
.mtcp__product-meta { color: var(--mtc-body); font-size: 14px; margin: 0; }

/* ---- the product actually being purchased ---- */

.mtcp__card--buying {
  background: var(--mtc-stage);
  border-color: var(--mtc-accent-soft);
}

.mtcp__buying-label {
  color: var(--mtc-accent);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.06em;
  margin: 0 0 12px;
  text-transform: uppercase;
}

.mtcp__buying-note {
  color: var(--mtc-body);
  font-size: 13px;
  margin: 14px 0 0;
  overflow-wrap: anywhere;
}

/* ---- design chooser ---- */

.mtcp__designs {
  display: grid;
  gap: 12px;
  grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
}

.mtcp__design {
  background: var(--mtc-surface);
  border: 1.5px solid var(--mtc-border);
  border-radius: 12px;
  cursor: pointer;
  display: grid;
  font: inherit;
  gap: 8px;
  justify-items: center;
  padding: 12px;
  text-align: center;
}

.mtcp__design:hover { border-color: var(--mtc-accent-soft); }

.mtcp__design[aria-checked="true"] {
  border-color: var(--mtc-accent);
  box-shadow: 0 0 0 1px var(--mtc-accent);
}

.mtcp__design-img {
  aspect-ratio: 1 / 1;
  background: var(--mtc-stage);
  border-radius: 8px;
  display: block;
  height: auto;
  object-fit: contain;
  width: 100%;
}

.mtcp__design-name {
  font-size: 13px;
  font-weight: 600;
  overflow-wrap: anywhere;
}

/* ---- dropzone ---- */

.mtcp__drop {
  align-items: center;
  background: none;
  border: 1.5px dashed var(--mtc-border-strong);
  border-radius: 12px;
  cursor: pointer;
  display: flex;
  font: inherit;
  gap: 20px;
  padding: 22px;
  text-align: left;
  width: 100%;
}

.mtcp__drop:hover, .mtcp__drop:focus-visible, .mtcp__drop.is-over {
  background: #fffaf8;
  border-color: var(--mtc-accent);
}

.mtcp__drop-icon { color: var(--mtc-accent); flex: none; }
.mtcp__drop-copy { display: grid; gap: 4px; justify-items: start; }
.mtcp__drop-title { font-weight: 600; margin: 0; overflow-wrap: anywhere; }
.mtcp__drop-hint { color: var(--mtc-muted); font-size: 13px; margin: 0; }

/* The uploaded file, as the approved design shows it: thumbnail, name, and a
   progress line that becomes a completed line. */
.mtcp__file-row {
  align-items: center;
  background: #f4f6fa;
  border-radius: 12px;
  display: flex;
  gap: 12px;
  margin-top: 12px;
  overflow: hidden;
  padding: 12px;
}

.mtcp__file-thumb {
  border-radius: 8px;
  flex: none;
  height: 44px;
  object-fit: cover;
  width: 44px;
}

.mtcp__file-body { display: grid; gap: 4px; min-width: 0; flex: 1; }

.mtcp__file-name {
  font-size: 14px;
  font-weight: 600;
  margin: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mtcp__file-state {
  align-items: center;
  color: var(--mtc-muted);
  display: flex;
  font-size: 12px;
  gap: 5px;
  margin: 0;
}

.mtcp__file-state.is-done { color: #1a7f4b; }

.mtcp__file-bar {
  background: #dfe3ea;
  border-radius: 999px;
  height: 5px;
  overflow: hidden;
  width: 100%;
}

.mtcp__file-bar > span {
  background: var(--mtc-accent);
  display: block;
  height: 100%;
  transition: width .18s ease;
  width: 0;
}

.mtcp__file-remove {
  background: none;
  border: 0;
  color: var(--mtc-muted);
  cursor: pointer;
  flex: none;
  font-size: 17px;
  line-height: 1;
  padding: 4px;
}

.mtcp__file-remove:hover, .mtcp__file-remove:focus-visible { color: var(--mtc-ink); }

@media (prefers-reduced-motion: reduce) {
  .mtcp__file-bar > span { transition: none; }
}
.mtcp__file { display: none; }

/* ---- fields ---- */

.mtcp__field { display: grid; gap: 6px; width: 100%; }
.mtcp__label { font-size: 14px; font-weight: 600; }

.mtcp__input {
  background: var(--mtc-surface);
  border: 1.5px solid var(--mtc-border);
  border-radius: var(--mtc-radius-sm);
  color: var(--mtc-ink);
  font: inherit;
  min-height: 48px;
  padding: 12px 14px;
  width: 100%;
}

.mtcp__input:focus { border-color: var(--mtc-accent); outline: none; }
.mtcp__count { color: var(--mtc-muted); font-size: 12px; }

/* ---- buttons ---- */

.mtcp__btn {
  align-items: center;
  border: 1.5px solid transparent;
  border-radius: var(--mtc-pill);
  cursor: pointer;
  display: inline-flex;
  font: inherit;
  font-weight: 600;
  gap: 10px;
  justify-content: center;
  min-height: 52px;
  padding: 14px 30px;
  text-align: center;
  text-decoration: none;
  transition: background-color 0.15s ease, border-color 0.15s ease;
  width: 100%;
}

.mtcp__btn--primary { background: var(--mtc-accent); color: #fff; }
.mtcp__btn--primary:hover:not(:disabled) { background: var(--mtc-accent-hover); }
.mtcp__btn--primary:disabled { background: var(--mtc-accent-soft); cursor: not-allowed; }

.mtcp__btn--outline {
  background: var(--mtc-surface);
  border-color: var(--mtc-accent);
  color: var(--mtc-accent);
}

.mtcp__btn--outline:hover:not(:disabled) { background: #fff4f1; }
.mtcp__btn--outline:disabled { border-color: var(--mtc-border-strong); color: var(--mtc-muted); cursor: not-allowed; }

.mtcp__actions { display: grid; gap: 12px; }

.mtcp__btn--sm {
  margin-top: 4px;
  min-height: 40px;
  padding: 9px 24px;
  width: auto;
}

.mtcp__btn--auto { width: auto; }
.mtcp__btn--block { width: 100%; }

/* ---- spinner + states ---- */

.mtcp__spinner {
  animation: mtcp-spin 0.7s linear infinite;
  border: 2.5px solid rgba(255, 255, 255, 0.4);
  border-radius: 50%;
  border-top-color: #fff;
  height: 18px;
  width: 18px;
}

@keyframes mtcp-spin { to { transform: rotate(360deg); } }

@media (prefers-reduced-motion: reduce) {
  .mtcp__spinner { animation-duration: 2s; }
}

/* ---- generation progress ---- */

/*
 * Shown while the artwork is being drawn, which can take most of a minute.
 *
 * A plain bar and a line of text, in the shop's own colours. Nothing that
 * performs machine activity at the customer.
 *
 * The fill transitions rather than animates. It moves only when the script
 * sets a new width, so it cannot keep sliding after a failure and imply
 * progress that has stopped.
 */
.mtcp__progress {
  margin: 14px 0 0;
  max-width: 420px;
}

.mtcp__progress-track {
  background: rgba(0, 0, 0, 0.08);
  border-radius: 999px;
  height: 6px;
  overflow: hidden;
  width: 100%;
}

.mtcp__progress-fill {
  background: var(--mtc-accent, #1f5560);
  border-radius: 999px;
  height: 100%;
  transition: width 0.45s ease-out;
  width: 0%;
}

.mtcp__progress-text {
  align-items: baseline;
  color: var(--mtc-muted, #6a7078);
  display: flex;
  font-size: 14px;
  gap: 8px;
  justify-content: space-between;
  margin: 8px 0 0;
}

/* Tabular figures so a rising counter does not jiggle the line. */
.mtcp__progress-time {
  font-variant-numeric: tabular-nums;
  opacity: 0.75;
}

@media (prefers-reduced-motion: reduce) {
  .mtcp__progress-fill { transition: none; }
}

.mtcp__note {
  border-radius: var(--mtc-radius-sm);
  font-size: 14px;
  margin: 16px 0 0;
  padding: 14px 16px;
}

.mtcp__note--error { background: var(--mtc-critical-soft); color: var(--mtc-critical); }
.mtcp__note--success { background: var(--mtc-success-soft); color: var(--mtc-success); }

.mtcp__saved {
  align-items: center;
  background: var(--mtc-success-soft);
  border-radius: var(--mtc-radius-sm);
  display: grid;
  gap: 14px;
  grid-template-columns: 64px 1fr;
  margin-bottom: 16px;
  padding: 14px;
}

.mtcp__saved-img {
  aspect-ratio: 16 / 9;
  border-radius: 8px;
  display: block;
  height: auto;
  object-fit: contain;
  object-position: center;
  background: var(--mtc-stage);
  width: 100%;
}

.mtcp__saved-title { color: var(--mtc-success); font-weight: 700; margin: 0 0 2px; }
.mtcp__saved-meta { color: var(--mtc-body); font-size: 13px; margin: 0; overflow-wrap: anywhere; }

[hidden] { display: none !important; }

/* ---- responsive ---- */

/* The Gelato mockup replaces the built preview in place, so the customer
   approves it where they have been looking all along rather than comparing two
   pictures in two places. */
.mtcp__stage-mockup {
  background: var(--mtc-stage);
  display: block;
  height: 100%;
  inset: 0;
  object-fit: contain;
  object-position: center;
  position: absolute;
  width: 100%;
  z-index: 3;
}

/* While the real mockup is up, the built preview underneath must not show
   through, and its guide must not invite dragging something that is no longer
   adjustable. */
.mtcp__stage.is-mockup { cursor: default; }
.mtcp__stage.is-mockup .mtcp__area { display: none; }

.mtcp__stage.is-loading-preview {
  position: relative;
}
.mtcp__stage.is-loading-preview::after {
  content: "";
  position: absolute;
  inset: 0;
  background: rgba(253, 244, 241, 0.75) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='38' height='38' viewBox='0 0 38 38' stroke='%23f4451d'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg transform='translate(1 1)' stroke-width='3'%3E%3Ccircle stroke-opacity='.2' cx='18' cy='18' r='18'/%3E%3Cpath d='M36 18c0-9.94-8.06-18-18-18'%3E%3CanimateTransform attributeName='transform' type='rotate' from='0 18 18' to='360 18 18' dur='0.8s' repeatCount='indefinite'/%3E%3C/path%3E%3C/g%3E%3C/g%3E%3C/svg%3E") no-repeat center center;
  z-index: 10;
  backdrop-filter: blur(2px);
  border-radius: var(--mtc-radius);
}

/* Another view of the same design, shown in place of the editable preview. */
.mtcp__stage-view {
  background: var(--mtc-stage);
  display: block;
  height: 100%;
  inset: 0;
  object-fit: contain;
  object-position: center;
  position: absolute;
  width: 100%;
  z-index: 2;
}

.mtcp__stage.is-viewing { cursor: default; }
.mtcp__stage.is-viewing .mtcp__area { display: none; }

/*
 * Stepping through the design's other views.
 *
 * Arrows on the image rather than thumbnails under it: twelve tiles wrapped
 * onto two rows, pushed the zoom controls down, and put a grid of small mugs
 * directly beneath a large one.
 */
.mtcp__views-nav {
  align-items: center;
  background: rgba(255, 255, 255, 0.92);
  border: 1px solid var(--mtc-line);
  border-radius: 999px;
  color: var(--mtc-ink);
  cursor: pointer;
  display: flex;
  font-size: 20px;
  height: 40px;
  justify-content: center;
  line-height: 1;
  padding: 0;
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  width: 40px;
  z-index: 6;
}

.mtcp__views-nav[hidden] { display: none; }
.mtcp__views-nav:hover { background: #fff; }

.mtcp__views-nav:focus-visible {
  outline: 2px solid var(--mtc-accent);
  outline-offset: 2px;
}

.mtcp__views-nav--prev { left: 10px; }
.mtcp__views-nav--next { right: 10px; }

.mtcp__views-count {
  background: rgba(255, 255, 255, 0.92);
  border: 1px solid var(--mtc-line);
  border-radius: 999px;
  bottom: 10px;
  color: var(--mtc-body);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  left: 50%;
  padding: 3px 10px;
  position: absolute;
  transform: translateX(-50%);
  z-index: 6;
}

.mtcp__views-count[hidden] { display: none; }

@media (max-width: 989px) {
  .mtcp { padding: 24px 18px 56px; }
  .mtcp__layout { gap: 32px; }
  /* Vertical room is scarce on a phone, so let the stage stay responsive at 16:9. */
  .mtcp__stage { --mtc-stage-max-h: 46vh; width: 100%; }
}

@media (max-width: 749px) {
  .mtcp__card { padding: 20px 16px; }
  .mtcp__drop { flex-direction: column; text-align: center; }
  .mtcp__drop-copy { justify-items: center; }
}

/* ---- flat template preview modal ---- */

.mtcp-modal {
  position: fixed;
  inset: 0;
  z-index: 9999;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}
.mtcp-modal[hidden] {
  display: none !important;
}
.mtcp-modal__backdrop {
  position: fixed;
  inset: 0;
  background: rgba(16, 16, 16, 0.7);
  backdrop-filter: blur(4px);
}
.mtcp-modal__dialog {
  position: relative;
  background: var(--mtc-surface, #ffffff);
  border-radius: var(--mtc-radius, 16px);
  box-shadow: 0 20px 40px rgba(0, 0, 0, 0.25);
  max-width: 96vw;
  width: 96vw;
  max-height: 94vh;
  height: 94vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  z-index: 1;
  animation: mtcp-modal-in 0.25s ease-out;
}
@keyframes mtcp-modal-in {
  from { opacity: 0; transform: scale(0.96) translateY(8px); }
  to { opacity: 1; transform: scale(1) translateY(0); }
}
.mtcp-modal__header {
  padding: 16px 24px;
  border-bottom: 1px solid var(--mtc-border, #e4e4e4);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex-shrink: 0;
}
.mtcp-modal__title-group {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.mtcp-modal__title {
  font-size: 18px;
  font-weight: 700;
  color: var(--mtc-ink, #101010);
  margin: 0;
}
.mtcp-modal__subtitle {
  font-size: 13px;
  color: var(--mtc-body, #5c5c5c);
}
.mtcp-modal__close {
  background: transparent;
  border: none;
  font-size: 28px;
  line-height: 1;
  color: var(--mtc-muted, #8c8c8c);
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 6px;
  transition: color 0.15s;
}
.mtcp-modal__close:hover {
  color: var(--mtc-ink, #101010);
}
.mtcp-modal__body {
  padding: 16px;
  background: var(--mtc-stage, #fdf4f1);
  overflow: hidden;
  flex: 1;
  display: flex;
  justify-content: center;
  align-items: center;
}
.mtcp-modal__landscape-wrapper {
  background: #ffffff;
  border-radius: 8px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.08);
  padding: 12px;
  width: 100%;
  height: 100%;
  max-width: 100%;
  max-height: 100%;
  display: flex;
  justify-content: center;
  align-items: center;
  position: relative;
  overflow: hidden;
}
.mtcp-modal__artwork-img {
  max-width: 100%;
  max-height: 100%;
  width: 100%;
  height: 100%;
  display: block;
  border-radius: 4px;
  object-fit: contain;
  object-position: center;
}
.mtcp-modal__placeholder-notice {
  color: var(--mtc-body, #5c5c5c);
  font-size: 14px;
  padding: 40px 20px;
  text-align: center;
}
.mtcp-modal__footer {
  padding: 16px 24px;
  border-top: 1px solid var(--mtc-border, #e4e4e4);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex-shrink: 0;
}
.mtcp-modal__info {
  font-size: 13px;
  color: var(--mtc-body, #5c5c5c);
}
`;

const SCRIPT = `
(function () {
  "use strict";

  var root = document.getElementById("mtcp-root");
  if (!root) return;

  var dataNode = document.getElementById("mtcp-data");
  var DATA = {};

  try {
    DATA = JSON.parse(dataNode.textContent);
  } catch (error) {
    console.error("[magiktoon] page data unreadable", error);
    return;
  }

  var MAX_BYTES = DATA.maxBytes || 31457280;
  var ALLOWED = ["image/png", "image/jpeg", "image/jpg"];
  var STORAGE_KEY = "mtc:design:" + DATA.productId;

  function el(id) { return document.getElementById(id); }
  function show(node) { if (node) node.hidden = false; }
  function hide(node) { if (node) node.hidden = true; }

  var ui = {
    stage: el("mtcp-stage"),
    layout: el("mtcp-layout"),
    productImg: el("mtcp-product-img"),
    area: el("mtcp-area"),
    art: el("mtcp-art"),
    areaEmpty: el("mtcp-area-empty"),
    zoomOut: el("mtcp-zoom-out"),
    zoomIn: el("mtcp-zoom-in"),
    zoomReset: el("mtcp-zoom-reset"),
    zoomValue: el("mtcp-zoom-value"),
    drop: el("mtcp-drop"),
    file: el("mtcp-file"),
    dropTitle: el("mtcp-drop-title"),
    fileRow: el("mtcp-file-row"),
    fileThumb: el("mtcp-file-thumb"),
    fileName: el("mtcp-file-name"),
    fileState: el("mtcp-file-state"),
    fileBar: el("mtcp-file-bar"),
    fileRemove: el("mtcp-file-remove"),
    cart: el("mtcp-cart"),
    generate: el("mtcp-generate"),
    progress: el("mtcp-progress"),
    progressTrack: el("mtcp-progress-track"),
    progressFill: el("mtcp-progress-fill"),
    progressStage: el("mtcp-progress-stage"),
    progressTime: el("mtcp-progress-time"),
    previewProgress: el("mtcp-preview-progress"),
    previewProgressTrack: el("mtcp-preview-progress-track"),
    previewProgressFill: el("mtcp-preview-progress-fill"),
    previewProgressStage: el("mtcp-preview-progress-stage"),
    previewProgressTime: el("mtcp-preview-progress-time"),
    preview: el("mtcp-preview"),
    mockupImg: el("mtcp-mockup-img"),
    viewImg: el("mtcp-view-img"),
    viewPrev: el("mtcp-view-prev"),
    viewNext: el("mtcp-view-next"),
    viewCount: el("mtcp-view-count"),
    views: el("mtcp-views"),
    mockupNote: el("mtcp-mockup-note"),
    help: el("mtcp-cart-help"),
    error: el("mtcp-error"),
    success: el("mtcp-success"),
    savedBox: el("mtcp-saved"),
    savedImg: el("mtcp-saved-img"),
    savedMeta: el("mtcp-saved-meta"),
    btnTemplatePreview: el("mtcp-btn-template-preview"),
    templateModal: el("mtcp-template-modal"),
    templateBackdrop: el("mtcp-template-backdrop"),
    templateClose: el("mtcp-template-close"),
    templateDone: el("mtcp-template-done"),
    templateImg: el("mtcp-template-img"),
    templateEmpty: el("mtcp-template-empty")
  };

  var state = {
    image: null,
    // The product photo as the page loaded, so removing the upload can put it
    // back after the artwork has replaced it.
    productImageSrc: "",
    // True once the artwork owns the stage, so its shape cannot resize it.
    ratioLocked: false,
    // Is the loaded image something to draw on the product yet?
    //
    // False for a photo the customer has only just chosen. The raw snapshot is
    // not what gets printed — the AI artwork is — so putting it on the mug
    // implied a finished design before the step that makes one had been run.
    // Set once artwork is generated, or once a preview is rendered.
    onProduct: false,
    fileName: "",
    // The customer's original photo, kept so it can be sent to the AI and
    // re-sent on every regeneration without asking them to upload again.
    uploadDataUrl: "",
    // True once AI artwork has replaced the upload on the canvas. Designs with
    // no active prompt never set it, and keep the pre-Milestone-4 behaviour
    // where the uploaded photo is itself what gets printed.
    generated: false,
    generations: 0,
    // The id of the generation the Gelato mockup was rendered from, so a
    // mockup is never shown against artwork it does not belong to.
    generationId: "",
    mockup: null,
    // Identifies the current preview request; see previewOnProduct.
    mockupToken: 0,
    // 0 is the editable preview; 1..n are the template's other views.
    viewIndex: 0,
    rotateTimer: null,
    // Step 4's mockup slideshow.
    mockupTimer: null,
    placement: { x: 0.5, y: 0.5, zoom: 1 },
    saved: null,
    busy: false,
    drag: null,
    // The chosen DESIGN. The product and variant being purchased never change
    // with it — only the artwork template applied to that same product does.
    mapping: DATA.mapping
  };

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  function aspect() {
    var ratio = state.mapping && state.mapping.placeholderAspectRatio;
    return typeof ratio === "number" && isFinite(ratio) && ratio > 0 ? ratio : 1;
  }

  function designImage(base, option) {
    if (!option) return "";

    return option.previewPath
      ? (base || "/apps/magiktoon") + option.previewPath
      : option.previewUrl || "";
  }

  /** The guide's position and size, from the selected design. */
  function printArea() {
    var area = state.mapping && state.mapping.printArea;

    return area && typeof area.size === "number" ? area : DATA.printArea;
  }

  /**
   * Switch to another design on the SAME Shopify product.
   *
   * Only the print template changes. The product id and variant id the cart is
   * built from are untouched, so choosing a design can never alter what is
   * being bought.
   */
  function selectDesign(mappingId) {
    stopRotating();
    state.viewIndex = 0;
    var chosen = null;

    (DATA.templates || []).forEach(function (option) {
      if (option.mappingId === mappingId) chosen = option;
    });

    if (!chosen || chosen.mappingId === state.mapping.mappingId) return;

    state.mapping = chosen;

    // A different print shape invalidates a design saved against the old one.
    state.saved = null;
    hide(ui.savedBox);
    updateCartButton();
    setSuccess("");

    var designs = el("mtcp-designs");

    if (designs) {
      Array.prototype.forEach.call(
        designs.querySelectorAll(".mtcp__design"),
        function (button) {
          button.setAttribute(
            "aria-checked",
            button.dataset.mappingId === mappingId ? "true" : "false"
          );
        }
      );
    }

    var name = el("mtcp-design-name");
    if (name) name.textContent = chosen.designLabel || chosen.templateName || "selected";

    // A different design has its own set of Gelato views, and the mockup on
    // screen belonged to the previous one.
    clearMockup();
    showView(0);
    renderViews();

    layoutArea();
    renderArtwork();
  }

  function setError(message) {
    if (!ui.error) return;
    if (!message) { hide(ui.error); ui.error.textContent = ""; return; }
    ui.error.textContent = message;
    show(ui.error);
    ui.error.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  function setSuccess(message) {
    if (!ui.success) return;
    if (!message) { hide(ui.success); return; }
    ui.success.textContent = message;
    show(ui.success);
  }

  /*
   * The stages a customer is told about, and when.
   *
   * Wording only — none of these correspond to a real step the server reports,
   * and pretending otherwise would be a lie told at 40%. What they honestly do
   * is mark the passage of time in words rather than in a number, so a long
   * wait feels attended to rather than stuck.
   *
   * Each "at" is a fraction of the expected duration.
   */
  var PROGRESS_STAGES = [
    { at: 0.00, text: "Preparing your photo" },
    { at: 0.12, text: "Creating your artwork" },
    { at: 0.55, text: "Adding the finishing touches" },
    { at: 0.85, text: "Almost ready" },
  ];

  var progressTimer = null;

  /**
   * Move the bar to a fraction, and say which stage that is.
   *
   * Capped below 100 while running. A bar that reaches the end and then waits
   * is worse than one that never gets there: it says the work is done when it
   * is not, and the customer starts wondering what is broken.
   */
  function setProgress(fraction) {
    var pct = Math.max(0, Math.min(0.97, fraction)) * 100;

    if (ui.progressFill) ui.progressFill.style.width = pct.toFixed(1) + "%";

    if (ui.progressTrack) {
      ui.progressTrack.setAttribute("aria-valuenow", String(Math.round(pct)));
    }

    if (!ui.progressStage) return;

    var stage = PROGRESS_STAGES[0];

    for (var i = 0; i < PROGRESS_STAGES.length; i += 1) {
      if (fraction >= PROGRESS_STAGES[i].at) stage = PROGRESS_STAGES[i];
    }

    if (ui.progressStage.textContent !== stage.text) {
      ui.progressStage.textContent = stage.text;
    }
  }

  /**
   * Start the progress display for one generation.
   *
   * The curve eases towards the expected duration and then keeps creeping,
   * slowly, without ever arriving. That matters because the estimate is only an
   * estimate: the same model measured 16s one hour and 60s the next, and a bar
   * that stalls dead at the estimate looks broken exactly when the wait is
   * already longer than promised.
   */
  function startProgress() {
    if (!ui.progress) return;

    var startedAt = Date.now();
    var expected = Math.max(4000, Number(DATA.expectedGenerationMs) || 20000);

    ui.progress.hidden = false;
    setProgress(0);

    if (ui.progressTime) ui.progressTime.textContent = "";

    window.clearInterval(progressTimer);

    progressTimer = window.setInterval(function () {
      var elapsed = Date.now() - startedAt;
      var ratio = elapsed / expected;

      // Approaches 1 without reaching it, then continues to inch forward.
      var fraction = 1 - Math.exp(-1.6 * ratio);

      setProgress(fraction);

      if (ui.progressTime) {
        ui.progressTime.textContent = Math.round(elapsed / 1000) + "s";
      }
    }, 250);
  }

  /** Finish the bar honestly, then clear it. */
  function stopProgress(succeeded) {
    window.clearInterval(progressTimer);
    progressTimer = null;

    if (!ui.progress) return;

    if (succeeded && ui.progressFill) {
      // Only now does it reach the end, because only now is it true.
      ui.progressFill.style.width = "100%";

      if (ui.progressTrack) ui.progressTrack.setAttribute("aria-valuenow", "100");
      if (ui.progressStage) ui.progressStage.textContent = "Your artwork is ready";
    }

    var hold = succeeded ? 600 : 0;

    window.setTimeout(function () {
      ui.progress.hidden = true;

      if (ui.progressFill) ui.progressFill.style.width = "0%";
      if (ui.progressTime) ui.progressTime.textContent = "";
      if (ui.progressStage) ui.progressStage.textContent = PROGRESS_STAGES[0].text;
    }, hold);
  }

  var PREVIEW_PROGRESS_STAGES = [
    { at: 0.00, text: "Preparing preview" },
    { at: 0.15, text: "Generating 3D mockup" },
    { at: 0.60, text: "Finishing details" },
    { at: 0.85, text: "Almost ready" },
  ];

  var previewProgressTimer = null;

  function setPreviewProgress(fraction) {
    var pct = Math.max(0, Math.min(0.97, fraction)) * 100;

    if (ui.previewProgressFill) ui.previewProgressFill.style.width = pct.toFixed(1) + "%";

    if (ui.previewProgressTrack) {
      ui.previewProgressTrack.setAttribute("aria-valuenow", String(Math.round(pct)));
    }

    if (!ui.previewProgressStage) return;

    var stage = PREVIEW_PROGRESS_STAGES[0];

    for (var i = 0; i < PREVIEW_PROGRESS_STAGES.length; i += 1) {
      if (fraction >= PREVIEW_PROGRESS_STAGES[i].at) stage = PREVIEW_PROGRESS_STAGES[i];
    }

    if (ui.previewProgressStage.textContent !== stage.text) {
      ui.previewProgressStage.textContent = stage.text;
    }
  }

  function startPreviewProgress() {
    if (!ui.previewProgress) return;

    var startedAt = Date.now();
    // The wrapped views come back in a few seconds; Gelato's live render
    // follows separately and does not hold this bar up.
    var expected = 8000;

    ui.previewProgress.hidden = false;
    setPreviewProgress(0);

    if (ui.previewProgressTime) ui.previewProgressTime.textContent = "";

    window.clearInterval(previewProgressTimer);

    previewProgressTimer = window.setInterval(function () {
      var elapsed = Date.now() - startedAt;
      var ratio = elapsed / expected;

      var fraction = 1 - Math.exp(-1.6 * ratio);

      setPreviewProgress(fraction);

      if (ui.previewProgressTime) {
        ui.previewProgressTime.textContent = Math.round(elapsed / 1000) + "s";
      }
    }, 250);
  }

  function stopPreviewProgress(succeeded) {
    window.clearInterval(previewProgressTimer);
    previewProgressTimer = null;

    if (!ui.previewProgress) return;

    if (succeeded && ui.previewProgressFill) {
      ui.previewProgressFill.style.width = "100%";

      if (ui.previewProgressTrack) ui.previewProgressTrack.setAttribute("aria-valuenow", "100");
      if (ui.previewProgressStage) ui.previewProgressStage.textContent = "Your preview is ready";
    }

    var hold = succeeded ? 600 : 0;

    window.setTimeout(function () {
      ui.previewProgress.hidden = true;

      if (ui.previewProgressFill) ui.previewProgressFill.style.width = "0%";
      if (ui.previewProgressTime) ui.previewProgressTime.textContent = "";
      if (ui.previewProgressStage) ui.previewProgressStage.textContent = PREVIEW_PROGRESS_STAGES[0].text;
    }, hold);
  }

  function setBusy(button, busy, label) {
    if (!button) return;
    button.disabled = busy || button.dataset.blocked === "true";
    button.innerHTML = busy
      ? '<span class="mtcp__spinner" aria-hidden="true"></span>' + label
      : label;
  }

  /**
   * Position the upload area from the layer stack.
   *
   * A configured upload layer wins: the merchant placed it over the product in
   * admin, and the customer must see exactly that. The older print-area
   * fractions remain the fallback for mappings created before layers existed.
   */
  function layoutArea() {
    if (!ui.area) return;

    var layer = uploadLayer();

    if (layer) {
      ui.area.style.left = layer.x * 100 + "%";
      ui.area.style.top = layer.y * 100 + "%";
      ui.area.style.width = layer.width * 100 + "%";
      ui.area.style.aspectRatio = layer.width / layer.height + " / 1";
      ui.area.style.transform = "rotate(" + layer.rotation + "deg)";
      ui.area.style.borderRadius = "8px";
      ui.area.style.zIndex = layer.zIndex;
      return;
    }

    var ratio = aspect();
    var area = printArea();

    ui.area.style.left = area.x * 100 + "%";
    ui.area.style.top = area.y * 100 + "%";
    ui.area.style.width = area.size * 100 + "%";
    ui.area.style.aspectRatio = ratio + " / 1";
    ui.area.style.borderRadius = Math.abs(ratio - 1) < 0.02 ? "50%" : "8px";
  }

  /**
   * Shape the stage to whatever is currently displayed on it.
   *
   * The product photo, a rendered mockup and a template's other views can each
   * be a different shape, and the stage has to follow — a fixed square either
   * letterboxes a landscape design or crops it. Falls back to the product
   * image, which is what shows when nothing else is on the stage.
   */
  function setStageRatio(image) {
    if (!ui.stage) return;

    // Once the artwork has replaced the product shot the frame is fixed. The
    // artwork is a different shape from the mug, and letting it resize the
    // stage would make the page jump at the moment the customer is looking
    // hardest at it.
    if (state.ratioLocked) return;

    var source = image && image.naturalWidth ? image : ui.productImg;

    if (!source || !source.naturalWidth || !source.naturalHeight) return;

    var ratio = 16 / 9;
    ui.stage.style.setProperty("--mtc-stage-ratio", "1.77778");

    // Wide artwork gets the whole page and the steps move below it. Anything
    // squarer keeps the two columns the design calls for.
    //
    // 1.25 rather than 1: a photo a little wider than tall still fits a column
    // comfortably, and reflowing the page for it would be a distraction every
    // time the customer changed their mind.
    // The layout does not change. It is stacked from the first paint, so
    // there is nothing here to toggle.
  }

  /** Follow one stage image, now and whenever its source changes. */
  function watchStageImage(image) {
    if (!image) return;

    if (image.complete && image.naturalWidth) setStageRatio(image);

    image.addEventListener("load", function () {
      // Only reshape for the image actually on show: a mockup that finishes
      // loading while the customer is looking at another view must not
      // resize the stage under them.
      if (!image.hidden) setStageRatio(image);
    });
  }

  /** The layer the uploaded photo goes into, if the template defines one. */
  function uploadLayer() {
    var found = null;

    layersOf(state.mapping).forEach(function (layer) {
      if (layer.type !== "image") return;
      if (!found || (layer.editable && !found.editable)) found = layer;
    });

    return found;
  }

  function layersOf(mapping) {
    return mapping && Array.isArray(mapping.layers) ? mapping.layers : [];
  }

  /**
   * Draw the design's fixed image layers over the product.
   *
   * These are the parts of the template that are not the customer's photo.
   * Gelato names them but publishes none of their artwork, so each is an image
   * uploaded against the design and positioned by the layer's own coordinates.
   */
  function renderImageLayers() {
    if (!ui.stage) return;

    layersOf(state.mapping).forEach(function (layer) {
      if (layer.type !== "image" || !layer.imagePath) return;

      var id = "mtcp-imglayer-" + layer.zIndex;
      var node = document.getElementById(id);

      if (!node) {
        node = document.createElement("img");
        node.id = id;
        node.className = "mtcp__layer-img";
        node.alt = "";
        node.decoding = "async";
        node.src = (DATA.proxyBase || "/apps/magiktoon") + layer.imagePath;
        ui.stage.appendChild(node);
      }

      node.style.left = layer.x * 100 + "%";
      node.style.top = layer.y * 100 + "%";
      node.style.width = layer.width * 100 + "%";
      node.style.height = layer.height * 100 + "%";
      node.style.transform = "rotate(" + layer.rotation + "deg)";
      node.style.zIndex = layer.zIndex;
    });
  }

  /*
   * There is deliberately no text overlay here.
   *
   * The stage shows a Gelato mockup, and that render already carries the
   * design's wording. Drawing the same words over it printed them twice, in a
   * different typeface and slightly out of place, on a surface that curves away
   * from the viewer.
   *
   * Step 4 renders the customer's own text properly, through Gelato, using the
   * template's fonts and positions — the only version that matches what gets
   * printed.
   */

  /** Scale that fits the artwork into the box. Contained for generated artwork so no edges are cut off. */
  function baseCover(boxWidth, boxHeight) {
    var bw = Number(boxWidth) || 100;
    var bh = Number(boxHeight) || 100;
    var natural = (state.image && state.image.naturalWidth && state.image.naturalHeight)
      ? (state.image.naturalWidth / state.image.naturalHeight)
      : 1;
    var box = bw / bh;

    if (state.generated) {
      if (natural > box) {
        return { width: bw, height: bw / natural };
      }
      return { width: bh * natural, height: bh };
    }

    if (natural > box) {
      return { width: bh * natural, height: bh };
    }

    return { width: bw, height: bw / natural };
  }

  function renderArtwork() {
    if (!ui.art || !ui.area) return;

    // A pending upload leaves the product as it is. The file row already
    // confirms the photo arrived; the mug waits for artwork worth showing.
    //
    // The guide goes with it. A dashed print area and a dimmed surround are
    // there to help someone drag artwork about, and there is no artwork.
    if (!state.image || !state.onProduct) {
      hide(ui.art);
      hide(ui.areaEmpty);
      if (ui.area) ui.area.classList.add("is-quiet");
      return;
    }

    hide(ui.areaEmpty);
    if (ui.area) ui.area.classList.remove("is-quiet");

    var rect = ui.area.getBoundingClientRect();
    if (!rect.width || !rect.height) return;

    var base = baseCover(rect.width, rect.height);

    ui.art.src = state.image.src;
    ui.art.style.width = base.width * state.placement.zoom + "px";
    ui.art.style.height = base.height * state.placement.zoom + "px";
    ui.art.style.left = state.placement.x * 100 + "%";
    ui.art.style.top = state.placement.y * 100 + "%";
    show(ui.art);
  }

  function setZoom(value) {
    state.placement.zoom = clamp(value, 0.2, 5);
    if (ui.zoomValue) {
      ui.zoomValue.textContent = Math.round(state.placement.zoom * 100) + "%";
    }
    renderArtwork();
  }

  function enableControls(enabled) {
    [ui.zoomIn, ui.zoomOut, ui.zoomReset].forEach(function (button) {
      if (button) button.disabled = !enabled;
    });

    // With no separate Save button, Add to Cart is what a photo unlocks.
    updateCartButton();
  }

  /**
   * Drag to reposition, wheel or pinch to zoom, arrow keys to nudge.
   *
   * Events are bound to the whole stage rather than the print guide: the guide
   * can be a narrow band — a mug's is 200 x 96 — and asking someone to grab a
   * few millimetres of it is not a usable editor. Movement is still measured
   * against the guide, so a drag means the same thing wherever it starts.
   */
  function bindDragging() {
    var surface = ui.stage;

    if (!surface) return;

    var pointers = {};
    var pinch = null;

    function areaSize() {
      var rect = ui.area.getBoundingClientRect();

      return {
        width: rect.width || 1,
        height: rect.height || 1
      };
    }

    surface.addEventListener("pointerdown", function (event) {
      if (!state.image) return;

      pointers[event.pointerId] = { x: event.clientX, y: event.clientY };

      var ids = Object.keys(pointers);

      if (ids.length === 2) {
        // Two fingers: pinch to zoom instead of dragging.
        var a = pointers[ids[0]];
        var b = pointers[ids[1]];

        pinch = {
          distance: Math.hypot(a.x - b.x, a.y - b.y) || 1,
          zoom: state.placement.zoom
        };

        state.drag = null;
      } else {
        var size = areaSize();

        state.drag = {
          pointerId: event.pointerId,
          startX: event.clientX,
          startY: event.clientY,
          originX: state.placement.x,
          originY: state.placement.y,
          width: size.width,
          height: size.height
        };
      }

      surface.setPointerCapture(event.pointerId);
      surface.classList.add("is-dragging");
      event.preventDefault();
    });

    surface.addEventListener("pointermove", function (event) {
      if (!pointers[event.pointerId]) return;

      pointers[event.pointerId] = { x: event.clientX, y: event.clientY };

      var ids = Object.keys(pointers);

      if (pinch && ids.length === 2) {
        var a = pointers[ids[0]];
        var b = pointers[ids[1]];
        var distance = Math.hypot(a.x - b.x, a.y - b.y) || 1;

        setZoom(pinch.zoom * (distance / pinch.distance));
        return;
      }

      if (!state.drag || state.drag.pointerId !== event.pointerId) return;

      state.placement.x = clamp(
        state.drag.originX + (event.clientX - state.drag.startX) / state.drag.width,
        -0.5,
        1.5
      );

      state.placement.y = clamp(
        state.drag.originY + (event.clientY - state.drag.startY) / state.drag.height,
        -0.5,
        1.5
      );

      renderArtwork();
    });

    function endDrag(event) {
      delete pointers[event.pointerId];

      if (Object.keys(pointers).length < 2) pinch = null;

      if (state.drag && state.drag.pointerId === event.pointerId) {
        state.drag = null;
      }

      if (Object.keys(pointers).length === 0) {
        surface.classList.remove("is-dragging");
      }
    }

    surface.addEventListener("pointerup", endDrag);
    surface.addEventListener("pointercancel", endDrag);
    surface.addEventListener("pointerleave", endDrag);

    surface.addEventListener("wheel", function (event) {
      if (!state.image) return;
      event.preventDefault();
      setZoom(state.placement.zoom * (event.deltaY < 0 ? 1.08 : 0.92));
    }, { passive: false });

    // Keyboard nudging, so placement does not require a mouse.
    surface.setAttribute("tabindex", "0");

    surface.addEventListener("keydown", function (event) {
      if (!state.image) return;

      var step = event.shiftKey ? 0.05 : 0.01;
      var moved = true;

      if (event.key === "ArrowLeft") state.placement.x -= step;
      else if (event.key === "ArrowRight") state.placement.x += step;
      else if (event.key === "ArrowUp") state.placement.y -= step;
      else if (event.key === "ArrowDown") state.placement.y += step;
      else if (event.key === "+" || event.key === "=") setZoom(state.placement.zoom * 1.1);
      else if (event.key === "-") setZoom(state.placement.zoom / 1.1);
      else moved = false;

      if (!moved) return;

      event.preventDefault();
      state.placement.x = clamp(state.placement.x, -0.5, 1.5);
      state.placement.y = clamp(state.placement.y, -0.5, 1.5);
      renderArtwork();
    });
  }

  function readFile(file) {
    setError("");
    setSuccess("");

    if (!file) return;

    if (ALLOWED.indexOf(file.type) === -1) {
      setError("Please choose a JPEG or PNG image.");
      return;
    }

    if (file.size > MAX_BYTES) {
      setError("That image is larger than " + Math.round(MAX_BYTES / 1048576) + "MB.");
      return;
    }

    // Shown straight away so the customer sees their file accepted, then
    // driven by the reader's real progress.
    showFileRow(file.name, 0, false);

    var reader = new FileReader();

    reader.onprogress = function (event) {
      if (event.lengthComputable) {
        showFileRow(file.name, (event.loaded / event.total) * 100, false);
      }
    };

    reader.onload = function () {
      var image = new Image();

      image.onload = function () {
        state.image = image;
        // Pending: confirmed in the file row, absent from the product.
        state.onProduct = false;
        state.fileName = file.name;
        state.uploadDataUrl = reader.result;
        state.placement = { x: 0.5, y: 0.5, zoom: 1 };
        // A fresh upload invalidates any design saved earlier, and any artwork
        // generated from the previous photo.
        state.saved = null;
        state.generated = false;
        state.generations = 0;
        state.generationId = "";
        clearMockup();
        hide(ui.savedBox);

        if (ui.fileThumb) ui.fileThumb.src = reader.result;
        showFileRow(file.name, 100, true);

        stopRotating();
        showView(0);

        // Nothing to drag or zoom until the artwork is actually on the mug.
        enableControls(false);
        setZoom(1);
        renderArtwork();
        updateGenerateButton();
        updatePreviewButton();
        updateCartButton();
      };

      image.onerror = function () { setError("That image could not be opened."); };
      image.src = reader.result;
    };

    reader.onerror = function () {
      clearFileRow();
      setError("That file could not be read.");
    };
    reader.readAsDataURL(file);
  }

  /** Render the print file at the placeholder's own shape, never a fixed square. */
  function renderPrintFile() {
    var ratio = aspect();
    var width = DATA.printFileSize;
    var height = Math.max(1, Math.round(width / ratio));

    if (ratio < 1) {
      height = DATA.printFileSize;
      width = Math.max(1, Math.round(height * ratio));
    }

    var canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;

    var context = canvas.getContext("2d");
    if (!context) throw new Error("This browser cannot render the artwork.");

    // A fresh canvas is fully TRANSPARENT, and anything the artwork does not
    // cover stays that way: zoomed out, dragged aside, or simply a different
    // shape from the print area. That transparency is exported into the PNG and
    // travels all the way to the printer, where it is not a colour but an
    // absence — an unprinted band down the side of the mug.
    //
    // Measured on stored designs before this line existed: artwork files that
    // were 25%, 1% and in one case 0% opaque, every one of them saved as a
    // completed design with nothing anywhere reporting it.
    //
    // White because that is the ceramic underneath, so a gap now prints as the
    // mug itself rather than as an error.
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);

    var base = baseCover(width, height);
    var zoom = Number(state.placement && state.placement.zoom) || 1;
    var drawWidth = base.width * zoom;
    var drawHeight = base.height * zoom;
    var posX = (state.placement && typeof state.placement.x === "number") ? state.placement.x : 0.5;
    var posY = (state.placement && typeof state.placement.y === "number") ? state.placement.y : 0.5;

    if (state.image) {
      try {
        context.drawImage(
          state.image,
          posX * width - drawWidth / 2,
          posY * height - drawHeight / 2,
          drawWidth,
          drawHeight
        );
      } catch (err) {
        console.warn("[magiktoon] failed to draw image in renderPrintFile", err);
      }
    }

    return { dataUrl: canvas.toDataURL("image/png"), canvas: canvas };
  }

  /** Composite onto the product shot for the cart thumbnail with realistic 3D cylindrical mug curvature. */
  function renderPreview(artworkCanvas) {
    return new Promise(function (resolve) {
      if (!artworkCanvas) return resolve("");

      // Composite over the original product shot, falling back to the design
      // preview only when the product has no usable image.
      var source =
        state.productImageSrc ||
        (DATA.product && DATA.product.imageUrl) ||
        designImage(DATA.proxyBase, state.mapping) ||
        "";

      if (!source) {
        try {
          return resolve(artworkCanvas.toDataURL("image/png"));
        } catch (e) {
          return resolve("");
        }
      }

      var product = new Image();
      product.crossOrigin = "anonymous";

      product.onload = function () {
        try {
          var width = product.naturalWidth || 1000;
          var height = product.naturalHeight || 1000;

          var canvas = document.createElement("canvas");
          canvas.width = width;
          canvas.height = height;

          var context = canvas.getContext("2d");
          if (!context) return resolve("");

          context.drawImage(product, 0, 0, width, height);

          var layer = uploadLayer();
          var ratio = aspect();
          var area = printArea();
          var areaWidth, areaHeight, areaX, areaY;

          if (layer) {
            areaX = layer.x * width;
            areaY = layer.y * height;
            areaWidth = layer.width * width;
            areaHeight = layer.height * height;
          } else {
            areaWidth = area.size * width;
            areaHeight = areaWidth / ratio;
            areaX = area.x * width;
            areaY = area.y * height;
          }

          context.save();

          var isCircular = Math.abs(ratio - 1) < 0.02;

          if (isCircular) {
            context.beginPath();
            context.arc(areaX + areaWidth / 2, areaY + areaHeight / 2, areaWidth / 2, 0, Math.PI * 2);
            context.clip();
            context.drawImage(artworkCanvas, areaX, areaY, areaWidth, areaHeight);
          } else {
            var slices = 120;
            var thetaMax = Math.PI / 2.25;
            var sinMax = Math.sin(thetaMax);
            var cx = areaX + areaWidth / 2;
            var rx = areaWidth / 2;
            var tiltFactor = areaHeight * 0.08;

            context.beginPath();
            for (var s = 0; s <= slices; s++) {
              var u = s / slices;
              var theta = (u - 0.5) * 2 * thetaMax;
              var px = cx + rx * (Math.sin(theta) / sinMax);
              var dy = tiltFactor * (1 - Math.cos(theta));
              var py = areaY + dy;
              if (s === 0) context.moveTo(px, py);
              else context.lineTo(px, py);
            }
            for (var s = slices; s >= 0; s--) {
              var u = s / slices;
              var theta = (u - 0.5) * 2 * thetaMax;
              var px = cx + rx * (Math.sin(theta) / sinMax);
              var dy = tiltFactor * (1 - Math.cos(theta));
              var py = areaY + areaHeight + dy;
              context.lineTo(px, py);
            }
            context.closePath();
            context.clip();

            var srcW = artworkCanvas.width || 1000;
            var srcH = artworkCanvas.height || 1000;

            for (var i = 0; i < slices; i++) {
              var u0 = i / slices;
              var u1 = (i + 1) / slices;

              var t0 = (u0 - 0.5) * 2 * thetaMax;
              var t1 = (u1 - 0.5) * 2 * thetaMax;

              var x0 = cx + rx * (Math.sin(t0) / sinMax);
              var x1 = cx + rx * (Math.sin(t1) / sinMax);
              var destW = x1 - x0;
              if (destW <= 0) continue;

              var midT = (t0 + t1) / 2;
              var dy = tiltFactor * (1 - Math.cos(midT));

              var sx = u0 * srcW;
              var sw = (u1 - u0) * srcW;

              context.drawImage(
                artworkCanvas,
                sx, 0, sw, srcH,
                x0, areaY + dy, destW + 0.5, areaHeight
              );
            }

            var shadeGrad = context.createLinearGradient(areaX, 0, areaX + areaWidth, 0);
            shadeGrad.addColorStop(0.00, "rgba(0, 0, 0, 0.35)");
            shadeGrad.addColorStop(0.18, "rgba(0, 0, 0, 0.12)");
            shadeGrad.addColorStop(0.35, "rgba(255, 255, 255, 0.22)");
            shadeGrad.addColorStop(0.55, "rgba(0, 0, 0, 0.0)");
            shadeGrad.addColorStop(0.85, "rgba(0, 0, 0, 0.15)");
            shadeGrad.addColorStop(1.00, "rgba(0, 0, 0, 0.40)");

            context.fillStyle = shadeGrad;
            context.fillRect(areaX - 10, areaY - 10, areaWidth + 20, areaHeight + 40);
          }

          context.restore();

          resolve(canvas.toDataURL("image/png"));
        } catch (error) {
          console.warn("[magiktoon] preview composite failed", error);
          try {
            resolve(artworkCanvas.toDataURL("image/png"));
          } catch (e) {
            resolve("");
          }
        }
      };

      product.onerror = function () {
        try {
          resolve(artworkCanvas.toDataURL("image/png"));
        } catch (e) {
          resolve("");
        }
      };
      product.src = source;
    });
  }

  function readText() {
    var out = {};

    Array.prototype.forEach.call(
      document.querySelectorAll("[data-mtcp-text]"),
      function (input) {
        var value = input.value.trim();

        if (value) {
          out[input.dataset.name] = value;
        }
      }
    );

    return out;
  }

  /** Add to Cart unlocks as soon as there is a photo to print. */
  function canGenerate() {
    return Boolean(state.mapping && state.mapping.canGenerate && DATA.generateUrl);
  }

  function updateGenerateButton() {
    if (!ui.generate) return;

    // Hidden entirely for designs with no prompt: a permanently dead button
    // reads as a broken page rather than as a feature that does not apply here.
    if (!canGenerate()) {
      ui.generate.hidden = true;
      return;
    }

    ui.generate.hidden = false;
    ui.generate.disabled = state.busy || !state.uploadDataUrl;
    ui.generate.textContent = state.generated ? "Re-Generate" : "Generate";
  }

  function generate() {
    if (state.busy || !canGenerate()) return;

    if (!state.uploadDataUrl) {
      setError("Upload a photo first.");
      return;
    }

    var regenerating = state.generated;

    setError("");
    setSuccess("");
    state.busy = true;
    setBusy(ui.generate, true, regenerating ? "Regenerating…" : "Generating…");
    startProgress();

    fetch(DATA.generateUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        productId: DATA.productId,
        mappingId: state.mapping ? state.mapping.mappingId : "",
        image: state.uploadDataUrl,
        // Printed into the artwork by the server, so what comes back already
        // reads the way it will print.
        text: readText(),
        regenerate: regenerating
      })
    })
      .then(function (response) { return response.json(); })
      .then(function (payload) {
        if (!payload || !payload.ok) {
          // The server has already reduced every failure to one sentence a
          // customer can act on; it is shown verbatim rather than reworded.
          setError((payload && payload.error) || "AI generation failed. Please try again.");
          return;
        }

        var image = new Image();

        image.onload = function () {
          state.image = image;

          // The artwork replaces the product shot rather than being pasted
          // into a dashed box on top of it. It keeps the shape the product had,
          // so the frame does not jump as it swaps, and the page stacks so the
          // artwork gets the width instead of half of it.
          //
          // onProduct stays false: the stage IS the artwork now, so drawing the
          // overlay as well would show it twice.
          if (ui.productImg) ui.productImg.src = image.src;

          state.ratioLocked = true;

          state.onProduct = false;
          state.generated = true;
          state.generations += 1;
          state.generationId = payload.generationId || "";
          // The mockup on screen was rendered from the previous artwork.
          clearMockup();
          // The generated artwork is a new picture, so any placement the
          // customer had chosen for the previous one no longer means anything.
          state.placement = { x: 0.5, y: 0.5, zoom: 1 };
          // Artwork this design has not been saved with yet.
          state.saved = null;
          hide(ui.savedBox);

          enableControls(true);
          setZoom(1);
          renderArtwork();
          updateGenerateButton();
          updatePreviewButton();
          updateCartButton();
          stopProgress(true);
          setSuccess(regenerating ? "New artwork ready." : "Your artwork is ready.");
        };

        image.onerror = function () {
          setError("The generated artwork could not be displayed. Please try again.");
        };

        image.src = payload.artwork;
      })
      .catch(function (error) {
        setError("AI generation failed. Please try again.");
      })
      .finally(function () {
        state.busy = false;
        // Cleared here as well as on success: a failure or a network drop must
        // not leave a bar creeping forward over a page that has given up.
        stopProgress(false);
        setBusy(ui.generate, false, state.generated ? "Re-Generate" : "Generate");
        updateGenerateButton();
      });
  }

  /**
   * Show the chosen photo while it is being read, then as complete.
   *
   * The read is genuinely asynchronous for a 30MB photo, so the progress here
   * is the FileReader's own — not a decorative animation.
   */
  function showFileRow(name, progress, done) {
    if (!ui.fileRow) return;

    ui.fileRow.hidden = false;

    if (ui.fileName) ui.fileName.textContent = name;

    if (ui.fileState) {
      ui.fileState.textContent = done ? "Completed" : "Uploading…";
      ui.fileState.className = "mtcp__file-state" + (done ? " is-done" : "");
    }

    var bar = ui.fileBar && ui.fileBar.firstElementChild;
    if (bar) bar.style.width = Math.round(progress) + "%";
  }

  function clearFileRow() {
    if (ui.fileRow) ui.fileRow.hidden = true;
    if (ui.fileThumb) ui.fileThumb.removeAttribute("src");
    if (ui.dropTitle) ui.dropTitle.textContent = DATA.dropTitle || "Choose a file or drag & drop it here";
  }

  /** Discard the photo and everything derived from it. */
  function removePhoto() {
    state.image = null;
    state.onProduct = false;

    // Back to the product the shop sells.
    if (ui.productImg && state.productImageSrc) {
      ui.productImg.src = state.productImageSrc;
    }

    state.ratioLocked = false;
    state.uploadDataUrl = "";
    state.fileName = "";
    state.generated = false;
    state.generations = 0;
    state.generationId = "";
    state.saved = null;

    if (ui.file) ui.file.value = "";

    clearFileRow();
    clearMockup();
    hide(ui.savedBox);
    setError("");
    setSuccess("");

    enableControls(false);
    renderArtwork();
    updateGenerateButton();
    updatePreviewButton();
    updateCartButton();
  }

  /** Every image this design has, the editable preview first. */
  function viewsOf() {
    // Once previewed, the slider steps through the mockups instead.
    if (state.mockup && state.mockup.views && state.mockup.views.length > 1) {
      return state.mockup.views.map(function (url, index) {
        return { index: index, url: url, mockup: true };
      });
    }

    var mapping = state.mapping;
    var paths = (mapping && mapping.imagePaths) || [];

    if (paths.length < 2) return [];

    return paths.map(function (path, index) {
      return {
        index: index,
        url: (DATA.proxyBase || "/apps/magiktoon") + path,
      };
    });
  }

  /**
   * Show one of the design's views.
   *
   * Index 0 is the editable preview — the product photo with the customer's
   * artwork and the print guide over it. Anything else is one of Gelato's own
   * shots of the design, shown as a reference: the guide is calibrated for the
   * primary view only, so placing artwork on another one would put it in the
   * wrong spot.
   */
  function showView(index) {
    var views = viewsOf();

    if (views.length === 0) return;

    state.viewIndex = Math.max(0, Math.min(index, views.length - 1));

    // Every mockup is shown in the mockup slot; none is adjustable.
    if (views[0].mockup) {
      hide(ui.viewImg);
      if (ui.stage) ui.stage.classList.remove("is-viewing");
      if (ui.mockupImg) ui.mockupImg.src = views[state.viewIndex].url;
      if (ui.viewCount) {
        ui.viewCount.textContent = state.viewIndex + 1 + " / " + views.length;
      }
      return;
    }

    var isReference = state.viewIndex > 0;

    if (ui.viewImg) {
      if (isReference) {
        ui.viewImg.src = views[state.viewIndex].url;
        show(ui.viewImg);
      } else {
        hide(ui.viewImg);
      }
    }

    if (ui.stage) ui.stage.classList.toggle("is-viewing", isReference);

    // Only the editable view can be adjusted.
    enableControls(!isReference && Boolean(state.image));

    if (ui.viewCount) {
      ui.viewCount.textContent = state.viewIndex + 1 + " / " + views.length;
    }
  }

  /** Step to another view, wrapping at either end. */
  function stepView(direction) {
    var views = viewsOf();

    if (views.length < 2) return;

    stopRotating();
    // Stepping by hand ends the slideshow, so it doesn't jump away.
    stopMockupAutoplay();
    showView((state.viewIndex + direction + views.length) % views.length);
  }

  /** Stop cycling. Any deliberate action ends it for good. */
  function stopRotating() {
    if (state.rotateTimer) {
      clearInterval(state.rotateTimer);
      state.rotateTimer = null;
    }
  }

  /**
   * Cycle the views while the customer has not started yet.
   *
   * A design with several shots is worth showing off on an empty page, but
   * rotating underneath somebody positioning their artwork would be hostile —
   * so it runs only before a photo is uploaded, and never restarts.
   */
  function startRotating() {
    var views = viewsOf();

    if (views.length < 2 || state.rotateTimer) return;

    if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return;
    }

    state.rotateTimer = setInterval(function () {
      if (state.image || state.mockup) {
        stopRotating();
        showView(0);
        return;
      }

      showView((state.viewIndex + 1) % views.length);
    }, 4000);
  }

  /** Build the thumbnail strip, or leave it hidden for a single-image design. */
  /**
   * Show the stepping controls, if there is more than one view to step through.
   *
   * A design with a single image needs no arrows, and a counter reading "1 / 1"
   * is noise on a product photo.
   */
  function renderViews() {
    var views = viewsOf();
    var many = views.length > 1;
    // Arrows and counter only on the product preview's mockups.
    var arrows = many && Boolean(state.mockup);

    [ui.viewPrev, ui.viewNext, ui.viewCount].forEach(function (node) {
      if (node) node.hidden = !arrows;
    });

    if (!many) {
      stopRotating();
      stopMockupAutoplay();
      return;
    }

    if (state.mockup) {
      startMockupAutoplay();
    } else {
      startRotating();
    }
  }

  /**
   * Step 4's mockups play through on their own, like a slideshow, until the
   * customer uses the arrows. Stops when the mockups are cleared.
   */
  function startMockupAutoplay() {
    stopMockupAutoplay();

    state.mockupTimer = setInterval(function () {
      var views = viewsOf();

      if (!state.mockup || views.length < 2) {
        stopMockupAutoplay();
        return;
      }

      showView((state.viewIndex + 1) % views.length);
    }, 3000);
  }

  function stopMockupAutoplay() {
    if (state.mockupTimer) {
      clearInterval(state.mockupTimer);
      state.mockupTimer = null;
    }
  }

  function clearMockup() {
    var hadMockup = Boolean(state.mockup);

    state.mockup = null;
    stopMockupAutoplay();
    // A live render still arriving for this design is no longer wanted.
    state.mockupToken += 1;

    hide(ui.mockupImg);

    // Back to the design's own views in the slider.
    if (hadMockup) {
      state.viewIndex = 0;
      renderViews();
      showView(0);
    }
    hide(ui.mockupNote);

    if (ui.stage) ui.stage.classList.remove("is-mockup");

    // Back to the product's own shape now the mockup is gone.
    setStageRatio(ui.productImg);

    // The built preview is adjustable again once the mockup is gone.
    enableControls(Boolean(state.image));
    updatePreviewButton();
  }

  function canPreview() {
    return Boolean(DATA.mockupUrl && state.mapping && state.mapping.templateId);
  }

  function updatePreviewButton() {
    if (!ui.preview) return;

    if (!canPreview()) {
      ui.preview.hidden = true;
      return;
    }

    ui.preview.hidden = false;
    // Only meaningful once there is AI artwork to place on the product.
    ui.preview.disabled = state.busy || !state.generationId;
    ui.preview.textContent = state.mockup
      ? "Refresh the product preview"
      : "Preview on Product";
  }

  function previewOnProduct() {
    if (state.busy || !canPreview()) return;

    if (!state.generationId) {
      setError("Generate your artwork first.");
      return;
    }

    setError("");
    setSuccess("");
    state.busy = true;
    setBusy(ui.preview, true, "Building your preview…");
    startPreviewProgress();

    var previewSucceeded = false;

    // The text from Step 2 and the AI artwork from Step 3, exactly as they
    // stand now. Gelato places both on the selected template.
    var sentGenerationId = state.generationId;
    var sentText = readText();
    var requestBody = JSON.stringify({
      productId: DATA.productId,
      mappingId: state.mapping ? state.mapping.mappingId : "",
      generationId: sentGenerationId,
      // The colourway being bought. The server narrows Gelato's mockup gallery
      // to it, so a white mug is no longer previewed on a pink body.
      variantId: DATA.variantId,
      text: sentText
    });
    // A little longer than the server's own render limit, so the server's
    // answer — success or a specific error — is the one the customer sees.
    var pollDeadline = Date.now() + 330000;
    // Bumped by clearMockup: a live render for an abandoned design is dropped.
    var token = ++state.mockupToken;

    function stillCurrent() {
      return (
        token === state.mockupToken &&
        state.generationId === sentGenerationId &&
        JSON.stringify(readText()) === JSON.stringify(sentText)
      );
    }

    function post(poll) {
      return fetch(DATA.mockupUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: poll ? requestBody.replace(/^[{]/, '{"poll":true,') : requestBody
      }).then(function (response) { return response.json(); });
    }

    // When the server is too busy to answer in time, the app proxy returns its
    // own error page rather than JSON. The render carries on regardless, so
    // that counts as "still working" and the next poll collects it.
    function stillWorking() {
      return { ok: true, pending: true };
    }

    // Gelato renders asynchronously, often for longer than the app proxy will
    // hold a request open. The server keeps the render running and answers
    // "pending"; asking again with the same body collects the same render.
    // With acceptStandIn, the wrapped stand-in views end the wait too.
    function pollLiveRender(acceptStandIn) {
      return post(true).catch(stillWorking).then(function (payload) {
        if (payload && payload.ok && payload.pending && !(acceptStandIn && payload.mockup)) {
          if (Date.now() > pollDeadline || token !== state.mockupToken) {
            return { ok: false, error: "The preview is taking too long. Please try again." };
          }
          return new Promise(function (resolve) {
            window.setTimeout(resolve, 3000);
          }).then(function () { return pollLiveRender(acceptStandIn); });
        }
        return payload;
      });
    }

    /** Put a set of mockups in the slider on the left. Resolves once shown. */
    function showMockups(payload, live) {
      var urls = (payload.mockups || []).map(function (item) { return item.url; });
      if (urls.length === 0) urls = [payload.mockup];

      // The live render leads; the wrapped views stay as extra angles.
      if (live && state.mockup && state.mockup.approximate) {
        urls = urls.concat(state.mockup.views);
      }

      return new Promise(function (resolve) {
        var resolved = false;

        function finish() {
          if (resolved) return;
          resolved = true;

          state.mockup = {
            url: urls[0],
            key: payload.mockupKey,
            views: urls,
            approximate: !live
          };

          stopRotating();
          state.viewIndex = 0;
          renderViews();
          showView(0);

          if (ui.stage) ui.stage.classList.add("is-mockup");

          // Nothing to drag or zoom on a finished mockup.
          enableControls(false);

          if (ui.mockupNote) {
            ui.mockupNote.textContent = live
              ? "This is the actual product preview from our print partner. " +
                "It is exactly what will be printed."
              : "A preview of your design on the product. " +
                "Our print partner's own render will appear here when it is ready.";
            show(ui.mockupNote);
          }
          // A saved design no longer matches what is on screen.
          state.saved = null;
          hide(ui.savedBox);
          updateCartButton();
          resolve(true);
        }

        if (!ui.mockupImg) {
          finish();
          return;
        }

        ui.mockupImg.onload = finish;
        ui.mockupImg.onerror = function () {
          if (resolved) return;
          resolved = true;
          resolve(false);
        };
        ui.mockupImg.src = urls[0];
        show(ui.mockupImg);

        if (ui.mockupImg.complete && ui.mockupImg.naturalWidth > 0) {
          finish();
        }
      });
    }

    /** Swap Gelato's live render in quietly, whenever it lands. */
    function awaitLiveRender() {
      pollLiveRender()
        .then(function (payload) {
          if (!payload || !payload.ok || !payload.mockup || payload.approximate) {
            console.warn("[magiktoon] live render unavailable", payload && payload.error);
            return;
          }
          if (!stillCurrent()) return;
          showMockups(payload, true);
        })
        .catch(function (error) {
          console.warn("[magiktoon] live render polling failed", error);
        });
    }

    post(false)
      .catch(stillWorking)
      .then(function (payload) {
        // No preview yet (no wrapped views for this product, or the click went
        // unanswered): poll until the stand-ins or the live render arrive.
        if (payload && payload.ok && payload.pending && !payload.mockup) {
          return pollLiveRender(true);
        }
        return payload;
      })
      .then(function (payload) {
        if (!payload || !payload.ok || !payload.mockup) {
          setError(
            (payload && payload.error) || "Please try ‘Preview on Product’ again."
          );
          return;
        }

        // The customer changed the artwork or the text while it rendered:
        // this mockup no longer shows what would be bought.
        if (!stillCurrent()) {
          setError("Your design changed — preview it on the product again.");
          return;
        }

        return showMockups(payload, !payload.approximate).then(function (shown) {
          if (!shown) {
            setError(
              "Your preview was created but the image didn't load. " +
                "Please try again."
            );
            return;
          }

          previewSucceeded = true;
          setSuccess("Your product preview is ready.");
          stopPreviewProgress(true);

          if (payload.approximate && payload.pending) awaitLiveRender();
        });
      })
      .catch(function (error) {
        console.error("[magiktoon] preview failed", error);
        setError("Please try ‘Preview on Product’ again.");
      })
      .finally(function () {
        state.busy = false;
        if (!previewSucceeded) {
          stopPreviewProgress(false);
        }
        setBusy(ui.preview, false, state.mockup ? "Refresh the product preview" : "Preview on Product");
        updatePreviewButton();
      });
  }

  function updateCartButton() {
    if (!ui.cart) return;

    // Where a design can generate, the AI artwork is the product: an
    // ungenerated upload must not reach the cart. Where it cannot, the upload
    // itself is the artwork and the rule is unchanged from Milestone 3.
    var artworkReady = Boolean(state.image && (state.generated || !canGenerate()));

    // And where the product can be previewed, that preview is what the
    // customer approves — so it has to exist, and has to be of the current
    // artwork and wording.
    var previewReady = !canPreview() || Boolean(state.mockup);

    var ready = Boolean(state.saved) || (artworkReady && previewReady);

    ui.cart.dataset.blocked = ready ? "false" : "true";
    ui.cart.disabled = !ready;

    // A disabled button with no explanation reads as a broken page.
    if (ui.help) {
      if (ready) {
        ui.help.textContent = "";
        ui.help.hidden = true;
      } else if (canGenerate() && state.image && !state.generated) {
        ui.help.textContent = "Generate your artwork to continue.";
        ui.help.hidden = false;
      } else if (canPreview() && (state.generated || state.image) && !state.mockup) {
        ui.help.textContent =
          "Preview your design on the product, then you can add it to your cart.";
        ui.help.hidden = false;
      } else {
        ui.help.textContent = "";
        ui.help.hidden = true;
      }
    }
  }

  function showSaved(saved) {
    state.saved = saved;

    if (ui.savedImg && saved.previewUrl) ui.savedImg.src = saved.previewUrl;
    if (ui.savedMeta) ui.savedMeta.textContent = "Design reference: " + saved.customizationId;

    show(ui.savedBox);
    updateCartButton();
  }

  function openTemplatePreviewModal() {
    if (!ui.templateModal) return;
    var artworkSrc = (state.image && state.image.src) || state.uploadDataUrl || "";
    if (artworkSrc && ui.templateImg) {
      ui.templateImg.src = artworkSrc;
      show(ui.templateImg);
      hide(ui.templateEmpty);
    } else {
      hide(ui.templateImg);
      show(ui.templateEmpty);
    }
    show(ui.templateModal);
    document.body.style.overflow = "hidden";
  }

  function closeTemplatePreviewModal() {
    if (!ui.templateModal) return;
    hide(ui.templateModal);
    document.body.style.overflow = "";
  }

  function saveDesign() {
    if (state.busy) return;

    if (!state.image) {
      setError("Upload a photo before adding this to your cart.");
      return Promise.resolve(null);
    }

    setError("");
    setSuccess("");
    state.busy = true;
    setBusy(ui.cart, true, "Saving your design…");

    var artwork;

    try {
      artwork = renderPrintFile();
    } catch (error) {
      state.busy = false;
      setBusy(ui.cart, false, "Add to Cart");
      setError(error.message);
      return Promise.resolve(null);
    }

    return renderPreview(artwork.canvas)
      .then(function (previewDataUrl) {
        return fetch(DATA.customizationUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            // The original Shopify product and variant, unchanged throughout.
            productId: DATA.productId,
            variantId: DATA.variantId,
            // The Gelato design applied to it — reference only.
            mappingId: state.mapping && state.mapping.mappingId,
            artwork: (state.generated && state.image && state.image.src) || artwork.dataUrl,
            preview: previewDataUrl,
            placement: state.placement,
            text: readText(),
            // How many AI generations produced the artwork being accepted, so
            // the cost of this order can be reported honestly (NFR-06).
            generations: state.generations,
            // The Gelato mockup the customer approved. Stored with the order so
            // the pending-orders view shows what was actually agreed to, rather
            // than our own canvas approximation of it.
            mockupKey: state.mockup ? state.mockup.key : ""
          })
        });
      })
      .then(function (response) { return response.json(); })
      .then(function (payload) {
        if (!payload || !payload.ok) {
          throw new Error((payload && payload.error) || "Your design could not be saved.");
        }

        var saved = {
          customizationId: payload.customizationId,
          previewUrl: payload.previewUrl || payload.artworkUrl,
          properties: payload.properties || {}
        };

        // Survives navigating back to the product page and returning.
        try {
          window.localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
        } catch (error) {
          console.warn("[magiktoon] design not cached locally", error);
        }

        showSaved(saved);
        return saved;
      })
      .catch(function (error) {
        setError(error.message || "Your design could not be saved.");
        return null;
      })
      .finally(function () {
        state.busy = false;
        setBusy(ui.cart, false, "Add to Cart");
      });
  }

  /**
   * Save the design, then add the ORIGINAL Shopify product to the cart.
   *
   * The approved design has a single call to action, so saving is a step inside
   * adding to cart rather than a button of its own. A design saved earlier in
   * this browser is reused instead of being written again.
   */
  function addToCart() {
    if (state.busy) return;

    if (!DATA.variantId) {
      setError("This product has no variant available to purchase.");
      return;
    }

    var ready = state.saved ? Promise.resolve(state.saved) : saveDesign();

    ready.then(function (saved) {
      if (saved) sendToCart(saved);
    });
  }

  function sendToCart(saved) {
    state.busy = true;
    setBusy(ui.cart, true, "Adding to cart…");

    fetch("/cart/add.js", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items: [{
          id: Number(DATA.variantId),
          quantity: 1,
          properties: saved.properties
        }]
      })
    })
      .then(function (response) {
        return response.json().then(function (payload) {
          if (!response.ok) {
            throw new Error(payload.description || payload.message || "Cart error");
          }
          return payload;
        });
      })
      .then(function () {
        try { window.localStorage.removeItem(STORAGE_KEY); } catch (error) { /* non-fatal */ }
        window.location.href = "/cart";
      })
      .catch(function (error) {
        setError(error.message || "This product could not be added to your cart.");
        state.busy = false;
        setBusy(ui.cart, false, "Add to Cart");
      });
  }

  /** Restore a design saved earlier in this browser. */
  function restore() {
    var raw;

    try {
      raw = window.localStorage.getItem(STORAGE_KEY);
    } catch (error) {
      return;
    }

    if (!raw) return;

    try {
      var saved = JSON.parse(raw);
      if (saved && saved.customizationId) {
        showSaved(saved);
        setSuccess("We found the design you saved earlier. Add it to your cart, or upload a new photo to replace it.");
      }
    } catch (error) {
      try { window.localStorage.removeItem(STORAGE_KEY); } catch (ignored) { /* non-fatal */ }
    }
  }

  // ---- wiring -----------------------------------------------------------

  if (ui.drop) {
    ui.drop.addEventListener("click", function () { ui.file.click(); });

    ["dragenter", "dragover"].forEach(function (name) {
      ui.drop.addEventListener(name, function (event) {
        event.preventDefault();
        ui.drop.classList.add("is-over");
      });
    });

    ["dragleave", "drop"].forEach(function (name) {
      ui.drop.addEventListener(name, function (event) {
        event.preventDefault();
        ui.drop.classList.remove("is-over");
      });
    });

    ui.drop.addEventListener("drop", function (event) {
      readFile(event.dataTransfer && event.dataTransfer.files[0]);
    });
  }

  if (ui.file) {
    ui.file.addEventListener("change", function () { readFile(ui.file.files[0]); });
  }

  if (ui.zoomIn) ui.zoomIn.addEventListener("click", function () { setZoom(state.placement.zoom * 1.15); });
  if (ui.zoomOut) ui.zoomOut.addEventListener("click", function () { setZoom(state.placement.zoom / 1.15); });
  if (ui.zoomReset) ui.zoomReset.addEventListener("click", function () {
    state.placement = { x: 0.5, y: 0.5, zoom: 1 };
    setZoom(1);
  });

  if (ui.fileRemove) ui.fileRemove.addEventListener("click", removePhoto);

  if (ui.generate) ui.generate.addEventListener("click", generate);
  if (ui.preview) ui.preview.addEventListener("click", previewOnProduct);
  if (ui.btnTemplatePreview) ui.btnTemplatePreview.addEventListener("click", openTemplatePreviewModal);
  if (ui.templateClose) ui.templateClose.addEventListener("click", closeTemplatePreviewModal);
  if (ui.templateDone) ui.templateDone.addEventListener("click", closeTemplatePreviewModal);
  if (ui.templateBackdrop) ui.templateBackdrop.addEventListener("click", closeTemplatePreviewModal);
  if (ui.cart) ui.cart.addEventListener("click", addToCart);

  // Typing updates the layer drawn on the product, not just the input.
  Array.prototype.forEach.call(
    document.querySelectorAll("[data-mtcp-text]"),
    function (input) {
      input.addEventListener("input", function () {

        // A mockup rendered from the previous wording no longer shows what is
        // being bought. Without this a customer could preview with one name,
        // change it, and add to cart with a mockup of the old one.
        if (state.mockup) {
          clearMockup();
          setSuccess("");
          setError("Your text changed — preview it on the product again.");
          updateCartButton();
        }
      });
    }
  );

  var designs = el("mtcp-designs");

  if (designs) {
    designs.addEventListener("click", function (event) {
      var button = event.target.closest(".mtcp__design");
      if (button) selectDesign(button.dataset.mappingId);
    });
  }

  if (ui.productImg) state.productImageSrc = ui.productImg.src;

  watchStageImage(ui.productImg);
  watchStageImage(ui.mockupImg);
  watchStageImage(ui.viewImg);
  setStageRatio(ui.productImg);

  [
    [ui.viewPrev, -1],
    [ui.viewNext, 1],
  ].forEach(function (pair) {
    if (!pair[0]) return;

    // The whole stage is a drag surface, so these must not start a drag.
    pair[0].addEventListener("pointerdown", function (event) {
      event.stopPropagation();
    });

    pair[0].addEventListener("click", function (event) {
      event.preventDefault();
      event.stopPropagation();
      stepView(pair[1]);
    });
  });

  updateGenerateButton();
  updatePreviewButton();
  renderViews();

  window.addEventListener("resize", renderArtwork);

  bindDragging();
  layoutArea();
  renderImageLayers();
  enableControls(false);
  updateCartButton();
  restore();
})();
`;

/**
 * The nouns these products actually are, longest first so that "Tote Bag"
 * wins over "Bag" and "Phone Case" over "Case".
 *
 * A list rather than a guess at the last word of the title: "11oz Ceramic"
 * ends the mug's title, and "Personalise Your Ceramic" is no better than
 * "Print Material". Anything not listed falls through to the product type.
 */
const PRODUCT_NOUNS = [
  "Phone Case",
  "Tote Bag",
  "Water Bottle",
  "Mouse Mat",
  "Jigsaw Puzzle",
  "Greeting Card",
  "Tea Towel",
  "Sweatshirt",
  "Notebook",
  "Calendar",
  "Cushion",
  "Blanket",
  "T-Shirt",
  "Hoodie",
  "Sticker",
  "Coaster",
  "Apron",
  "Canvas",
  "Poster",
  "Puzzle",
  "Bottle",
  "Pillow",
  "Magnet",
  "Keyring",
  "Card",
  "Print",
  "Frame",
  "Mug",
  "Cap",
  "Hat",
  "Bag",
];

/**
 * Product types Gelato and Shopify set that name no product a shopper knows.
 *
 * "Print Material" is on every product Gelato publishes, which is why the
 * panel read "Personalise Your Print Material" in production.
 */
const GENERIC_PRODUCT_TYPES = new Set([
  "print material",
  "print materials",
  "print product",
  "merchandise",
  "product",
  "other",
]);

/**
 * The noun for "Personalise Your ___", from the product title where it can be
 * found and the product type otherwise.
 *
 * Neither source is reliable alone: the type is usually Gelato's boilerplate,
 * and the whole title ("Her Fashion Icon Mug, 11oz Ceramic") is far too long
 * for a heading. Nothing recognisable in either gives "Product", which is
 * vague but never wrong.
 */
export function resolveProductNoun(title, type) {
  const haystack = toTrimmedString(title).toLowerCase();

  const found = PRODUCT_NOUNS.find((noun) => {
    // Word-bounded so "Cap" does not match "Capsule" and "Print" does not
    // match "Fingerprint".
    const pattern = new RegExp(`\\b${noun.toLowerCase().replace(/[-\s]/g, "[-\\s]")}s?\\b`);

    return pattern.test(haystack);
  });

  if (found) return found;

  const trimmedType = toTrimmedString(type);

  if (trimmedType && !GENERIC_PRODUCT_TYPES.has(trimmedType.toLowerCase())) {
    return trimmedType;
  }

  return "Product";
}

/**
 * Render the full customization page.
 *
 * @param {object} params
 * @param {object} params.mapping   Storefront-shaped mapping (no secrets).
 * @param {string} params.productId
 * @param {string} params.variantId
 * @param {string} params.returnUrl Product page to go back to.
 * @param {string} params.customizationUrl Proxy path that saves the design.
 */
export function renderCustomizePage({
  mapping,
  templates,
  product,
  productId,
  variantId,
  returnUrl,
  customizationUrl,
  generateUrl,
  mockupUrl,
  proxyBase = "/apps/magiktoon",
}) {
  const options = Array.isArray(templates) && templates.length > 0
    ? templates
    : [mapping].filter(Boolean);

  const data = toJsonScript({
    mapping,
    templates: options,
    productId,
    variantId,
    customizationUrl,
    generateUrl,
    mockupUrl,
    returnUrl,
    product: product || null,
    proxyBase,
    // Fallback only. Each design carries its own guide, so the JS reads
    // `state.mapping.printArea` and comes back here only if it is missing.
    printArea: mapping?.printArea || PRINT_AREA,
    printFileSize: 2400,
    // Paces the progress bar only. Falls back when a design carries no model.
    expectedGenerationMs: mapping?.expectedGenerationMs || 25000,
    maxBytes: 30 * 1024 * 1024,
  });

  const productTitle =
    escapeHtml(product?.title || mapping?.productTitle) || "your product";

  // The ORIGINAL Shopify product's image is the hero. The Gelato preview is
  // only the design reference, and is never presented as the thing being sold.
  // The ORIGINAL Shopify product photo is the base the artwork sits on here —
  // the reverse of the product page, where the Gelato template fills the
  // gallery. `product.imageUrl` comes from the theme and is read before any
  // gallery swap, so it is the real product shot, not the template. The Gelato
  // preview is a last resort for a product with no image at all.
  const productImage = escapeHtml(
    product?.imageUrl ||
      mapping?.productImageUrl ||
      designImage(proxyBase, mapping),
  );

  // "Personalise Your Mug" reads better than the full product title, so the
  // heading is templated rather than hard-coded — "Mug" in the markup would
  // misname every other product the app is mapped onto.
  //
  // The product TYPE used to supply the noun, which read well in testing and
  // badly in production: Gelato publishes everything it creates into Shopify
  // as "Print Material", so the panel announced "Personalise Your Print
  // Material". Accurate for a fulfiller, meaningless to a customer.
  //
  // The title carries the real noun — "Her Fashion Icon Mug, 11oz Ceramic" —
  // so it is searched first, and the product type is used only when it says
  // something a shopper would recognise.
  const productNoun = escapeHtml(
    resolveProductNoun(mapping?.productTitle || product?.title, product?.type),
  );

  // Only the fields this design says a customer may change.
  //
  // Gelato publishes every text area a template contains and nothing about
  // which of them are meant to be edited, so the page used to offer all of
  // them. On a design carrying seven fixed lines and one name, that let the
  // customer rewrite the design itself. Fixed versus editable is recorded on
  // the layer stack, so the layer stack governs here.
  //
  // A design with no text layers configured predates layers and keeps the old
  // behaviour, rather than silently losing its inputs.
  const designLayers = normalizeLayers(mapping?.layers);

  const hasTextLayers = designLayers.some(function (layer) {
    return layer.type === LAYER_TYPES.TEXT;
  });

  const textAreas = hasTextLayers
    ? editableTextLayers(designLayers).map(function (layer) {
        return {
          name: layer.name,
          label: layer.label || layer.name,
          defaultText: layer.text.content,
        };
      })
    : Array.isArray(mapping?.textPlaceholders)
      ? mapping.textPlaceholders
      : [];

  const variantTitle = escapeHtml(product?.variantTitle);
  const productPrice = escapeHtml(product?.price);
  const templateName = escapeHtml(mapping?.templateName);

  const templateChooser =
    options.length > 1
      ? `<div class="mtcp__designs" id="mtcp-designs" role="radiogroup"
              aria-label="Choose a design">
          ${options
            .map((option, index) => {
              const label =
                escapeHtml(option.designLabel || option.templateName) ||
                `Design ${index + 1}`;
              // A 120px tile: ask for a small copy rather than Gelato's 2048px
              // original. Only our own image route understands `w`.
              const thumb = escapeHtml(
                option?.previewPath
                  ? `${designImage(proxyBase, option)}?w=240`
                  : designImage(proxyBase, option),
              );

              return `<button type="button" class="mtcp__design"
                      role="radio" aria-checked="${option.mappingId === mapping.mappingId}"
                      data-mapping-id="${escapeHtml(option.mappingId)}">
                ${
                  thumb
                    ? `<img class="mtcp__design-img" src="${thumb}" alt=""
                         width="120" height="120" loading="lazy" />`
                    : `<span class="mtcp__design-img"></span>`
                }
                <span class="mtcp__design-name">${label}</span>
              </button>`;
            })
            .join("")}
        </div>`
      : "";

  // Google Fonts is fetched rather than self-hosted because the storefront is
  // the merchant's domain, not ours, and a cross-origin font from an app is a
  // reliable way to be blocked by a content policy we do not control.
  const fontLink =
    `<link rel="preconnect" href="https://fonts.googleapis.com">` +
    `<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>` +
    `<link rel="stylesheet" href="${escapeHtml(googleFontsHref())}">`;

  return `{% raw %}${fontLink}<style>${STYLES}</style>{% endraw %}

<div class="mtcp" id="mtcp-root">
  <a class="mtcp__breadcrumb" href="${escapeHtml(returnUrl)}">
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M10 3L5 8l5 5" stroke="currentColor" stroke-width="1.6"
            stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
    Back to ${productTitle}
  </a>

  <h1 class="mtcp__title">${productTitle}</h1>

  <div class="mtcp__layout" id="mtcp-layout">
    <div class="mtcp__stage-col">
      <div class="mtcp__stage" id="mtcp-stage">
        ${
          productImage
            ? `<img class="mtcp__stage-img" id="mtcp-product-img" src="${productImage}"
                 alt="${productTitle}" width="900" height="900" />`
            : `<div class="mtcp__area-empty">Product preview unavailable</div>`
        }

        <img class="mtcp__stage-mockup" id="mtcp-mockup-img"
             alt="Your design on the product" hidden />

        ${/*
          One of the template's other views. Shown INSTEAD of the editable
          preview, never behind it: these are Gelato's own shots of the design,
          which already carry the artwork, so compositing onto them would draw
          the customer's photo twice.
        */ ""}
        <img class="mtcp__stage-view" id="mtcp-view-img"
             alt="Another view of this design" hidden />

        <div class="mtcp__area is-quiet" id="mtcp-area">
          <img class="mtcp__art" id="mtcp-art" alt="Your uploaded design"
               width="600" height="600" hidden />
          <div class="mtcp__area-empty" id="mtcp-area-empty" hidden>
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <rect x="3" y="3" width="18" height="18" rx="2" stroke="currentColor" stroke-width="1.5"/>
              <circle cx="8.5" cy="8.5" r="1.5" fill="currentColor"/>
              <path d="M21 15l-5-5L5 21" stroke="currentColor" stroke-width="1.5"
                    stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            Your design here
          </div>
        </div>
      </div>


      <div class="mtcp__zoom">
        <button type="button" class="mtcp__zoom-btn" id="mtcp-zoom-out"
                aria-label="Zoom out" disabled>&minus;</button>
        <span class="mtcp__zoom-val" id="mtcp-zoom-value">100%</span>
        <button type="button" class="mtcp__zoom-btn" id="mtcp-zoom-in"
                aria-label="Zoom in" disabled>+</button>
        <button type="button" class="mtcp__zoom-btn" id="mtcp-zoom-reset"
                aria-label="Reset position and zoom" disabled>&#8635;</button>
      </div>
    </div>

    <div class="mtcp__panel">
      <div class="mtcp__panel-head">
        <h2 class="mtcp__panel-title">Personalise Your ${productNoun}</h2>
        <p class="mtcp__panel-sub">
          Upload a photo and add a name to make it one of a kind.
        </p>
      </div>

      ${
        templateChooser
          ? `<section class="mtcp__step">
              <h3 class="mtcp__step-title">Choose Your Design</h3>
              ${templateChooser}
            </section>`
          : ""
      }

      <section class="mtcp__step">
        <h3 class="mtcp__step-title">Step 1. Upload Your Image</h3>

        <button type="button" class="mtcp__drop" id="mtcp-drop">
          <svg class="mtcp__drop-icon" width="36" height="36" viewBox="0 0 24 24"
               fill="none" aria-hidden="true">
            <path d="M7 18a4 4 0 010-8 5.5 5.5 0 0110.6-1.5A3.75 3.75 0 0118 18H7z"
                  stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
            <path d="M12 15V9m0 0l-2.2 2.2M12 9l2.2 2.2" stroke="currentColor"
                  stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          <span class="mtcp__drop-copy">
            <span class="mtcp__drop-title" id="mtcp-drop-title">
              Choose a file or drag &amp; drop it here
            </span>
            <span class="mtcp__drop-hint">
              Choose a clear, front-on, well-lit photo. JPEG or PNG, up to 30MB
            </span>
            <span class="mtcp__btn mtcp__btn--outline mtcp__btn--sm">Add image</span>
          </span>
        </button>

        <input class="mtcp__file" id="mtcp-file" type="file"
               accept="image/png,image/jpeg" />

        <div class="mtcp__file-row" id="mtcp-file-row" hidden>
          <img class="mtcp__file-thumb" id="mtcp-file-thumb" alt="" width="44" height="44">

          <div class="mtcp__file-body">
            <p class="mtcp__file-name" id="mtcp-file-name"></p>
            <p class="mtcp__file-state" id="mtcp-file-state"></p>
            <div class="mtcp__file-bar" id="mtcp-file-bar"><span></span></div>
          </div>

          <button type="button" class="mtcp__file-remove" id="mtcp-file-remove"
                  aria-label="Remove this photo">&times;</button>
        </div>
      </section>

      ${
        textAreas.length > 0
          ? `<section class="mtcp__step">
              <h3 class="mtcp__step-title">Step 2. Add Your Text</h3>

              <p class="mtcp__help">
                These are the text areas this design allows you to change. Leave
                one as it is to print the wording shown.
              </p>

              ${textAreas
                .map(
                  (area, index) => `<div class="mtcp__field">
                    <label class="mtcp__label" for="mtcp-text-${index}">
                      ${escapeHtml(area.label) || `Text ${index + 1}`}
                    </label>
                    <input
                      class="mtcp__input"
                      id="mtcp-text-${index}"
                      type="text"
                      maxlength="120"
                      data-mtcp-text
                      data-name="${escapeHtml(area.name)}"
                      value="${escapeHtml(area.defaultText)}"
                      placeholder="Enter Your Text"
                    />
                  </div>`,
                )
                .join("")}
            </section>`
          : ""
      }

      ${/*
        Shown only for designs with an active prompt. The script unhides it on
        load, so a design that cannot generate never flashes a button that would
        then vanish.
      */ ""}
      <section class="mtcp__step">
        <h3 class="mtcp__step-title">Step 3. Generate Your Artwork</h3>

        <button type="button" class="mtcp__btn mtcp__btn--primary mtcp__btn--auto"
                id="mtcp-generate" disabled hidden>Generate</button>

        ${/*
          Progress while the artwork is drawn.

          A spinning circle is fine for two seconds and wrong for fifty: it
          conveys "busy" but never "getting somewhere", so a long wait reads as
          a frozen page and the customer reloads it — losing the generation
          they already paid for in time.

          Deliberately plain. No pulsing orb, no shifting gradient, nothing that
          announces a machine is thinking. A bar that fills and a line of
          ordinary words, which is what any considered shop shows while it
          works.

          aria-live is polite so a screen reader hears each stage once, and the
          bar carries real progressbar semantics rather than being decoration.
        */ ""}
        <div class="mtcp__progress" id="mtcp-progress" hidden>
          <div class="mtcp__progress-track"
               role="progressbar"
               aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"
               id="mtcp-progress-track">
            <div class="mtcp__progress-fill" id="mtcp-progress-fill"></div>
          </div>
          <p class="mtcp__progress-text" aria-live="polite">
            <span id="mtcp-progress-stage">Preparing your photo</span>
            <span class="mtcp__progress-time" id="mtcp-progress-time"></span>
          </p>
        </div>

        <p class="mtcp__help">
          Every generation is unique. If this one is not quite right, then click
          &ldquo;Generate&rdquo; to try again.
        </p>

        <p class="mtcp__help">
          Adjust your artwork on the product &mdash; drag to move, use +/&minus; to
          zoom. What you see here is exactly what we&rsquo;ll print.
        </p>

        <button type="button" class="mtcp__btn mtcp__btn--outline mtcp__btn--block"
                id="mtcp-btn-template-preview" style="margin-top: 12px;">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
            <circle cx="12" cy="12" r="3"/>
          </svg>
          View Enlarged Artwork
        </button>
      </section>

      <section class="mtcp__step">
        <h3 class="mtcp__step-title">Step 4. Preview On The Product</h3>

        <button type="button" class="mtcp__btn mtcp__btn--outline mtcp__btn--auto"
                id="mtcp-preview" disabled hidden>Preview on Product</button>

        <div class="mtcp__progress" id="mtcp-preview-progress" hidden>
          <div class="mtcp__progress-track"
               role="progressbar"
               aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"
               id="mtcp-preview-progress-track">
            <div class="mtcp__progress-fill" id="mtcp-preview-progress-fill"></div>
          </div>
          <p class="mtcp__progress-text" aria-live="polite">
            <span id="mtcp-preview-progress-stage">Preparing preview</span>
            <span class="mtcp__progress-time" id="mtcp-preview-progress-time"></span>
          </p>
        </div>

        <p class="mtcp__help" id="mtcp-mockup-note" hidden></p>
      </section>

      <div class="mtcp__saved" id="mtcp-saved" hidden>
        <img class="mtcp__saved-img" id="mtcp-saved-img" alt="Your saved design"
             width="128" height="128" />
        <div>
          <p class="mtcp__saved-title">Design saved</p>
          <p class="mtcp__saved-meta" id="mtcp-saved-meta"></p>
        </div>
      </div>

      <button type="button" class="mtcp__btn mtcp__btn--primary mtcp__btn--block"
              id="mtcp-cart" data-blocked="true" disabled>Add to Cart</button>

      <p class="mtcp__help" id="mtcp-cart-help" hidden></p>

      <p class="mtcp__note mtcp__note--error" id="mtcp-error" role="alert" hidden></p>
      <p class="mtcp__note mtcp__note--success" id="mtcp-success" role="status" hidden></p>

      <p class="mtcp__buying">
        You are buying <strong>${productTitle}</strong>${
          [variantTitle, productPrice].filter(Boolean).length
            ? ` &middot; ${[variantTitle, productPrice].filter(Boolean).join(" &middot; ")}`
            : ""
        }, printed using the
        <span id="mtcp-design-name">${templateName || "selected"}</span> design.
      </p>
    </div>
  </div>
</div>

<!-- Landscape Design Template Preview Modal -->
<div class="mtcp-modal" id="mtcp-template-modal" hidden>
  <div class="mtcp-modal__backdrop" id="mtcp-template-backdrop"></div>
  <div class="mtcp-modal__dialog" role="dialog" aria-modal="true" aria-label="View Enlarged Artwork">
    <div class="mtcp-modal__header">
      <div class="mtcp-modal__title-group">
        <h2 class="mtcp-modal__title">Flat Artwork Print Template</h2>
        <span class="mtcp-modal__subtitle">Full landscape unwrapped design layout (without mug/product frame)</span>
      </div>
      <button type="button" class="mtcp-modal__close" id="mtcp-template-close" aria-label="Close preview">&times;</button>
    </div>
    <div class="mtcp-modal__body">
      <div class="mtcp-modal__landscape-wrapper">
        <img class="mtcp-modal__artwork-img" id="mtcp-template-img" alt="Flat Landscape Print Artwork" src="" />
        <div class="mtcp-modal__placeholder-notice" id="mtcp-template-empty" hidden>
          Flat artwork layout will display here once generated or loaded.
        </div>
      </div>
    </div>
    <div class="mtcp-modal__footer">
      <span class="mtcp-modal__info">High-resolution flat landscape view of the print artwork layout</span>
      <button type="button" class="mtcp__btn mtcp__btn--primary" id="mtcp-template-done">Close Preview</button>
    </div>
  </div>
</div>

<script type="application/json" id="mtcp-data">${data}</script>
{% raw %}<script>${SCRIPT}</script>{% endraw %}
`;
}

export const CUSTOMIZE_PRINT_AREA = PRINT_AREA;
