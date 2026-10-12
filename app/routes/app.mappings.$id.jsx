import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Page,
  Card,
  Text,
  Badge,
  Button,
  Banner,
  Box,
  Select,
  Spinner,
  TextField,
  Thumbnail,
  BlockStack,
  InlineStack,
  InlineGrid,
  FormLayout,
} from "@shopify/polaris";
import { Form, redirect, useActionData, useLoaderData, useNavigation } from "react-router";

import { authenticate } from "../shopify.server";
import { getMappingById, saveMapping } from "../lib/mappings.server";
import { listGenerationOptions } from "../lib/generation-settings.server";
import { buildSignedAssetUrl } from "../lib/signed-urls.server";
import { tryGetGelatoTemplateDetail } from "../lib/gelato-catalog.server";
import { resolveTemplatePreviewUrl } from "../lib/gelato-preview.server";
import { asArray, firstString, toTrimmedString } from "../lib/normalize";
import {
  ASPECT_RATIO_OPTIONS,
  aspectRatioForPrintArea,
} from "../lib/image-shape";
import { hasPrintArea, resolvePrintGeometry } from "../lib/print-geometry";
import {
  normalizeLayers,
  reorderLayer,
  seedLayersFromTemplate,
} from "../lib/layers";
import {
  MAPPING_STATUS_OPTIONS,
  fulfillmentMode,
  fulfillmentModeLabel,
  normalizeMappingInput,
  validateMapping,
} from "../lib/mapping-validation";

const NEW_MAPPING_ID = "new";

/**
 * Fetch JSON from one of our admin API routes.
 *
 * Embedded admin requests are authenticated by a session token that App Bridge
 * attaches to same-origin fetches. When that token is missing or stale,
 * `authenticate.admin` answers with HTTP 200 and an App Bridge bootstrap
 * *HTML* document instead of JSON. Parsing that as JSON produces a baffling
 * "Unexpected token <" error, so it is detected and reported plainly here.
 */
async function fetchAdminJson(url) {
  const response = await fetch(url, {
    headers: { Accept: "application/json" },
  });

  const body = await response.text();

  let payload;

  try {
    payload = JSON.parse(body);
  } catch {
    throw new Error(
      "The admin session expired while loading Gelato data. Reload the page and try again.",
    );
  }

  if (!response.ok || !payload?.ok) {
    throw new Error(payload?.error || "The Gelato request failed.");
  }

  return payload;
}

export async function loader({ request, params }) {
  const { session } = await authenticate.admin(request);

  const id = String(params.id || "");
  const isNew = id === NEW_MAPPING_ID;

  const mapping = isNew ? null : await getMappingById(session.shop, id);

  if (!isNew && !mapping) {
    throw new Response("Mapping not found", { status: 404 });
  }

  // The Gelato store catalog is deliberately NOT fetched here. A merchant's
  // store can hold hundreds of products, and listing them all to find one is
  // slow and unusable. The mapping is keyed on a template ID the merchant
  // pastes in; the catalog is only fetched if they ask to browse it.
  let template = null;

  if (mapping?.gelatoTemplateId) {
    const detail = await tryGetGelatoTemplateDetail(mapping.gelatoTemplateId);
    template = detail.template;
  }

  // Same reason as the mappings list: an <img> cannot carry the admin session
  // token, so the URL has to be resolved here and handed to the browser ready
  // to use. Gelato signs it for 24 hours and this loader runs on every visit.
  const previewUrl = mapping ? await resolveTemplatePreviewUrl(mapping) : "";

  // Milestone 4: which prompt and model this design generates with.
  const generationOptions = await listGenerationOptions(session.shop);

  // Only the key is stored, so a viewable URL is signed fresh on every visit
  // rather than persisted (NFR-09).
  let backgroundUrl = "";

  if (mapping?.backgroundImageKey) {
    try {
      backgroundUrl = buildSignedAssetUrl(mapping.backgroundImageKey);
    } catch (error) {
      console.error("[mappings] background URL could not be signed:", error.message);
    }
  }

  return Response.json({
    isNew,
    mapping,
    template,
    previewUrl,
    backgroundUrl,
    generationOptions,
  });
}

export async function action({ request, params }) {
  const { session } = await authenticate.admin(request);

  const id = String(params.id || "");
  const formData = await request.formData();

  const result = await saveMapping(session.shop, formData, {
    id: id === NEW_MAPPING_ID ? "" : id,
  });

  if (!result.ok) {
    return Response.json(
      {
        ok: false,
        errors: result.errors || {},
        error: result.error || "",
        values: normalizeMappingInput(formData),
      },
      { status: 400 },
    );
  }

  return redirect("/app/mappings");
}

/** Build the initial form state from a saved mapping or an empty mapping. */
function initialFormState(mapping) {
  return {
    shopifyProductId: firstString(mapping?.shopifyProductId),
    shopifyVariantId: firstString(mapping?.shopifyVariantId),
    shopifyVariantTitle: firstString(mapping?.shopifyVariantTitle),
    shopifyProductTitle: firstString(mapping?.shopifyProductTitle),
    shopifyProductHandle: firstString(mapping?.shopifyProductHandle),
    shopifyProductImageUrl: firstString(mapping?.shopifyProductImageUrl),
    gelatoProductId: firstString(mapping?.gelatoProductId),
    gelatoProductName: firstString(mapping?.gelatoProductName),
    gelatoProductUid: firstString(mapping?.gelatoProductUid),
    gelatoVariantId: firstString(mapping?.gelatoVariantId),
    gelatoVariantName: firstString(mapping?.gelatoVariantName),
    gelatoTemplateId: firstString(mapping?.gelatoTemplateId),
    gelatoTemplateName: firstString(mapping?.gelatoTemplateName),
    gelatoPlaceholderName: firstString(mapping?.gelatoPlaceholderName) || "ImageFront",
    gelatoPrintAreaName: firstString(mapping?.gelatoPrintAreaName) || "front",
    gelatoPlaceholderWidth: mapping?.gelatoPlaceholderWidth ?? "",
    gelatoPlaceholderHeight: mapping?.gelatoPlaceholderHeight ?? "",
    gelatoTextPlaceholders: JSON.stringify(mapping?.gelatoTextPlaceholders ?? []),
    layers: JSON.stringify(normalizeLayers(mapping?.layers)),
    gelatoPreviewUrl: firstString(mapping?.gelatoPreviewUrl),
    designLabel: firstString(mapping?.designLabel),
    sortOrder: String(mapping?.sortOrder ?? 0),

    // Milestone 6: the optional background layer and the supplier facts.
    backgroundImageKey: firstString(mapping?.backgroundImageKey),
    backgroundImageName: firstString(mapping?.backgroundImageName),
    backgroundPlaceholderName: firstString(mapping?.backgroundPlaceholderName),
    supplierSku: firstString(mapping?.supplierSku),
    printFileRequirements: firstString(mapping?.printFileRequirements),
    mockupTemplate: firstString(mapping?.mockupTemplate),
    pricingRules: mapping?.pricingRules ? JSON.stringify(mapping.pricingRules) : "",
    shippingRules: mapping?.shippingRules ? JSON.stringify(mapping.shippingRules) : "",

    // Milestone 4 generation settings. Empty string is a real choice here — it
    // means "no prompt" / "use the default model" — so these are not defaulted
    // to anything clever.
    promptId: firstString(mapping?.promptId),
    aiModelId: firstString(mapping?.aiModelId),
    outputResolution: firstString(mapping?.outputResolution) || "2K",
    aspectRatio: firstString(mapping?.aspectRatio),
    temperature: mapping?.temperature ?? "",
    seed: mapping?.seed ?? "",

    status: firstString(mapping?.status) || "DRAFT",
  };
}

