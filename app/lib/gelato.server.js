const GELATO_ECOMMERCE_API =
  "https://ecommerce.gelatoapis.com/v1";

const GELATO_PRODUCT_API =
  "https://product.gelatoapis.com/v3";

function getGelatoConfig() {
  const apiKey = process.env.GELATO_API_KEY;
  const storeId = process.env.GELATO_STORE_ID;

  if (!apiKey) {
    throw new Error("GELATO_API_KEY is missing");
  }

  if (!storeId) {
    throw new Error("GELATO_STORE_ID is missing");
  }

  return {
    apiKey,
    storeId,
  };
}

function headers() {
  const { apiKey } = getGelatoConfig();

  return {
    "X-API-KEY": apiKey,
    Accept: "application/json",
    "Content-Type": "application/json",
  };
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      ...headers(),
      ...(options.headers || {}),
    },
  });

  const text = await response.text();

  let data;

  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  if (!response.ok) {
    throw new Error(
      `Gelato API ${response.status}: ${
        typeof data === "string"
          ? data
          : JSON.stringify(data)
      }`
    );
  }

  return data;
}

function extractArray(data) {
  if (Array.isArray(data)) {
    return data;
  }

  return (
    data?.products ||
    data?.items ||
    data?.nodes ||
    data?.results ||
    data?.data ||
    []
  );
}

function getId(item) {
  return (
    item?.id ||
    item?.productId ||
    item?.productUid ||
    item?.uid ||
    ""
  );
}

function getName(item) {
  return (
    item?.name ||
    item?.title ||
    item?.productName ||
    item?.productTitle ||
    getId(item)
  );
}

function getPreview(item) {
  return (
    item?.previewUrl ||
    item?.preview_url ||
    item?.mockupUrl ||
    item?.mockup_url ||
    item?.thumbnailUrl ||
    item?.thumbnail_url ||
    item?.imageUrl ||
    item?.image_url ||
    item?.preview?.url ||
    ""
  );
}

export function normalizeGelatoProduct(item) {
  return {
    id: getId(item),
    templateId:
      item?.templateId ||
      item?.template_id ||
      item?.id ||
      "",
    productId:
      item?.productId ||
      item?.productUid ||
      item?.uid ||
      item?.id ||
      "",
    variantId:
      item?.variantId ||
      item?.variants?.[0]?.id ||
      item?.variants?.[0]?.variantId ||
      "",
    name: getName(item),
    previewUrl: getPreview(item),
    title: getName(item),
    variants: extractArray(item?.variants),
    productType: item?.productType || item?.type || "",
    source: item?.source || "product",
    raw: item,
  };
}

export async function listGelatoProducts({
  offset = 0,
  limit = 100,
} = {}) {
  const { storeId } = getGelatoConfig();

  const url =
    `${GELATO_ECOMMERCE_API}/stores/` +
    `${encodeURIComponent(storeId)}/products` +
    `?offset=${offset}&limit=${limit}`;

  const data = await requestJson(url);

  return {
    items: extractArray(data)
      .map(normalizeGelatoProduct)
      .filter((item) => item.id),
    raw: data,
  };
}

export async function getGelatoProduct(productId) {
  const { storeId } = getGelatoConfig();

  if (!productId) {
    throw new Error("Gelato product ID is required");
  }

  const url =
    `${GELATO_ECOMMERCE_API}/stores/` +
    `${encodeURIComponent(storeId)}/products/` +
    `${encodeURIComponent(productId)}`;

  const data = await requestJson(url);

  return normalizeGelatoProduct(data);
}

export async function getGelatoTemplate(templateId) {
  if (!templateId) {
    throw new Error("Gelato template ID is required");
  }

  const data = await requestJson(
    `${GELATO_ECOMMERCE_API}/templates/` +
      `${encodeURIComponent(templateId)}`
  );

  return normalizeGelatoProduct({
    ...data,
    id: data?.id || templateId,
    templateId: data?.id || templateId,
    source: "template",
  });
}

export async function listGelatoTemplates({
  offset = 0,
  limit = 100,
} = {}) {
  const templateIds = String(
    process.env.GELATO_TEMPLATE_IDS || ""
  )
    .split(",")
    .map((templateId) => templateId.trim())
    .filter(Boolean);

  if (templateIds.length > 0) {
    const templates = await Promise.all(
      templateIds.map((templateId) =>
        getGelatoTemplate(templateId)
      )
    );

    return {
      items: templates.filter((item) => item.id),
      source: "templates",
      raw: templates,
    };
  }

  const products = await listGelatoProducts({
    offset,
    limit,
  });

  return {
    items: products.items.map((product) => ({
      ...product,
      source: "store-product",
    })),
    source: "store-products",
    raw: products.raw,
  };
}

export async function getCatalogProduct(productUid) {
  if (!productUid) {
    throw new Error("Gelato catalog product UID is required");
  }

  const url =
    `${GELATO_PRODUCT_API}/products/` +
    `${encodeURIComponent(productUid)}`;

  const data = await requestJson(url);

  return normalizeGelatoProduct(data);
}

export async function renderMockup({
  gelatoTemplateId,
  artworkUrl,
  placeholderName = "ImageFront",
  placementArea = "front",
  textFieldValues = {},
}) {
  if (!gelatoTemplateId) {
    throw new Error("Gelato template ID is required");
  }

  if (!artworkUrl) {
    throw new Error("Artwork URL is required");
  }

  const data = await requestJson(
    `${GELATO_ECOMMERCE_API}/templates/mockups`,
    {
      method: "POST",
      body: JSON.stringify({
        templateId: gelatoTemplateId,
        placeholders: {
          [placeholderName]: {
            imageUrl: artworkUrl,
          },
        },
        placementArea,
        personalization: textFieldValues,
      }),
    }
  );

  return {
    mockupUrl:
      data?.mockupUrl ||
      data?.previewUrl ||
      data?.mockup_url ||
      null,
    printFileUrl:
      data?.printFileUrl ||
      data?.print_file_url ||
      null,
    raw: data,
  };
}
export async function testGelatoConnection() {
  return listGelatoProducts({
    offset: 0,
    limit: 1,
  });
}
