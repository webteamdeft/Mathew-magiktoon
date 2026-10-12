import { useState } from "react";
import {
  Page,
  Card,
  Text,
  Badge,
  Button,
  Banner,
  Box,
  Modal,
  Divider,
  Thumbnail,
  BlockStack,
  InlineStack,
  InlineGrid,
  ProgressBar,
  EmptyState,
} from "@shopify/polaris";
import { Link, useFetcher, useLoaderData } from "react-router";

import { authenticate } from "../shopify.server";
import { listMappings, deleteMapping, setMappingStatus } from "../lib/mappings.server";
import { resolveTemplatePreviewUrl } from "../lib/gelato-preview.server";
import { asArray } from "../lib/normalize";
import { fulfillmentMode, fulfillmentModeLabel, statusTone } from "../lib/mapping-validation";

/** Milestone 3 asks for three products wired end to end. */
const TARGET_MAPPING_COUNT = 3;

export async function loader({ request }) {
  const { session } = await authenticate.admin(request);

  const mappings = asArray(await listMappings(session.shop));

  // Preview URLs are resolved HERE rather than by an <img> pointing at one of
  // our routes. App Bridge attaches the admin session token to fetch/XHR only,
  // never to an image request, so an authenticated image route answers a
  // browser <img> with the App Bridge bootstrap document instead of a picture.
  //
  // Gelato's URLs are presigned for 24 hours and this page is re-rendered on
  // every visit, so a freshly resolved URL is always good by the time it is
  // used.
  const withPreviews = await Promise.all(
    mappings.map(async (mapping) => ({
      ...mapping,
      previewUrl:
        (await resolveTemplatePreviewUrl(mapping)) ||
        mapping.shopifyProductImageUrl ||
        "",
    })),
  );

  return Response.json({ mappings: withPreviews });
}

export async function action({ request }) {
  const { session } = await authenticate.admin(request);

  const formData = await request.formData();
  const intent = String(formData.get("intent") || "");
  const id = String(formData.get("id") || "");

  if (intent === "delete") {
    const result = await deleteMapping(session.shop, id);

    return Response.json(
      result.ok
        ? { ok: true, message: "Mapping deleted." }
        : { ok: false, error: result.error },
      { status: result.ok ? 200 : 400 },
    );
  }

  if (intent === "set-status") {
    const result = await setMappingStatus(
      session.shop,
      id,
      String(formData.get("status") || ""),
    );

    return Response.json(
      result.ok
        ? { ok: true, message: `Mapping is now ${result.mapping.status.toLowerCase()}.` }
        : { ok: false, error: result.error },
      { status: result.ok ? 200 : 400 },
    );
  }

  return Response.json({ ok: false, error: "Unknown action." }, { status: 400 });
}