/**
 * A scale preview of the layer stack over the product image.
 *
 * Coordinates are fractions, so the preview is the product image with
 * absolutely positioned boxes — no scaling maths, and it matches what the
 * customer's canvas renders from the same numbers.
 */
function LayerPreview({ layers, productImageUrl, selectedName, onSelect }) {
  return (
    <Box background="bg-surface-secondary" borderRadius="200" padding="300">
      <div
        style={{
          aspectRatio: "1 / 1",
          background: "#fff",
          borderRadius: 8,
          containerType: "inline-size",
          overflow: "hidden",
          position: "relative",
          width: "100%",
        }}
      >
        {productImageUrl ? (
          <img
            src={productImageUrl}
            alt=""
            style={{ height: "100%", objectFit: "contain", width: "100%" }}
          />
        ) : null}

        {layers.map((layer) => (
          <button
            type="button"
            key={layer.name}
            onClick={() => onSelect(layer.name)}
            title={layer.label || layer.name}
            style={{
              background:
                layer.type === "text" ? "transparent" : "rgba(244,69,29,0.10)",
              border:
                layer.name === selectedName
                  ? "2px solid #f4451d"
                  : "1px dashed rgba(0,0,0,0.35)",
              cursor: "pointer",
              height: `${layer.height * 100}%`,
              left: `${layer.x * 100}%`,
              overflow: "hidden",
              padding: 0,
              position: "absolute",
              top: `${layer.y * 100}%`,
              transform: `rotate(${layer.rotation}deg)`,
              width: `${layer.width * 100}%`,
              zIndex: layer.zIndex,
            }}
          >
            {layer.type === "text" ? (
              <span
                style={{
                  color: "#202223",
                  display: "block",
                  fontSize: "3cqw",
                  lineHeight: 1.2,
                  overflow: "hidden",
                  padding: "2px",
                  textAlign: "center",
                }}
              >
                {layer.label || layer.name}
              </span>
            ) : null}
          </button>
        ))}
      </div>
    </Box>
  );
}

/**
 * One layer in the stack list.
 *
 * The move controls change paint order, which is the one structural thing a
 * merchant still needs: Gelato names the layers but gives no way to say which
 * sits above which once we draw them.
 */
function LayerRow({ layer, selected, onSelect, onMove }) {
  return (
    <Box
      background={selected ? "bg-surface-selected" : "bg-surface"}
      borderRadius="200"
      borderWidth="025"
      borderColor="border"
      padding="200"
    >
      <InlineStack align="space-between" blockAlign="center" gap="200">
        <Button variant="plain" onClick={onSelect} textAlign="left">
          <InlineStack gap="200" blockAlign="center">
            <Badge tone={layer.type === "text" ? "info" : "success"}>
              {layer.type === "text" ? "Text" : "Image"}
            </Badge>

            <Text as="span" variant="bodySm">
              {layer.label || layer.name}
            </Text>

            <Text as="span" variant="bodySm" tone="subdued">
              {layer.locked ? "locked" : layer.editable ? "editable" : "fixed"}
            </Text>
          </InlineStack>
        </Button>

        <InlineStack gap="100">
          <Button
            variant="tertiary"
            size="slim"
            onClick={() => onMove("down")}
            accessibilityLabel={`Move ${layer.label || layer.name} back`}
          >
            &darr;
          </Button>

          <Button
            variant="tertiary"
            size="slim"
            onClick={() => onMove("up")}
            accessibilityLabel={`Move ${layer.label || layer.name} forward`}
          >
            &uarr;
          </Button>
        </InlineStack>
      </InlineStack>
    </Box>
  );
}

/**
 * The artwork for a fixed image layer.
 *
 * Gelato names a template's image placeholders but publishes none of their
 * artwork, so anything that is not the customer's photo has to be supplied
 * here.
 *
 * Uploading also decides the layer's role: a layer carrying artwork is fixed,
 * and whichever image layer is left without any is where the customer's photo
 * goes.
 */
function LayerImageField({ layer, onChange }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function upload(file) {
    if (!file) return;

    setError("");
    setBusy(true);

    try {
      const body = new FormData();
      body.append("file", file);
      body.append("kind", "layer");

      const response = await fetch("/app/api/background", { method: "POST", body });
      const payload = await response.json();

      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.error || "The image could not be uploaded.");
      }

      onChange({ imageKey: payload.key, imageName: payload.name });
    } catch (uploadError) {
      setError(uploadError.message || "The image could not be uploaded.");
    } finally {
      setBusy(false);
    }
  }

  if (layer.imageKey) {
    return (
      <BlockStack gap="200">
        <InlineStack gap="300" blockAlign="center">
          <Badge tone="success">Fixed</Badge>
          <Text as="span">{layer.imageName || "Uploaded artwork"}</Text>
          <Button
            variant="plain"
            tone="critical"
            onClick={() => onChange({ imageKey: "", imageName: "" })}
          >
            Remove
          </Button>
        </InlineStack>

        <Text as="p" variant="bodySm" tone="subdued">
          This layer prints exactly as supplied. The customer cannot change it.
        </Text>
      </BlockStack>
    );
  }

  return (
    <BlockStack gap="300">
      <Banner tone="info">
        <Text as="p">
          No artwork here, so this is where the customer&rsquo;s photo goes.
          Upload an image to make it a fixed part of the design instead.
        </Text>
      </Banner>

      {error ? (
        <Banner tone="critical">
          <Text as="p">{error}</Text>
        </Banner>
      ) : null}

      <input
        type="file"
        accept="image/png,image/jpeg,image/webp"
        disabled={busy}
        onChange={(event) => {
          upload(event.target.files?.[0]);
          // Cleared so choosing the same file twice still fires.
          event.target.value = "";
        }}
        aria-label={`Upload artwork for ${layer.label || layer.name}`}
      />

      {busy ? <Spinner size="small" /> : null}
    </BlockStack>
  );
}

