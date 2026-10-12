import {
  Page,
  Card,
  Text,
  Badge,
  Button,
  Banner,
  Box,
  Divider,
  Thumbnail,
  BlockStack,
  InlineStack,
  InlineGrid,
  EmptyState,
  Modal,
  Tabs,
  TextField,
} from "@shopify/polaris";
import { ImageIcon, MaximizeIcon, ExternalIcon } from "@shopify/polaris-icons";
import { useEffect, useState } from "react";
import { useFetcher, useLoaderData } from "react-router";

import { authenticate } from "../shopify.server";
import {
  approveOrderItems,
  listGelatoOrderItems,
  processOrderCreated,
  rejectOrderItems,
  retryOrderItems,
} from "../lib/fulfillment.server";
import {
  getShopSettings,
  setOrderReviewEnabled,
} from "../lib/shop-settings.server";
import { asArray } from "../lib/normalize";
import { describeConfigSnapshot } from "../lib/config-snapshot";
import {
  FULFILLMENT_STATUS,
  FULFILLMENT_STATUS_LABELS,
  MAX_FULFILLMENT_ATTEMPTS,
  fulfillmentTone,
  isAwaitingReview,
  isRetryable,
} from "../lib/fulfillment-status";

async function loadOrderForFulfillment(admin, shopifyOrderId) {
  const id = String(shopifyOrderId || "").trim();

  if (!id) {
    return null;
  }

  const gid = id.startsWith("gid://") ? id : `gid://shopify/Order/${id}`;
  let data;

  try {
    const response = await admin.graphql(
      `#graphql
        query OrderForFulfillment($id: ID!) {
          order(id: $id) {
            id
            legacyResourceId
            currencyCode
            shippingAddress {
              name
              firstName
              lastName
              company
              address1
              address2
              city
              zip
              provinceCode
              countryCodeV2
              phone
            }
          }
        }
      `,
      { variables: { id: gid } },
    );

    data = await response.json();
  } catch (error) {
    console.error(
      "[orders] could not load Shopify order for fulfillment:",
      error,
    );
    return null;
  }

  if (data?.errors?.length || !data?.data?.order) {
    console.error(
      "[orders] could not load Shopify order for fulfillment:",
      data?.errors,
    );
    return null;
  }

  const order = data.data.order;

  return {
    id: order.legacyResourceId || id,
    currency: order.currencyCode,
    shippingAddress: order.shippingAddress,
  };
}

function graphqlOrderToWebhookOrder(order) {
  return {
    id: order.legacyResourceId || order.id,
    name: order.name,
    currency: order.currencyCode,
    shippingAddress: order.shippingAddress,
    line_items: asArray(order.lineItems?.nodes).map((lineItem) => ({
      id: String(lineItem.id || "")
        .split("/")
        .pop(),
      product_id: lineItem.product?.legacyResourceId,
      quantity: lineItem.quantity,
      properties: asArray(lineItem.customAttributes).map((attribute) => ({
        name: attribute.key,
        value: attribute.value,
      })),
    })),
  };
}

async function syncRecentShopifyOrders({ admin, shop, baseUrl }) {
  let data;

  try {
    const response = await admin.graphql(
      `#graphql
        query RecentOrdersForGelatoSync {
          orders(first: 25, sortKey: CREATED_AT, reverse: true) {
            nodes {
              id
              legacyResourceId
              name
              currencyCode
              shippingAddress {
                name
                firstName
                lastName
                company
                address1
                address2
                city
                zip
                provinceCode
                countryCodeV2
                phone
              }
              lineItems(first: 50) {
                nodes {
                  id
                  quantity
                  customAttributes {
                    key
                    value
                  }
                  product {
                    legacyResourceId
                  }
                }
              }
            }
          }
        }
      `,
    );

    data = await response.json();
  } catch (error) {
    console.error("[orders] could not sync recent Shopify orders:", error);
    return {
      scanned: 0,
      claimed: 0,
      submitted: 0,
      failed: 0,
      error: error.message || "Could not read recent Shopify orders.",
    };
  }

  if (data?.errors?.length) {
    console.error(
      "[orders] could not sync recent Shopify orders:",
      data.errors,
    );
    return {
      scanned: 0,
      claimed: 0,
      submitted: 0,
      failed: 0,
      error: "Could not read recent Shopify orders.",
    };
  }

  const orders = asArray(data?.data?.orders?.nodes);
  const totals = {
    scanned: orders.length,
    claimed: 0,
    submitted: 0,
    failed: 0,
  };

  for (const order of orders) {
    const result = await processOrderCreated({
      shop,
      order: graphqlOrderToWebhookOrder(order),
      baseUrl,
    });

    totals.claimed += result.claimed || 0;
    totals.submitted += result.submitted || 0;
    totals.failed += result.failed || 0;
  }

  return totals;
}

