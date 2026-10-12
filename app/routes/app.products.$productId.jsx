import {
  Page,
  Card,
  Text,
  BlockStack,
  InlineStack,
  InlineGrid,
  Box,
  Badge,
  Button,
  FormLayout,
  TextField,
  Select,
} from "@shopify/polaris";
import { useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";

export async function loader({ request, params }) {
  const { admin } = await authenticate.admin(request);
  const productId = params.productId;

  if (!productId) {
    throw new Response("Product ID is required", { status: 400 });
  }

  const response = await admin.graphql(
    `
      query ProductConfiguration($id: ID!) {
        product(id: $id) {
          id
          title
          handle
          description
          productType
          status
          vendor
          featuredImage {
            url
            altText
          }
          variants(first: 20) {
            nodes {
              id
              title
              price
              sku
            }
          }
        }
      }
    `,
    { variables: { id: `gid://shopify/Product/${productId}` } },
  );

  const responseJson = await response.json();
  const product = responseJson?.data?.product;

  if (!product) {
    throw new Response("Product was not found", { status: 404 });
  }

  return { product };
}

function statusTone(status) {
  if (status === "ACTIVE") return "success";
  if (status === "DRAFT") return "attention";
  if (status === "ARCHIVED") return "critical";

  return "info";
}

function InfoRow({ label, value }) {
  return (
    <div className="mt-list-row">
      <InlineStack align="space-between" blockAlign="center" gap="300">
        <Text as="p" tone="subdued">
          {label}
        </Text>
        <Text as="p" fontWeight="semibold">
          {value}
        </Text>
      </InlineStack>
    </div>
  );
}

export default function ProductConfiguration() {
  const { product } = useLoaderData();
  const variants = product.variants?.nodes || [];

  return (
    <Page
      title={`Configure ${product.title}`}
      subtitle="Review the Shopify product and prepare the MagikToon personalization settings."
      backAction={{ content: "Products", url: "/app/products" }}
      primaryAction={{ content: "Map Gelato template", url: "/app/mappings" }}
    >
      <div className="mt-page-shell">
        <BlockStack gap="500">
          <section className="mt-page-hero">
            <div className="mt-hero-copy">
              <Badge tone={statusTone(product.status)}>{product.status}</Badge>
              <h1>{product.title}</h1>
              <p>
                Set the product theme, generation model, output resolution, and
                Gelato placement details before activating personalization.
              </p>
              <InlineStack gap="200">
                <Button variant="primary" url="/app/mappings">
                  Choose template
                </Button>
                <Button url="/app/prompts">Review prompts</Button>
              </InlineStack>
            </div>

            <div className="mt-hero-panel">
              <BlockStack gap="100">
                <Text as="p" tone="subdued">
                  Variants
                </Text>
                <Text as="p" variant="heading2xl">
                  {variants.length}
                </Text>
              </BlockStack>
              <BlockStack gap="100">
                <Text as="p" tone="subdued">
                  Product type
                </Text>
                <Text as="p" variant="headingMd">
                  {product.productType || "Not specified"}
                </Text>
              </BlockStack>
            </div>
          </section>

          <InlineGrid columns={{ xs: 1, md: "minmax(280px, .8fr) minmax(0, 1.2fr)" }} gap="400">
            <Card>
              <BlockStack gap="400">
                {product.featuredImage?.url ? (
                  <img
                    src={product.featuredImage.url}
                    alt={product.featuredImage.altText || product.title}
                    className="mt-product-preview"
                    style={{ height: 300 }}
                  />
                ) : (
                  <Box padding="800" background="bg-surface-secondary" borderRadius="200">
                    <Text as="p" variant="heading2xl" alignment="center">
                      {product.title.charAt(0)}
                    </Text>
                  </Box>
                )}

                <BlockStack gap="200">
                  <InfoRow label="Shopify product ID" value={product.id.split("/").pop()} />
                  <InfoRow label="Handle" value={product.handle} />
                  <InfoRow label="Vendor" value={product.vendor || "Not specified"} />
                </BlockStack>

                {variants.length > 0 ? (
                  <BlockStack gap="200">
                    <Text as="h2" variant="headingMd">
                      Variants
                    </Text>
                    {variants.slice(0, 4).map((variant) => (
                      <InlineStack key={variant.id} align="space-between" blockAlign="center">
                        <Text as="p">{variant.title}</Text>
                        <Text as="p" tone="subdued">
                          {variant.sku || variant.price}
                        </Text>
                      </InlineStack>
                    ))}
                  </BlockStack>
                ) : null}
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="400">
                <BlockStack gap="100">
                  <Text as="h2" variant="headingLg">
                    Personalization settings
                  </Text>
                  <Text as="p" tone="subdued">
                    Saving is still intentionally disabled here until the database write path is connected.
                  </Text>
                </BlockStack>

                <FormLayout>
                  <TextField label="Theme name" placeholder="Example: Icon fashion magazine" autoComplete="off" />
                  <TextField
                    label="AI prompt"
                    multiline={6}
                    placeholder="Enter the product-specific Gemini prompt"
                    autoComplete="off"
                  />
                  <Select
                    label="AI model"
                    options={[
                      { label: "Gemini Flash", value: "gemini-flash" },
                      { label: "Gemini 3 Pro", value: "gemini-3-pro" },
                    ]}
                    value="gemini-flash"
                  />
                  <Select
                    label="Output resolution"
                    options={[
                      { label: "1K", value: "1K" },
                      { label: "2K", value: "2K" },
                      { label: "4K", value: "4K" },
                    ]}
                    value="2K"
                  />
                  <TextField label="Gelato template ID" placeholder="Enter Gelato template ID" autoComplete="off" />
                  <TextField label="Placement areas" placeholder="Example: front_cover, back_cover" autoComplete="off" />
                  <Select
                    label="Editable text through Gelato"
                    options={[
                      { label: "Disabled", value: "false" },
                      { label: "Enabled", value: "true" },
                    ]}
                    value="false"
                  />
                  <Button
                    variant="primary"
                    onClick={() => {
                      window.alert("Database saving will be enabled after the ProductConfiguration write path is connected.");
                    }}
                  >
                    Save configuration
                  </Button>
                </FormLayout>
              </BlockStack>
            </Card>
          </InlineGrid>
        </BlockStack>
      </div>
    </Page>
  );
}