export default function MappingsIndex() {
  const { mappings: loadedMappings } = useLoaderData();
  const fetcher = useFetcher();

  const [pendingDelete, setPendingDelete] = useState(null);

  const mappings = asArray(loadedMappings);
  const activeCount = mappings.filter((mapping) => mapping.status === "ACTIVE").length;

  const busy = fetcher.state !== "idle";
  const message = fetcher.data?.message || "";
  const error = fetcher.data?.error || "";

  function updateStatus(mapping, status) {
    fetcher.submit(
      { intent: "set-status", id: mapping.id, status },
      { method: "post" },
    );
  }

  function confirmDelete() {
    if (!pendingDelete) return;

    fetcher.submit(
      { intent: "delete", id: pendingDelete.id },
      { method: "post" },
    );

    setPendingDelete(null);
  }

  return (
    <Page
      title="Product mappings"
      subtitle="Connect each Shopify product to its own Gelato product, variant and template."
      primaryAction={{
        content: "Add mapping",
        url: "/app/mappings/new",
      }}
    >
      <BlockStack gap="500">
        {message ? (
          <Banner tone="success" title="Saved">
            {message}
          </Banner>
        ) : null}

        {error ? (
          <Banner tone="critical" title="Something went wrong">
            {error}
          </Banner>
        ) : null}

        <Card>
          <BlockStack gap="300">
            <InlineStack align="space-between" blockAlign="center" gap="400" wrap>
              <BlockStack gap="100">
                <Text as="h2" variant="headingMd">
                  Storefront readiness
                </Text>
                <Text as="p" tone="subdued">
                  {activeCount} of {TARGET_MAPPING_COUNT} products are live for
                  customers. {mappings.length} mapping
                  {mappings.length === 1 ? "" : "s"} saved in total.
                </Text>
              </BlockStack>

              <Badge tone={activeCount >= TARGET_MAPPING_COUNT ? "success" : "attention"}>
                {activeCount >= TARGET_MAPPING_COUNT ? "Ready" : "Setup in progress"}
              </Badge>
            </InlineStack>

            <ProgressBar
              progress={Math.min(
                100,
                Math.round((activeCount / TARGET_MAPPING_COUNT) * 100),
              )}
              tone={activeCount >= TARGET_MAPPING_COUNT ? "success" : "primary"}
            />
          </BlockStack>
        </Card>

        <Card padding="0">
          {mappings.length === 0 ? (
            <Box padding="500">
              <EmptyState
                heading="No mappings yet"
                action={{ content: "Add your first mapping", url: "/app/mappings/new" }}
                image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
              >
                <p>
                  Map a Shopify product to a Gelato product, variant and template
                  so customers can personalise it and orders can be fulfilled
                  automatically.
                </p>
              </EmptyState>
            </Box>
          ) : (
            <BlockStack gap="0">
              {mappings.map((mapping, index) => (
                <Box key={mapping.id} padding="400">
                  <InlineGrid
                    columns={{ xs: 1, md: "auto 1fr auto" }}
                    gap="400"
                    alignItems="center"
                  >
                    <Thumbnail
                      source={mapping.previewUrl || ""}
                      alt={mapping.shopifyProductTitle || "Product preview"}
                      size="large"
                    />

                    <BlockStack gap="150">
                      <InlineStack gap="200" blockAlign="center" wrap>
                        <Text as="h3" variant="headingMd">
                          {mapping.shopifyProductTitle || "Untitled product"}
                        </Text>
                        <Badge tone={statusTone(mapping.status)}>
                          {mapping.status}
                        </Badge>
<Badge
                          tone={
                            fulfillmentMode(mapping) === "catalog"
                              ? "info"
                              : "critical"
                          }
                        >
                          {fulfillmentModeLabel(mapping)}
                        </Badge>
                      </InlineStack>

                      <Text as="p" tone="subdued">
                        Gelato product:{" "}
                        {mapping.gelatoProductName || mapping.gelatoProductId}
                        {mapping.gelatoVariantName
                          ? ` — ${mapping.gelatoVariantName}`
                          : ""}
                      </Text>

                      <Text as="p" tone="subdued">
{`Product UID: ${mapping.gelatoProductUid || "— none, cannot fulfil"}`}{" "}
                        · Placeholder: {mapping.gelatoPlaceholderName} · Print area:{" "}
                        {mapping.gelatoPrintAreaName}
                      </Text>
                    </BlockStack>

                    <InlineStack gap="200" wrap>
                      <Button
                        onClick={() =>
                          updateStatus(
                            mapping,
                            mapping.status === "ACTIVE" ? "DISABLED" : "ACTIVE",
                          )
                        }
                        loading={busy}
                        variant={mapping.status === "ACTIVE" ? "secondary" : "primary"}
                      >
                        {mapping.status === "ACTIVE" ? "Disable" : "Activate"}
                      </Button>

                      <Button url={`/app/mappings/${mapping.id}`}>Edit</Button>

                      <Button
                        tone="critical"
                        variant="secondary"
                        onClick={() => setPendingDelete(mapping)}
                      >
                        Delete
                      </Button>
                    </InlineStack>
                  </InlineGrid>

                  {index < mappings.length - 1 ? (
                    <Box paddingBlockStart="400">
                      <Divider />
                    </Box>
                  ) : null}
                </Box>
              ))}
            </BlockStack>
          )}
        </Card>

        <Text as="p" tone="subdued">
          Need to check fulfillment? See{" "}
          <Link to="/app/orders">Gelato orders</Link>.
        </Text>
      </BlockStack>

      <Modal
        open={Boolean(pendingDelete)}
        onClose={() => setPendingDelete(null)}
        title="Delete this mapping?"
        primaryAction={{
          content: "Delete mapping",
          destructive: true,
          onAction: confirmDelete,
        }}
        secondaryActions={[
          { content: "Cancel", onAction: () => setPendingDelete(null) },
        ]}
      >
        <Modal.Section>
          <Text as="p">
            {pendingDelete?.shopifyProductTitle || "This product"} will stop
            offering customization on the storefront. Existing orders and saved
            customizations are kept.
          </Text>
        </Modal.Section>
      </Modal>
    </Page>
  );
}