export async function loader({ request }) {
  const { session } = await authenticate.admin(request);

  // Signed against the origin serving this request, not the stored one: in
  // development the tunnel host changes on every restart, so a URL persisted
  // with the order points at a host that has since died.
  const items = await listGelatoOrderItems(session.shop, {
    take: 100,
    baseUrl: new URL(request.url).origin,
  });

  // Group by Shopify order so multi-product orders read as one unit.
  const groups = new Map();

  for (const item of asArray(items)) {
    const key = item.shopifyOrderId;

    groups.set(key, {
      shopifyOrderId: key,
      shopifyOrderName: item.shopifyOrderName || `#${key}`,
      gelatoOrderId: item.gelatoOrderId || groups.get(key)?.gelatoOrderId || "",
      createdAt: item.createdAt,
      items: [
        ...(groups.get(key)?.items || []),
        // Only the fields the page renders: the raw record carries payloads and
        // relations that would bloat every response for nothing.
        {
          id: item.id,
          status: item.status,
          attempts: item.attempts,
          quantity: item.quantity,
          lastError: item.lastError,
          artworkUrl: item.artworkUrl,
          previewUrl: item.previewUrl,
          shopifyLineItemId: item.shopifyLineItemId,
          productMapping: item.productMapping,
          configSnapshot: item.configSnapshot,
        },
      ],
    });
  }

  const settings = await getShopSettings(session.shop);

  return Response.json({
    orders: Array.from(groups.values()),
    maxAttempts: MAX_FULFILLMENT_ATTEMPTS,
    orderReviewEnabled: settings.orderReviewEnabled,
  });
}

export async function action({ request }) {
  const { session, admin } = await authenticate.admin(request);

  const formData = await request.formData();
  const intent = String(formData.get("intent") || "");
  const shopifyOrderId = String(formData.get("shopifyOrderId") || "");

  if (intent === "toggle-review") {
    const enabled = String(formData.get("enabled") || "") === "true";

    const result = await setOrderReviewEnabled(session.shop, enabled);

    if (!result.ok) {
      return Response.json({ ok: false, error: result.error }, { status: 400 });
    }

    return Response.json({
      ok: true,
      message: enabled
        ? "Order review is on. New paid orders will wait for your approval before going to Gelato."
        : "Order review is off. New paid orders will go to Gelato automatically. Orders already waiting still need approving.",
    });
  }

  if (intent === "sync-recent") {
    const result = await syncRecentShopifyOrders({
      admin,
      shop: session.shop,
      baseUrl: new URL(request.url).origin,
    });

    if (result.error) {
      return Response.json({ ok: false, error: result.error }, { status: 400 });
    }

    return Response.json({
      ok: true,
      message:
        `Synced ${result.scanned} recent Shopify orders: ` +
        `${result.claimed} new customized item${result.claimed === 1 ? "" : "s"} found, ` +
        `${result.submitted} submitted, ${result.failed} failed.`,
    });
  }

  if (intent === "approve") {
    try {
      const result = await approveOrderItems(
        {
          shop: session.shop,
          shopifyOrderId,
          reviewedBy: session.shop,
        },
        {
          loadShopifyOrder: (id) => loadOrderForFulfillment(admin, id),
        },
      );

      if (result.approved === 0) {
        return Response.json({
          ok: true,
          message:
            "Nothing to approve — this order is no longer awaiting review.",
        });
      }

      return Response.json({
        ok: true,
        message:
          `Approved ${result.approved} item${result.approved === 1 ? "" : "s"}: ` +
          `${result.submitted} sent to Gelato, ${result.failed} failed.`,
      });
    } catch (error) {
      console.error("[orders] approve action failed:", error);
      return Response.json(
        {
          ok: false,
          error: error.message || "Failed to approve order items.",
        },
        { status: 400 },
      );
    }
  }

  if (intent === "reject") {
    try {
      const result = await rejectOrderItems({
        shop: session.shop,
        shopifyOrderId,
        reason: String(formData.get("reason") || "").trim(),
        reviewedBy: session.shop,
      });

      return Response.json({
        ok: true,
        message: `Rejected ${result.rejected} item${result.rejected === 1 ? "" : "s"}. Nothing was sent to Gelato.`,
      });
    } catch (error) {
      console.error("[orders] reject action failed:", error);
      return Response.json(
        {
          ok: false,
          error: error.message || "Failed to reject order items.",
        },
        { status: 400 },
      );
    }
  }

  if (intent !== "retry") {
    return Response.json(
      { ok: false, error: "Unknown action." },
      { status: 400 },
    );
  }

  try {
    const result = await retryOrderItems(
      {
        shop: session.shop,
        shopifyOrderId,
      },
      {
        loadShopifyOrder: (id) => loadOrderForFulfillment(admin, id),
      },
    );

    if (result.retried === 0) {
      return Response.json({
        ok: true,
        message: "Nothing to retry — no retryable failures were found.",
      });
    }

    return Response.json({
      ok: true,
      message:
        `Retried ${result.retried} item${result.retried === 1 ? "" : "s"}: ` +
        `${result.submitted} submitted, ${result.failed} still failing.`,
    });
  } catch (error) {
    console.error("[orders] retry action failed:", error);
    return Response.json(
      {
        ok: false,
        error: error.message || "Failed to retry order items.",
      },
      { status: 400 },
    );
  }
}

