import {
  Page,
  Card,
  Text,
  Button,
  BlockStack,
  InlineStack,
  InlineGrid,
  Box,
  Badge,
  ProgressBar,
} from "@shopify/polaris";
import { useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { listShopifyProducts } from "../lib/shopify-products.server";

export async function loader({ request }) {
  const { admin, session } = await authenticate.admin(request);

  const response = await admin.graphql(`
    query DashboardHome {
      shop {
        name
        myshopifyDomain
      }
    }
  `);

  const responseJson = await response.json();

  if (responseJson.errors) {
    console.error(responseJson.errors);
    throw new Response("Unable to load dashboard data.", { status: 500 });
  }

  const data = responseJson?.data || {};

  // Counted through the paginating helper rather than a `first: 50` query.
  // The metric below renders this length, so a capped fetch reported exactly
  // fifty on any larger store — a number that looks real and is not.
  //
  // A failure leaves the count at zero rather than taking the dashboard down
  // with it; every other panel on this page still has something to say.
  let products = [];

  try {
    products = await listShopifyProducts(admin);
  } catch (error) {
    console.error("[dashboard] products could not be counted:", error.message);
  }

  // `ProductMapping` is the table the storefront and the orders/create webhook
  // actually read, so the dashboard counts that — not the legacy
  // `GelatoTemplate` / `ProductConfiguration` tables it used to report on.
  const [configurations, promptCount, templateCount, activeCount, pendingOrderCount, generationCount] =
    await Promise.all([
      db.productConfiguration.findMany({
        where: { shop: session.shop },
        include: { prompt: true, aiModel: true },
        orderBy: { updatedAt: "desc" },
        take: 6,
      }),
      db.prompt.count({ where: { shop: session.shop } }),
      db.productMapping.count({ where: { shop: session.shop } }),
      db.productMapping.count({ where: { shop: session.shop, status: "ACTIVE" } }),
      db.pendingOrder.count({ where: { shop: session.shop, status: "PENDING_REVIEW" } }),
      db.generationLog.count({ where: { shop: session.shop } }),
    ]);

  const setupComplete = [products.length > 0, promptCount > 0, templateCount > 0, activeCount > 0].filter(Boolean).length;

  return {
    shopName: data.shop?.name || session.shop,
    shopDomain: data.shop?.myshopifyDomain || session.shop,
    products,
    configurations,
    promptCount,
    templateCount,
    pendingOrderCount,
    generationCount,
    activeCount,
    setupPercentage: Math.round((setupComplete / 4) * 100),
  };
}

function statusTone(status) {
  if (status === "ACTIVE") return "success";
  if (status === "MODIFY") return "warning";

  return "attention";
}

function Metric({ label, value, note, tone = "info" }) {
  return (
    <div className="mt-home-metric">
      <InlineStack align="space-between" blockAlign="center">
        <Text as="p" tone="subdued">
          {label}
        </Text>
        <Badge tone={tone}>{note}</Badge>
      </InlineStack>
      <Text as="p" variant="heading2xl">
        {value}
      </Text>
    </div>
  );
}

function ChecklistItem({ complete, label, url }) {
  return (
    <Box padding="300" background="bg-surface-secondary" borderRadius="200">
      <InlineStack align="space-between" blockAlign="center" gap="300">
        <InlineStack gap="300" blockAlign="center">
          <Badge tone={complete ? "success" : "attention"}>{complete ? "Done" : "Todo"}</Badge>
          <Text as="p" fontWeight="semibold">
            {label}
          </Text>
        </InlineStack>
        <Button url={url}>Open</Button>
      </InlineStack>
    </Box>
  );
}

export default function DashboardHome() {
  const {
    shopName,
    shopDomain,
    products,
    configurations,
    promptCount,
    templateCount,
    pendingOrderCount,
    generationCount,
    activeCount,
    setupPercentage,
  } = useLoaderData();

  return (
    <Page>
      <style>{dashboardCss}</style>
      <div className="mt-page-shell">
      <BlockStack gap="500">
        <section className="mt-home-hero">
          <div className="mt-home-hero-copy">
            <Badge tone="success">MagikToon dashboard</Badge>
            <h1>Good to see you, {shopName}</h1>
            <p>
              Build the personalized product flow from one place: Shopify products,
              AI prompts, Gelato templates, and approval-ready orders.
            </p>
            <div className="mt-home-actions">
              <Button variant="primary" url="/app/mappings">
                Map Gelato templates
              </Button>
              <Button url="/app/products">Configure products</Button>
              <Button url="/app/prompts">Manage prompts</Button>
            </div>
          </div>

          <div className="mt-home-command">
            <div className="mt-home-command-top">
              <span>Launch readiness</span>
              <strong>{setupPercentage}%</strong>
            </div>
            <ProgressBar progress={setupPercentage} tone="success" />
            <div className="mt-home-command-grid">
              <span>Store</span>
              <b>{shopDomain}</b>
              <span>Active themes</span>
              <b>{activeCount}</b>
              <span>Reviews</span>
              <b>{pendingOrderCount}</b>
            </div>
          </div>
        </section>

        <InlineGrid columns={{ xs: 1, sm: 2, lg: 4 }} gap="400">
          <Metric label="Shopify products" value={products.length} note="Store" />
          <Metric label="Configured themes" value={configurations.length} note={`${activeCount} active`} tone={activeCount ? "success" : "attention"} />
          <Metric label="Gelato templates" value={templateCount} note="Mapped" tone={templateCount ? "success" : "attention"} />
          <Metric label="Pending reviews" value={pendingOrderCount} note={pendingOrderCount ? "Needs review" : "Clear"} tone={pendingOrderCount ? "critical" : "success"} />
        </InlineGrid>

        <InlineGrid columns={{ xs: 1, md: 2 }} gap="400">
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between" blockAlign="center">
                <Text as="h2" variant="headingLg">
                  Launch checklist
                </Text>
                <Text as="p" variant="headingMd">
                  {setupPercentage}%
                </Text>
              </InlineStack>
              <ProgressBar progress={setupPercentage} tone="success" />
              <ChecklistItem complete={products.length > 0} label="Connect Shopify products" url="/app/products" />
              <ChecklistItem complete={promptCount > 0} label="Create an AI prompt" url="/app/prompts" />
              <ChecklistItem complete={templateCount > 0} label="Map a Gelato template" url="/app/mappings" />
              <ChecklistItem complete={activeCount > 0} label="Activate your first theme" url="/app/products" />
            </BlockStack>
          </Card>

          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between" blockAlign="center">
                <Text as="h2" variant="headingLg">
                  Workspace status
                </Text>
                <Badge tone="success">Live</Badge>
              </InlineStack>
              <StatusRow label="Shopify connection" value="Connected" good />
              <StatusRow label="AI prompts" value={`${promptCount} saved`} good={promptCount > 0} />
              <StatusRow label="Gelato mappings" value={`${templateCount} saved`} good={templateCount > 0} />
              <StatusRow label="Generation records" value={`${generationCount} total`} good />
            </BlockStack>
          </Card>
        </InlineGrid>

        <InlineGrid columns={{ xs: 1, md: 3 }} gap="400">
          <QuickAction
            label="Step 1"
            title="Choose products"
            text={`${products.length} Shopify products are available for configuration.`}
            url="/app/products"
            button="Open products"
          />
          <QuickAction
            label="Step 2"
            title="Write prompts"
            text={`${promptCount} AI prompts are ready for generation workflows.`}
            url="/app/prompts"
            button="Open prompts"
          />
          <QuickAction
            label="Step 3"
            title="Map templates"
            text={`${templateCount} Gelato templates are connected to your store.`}
            url="/app/mappings"
            button="Open mappings"
          />
        </InlineGrid>

        <Card>
          <BlockStack gap="400">
            <InlineStack align="space-between" blockAlign="center">
              <Text as="h2" variant="headingLg">
                Recent product configurations
              </Text>
              <Button url="/app/products">View all</Button>
            </InlineStack>

            {configurations.length === 0 ? (
              <Box padding="600" background="bg-surface-secondary" borderRadius="200">
                <BlockStack gap="200" inlineAlign="center">
                  <Text as="p" variant="headingMd">
                    No configurations yet
                  </Text>
                  <Text as="p" tone="subdued" alignment="center">
                    Choose a Shopify product to create your first theme.
                  </Text>
                  <Button variant="primary" url="/app/products">
                    Configure a product
                  </Button>
                </BlockStack>
              </Box>
            ) : (
              <BlockStack gap="300">
                {configurations.map((configuration) => (
                  <Box key={configuration.id} padding="300" background="bg-surface-secondary" borderRadius="200">
                    <InlineStack align="space-between" blockAlign="center" gap="400">
                      <BlockStack gap="100">
                        <Text as="p" fontWeight="semibold">
                          {configuration.productTitle}
                        </Text>
                        <Text as="p" tone="subdued">
                          {configuration.prompt?.name || "No prompt"} · {configuration.aiModel?.name || "No model"} · {configuration.outputResolution}
                        </Text>
                      </BlockStack>
                      <InlineStack gap="200" blockAlign="center">
                        <Badge tone={statusTone(configuration.status)}>{configuration.status}</Badge>
                        <Button url={`/app/products/${configuration.id}`}>Open</Button>
                      </InlineStack>
                    </InlineStack>
                  </Box>
                ))}
              </BlockStack>
            )}
          </BlockStack>
        </Card>
      </BlockStack>
      </div>
    </Page>
  );
}

function QuickAction({ label, title, text, url, button }) {
  return (
    <Card>
      <BlockStack gap="300">
        <Badge tone="info">{label}</Badge>
        <BlockStack gap="100">
          <Text as="h3" variant="headingMd">
            {title}
          </Text>
          <Text as="p" tone="subdued">
            {text}
          </Text>
        </BlockStack>
        <Button url={url}>{button}</Button>
      </BlockStack>
    </Card>
  );
}

function StatusRow({ label, value, good }) {
  return (
    <Box padding="300" background="bg-surface-secondary" borderRadius="200">
      <InlineStack align="space-between" blockAlign="center" gap="300">
        <InlineStack gap="200" blockAlign="center">
          <Badge tone={good ? "success" : "attention"}>{good ? "Ready" : "Needs setup"}</Badge>
          <Text as="p" fontWeight="semibold">
            {label}
          </Text>
        </InlineStack>
        <Text as="p" tone="subdued">
          {value}
        </Text>
      </InlineStack>
    </Box>
  );
}

const dashboardCss = `
  .mt-home-hero {
    display: grid;
    grid-template-columns: minmax(0, 1.45fr) minmax(300px, .75fr);
    gap: 20px;
    align-items: stretch;
    padding: 28px;
    border-radius: 12px;
    background:
      radial-gradient(circle at 88% 18%, rgba(0, 128, 96, .16), transparent 30%),
      linear-gradient(135deg, #ffffff 0%, #f3fbf7 58%, #eef6ff 100%);
    border: 1px solid #dfe7e3;
    box-shadow: 0 10px 30px rgba(32, 34, 35, .05);
  }

  .mt-home-hero-copy {
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 14px;
    min-height: 250px;
  }

  .mt-home-hero-copy h1 {
    max-width: 760px;
    margin: 0;
    color: #202223;
    font-size: 42px;
    line-height: 1.08;
    letter-spacing: 0;
  }

  .mt-home-hero-copy p {
    max-width: 680px;
    margin: 0;
    color: #5c5f62;
    font-size: 15px;
    line-height: 1.55;
  }

  .mt-home-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    margin-top: 8px;
  }

  .mt-home-command {
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    gap: 22px;
    padding: 22px;
    border: 1px solid #dfe7e3;
    border-radius: 10px;
    background: rgba(255, 255, 255, .82);
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, .75);
  }

  .mt-home-command-top {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 16px;
  }

  .mt-home-command-top span,
  .mt-home-command-grid span {
    color: #6d7175;
    font-size: 12px;
    font-weight: 650;
  }

  .mt-home-command-top strong {
    color: #008060;
    font-size: 34px;
    line-height: 1;
  }

  .mt-home-command-grid {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 12px 18px;
    padding-top: 4px;
  }

  .mt-home-command-grid b {
    color: #202223;
    font-size: 13px;
    text-align: right;
  }

  .mt-home-metric {
    min-height: 110px;
    padding: 18px;
    border: 1px solid #e1e5e7;
    border-radius: 10px;
    background: #ffffff;
    box-shadow: 0 4px 14px rgba(32, 34, 35, .04);
  }

  .mt-home-metric > p {
    margin-top: 12px;
  }

  @media (max-width: 900px) {
    .mt-home-hero {
      grid-template-columns: 1fr;
      padding: 22px;
    }

    .mt-home-hero-copy {
      min-height: auto;
    }

    .mt-home-hero-copy h1 {
      font-size: 32px;
    }
  }
`;