/**
 * What a merchant may change about one layer.
 *
 * Deliberately very little. The Client designs the template in Gelato and does
 * not want it adjustable anywhere else — one source of truth, and no way for an
 * employee to alter a template by accident. So position, size, rotation,
 * wording, font, colour and alignment are all absent: they belong to Gelato.
 *
 * What is left is the label the customer reads, and whether they may edit the
 * field at all. Neither exists in Gelato, so neither can come from it.
 */
function LayerEditor({ layer, onChange }) {
  return (
    <Card>
      <BlockStack gap="400">
        <Text as="h3" variant="headingSm">
          {layer.label || layer.name}
        </Text>

        <FormLayout>
          <TextField
            label="Label"
            value={layer.label}
            onChange={(value) => onChange({ label: value })}
            autoComplete="off"
            helpText="Shown to the customer instead of the Gelato layer name."
          />

          <Select
            label="Customer access"
            options={[
              { label: "Editable by the customer", value: "editable" },
              { label: "Fixed", value: "fixed" },
              { label: "Locked", value: "locked" },
            ]}
            value={layer.locked ? "locked" : layer.editable ? "editable" : "fixed"}
            onChange={(value) =>
              onChange({
                locked: value === "locked",
                editable: value === "editable",
              })
            }
          />

          {layer.type === "text" ? (
            <Banner tone="info">
              <Text as="p">
                The wording, font, size, colour and position all come from the
                Gelato template and are set there. Only the label above and the
                access setting are configured here.
              </Text>
            </Banner>
          ) : (
            <LayerImageField layer={layer} onChange={onChange} />
          )}
        </FormLayout>
      </BlockStack>
    </Card>
  );
}

