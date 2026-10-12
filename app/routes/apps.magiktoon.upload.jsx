import db from "../db.server";

export async function loader({ request }) {
  const url = new URL(request.url);
  const productId = String(url.searchParams.get("product_id") || "").trim();
  const shop = String(url.searchParams.get("shop") || "").trim();

  if (productId && shop) {
    const productGid = productId.startsWith("gid://")
      ? productId
      : `gid://shopify/Product/${productId}`;

    const configuration = await db.productConfiguration.findFirst({
      where: {
        shop,
        OR: [
          { shopifyProductId: productId },
          { shopifyProductId: productGid },
        ],
      },
      include: {
        gelatoTemplates: {
          orderBy: { createdAt: "desc" },
          take: 1,
        },
      },
    });

    const template = configuration?.gelatoTemplates?.[0];

    return Response.json({
      ok: Boolean(configuration),
      productTitle: configuration?.productTitle || "",
      gelatoTemplateId: configuration?.gelatoTemplateId || template?.gelatoTemplateId || "",
      gelatoTemplateVariantId:
        configuration?.gelatoTemplateVariantId ||
        template?.gelatoTemplateVariantId ||
        "",
      gelatoTemplatePreviewUrl:
        configuration?.gelatoTemplatePreviewUrl ||
        template?.templatePreviewUrl ||
        "",
      gelatoPlaceholderName:
        configuration?.gelatoPlaceholderName ||
        "ImageFront",
      gelatoPlacementArea:
        configuration?.gelatoPlacementArea ||
        "front",
      templateName:
        template?.templateName ||
        configuration?.productTitle ||
        "",
    });
  }

  return Response.json({
    ok: true,
    route: "apps.magiktoon.upload",
    method: request.method,
  });
}

export async function action({ request }) {
  console.log("[proxy-health] POST:", request.url);

  return Response.json({
    ok: true,
    route: "apps.magiktoon.upload",
    method: request.method,
  });
}
