import {
  Page,
  Card,
  Text,
  BlockStack,
  InlineStack,
  Box,
  Badge,
  Button,
  Thumbnail,
} from "@shopify/polaris";
import { useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import { listShopifyProducts } from "../lib/shopify-products.server";

export async function loader({ request }) {
  const { admin } = await authenticate.admin(request);

  // Every product, not the first page of them.
  //
  // This route used to run its own `products(first: 50)` with no cursor loop,
  // so a store with more than fifty products lost the rest — and because the
  // query sorts by title, what went missing was the end of the alphabet rather
  // than anything a merchant would think to look for.
  const products = await listShopifyProducts(admin);

  return { products };
}

function statusTone(status) {
  if (status === "ACTIVE") return "success";
  if (status === "DRAFT") return "attention";
  if (status === "ARCHIVED") return "critical";

  return "info";
}

function shortProductId(productId) {
  return String(productId || "").split("/").pop();
}

export default function Products() {
  const { products } = useLoaderData();

  return (
    <Page
      title="Product configurations"
      subtitle="Select a Shopify product and configure its MagikToon theme, prompt, AI model, resolution, and Gelato mapping."
      primaryAction={{ content: "Map Gelato templates", url: "/app/mappings" }}
      backAction={{ content: "Dashboard", url: "/app" }}
    >
      <div className="mt-page-shell">
      <BlockStack gap="500">
        <section className="mt-page-hero">
          <div className="mt-hero-copy">
            <Badge tone="info">Catalog setup</Badge>
            <h1>Choose the products customers can personalize</h1>
            <p>
              Start from Shopify inventory, then attach each product to the right prompt,
              generation settings, and Gelato production template.
            </p>
            <InlineStack gap="200">
              <Button variant="primary" url="/app/mappings">Map templates</Button>
              <Button url="/app/prompts">Manage prompts</Button>
            </InlineStack>
          </div>

          <div className="mt-hero-panel">
            <BlockStack gap="100">
              <Text as="p" tone="subdued">
                Shopify products
              </Text>
              <Text as="p" variant="heading2xl">
                {products.length}
              </Text>
            </BlockStack>
            <BlockStack gap="100">
              <Text as="p" tone="subdued">
                Next step
              </Text>
              <Text as="p" variant="headingMd">
                Configure product details
              </Text>
            </BlockStack>
          </div>
        </section>

        <Card>
          <BlockStack gap="400">
            <InlineStack align="space-between" blockAlign="center" gap="300">
              <Text as="h2" variant="headingLg">
                Products
              </Text>
              <Badge tone="info">Sorted by Shopify title</Badge>
            </InlineStack>

            {products.length === 0 ? (
              <Box padding="600" background="bg-surface-secondary" borderRadius="200">
                <BlockStack gap="200" inlineAlign="center">
                  <Text as="p" variant="headingMd">
                    No Shopify products found
                  </Text>
                  <Text as="p" tone="subdued" alignment="center">
                    Add products in Shopify, then return here to configure them.
                  </Text>
                </BlockStack>
              </Box>
            ) : (
              <BlockStack gap="300">
                {products.map((product) => {
                  const firstVariant = product.variants?.nodes?.[0];

                  return (
                    <div key={product.id} className="mt-list-row">
                      <InlineStack align="space-between" blockAlign="center" gap="400">
                        <InlineStack gap="300" blockAlign="center">
                          {product.featuredImage?.url ? (
                            <Thumbnail
                              source={product.featuredImage.url}
                              alt={product.featuredImage.altText || product.title}
                              size="large"
                            />
                          ) : (
                            <Box padding="300" background="bg-surface" borderRadius="200">
                              <Text as="p" fontWeight="semibold">
                                {product.title.charAt(0)}
                              </Text>
                            </Box>
                          )}

                          <BlockStack gap="100">
                            <Text as="p" fontWeight="semibold">
                              {product.title}
                            </Text>
                            <Text as="p" tone="subdued">
                              /products/{product.handle} · {product.productType || "No product type"} · {firstVariant?.title || "Default variant"}
                            </Text>
                          </BlockStack>
                        </InlineStack>

                        <InlineStack gap="300" blockAlign="center">
                          <Badge tone={statusTone(product.status)}>{product.status || "Unknown"}</Badge>
                          <Button url={`/app/products/${shortProductId(product.id)}`}>Configure</Button>
                        </InlineStack>
                      </InlineStack>
                    </div>
                  );
                })}
              </BlockStack>
            )}
          </BlockStack>
        </Card>
      </BlockStack>
      </div>
    </Page>
  );
}