export default function MappingForm() {
  const {
    isNew,
    mapping,
    template: loadedTemplate,
    previewUrl: loadedPreviewUrl,
    backgroundUrl: loadedBackgroundUrl,
    generationOptions,
  } = useLoaderData();

  const actionData = useActionData();
  const navigation = useNavigation();

  const [values, setValues] = useState(() => initialFormState(mapping));
  const [shopifyVariants, setShopifyVariants] = useState([]);
  const [template, setTemplate] = useState(loadedTemplate);
  const [templateLoading, setTemplateLoading] = useState(false);
  const [templateError, setTemplateError] = useState("");
  const [pickerError, setPickerError] = useState("");
  const [clientErrors, setClientErrors] = useState({});

  // The background lives on the record as a key; this is the viewable copy,
  // replaced in place when a new file is uploaded.
  const [backgroundUrl, setBackgroundUrl] = useState(loadedBackgroundUrl || "");
  const [backgroundBusy, setBackgroundBusy] = useState(false);
  const [backgroundError, setBackgroundError] = useState("");
  const [blockedFields, setBlockedFields] = useState([]);
  const [selectedLayerName, setSelectedLayerName] = useState("");

  // The Gelato store catalog is an escape hatch, not the main road: it is only
  // requested when the merchant opens the browser, and never on page load.
  const [browsing, setBrowsing] = useState(false);
  const [gelatoProducts, setGelatoProducts] = useState([]);
  const [gelatoVariants, setGelatoVariants] = useState([]);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogError, setCatalogError] = useState("");
  const [productLoading, setProductLoading] = useState(false);

  const saving = navigation.state === "submitting";

  const errors = useMemo(
    () => ({ ...clientErrors, ...(actionData?.errors || {}) }),
    [clientErrors, actionData],
  );

  const setValue = useCallback((key, value) => {
    setValues((current) => ({ ...current, [key]: value }));
    setClientErrors((current) => {
      if (!current[key]) return current;

      const next = { ...current };
      delete next[key];
      return next;
    });
  }, []);

  /**
   * Load one Gelato template by ID and prefill the mapping from it.
   *
   * This is the primary path: the merchant copies a template ID out of Gelato
   * and pastes it here, so a single request replaces listing the whole store.
   */
  const loadTemplate = useCallback(
    async (templateId, { prefill = true } = {}) => {
      const id = toTrimmedString(templateId);

      setTemplateError("");

      if (!id) {
        setTemplate(null);
        return null;
      }

      setTemplateLoading(true);

      try {
        const result = await fetchAdminJson(
          `/app/api/gelato-template/${encodeURIComponent(id)}`,
        );

        const detail = result.template;

        setTemplate(detail);

        if (prefill && detail) {
          const variants = asArray(detail.variants);
          const placeholder = asArray(detail.placeholders)[0];

          setValues((current) => ({
            ...current,
            gelatoTemplateId: firstString(detail.id) || id,
            gelatoTemplateName:
              firstString(detail.name) || current.gelatoTemplateName,
            // A template pins its own catalog product; keep it so fulfilment
            // can fall back to the catalog flow if the template is retired.
            gelatoProductUid:
              firstString(detail.productUid, variants[0]?.productUid) ||
              current.gelatoProductUid,
            gelatoVariantId:
              current.gelatoVariantId || firstString(variants[0]?.id),
            gelatoVariantName:
              current.gelatoVariantName || firstString(variants[0]?.title),
            // Replaced outright, not merged: keeping the previous template's
            // preview when the new one has none leaves the design showing an
            // image it no longer prints.
            gelatoPreviewUrl: firstString(detail.previewUrl),
            gelatoPlaceholderName:
              firstString(placeholder?.name) || current.gelatoPlaceholderName,
            gelatoPrintAreaName:
              firstString(placeholder?.printArea) || current.gelatoPrintAreaName,
            gelatoPlaceholderWidth: placeholder?.width ?? "",
            gelatoPlaceholderHeight: placeholder?.height ?? "",
            // Editable text areas the template defines, stored verbatim so the
            // storefront can render one input per area.
            gelatoTextPlaceholders: JSON.stringify(
              asArray(detail.textPlaceholders),
            ),
            // Gelato names the layers; it gives no geometry, so this seeds
            // workable defaults and leaves any the merchant already positioned
            // exactly as they were.
            layers: JSON.stringify(
              seedLayersFromTemplate(detail, JSON.parse(current.layers || "[]")),
            ),
          }));
        }

        return detail;
      } catch (error) {
        console.error("[mapping] Gelato template:", error);
        setTemplate(null);
        setTemplateError(
          error.message ||
            "That template ID was not found in your Gelato account.",
        );
        return null;
      } finally {
        setTemplateLoading(false);
      }
    },
    [],
  );

  /** Fetch the Gelato store catalog on demand, never on page load. */
  const openCatalog = useCallback(async () => {
    setBrowsing(true);

    if (gelatoProducts.length > 0 || catalogLoading) {
      return;
    }

    setCatalogLoading(true);
    setCatalogError("");

    try {
      const result = await fetchAdminJson("/app/api/gelato-products");
      setGelatoProducts(asArray(result.products));
    } catch (error) {
      console.error("[mapping] Gelato catalog:", error);
      setCatalogError(error.message || "The Gelato catalog could not be loaded.");
    } finally {
      setCatalogLoading(false);
    }
  }, [catalogLoading, gelatoProducts.length]);

  /**
   * Load a Gelato product's detail and preselect sensible defaults.
   *
   * The detail endpoint is always fetched: Gelato's product *list* payload
   * omits the template id (it lives on `parentTemplateId`, detail only) and
   * omits each variant's catalog `productUid`, both of which we need.
   */
  const selectGelatoProduct = useCallback(
    async (productId) => {
      const listed = gelatoProducts.find((item) => item.id === productId);

      setValue("gelatoProductId", productId);
      setValue("gelatoProductName", firstString(listed?.title));
      setValue("gelatoVariantId", "");
      setValue("gelatoVariantName", "");
      setValue("gelatoProductUid", "");

      if (!productId) {
        setGelatoVariants([]);
        setTemplate(null);
        return;
      }

      // Show whatever the list gave us while the detail request is in flight.
      setGelatoVariants(asArray(listed?.variants));

      if (firstString(listed?.previewUrl)) {
        setValue("gelatoPreviewUrl", listed.previewUrl);
      }

      setProductLoading(true);

      try {
        const result = await fetchAdminJson(
          `/app/api/gelato-product/${encodeURIComponent(productId)}`,
        );

        const detail = result.product;
        const variants = asArray(detail?.variants);

        setGelatoVariants(variants);

        if (firstString(detail?.previewUrl)) {
          setValue("gelatoPreviewUrl", detail.previewUrl);
        }

        // Preselect the first variant so the product UID is never left blank.
        if (variants.length > 0) {
          setValue("gelatoVariantId", firstString(variants[0].id));
          setValue("gelatoVariantName", firstString(variants[0].title));
          setValue("gelatoProductUid", firstString(variants[0].productUid));
        }

        if (firstString(detail?.templateId)) {
          setValue("gelatoTemplateId", detail.templateId);
          setValue("gelatoTemplateName", firstString(detail.templateName));
          await loadTemplate(detail.templateId);
        } else {
          // Not built from a template — this mapping uses the catalog flow.
          setValue("gelatoTemplateId", "");
          setValue("gelatoTemplateName", "");
          setTemplate(null);
        }
      } catch (error) {
        console.error("[mapping] Gelato product detail:", error);
        setPickerError(error.message || "That Gelato product could not be loaded.");
      } finally {
        setProductLoading(false);
      }
    },
    [gelatoProducts, loadTemplate, setValue],
  );

  // Keep placeholder/print area valid whenever the template changes.
  useEffect(() => {
    const placeholders = asArray(template?.placeholders);

    if (placeholders.length === 0) {
      return;
    }

    const stillValid = placeholders.some(
      (placeholder) => placeholder.name === values.gelatoPlaceholderName,
    );

    if (!stillValid) {
      setValues((current) => ({
        ...current,
        gelatoPlaceholderName: placeholders[0].name,
        gelatoPrintAreaName: placeholders[0].printArea,
      }));
    }
    // `values.gelatoPlaceholderName` is intentionally the only value watched.
  }, [template, values.gelatoPlaceholderName]);

  async function chooseShopifyProduct() {
    setPickerError("");

    if (typeof window === "undefined" || !window.shopify?.resourcePicker) {
      setPickerError(
        "The Shopify product picker is only available inside the embedded admin.",
      );
      return;
    }

    try {
      const selection = await window.shopify.resourcePicker({
        type: "product",
        multiple: false,
        action: "select",
        filter: { hidden: false, variants: true },
      });

      const product = asArray(selection)[0];

      if (!product) {
        return;
      }

      const variants = asArray(product.variants);

      setShopifyVariants(variants);

      setValues((current) => ({
        ...current,
        shopifyProductId: firstString(product.id),
        shopifyProductTitle: firstString(product.title),
        shopifyProductHandle: firstString(product.handle),
        shopifyProductImageUrl: firstString(
          product.images?.[0]?.originalSrc,
          product.images?.[0]?.url,
          product.featuredImage?.url,
        ),
        shopifyVariantId: firstString(variants[0]?.id),
        shopifyVariantTitle: firstString(variants[0]?.title),
      }));
    } catch (error) {
      console.error("[mapping] resource picker:", error);
      setPickerError(error.message || "The product picker could not be opened.");
    }
  }

  function handleSubmit(event) {
    const normalized = normalizeMappingInput(values);
    const { valid, errors: validationErrors } = validateMapping(normalized);

    if (valid) {
      setBlockedFields([]);
      return;
    }

    event.preventDefault();
    setClientErrors(validationErrors);

    // The offending field can be a long way up the page, so name what is
    // missing in a banner at the top instead of leaving the button looking
    // like it simply did nothing.
    setBlockedFields(Object.values(validationErrors));

    if (typeof window !== "undefined") {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }

  const gelatoProductOptions = [
    {
      label: catalogLoading
        ? "Loading your Gelato store…"
        : gelatoProducts.length === 0
          ? "No Gelato store products found"
          : `Select a Gelato product (${gelatoProducts.length})`,
      value: "",
    },
    ...gelatoProducts.map((product) => ({
      label: product.title,
      value: product.id,
    })),
  ];

  const gelatoVariantOptions = [
    {
      label: values.gelatoProductId
        ? "Select a Gelato variant"
        : "Select a Gelato product first",
      value: "",
    },
    ...gelatoVariants.map((variant) => ({
      label: variant.title,
      value: variant.id,
    })),
  ];

  const shopifyVariantOptions = [
    { label: "All variants", value: "" },
    ...shopifyVariants.map((variant) => ({
      label: firstString(variant.title, variant.displayName, "Default title"),
      value: firstString(variant.id),
    })),
  ];

  const placeholders = asArray(template?.placeholders);
  const printAreas = asArray(template?.printAreas);
  const textAreas = asArray(template?.textPlaceholders);

  const layers = useMemo(() => normalizeLayers(values.layers), [values.layers]);

  /**
   * What the print area alone would suggest — shown, not applied.
   *
   * Useful when a design IS full-bleed, and quiet when there is nothing to say.
   * It informs the choice; the merchant still makes it.
   */
  const aspectRatioHelp = useMemo(() => {
    const base =
      "The shape the AI draws at. Set this to match the artwork area in your " +
      "Gelato template — not the whole template, if the design also carries " +
      "fixed text or graphics.";

    const geometry = resolvePrintGeometry({
      printFileRequirements: values.printFileRequirements,
    });

    if (!hasPrintArea(geometry)) return base;

    const ratio = (geometry.width / geometry.height).toFixed(2);
    const nearest = aspectRatioForPrintArea(geometry);

    return `${base} For reference, this product's full print area is ${ratio}:1, whose closest available option is ${nearest}.`;
  }, [values.printFileRequirements]);

  const selectedLayer =
    layers.find((layer) => layer.name === selectedLayerName) || layers[0] || null;

  /** Patch one layer, merging its `text` block rather than replacing it. */
  function updateLayer(name, patch) {
    const next = layers.map((layer) =>
      layer.name === name
        ? { ...layer, ...patch, text: { ...layer.text, ...(patch.text || {}) } }
        : layer,
    );

    setValue('layers', JSON.stringify(normalizeLayers(next)));
  }

  const placeholderOptions =
    placeholders.length > 0
      ? placeholders.map((placeholder) => ({
          label: `${placeholder.name} (${placeholder.printArea})`,
          value: placeholder.name,
        }))
      : [
          { label: "ImageFront", value: "ImageFront" },
          { label: "ImageBack", value: "ImageBack" },
        ];

  const printAreaOptions =
    printAreas.length > 0
      ? printAreas.map((area) => ({ label: area, value: area }))
      : [
          { label: "front", value: "front" },
          { label: "back", value: "back" },
        ];

  /**
   * Send the chosen file to the admin upload route and keep its key.
   *
   * Uploaded immediately rather than on save: the mapping form posts as plain
   * fields, and threading a multi-megabyte file through it would mean rebuilding
   * the whole form as multipart for one optional image.
   */
  async function uploadBackground(file) {
    if (!file) return;

    setBackgroundError("");
    setBackgroundBusy(true);

    try {
      const body = new FormData();
      body.append("file", file);

      const response = await fetch("/app/api/background", { method: "POST", body });
      const payload = await response.json();

      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.error || "The background could not be uploaded.");
      }

      setValues((current) => ({
        ...current,
        backgroundImageKey: payload.key,
        backgroundImageName: payload.name,
      }));

      setBackgroundUrl(payload.url || "");
    } catch (error) {
      setBackgroundError(error.message || "The background could not be uploaded.");
    } finally {
      setBackgroundBusy(false);
    }
  }

  function removeBackground() {
    setValues((current) => ({
      ...current,
      backgroundImageKey: "",
      backgroundImageName: "",
      backgroundPlaceholderName: "",
    }));

    setBackgroundUrl("");
    setBackgroundError("");
  }

  const mode = fulfillmentMode(values);
  const modeLabel = fulfillmentModeLabel(values);

  // The loader's URL is freshly signed; `values.gelatoPreviewUrl` is whatever
  // was stored when the mapping was saved and has very likely expired, so it is
  // only a last resort.
  const previewUrl =
    loadedPreviewUrl ||
    firstString(template?.previewUrl) ||
    values.gelatoPreviewUrl ||
    values.shopifyProductImageUrl;

  return (
    <Page
      title={isNew ? "Add product mapping" : "Edit product mapping"}
      subtitle="Add one Gelato design to a Shopify product. The product is still what the customer buys — add another mapping to offer it a second design."
      backAction={{ content: "Product mappings", url: "/app/mappings" }}
    >
      <Form method="post" onSubmit={handleSubmit}>
        <BlockStack gap="500">
          {actionData?.error ? (
            <Banner tone="critical" title="The mapping could not be saved">
              {actionData.error}
            </Banner>
          ) : null}

          {blockedFields.length > 0 ? (
            <Banner
              tone="critical"
              title="The mapping is not ready to save"
              onDismiss={() => setBlockedFields([])}
            >
              <BlockStack gap="100">
                {blockedFields.map((message) => (
                  <Text as="p" key={message}>
                    {message}
                  </Text>
                ))}
              </BlockStack>
            </Banner>
          ) : null}

          {catalogError ? (
            <Banner tone="warning" title="Gelato catalog unavailable">
              {catalogError} You can still map this product by pasting its
              template ID.
            </Banner>
          ) : null}

          {pickerError ? (
            <Banner tone="warning" title="Product picker">
              {pickerError}
            </Banner>
          ) : null}

          {/* Every value the action reads, mirrored from component state. */}
          {Object.entries(values).map(([key, value]) => (
            <input key={key} type="hidden" name={key} value={value} readOnly />
          ))}

          <InlineGrid columns={{ xs: 1, lg: 2 }} gap="500">
            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between" blockAlign="center" gap="300">
                  <InlineStack gap="200" blockAlign="center">
                    <Badge tone="info">Step 1</Badge>
                    <Text as="h2" variant="headingMd">
                      Shopify product
                    </Text>
                  </InlineStack>

                  <Button onClick={chooseShopifyProduct}>
                    {values.shopifyProductId ? "Change product" : "Choose product"}
                  </Button>
                </InlineStack>

                {values.shopifyProductId ? (
                  <InlineStack gap="300" blockAlign="center">
                    <Thumbnail
                      source={values.shopifyProductImageUrl || ""}
                      alt={values.shopifyProductTitle}
                      size="large"
                    />

                    <BlockStack gap="100">
                      <Text as="p" fontWeight="semibold">
                        {values.shopifyProductTitle}
                      </Text>
                      <Text as="p" tone="subdued">
                        {values.shopifyProductId}
                      </Text>
                    </BlockStack>
                  </InlineStack>
                ) : (
                  <Box padding="400" background="bg-surface-secondary" borderRadius="200">
                    <Text as="p" tone="subdued">
                      No Shopify product selected yet.
                    </Text>
                  </Box>
                )}

                {errors.shopifyProductId ? (
                  <Text as="p" tone="critical">
                    {errors.shopifyProductId}
                  </Text>
                ) : null}

                {shopifyVariants.length > 0 ? (
                  <Select
                    label="Shopify variant"
                    helpText="Leave on “All variants” to customise every variant."
                    options={shopifyVariantOptions}
                    value={values.shopifyVariantId}
                    onChange={(value) => {
                      const variant = shopifyVariants.find(
                        (item) => firstString(item.id) === value,
                      );

                      setValue("shopifyVariantId", value);
                      setValue("shopifyVariantTitle", firstString(variant?.title));
                    }}
                  />
                ) : null}
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between" blockAlign="center" gap="300">
                  <InlineStack gap="200" blockAlign="center">
                    <Badge tone="info">Step 2</Badge>
                    <Text as="h2" variant="headingMd">
                      Gelato template
                    </Text>
                  </InlineStack>

                  {templateLoading ? <Spinner size="small" /> : null}
                </InlineStack>

                <Text as="p" tone="subdued">
                  Open the template in Gelato and copy its ID from the address
                  bar, then paste it here. Nothing else about your Gelato store
                  is loaded.
                </Text>

                <FormLayout>
                  <TextField
                    label="Gelato template ID"
                    value={values.gelatoTemplateId}
                    onChange={(value) => {
                      setValue("gelatoTemplateId", value);
                      setTemplateError("");
                    }}
                    onBlur={() => {
                      if (
                        toTrimmedString(values.gelatoTemplateId) &&
                        firstString(template?.id) !==
                          toTrimmedString(values.gelatoTemplateId)
                      ) {
                        loadTemplate(values.gelatoTemplateId);
                      }
                    }}
                    autoComplete="off"
                    placeholder="e.g. c12a3b45-6789-4def-0123-456789abcdef"
                    error={errors.gelatoTemplateId || templateError}
                    connectedRight={
                      <Button
                        onClick={() => loadTemplate(values.gelatoTemplateId)}
                        loading={templateLoading}
                        disabled={!toTrimmedString(values.gelatoTemplateId)}
                      >
                        Load
                      </Button>
                    }
                  />

                  {template ? (
                    <Banner tone="success" title={`Loaded “${template.name}”`}>
                      <BlockStack gap="100">
                        <Text as="p">
                          {placeholders.length} image placeholder
                          {placeholders.length === 1 ? "" : "s"},{" "}
                          {printAreas.length} print area
                          {printAreas.length === 1 ? "" : "s"} and{" "}
                          {textAreas.length} editable text area
                          {textAreas.length === 1 ? "" : "s"} found.
                          {values.gelatoProductUid
                            ? ` Product UID: ${values.gelatoProductUid}.`
                            : ""}
                        </Text>

                        {textAreas.length > 0 ? (
                          <Text as="p" tone="subdued">
                            Text areas: {textAreas.map((t) => t.label).join(" · ")}
                          </Text>
                        ) : (
                          <Text as="p" tone="subdued">
                            This template has no editable text. Add text layers in
                            Gelato if customers should be able to change wording.
                          </Text>
                        )}
                      </BlockStack>
                    </Banner>
                  ) : null}

                  <TextField
                    label="Template name"
                    value={values.gelatoTemplateName}
                    onChange={(value) => setValue("gelatoTemplateName", value)}
                    autoComplete="off"
                    helpText="Filled in automatically when the template loads."
                  />
                </FormLayout>

                {browsing ? (
                  <BlockStack gap="300">
                    <InlineStack align="space-between" blockAlign="center">
                      <Text as="h3" variant="headingSm">
                        Browse store products
                      </Text>

                      {catalogLoading || productLoading ? (
                        <Spinner size="small" />
                      ) : null}
                    </InlineStack>

                    <FormLayout>
                      <Select
                        label="Gelato product"
                        options={gelatoProductOptions}
                        value={values.gelatoProductId}
                        onChange={selectGelatoProduct}
                        disabled={catalogLoading}
                        error={errors.gelatoProductId}
                      />

                      <Select
                        label="Gelato variant"
                        options={gelatoVariantOptions}
                        value={values.gelatoVariantId}
                        disabled={!values.gelatoProductId}
                        onChange={(value) => {
                          const variant = gelatoVariants.find(
                            (item) => item.id === value,
                          );

                          setValue("gelatoVariantId", value);
                          setValue("gelatoVariantName", firstString(variant?.title));
                          // The catalog flow prints against this UID.
                          setValue(
                            "gelatoProductUid",
                            firstString(variant?.productUid),
                          );
                        }}
                        error={errors.gelatoVariantId}
                        helpText={
                          values.gelatoProductUid
                            ? `Product UID: ${values.gelatoProductUid}`
                            : undefined
                        }
                      />
                    </FormLayout>
                  </BlockStack>
                ) : (
                  <Button variant="plain" onClick={openCatalog}>
                    Don’t know the ID? Browse your Gelato store products
                  </Button>
                )}
              </BlockStack>
            </Card>
          </InlineGrid>

          <InlineGrid columns={{ xs: 1, lg: 2 }} gap="500">
            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between" blockAlign="center" gap="300">
                  <InlineStack gap="200" blockAlign="center">
                    <Badge tone="info">Step 3</Badge>
                    <Text as="h2" variant="headingMd">
                      Placeholder and print area
                    </Text>
                  </InlineStack>

                  {templateLoading ? <Spinner size="small" /> : null}
                </InlineStack>

<Banner tone={mode === "catalog" ? "info" : "warning"}>
                  <Text as="p" fontWeight="semibold">
                    {modeLabel}
                  </Text>
                  <Text as="p">
                    {mode === "catalog"
                      ? `Orders for this design are placed against the Gelato catalog product “${values.gelatoProductUid}”. That UID is the only identifier Gelato's Order API resolves, and it already encodes the variant.`
                      : mode === "template-only"
                        ? "A Gelato template is mapped, which is enough for the preview — but not to fulfil. Gelato's Order API does not resolve a template ID: an order sent with one is created and then parked as an unprintable draft. Pick the Gelato store product variant so its product UID is recorded, then this design can go active."
                        : "Paste a Gelato template ID in Step 2, or browse your store products and pick a variant, so Gelato knows what to print."}
                  </Text>
                </Banner>

                <FormLayout>
                  <Select
                    label="Image placeholder"
                    options={placeholderOptions}
                    value={values.gelatoPlaceholderName}
                    onChange={(value) => {
                      setValue("gelatoPlaceholderName", value);

                      const placeholder = placeholders.find(
                        (item) => item.name === value,
                      );

                      if (placeholder?.printArea) {
                        setValue("gelatoPrintAreaName", placeholder.printArea);
                      }

                      // Each placeholder has its own shape; keep them in step.
                      setValue("gelatoPlaceholderWidth", placeholder?.width ?? "");
                      setValue("gelatoPlaceholderHeight", placeholder?.height ?? "");
                    }}
                    error={errors.gelatoPlaceholderName}
                  />

                  <Select
                    label="Print area"
                    options={printAreaOptions}
                    value={values.gelatoPrintAreaName}
                    onChange={(value) => setValue("gelatoPrintAreaName", value)}
                    error={errors.gelatoPrintAreaName}
                  />
                </FormLayout>
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="400">
                <InlineStack gap="200" blockAlign="center">
                  <Badge tone="info">Step 4</Badge>
                  <Text as="h2" variant="headingMd">
                    Preview and status
                  </Text>
                </InlineStack>

                {previewUrl ? (
                  <Box
                    background="bg-surface-secondary"
                    borderRadius="200"
                    padding="300"
                  >
                    <img
                      src={previewUrl}
                      alt={values.shopifyProductTitle || "Template preview"}
                      style={{
                        width: "100%",
                        maxHeight: "260px",
                        objectFit: "contain",
                        display: "block",
                      }}
                    />
                  </Box>
                ) : (
                  <Box padding="400" background="bg-surface-secondary" borderRadius="200">
                    <Text as="p" tone="subdued">
                      No preview image yet.
                    </Text>
                  </Box>
                )}

                <FormLayout>
                  <TextField
                    label="Preview image URL"
                    value={values.gelatoPreviewUrl}
                    onChange={(value) => setValue("gelatoPreviewUrl", value)}
                    autoComplete="off"
                    error={errors.gelatoPreviewUrl}
                    helpText="Shown on the product page before the customer customises."
                  />

                  <TextField
                    label="Design name"
                    value={values.designLabel}
                    onChange={(value) => setValue("designLabel", value)}
                    autoComplete="off"
                    placeholder={values.gelatoTemplateName || "Classic"}
                    helpText="Shown to the customer when this product offers more than one design."
                  />

                  <TextField
                    label="Sort order"
                    type="number"
                    value={values.sortOrder}
                    onChange={(value) => setValue("sortOrder", value)}
                    autoComplete="off"
                    helpText="Lower numbers appear first. The first design is the default."
                  />

                  <Select
                    label="AI prompt"
                    options={generationOptions?.promptOptions || []}
                    value={values.promptId}
                    onChange={(value) => setValue("promptId", value)}
                    helpText="The prompt this design generates with. Only active prompts run on the storefront."
                  />

                  <Select
                    label="AI model"
                    options={generationOptions?.modelOptions || []}
                    value={values.aiModelId}
                    onChange={(value) => setValue("aiModelId", value)}
                    helpText="Chosen per design. Leave on the default to follow the app-wide model."
                  />

                  <Select
                    label="Output resolution"
                    options={generationOptions?.resolutionOptions || []}
                    value={values.outputResolution}
                    onChange={(value) => setValue("outputResolution", value)}
                    helpText="Higher resolution prints with more detail but takes longer to generate."
                  />

                  {/*
                    Set here, never calculated.

                    The print area describes the finished product, not the part
                    of it the AI draws. A 200 x 96 mm mug can carry 3:4 artwork
                    inside a fixed layout of text and graphics, and no
                    arithmetic on those dimensions reveals that. Only the person
                    who designed the template knows.

                    The list holds only ratios Google accepts. 2:1 reads like a
                    reasonable request for a mug wrap and is rejected outright.
                  */}
                  <Select
                    label="AI image aspect ratio"
                    options={ASPECT_RATIO_OPTIONS}
                    value={values.aspectRatio}
                    onChange={(value) => setValue("aspectRatio", value)}
                    helpText={aspectRatioHelp}
                  />

                  {/*
                    How literally the model follows the prompt.

                    Left blank, Google applies 1.0 — the most inventive setting
                    it has, and what every generation ran at until now. A prompt
                    asking for "the cabin fills roughly the right 45-50% of the
                    frame" was treated as a suggestion and the composition
                    spread across the whole width, putting the template text on
                    top of the subjects.
                  */}
                  <FormLayout.Group>
                    <TextField
                      label="Prompt adherence (temperature)"
                      type="number"
                      min={0}
                      max={2}
                      step={0.1}
                      value={String(values.temperature ?? "")}
                      onChange={(value) => setValue("temperature", value)}
                      autoComplete="off"
                      placeholder="Model default (1.0)"
                      helpText="0 follows the prompt most literally, 2 is most inventive. Lower this when a prompt specifies composition. Leave blank for the model default."
                    />

                    <TextField
                      label="Seed (optional)"
                      type="number"
                      min={0}
                      step={1}
                      value={String(values.seed ?? "")}
                      onChange={(value) => setValue("seed", value)}
                      autoComplete="off"
                      placeholder="Random each time"
                      helpText="Set any number while refining a prompt: the same photo then reproduces the same image, so a change you make is the only thing that differs. Clear it before going live so customers get unique artwork."
                    />
                  </FormLayout.Group>

{(() => {
                    // Three distinct states, because "no Generate button on the
                    // storefront" has three different causes and a merchant
                    // cannot tell them apart from the shop front.
                    const selected =
                      generationOptions?.promptsById?.[values.promptId];

                    if (!values.promptId) {
                      return (
                        <Banner tone="warning">
                          No prompt is assigned, so the Generate button is
                          hidden on the storefront and customers cannot create
                          artwork for this design.
                        </Banner>
                      );
                    }

                    if (selected && selected.status !== "ACTIVE") {
                      return (
                        <Banner tone="critical" title="This prompt will not run">
                          {`"${selected.name}" is ${selected.status.toLowerCase()}, not active. Only an active prompt runs on the storefront, so the Generate button stays hidden for customers. Set it to Active on the Prompts page.`}
                        </Banner>
                      );
                    }

                    return (
                      <Banner tone="success">
                        {`Customers can generate artwork for this design using "${selected?.name || "the assigned prompt"}".`}
                      </Banner>
                    );
                  })()}

                  <Select
                    label="Status"
                    options={MAPPING_STATUS_OPTIONS}
                    value={values.status}
                    onChange={(value) => setValue("status", value)}
                    helpText="Only active mappings are offered to customers."
                  />
                </FormLayout>
              </BlockStack>
            </Card>
          </InlineGrid>

          <Card>
            <BlockStack gap="400">
              <InlineStack gap="200" blockAlign="center">
                <Badge tone="info">Optional</Badge>
                <Text as="h2" variant="headingMd">
                  Background image
                </Text>
              </InlineStack>

              <Text as="p" tone="subdued">
                A design layer that sits behind the AI artwork. The customer
                never sees or changes it — you can add, replace or remove it at
                any time, and a design without one is complete.
              </Text>

              {backgroundError ? (
                <Banner tone="critical">{backgroundError}</Banner>
              ) : null}

              {values.backgroundImageKey ? (
                <InlineStack gap="400" blockAlign="start" wrap>
                  {backgroundUrl ? (
                    <img
                      src={backgroundUrl}
                      alt="Background layer"
                      width={120}
                      height={120}
                      style={{
                        width: 120,
                        height: 120,
                        objectFit: "cover",
                        borderRadius: "var(--p-border-radius-200)",
                        border: "var(--p-border-width-025) solid var(--p-color-border)",
                        background: "var(--p-color-bg-surface-secondary)",
                      }}
                    />
                  ) : null}

                  <BlockStack gap="200">
                    <Text as="p" fontWeight="semibold">
                      {values.backgroundImageName || "Background image"}
                    </Text>
                    <Button onClick={removeBackground} tone="critical" variant="plain">
                      Remove background
                    </Button>
                  </BlockStack>
                </InlineStack>
              ) : (
                <Text as="p" tone="subdued">
                  No background image. The Gelato template supplies its own.
                </Text>
              )}

              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                disabled={backgroundBusy}
                onChange={(event) => {
                  uploadBackground(event.target.files?.[0]);
                  // Cleared so choosing the same file twice still fires.
                  event.target.value = "";
                }}
                aria-label="Upload a background image"
              />

              {backgroundBusy ? <Spinner size="small" /> : null}

              {values.backgroundImageKey ? (
                <Select
                  label="Which placeholder the background fills"
                  options={[
                    { label: "— Not placed in the template —", value: "" },
                    ...placeholderOptions,
                  ]}
                  value={values.backgroundPlaceholderName}
                  onChange={(value) => setValue("backgroundPlaceholderName", value)}
                  helpText="Leave unset if the template already includes the background."
                />
              ) : null}
            </BlockStack>
          </Card>

          <Card>
            <BlockStack gap="400">
              <InlineStack gap="200" blockAlign="center">
                <Badge tone="info">Reference</Badge>
                <Text as="h2" variant="headingMd">
                  Supplier attributes
                </Text>
              </InlineStack>

              <Text as="p" tone="subdued">
                Gelato&rsquo;s commercial details for this product, kept with the
                design so they are in one place. Stored for reference; nothing
                here changes what is printed.
              </Text>

              <FormLayout>
                <FormLayout.Group>
                  <TextField
                    label="Stock Keeping Unit"
                    value={values.supplierSku}
                    onChange={(value) => setValue("supplierSku", value)}
                    autoComplete="off"
                    placeholder="MUG-11OZ-WHITE"
                  />
                  <TextField
                    label="Mock-up template"
                    value={values.mockupTemplate}
                    onChange={(value) => setValue("mockupTemplate", value)}
                    autoComplete="off"
                  />
                </FormLayout.Group>

                <TextField
                  label="Print file requirements"
                  value={values.printFileRequirements}
                  onChange={(value) => setValue("printFileRequirements", value)}
                  multiline={2}
                  autoComplete="off"
                  placeholder="2000 x 2000px, 300 DPI, 3mm bleed"
                />

                <FormLayout.Group>
                  <TextField
                    label="Pricing rules"
                    value={values.pricingRules}
                    onChange={(value) => setValue("pricingRules", value)}
                    multiline={2}
                    autoComplete="off"
                    helpText="JSON, or plain notes."
                  />
                  <TextField
                    label="Shipping rules"
                    value={values.shippingRules}
                    onChange={(value) => setValue("shippingRules", value)}
                    multiline={2}
                    autoComplete="off"
                    helpText="JSON, or plain notes."
                  />
                </FormLayout.Group>
              </FormLayout>
            </BlockStack>
          </Card>

          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between" blockAlign="center" gap="300">
                <InlineStack gap="200" blockAlign="center">
                  <Badge tone="info">Step 5</Badge>
                  <Text as="h2" variant="headingMd">
                    Layers
                  </Text>
                </InlineStack>

                <Button
                  onClick={() => {
                    if (!template) return;
                    setValue(
                      "layers",
                      JSON.stringify(seedLayersFromTemplate(template, layers)),
                    );
                  }}
                  disabled={!template}
                >
                  Re-seed from template
                </Button>
              </InlineStack>

              <Text as="p" tone="subdued">
                Gelato names each element but does not publish its position,
                font or colour, so the layout is set here. Coordinates are
                fractions of the product image, so one setting renders correctly
                at every size. What you configure is exactly what the customer
                sees on the canvas.
              </Text>

              {layers.length === 0 ? (
                <Box padding="400" background="bg-surface-secondary" borderRadius="200">
                  <Text as="p" tone="subdued">
                    No layers yet. Load a Gelato template in Step 2 and they are
                    created automatically.
                  </Text>
                </Box>
              ) : (
                <InlineGrid columns={{ xs: 1, lg: 2 }} gap="500">
                  <BlockStack gap="300">
                    <LayerPreview
                      layers={layers}
                      productImageUrl={values.shopifyProductImageUrl}
                      selectedName={selectedLayerName}
                      onSelect={setSelectedLayerName}
                    />

                    <BlockStack gap="200">
                      {layers.map((layer) => (
                        <LayerRow
                          key={layer.name}
                          layer={layer}
                          selected={layer.name === selectedLayerName}
                          onSelect={() => setSelectedLayerName(layer.name)}
                          onMove={(direction) =>
                            setValue(
                              "layers",
                              JSON.stringify(
                                reorderLayer(layers, layer.name, direction),
                              ),
                            )
                          }
                        />
                      ))}
                    </BlockStack>
                  </BlockStack>

                  {selectedLayer ? (
                    <LayerEditor
                      layer={selectedLayer}
                      onChange={(patch) => updateLayer(selectedLayer.name, patch)}
                    />
                  ) : (
                    <Box padding="400" background="bg-surface-secondary" borderRadius="200">
                      <Text as="p" tone="subdued">
                        Select a layer to edit it.
                      </Text>
                    </Box>
                  )}
                </InlineGrid>
              )}
            </BlockStack>
          </Card>


          <InlineStack align="end" gap="200">
            <Button url="/app/mappings">Cancel</Button>
            <Button submit variant="primary" loading={saving}>
              {isNew ? "Create mapping" : "Save mapping"}
            </Button>
          </InlineStack>
        </BlockStack>
      </Form>
    </Page>
  );
}