/**
 * Artwork thumbnail that opens a high-resolution detailed preview modal for QA.
 */
function OrderItemThumbnail({ sources, itemTitle, previewUrl, artworkUrl }) {
  const candidates = asArray(sources).filter(Boolean);
  const identity = candidates.join("|");
  const [index, setIndex] = useState(0);
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedTab, setSelectedTab] = useState(0);

  useEffect(() => setIndex(0), [identity]);

  const source = candidates[index];

  const modalTabs = [];
  if (artworkUrl) {
    modalTabs.push({ id: "artwork", content: "Flat Artwork Print Layout" });
  }
  if (previewUrl) {
    modalTabs.push({ id: "mockup", content: "Gelato Product Mockup" });
  }

  const activeImage =
    selectedTab === 0
      ? modalTabs[0]?.id === "mockup"
        ? previewUrl || artworkUrl
        : artworkUrl || previewUrl
      : modalTabs[1]?.id === "mockup"
        ? previewUrl || artworkUrl
        : artworkUrl || previewUrl;

  if (!source) {
    return (
      <Thumbnail source={ImageIcon} alt="Artwork unavailable" size="medium" />
    );
  }

  return (
    <>
      <div
        onClick={() => setModalOpen(true)}
        style={{
          cursor: "pointer",
          position: "relative",
          display: "inline-block",
          borderRadius: "var(--p-border-radius-200)",
          overflow: "hidden",
        }}
        title="Click to view high-resolution preview"
      >
        <img
          src={source}
          alt="Customized artwork"
          width={80}
          height={80}
          loading="lazy"
          onError={() => setIndex((current) => current + 1)}
          style={{
            width: 80,
            height: 80,
            objectFit: "cover",
            borderRadius: "var(--p-border-radius-200)",
            border: "var(--p-border-width-025) solid var(--p-color-border)",
            background: "var(--p-color-bg-surface-secondary)",
            display: "block",
            transition: "transform 0.15s ease",
          }}
        />
        <div
          style={{
            position: "absolute",
            bottom: 4,
            right: 4,
            background: "rgba(0,0,0,0.65)",
            color: "#fff",
            borderRadius: "4px",
            padding: "2px 4px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <MaximizeIcon style={{ width: 12, height: 12, fill: "#fff" }} />
        </div>
      </div>

      {modalOpen ? (
        <Modal
          open={modalOpen}
          onClose={() => setModalOpen(false)}
          title={`Quality Inspection — ${itemTitle || "Order Artwork"}`}
          primaryAction={{
            content: "Close",
            onAction: () => setModalOpen(false),
          }}
          secondaryActions={
            activeImage
              ? [
                  {
                    content: "Open original image in new tab",
                    icon: ExternalIcon,
                    onAction: () => window.open(activeImage, "_blank"),
                  },
                ]
              : []
          }
          size="large"
        >
          <Modal.Section>
            <BlockStack gap="400">
              {modalTabs.length > 1 ? (
                <Tabs
                  tabs={modalTabs}
                  selected={selectedTab}
                  onSelect={(tabIndex) => setSelectedTab(tabIndex)}
                />
              ) : null}

              <Box
                padding="400"
                style={{
                  background: "#181818",
                  borderRadius: "var(--p-border-radius-200)",
                  textAlign: "center",
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "center",
                  alignItems: "center",
                  minHeight: 380,
                  maxHeight: "75vh",
                  overflow: "auto",
                  width: "100%",
                }}
              >
                {activeImage ? (
                  <div
                    style={{
                      width: "100%",
                      maxWidth: "1100px",
                      display: "flex",
                      justifyContent: "center",
                      alignItems: "center",
                    }}
                  >
                    <img
                      src={activeImage}
                      alt={itemTitle || "Full resolution preview"}
                      style={{
                        maxWidth: "100%",
                        maxHeight: "68vh",
                        objectFit: "contain",
                        borderRadius: "8px",
                        boxShadow: "0 8px 24px rgba(0,0,0,0.6)",
                        border: "1px solid rgba(255,255,255,0.1)",
                      }}
                    />
                  </div>
                ) : (
                  <Text tone="subdued">Image preview unavailable.</Text>
                )}
              </Box>
            </BlockStack>
          </Modal.Section>
        </Modal>
      ) : null}
    </>
  );
}

export default function GelatoOrders() {
  const {
    orders: loadedOrders,
    maxAttempts,
    orderReviewEnabled,
  } = useLoaderData();
  const fetcher = useFetcher();

  const orders = asArray(loadedOrders);
  const busy = fetcher.state !== "idle";
  const [pendingRejectOrder, setPendingRejectOrder] = useState(null);
  const [rejectReason, setRejectReason] = useState("");

  const awaitingReview = orders.filter((order) =>
    asArray(order.items).some(isAwaitingReview),
  );

  return (
    <Page
      title="Gelato orders"
      subtitle="Every customized line item submitted to Gelato for fulfillment."
    >
      <BlockStack gap="500">
        {fetcher.data?.message ? (
          <Banner tone="success" title="Done">
            {fetcher.data.message}
          </Banner>
        ) : null}

        {fetcher.data?.error ? (
          <Banner tone="critical" title="That did not work">
            {fetcher.data.error}
          </Banner>
        ) : null}

        {/*
          The order-review switch (SOW section 4.3, Milestone 5). Global: it
          applies to every order, and can be turned on or off at any time — for
          example back on after changing the AI model.
        */}
        <Card>
          <BlockStack gap="300">
            <InlineStack
              align="space-between"
              blockAlign="center"
              gap="400"
              wrap
            >
              <BlockStack gap="100">
                <InlineStack gap="200" blockAlign="center">
                  <Text as="h2" variant="headingMd">
                    Review orders before they go to Gelato
                  </Text>
                  <Badge tone={orderReviewEnabled ? "success" : "attention"}>
                    {orderReviewEnabled ? "On" : "Off"}
                  </Badge>
                </InlineStack>

                <Text as="p" tone="subdued">
                  {orderReviewEnabled
                    ? "Each paid order waits here until you approve it. Nothing is printed before you have seen it."
                    : "Paid orders are sent to Gelato automatically as soon as they arrive."}
                </Text>
              </BlockStack>

              <InlineStack gap="200" wrap>
                <Button
                  loading={busy}
                  onClick={() =>
                    fetcher.submit(
                      {
                        intent: "sync-recent",
                      },
                      { method: "post" },
                    )
                  }
                >
                  Sync recent Shopify orders
                </Button>

                <Button
                  loading={busy}
                  onClick={() =>
                    fetcher.submit(
                      {
                        intent: "toggle-review",
                        enabled: String(!orderReviewEnabled),
                      },
                      { method: "post" },
                    )
                  }
                >
                  {orderReviewEnabled ? "Turn review off" : "Turn review on"}
                </Button>
              </InlineStack>
            </InlineStack>

            {awaitingReview.length > 0 ? (
              <Banner tone="info">
                {awaitingReview.length} order
                {awaitingReview.length === 1 ? " is" : "s are"} waiting for your
                approval.
              </Banner>
            ) : null}
          </BlockStack>
        </Card>

        {orders.length === 0 ? (
          <Card>
            <EmptyState
              heading="No Gelato orders yet"
              image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
            >
              <p>
                Customized orders appear here as soon as the orders/create
                webhook receives them.
              </p>
            </EmptyState>
          </Card>
        ) : null}

        {orders.map((order) => {
          const items = asArray(order.items);

          const retryable = items.filter((item) =>
            isRetryable(item, maxAttempts),
          );
          const pending = items.filter(isAwaitingReview);

          const exhausted = items.filter(
            (item) =>
              item.status === FULFILLMENT_STATUS.failed &&
              item.attempts >= maxAttempts,
          );

          const rejectable = items.filter(
            (item) =>
              item.status !== FULFILLMENT_STATUS.rejected &&
              item.status !== FULFILLMENT_STATUS.submitted,
          );

          return (
            <Card key={order.shopifyOrderId}>
              <BlockStack gap="400">
                <InlineStack
                  align="space-between"
                  blockAlign="center"
                  gap="400"
                  wrap
                >
                  <BlockStack gap="100">
                    <Text as="h2" variant="headingMd">
                      Shopify order {order.shopifyOrderName}
                    </Text>
                    <Text as="p" tone="subdued">
                      Gelato order: {order.gelatoOrderId || "not submitted yet"}{" "}
                      · {items.length} customized item
                      {items.length === 1 ? "" : "s"}
                    </Text>
                  </BlockStack>

                  <InlineStack gap="200" wrap>
                    {pending.length > 0 ? (
                      <Button
                        variant="primary"
                        loading={busy}
                        onClick={() =>
                          fetcher.submit(
                            {
                              intent: "approve",
                              shopifyOrderId: order.shopifyOrderId,
                            },
                            { method: "post" },
                          )
                        }
                      >
                        Approve and send to Gelato
                      </Button>
                    ) : null}

                    {retryable.length > 0 ? (
                      <Button
                        variant="primary"
                        loading={busy}
                        onClick={() =>
                          fetcher.submit(
                            {
                              intent: "retry",
                              shopifyOrderId: order.shopifyOrderId,
                            },
                            { method: "post" },
                          )
                        }
                      >
                        Retry {retryable.length} failed item
                        {retryable.length === 1 ? "" : "s"}
                      </Button>
                    ) : null}

                    {rejectable.length > 0 ? (
                      <Button
                        tone="critical"
                        loading={busy}
                        onClick={() => {
                          setPendingRejectOrder(order);
                          setRejectReason("");
                        }}
                      >
                        Reject
                      </Button>
                    ) : null}
                  </InlineStack>
                </InlineStack>

                {pending.length > 0 ? (
                  <Banner tone="info" title="Waiting for your approval">
                    This order has been paid. The artwork below is exactly what
                    Gelato will print — approve it to send the order for
                    production, or reject it to stop it.
                  </Banner>
                ) : null}

                {exhausted.length > 0 ? (
                  <Banner tone="critical" title="Retries exhausted">
                    {exhausted.length} item{exhausted.length === 1 ? "" : "s"}{" "}
                    reached {maxAttempts} attempts. Fix the mapping or the
                    artwork, then submit the order in Gelato manually.
                  </Banner>
                ) : null}

                <Divider />

                <BlockStack gap="300">
                  {items.map((item) => (
                    <InlineGrid
                      key={item.id}
                      columns={{ xs: 1, md: "auto 1fr auto" }}
                      gap="400"
                      alignItems="center"
                    >
                      <OrderItemThumbnail
                        sources={[item.previewUrl, item.artworkUrl]}
                        itemTitle={
                          item.productMapping?.shopifyProductTitle ||
                          `Line item ${item.shopifyLineItemId}`
                        }
                        previewUrl={item.previewUrl}
                        artworkUrl={item.artworkUrl}
                      />

                      <BlockStack gap="100">
                        <Text as="p" fontWeight="semibold">
                          {item.productMapping?.shopifyProductTitle ||
                            `Line item ${item.shopifyLineItemId}`}
                        </Text>

                        <Text as="p" tone="subdued">
                          Template:{" "}
                          {item.productMapping?.gelatoTemplateId || "—"} ·
                          Placeholder:{" "}
                          {item.productMapping?.gelatoPlaceholderName || "—"} ·
                          Print area:{" "}
                          {item.productMapping?.gelatoPrintAreaName || "—"} ·
                          Qty {item.quantity}
                        </Text>

                        {item.lastError ? (
                          <Text as="p" tone="critical">
                            {item.lastError}
                          </Text>
                        ) : null}

                        {/*
                          What produced this design, frozen when the customer
                          approved it. Editing the design since does not change
                          any of this (Milestone 6).
                        */}
                        {describeConfigSnapshot(item.configSnapshot).length >
                        0 ? (
                          <Box paddingBlockStart="100">
                            <InlineStack gap="300" wrap>
                              {describeConfigSnapshot(item.configSnapshot).map(
                                (line) => (
                                  <Text
                                    as="span"
                                    tone="subdued"
                                    variant="bodySm"
                                    key={line.label}
                                  >
                                    <strong>{line.label}:</strong> {line.value}
                                  </Text>
                                ),
                              )}
                            </InlineStack>
                          </Box>
                        ) : null}
                      </BlockStack>

                      <BlockStack gap="100" inlineAlign="end">
                        <Badge tone={fulfillmentTone(item.status)}>
                          {FULFILLMENT_STATUS_LABELS[item.status] ||
                            item.status}
                        </Badge>
                        <Text as="p" tone="subdued">
                          {item.attempts} attempt
                          {item.attempts === 1 ? "" : "s"}
                        </Text>
                      </BlockStack>
                    </InlineGrid>
                  ))}
                </BlockStack>
              </BlockStack>
            </Card>
          );
        })}

        <Box paddingBlockEnd="500">
          <Text as="p" tone="subdued">
            Duplicate protection: each Shopify line item can only ever be
            claimed once, so a replayed webhook never creates a second Gelato
            order.
          </Text>
        </Box>
      </BlockStack>

      {/* Confirmation popup for rejecting an order */}
      <Modal
        open={Boolean(pendingRejectOrder)}
        onClose={() => {
          if (!busy) {
            setPendingRejectOrder(null);
            setRejectReason("");
          }
        }}
        title="Are you sure you want to reject this order?"
        primaryAction={{
          content: "Reject order",
          destructive: true,
          loading: busy,
          onAction: () => {
            if (!pendingRejectOrder) return;
            fetcher.submit(
              {
                intent: "reject",
                shopifyOrderId: pendingRejectOrder.shopifyOrderId,
                reason: rejectReason,
              },
              { method: "post" },
            );
            setPendingRejectOrder(null);
            setRejectReason("");
          },
        }}
        secondaryActions={[
          {
            content: "Cancel",
            disabled: busy,
            onAction: () => {
              setPendingRejectOrder(null);
              setRejectReason("");
            },
          },
        ]}
      >
        <Modal.Section>
          <BlockStack gap="400">
            <Text as="p">
              Are you sure you want to reject order{" "}
              <strong>{pendingRejectOrder?.shopifyOrderName}</strong>? Once
              rejected, items from this order will not be sent to Gelato for
              production.
            </Text>
            <TextField
              label="Why is this order being rejected? (optional)"
              value={rejectReason}
              onChange={setRejectReason}
              placeholder="e.g. Artwork adjustment needed, customer requested cancellation"
              autoComplete="off"
              multiline={2}
            />
          </BlockStack>
        </Modal.Section>
      </Modal>
    </Page>
  );
}
