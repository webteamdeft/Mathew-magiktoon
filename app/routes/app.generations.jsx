import {
  Page,
  Card,
  Text,
  Badge,
  Banner,
  Box,
  Select,
  Divider,
  DataTable,
  BlockStack,
  InlineStack,
  InlineGrid,
  EmptyState,
} from "@shopify/polaris";
import { useLoaderData, useSearchParams } from "react-router";

import { authenticate } from "../shopify.server";
import {
  isSupportedRange,
  loadGenerationReport,
  loadRegenerationStats,
} from "../lib/generation-stats.server";
import {
  CEILING_MS,
  FAILURE_LABELS,
  RANGE_OPTIONS,
  TARGET_MS,
} from "../lib/generation-stats";

export async function loader({ request }) {
  const { session } = await authenticate.admin(request);

  const url = new URL(request.url);
  const requested = url.searchParams.get("range");
  const range = isSupportedRange(requested) ? requested : "7d";

  const [report, regenerations] = await Promise.all([
    loadGenerationReport(session.shop, { range }),
    loadRegenerationStats(session.shop, { range }),
  ]);

  return Response.json({ report, regenerations });
}

/** Milliseconds as seconds, or an em dash when there is nothing to show. */
function seconds(value) {
  return Number.isFinite(value) ? `${(value / 1000).toFixed(1)}s` : "—";
}

/**
 * A cost figure.
 *
 * Rendered to four decimal places because a per-image rate is cents, and
 * rounding to two would print every single generation as $0.00.
 */
function money(value) {
  return Number.isFinite(value) ? `$${value.toFixed(4)}` : "—";
}

function percent(value) {
  return Number.isFinite(value) ? `${Math.round(value * 100)}%` : "—";
}

/** One headline number. */
function Metric({ label, value, tone, help }) {
  return (
    <Card>
      <BlockStack gap="100">
        <Text as="p" tone="subdued" variant="bodySm">
          {label}
        </Text>
        <Text as="p" variant="headingLg" tone={tone}>
          {value}
        </Text>
        {help ? (
          <Text as="p" tone="subdued" variant="bodySm">
            {help}
          </Text>
        ) : null}
      </BlockStack>
    </Card>
  );
}

export default function GenerationReport() {
  const { report, regenerations } = useLoaderData();
  const [searchParams, setSearchParams] = useSearchParams();

  const { summary, groups, risks, recent } = report;
  const { durations, cost } = summary;

  const overCeiling = durations.overCeiling > 0;

  return (
    <Page
      title="AI generations"
      subtitle="Generation time, cost and reliability for every image the AI produces."
    >
      <BlockStack gap="500">
        <InlineStack align="space-between" blockAlign="center" gap="400" wrap>
          <Select
            label="Period"
            labelInline
            options={RANGE_OPTIONS}
            value={report.range}
            onChange={(value) => {
              searchParams.set("range", value);
              setSearchParams(searchParams);
            }}
          />

          {report.truncated ? (
            <Text as="p" tone="subdued">
              Showing the most recent 2,000 of {report.total} runs.
            </Text>
          ) : null}
        </InlineStack>

        {summary.runs === 0 ? (
          <Card>
            <EmptyState
              heading="No generations recorded yet"
              image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
            >
              <p>
                Assign a prompt and an AI model to a product mapping, then
                generate a design on the storefront. Every run appears here with
                its timing and cost.
              </p>
            </EmptyState>
          </Card>
        ) : (
          <>
            {overCeiling ? (
              <Banner
                tone="critical"
                title={`Runs exceeded the ${CEILING_MS / 1000}-second ceiling`}
              >
                {durations.overCeiling} of {durations.count} successful runs took
                longer than {CEILING_MS / 1000} seconds. The ceiling is a
                pass-or-fail condition at Milestones 4 and 5, so this combination
                should be resolved before the product goes live.
              </Banner>
            ) : null}

            {risks.length > 0 && !overCeiling ? (
              <Banner tone="warning" title="Close to the ceiling">
                {risks.length} combination{risks.length === 1 ? "" : "s"} of
                model, prompt and resolution are running close to the{" "}
                {CEILING_MS / 1000}-second ceiling. Worth deciding how to handle
                before launch.
              </Banner>
            ) : null}

            <InlineGrid columns={{ xs: 1, sm: 2, lg: 4 }} gap="400">
              <Metric
                label="Runs"
                value={summary.runs}
                help={`${summary.successes} succeeded, ${summary.failures} failed`}
              />
              <Metric
                label="Success rate"
                value={percent(summary.successRate)}
                tone={summary.successRate === 1 ? "success" : undefined}
              />
              <Metric
                label="Median time"
                value={seconds(durations.p50)}
                help={`Target is under ${TARGET_MS / 1000}s`}
              />
              <Metric
                label="95th percentile"
                value={seconds(durations.p95)}
                tone={durations.p95 > CEILING_MS ? "critical" : undefined}
                help={`Ceiling is ${CEILING_MS / 1000}s`}
              />
            </InlineGrid>

            <InlineGrid columns={{ xs: 1, sm: 2, lg: 4 }} gap="400">
              <Metric
                label="Slowest run"
                value={seconds(durations.slowest)}
                tone={durations.slowest > CEILING_MS ? "critical" : undefined}
              />
              <Metric
                label="Estimated AI cost"
                value={money(cost.total)}
                help={
                  cost.unpriced > 0
                    ? `${cost.unpriced} run(s) have no rate configured`
                    : `${money(cost.perGeneration)} per generation`
                }
              />
              <Metric
                label="Regenerations"
                value={summary.regenerations}
                help="Runs where the customer asked again"
              />
              <Metric
                label="Per accepted design"
                value={
                  Number.isFinite(regenerations.averagePerAcceptedOrder)
                    ? regenerations.averagePerAcceptedOrder.toFixed(2)
                    : "—"
                }
                help={`${regenerations.regenerated} of ${regenerations.withGenerations} accepted designs were regenerated`}
              />
            </InlineGrid>

            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">
                  By product, model and resolution
                </Text>

                <Text as="p" tone="subdued">
                  The figures each run was actually produced with, kept on the
                  run itself — so changing a mapping later never rewrites this
                  history.
                </Text>

                <DataTable
                  columnContentTypes={[
                    "text", "text", "text",
                    "numeric", "numeric", "numeric", "numeric", "numeric",
                  ]}
                  headings={[
                    "Product", "Model", "Resolution",
                    "Runs", "Success", "Median", "p95", "Cost",
                  ]}
                  rows={groups.map((group) => [
                    group.product,
                    group.model,
                    group.resolution,
                    group.runs,
                    percent(group.successRate),
                    seconds(group.durations.p50),
                    seconds(group.durations.p95),
                    money(group.cost.total),
                  ])}
                />
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">
                  Recent runs
                </Text>

                <Divider />

                <BlockStack gap="300">
                  {recent.map((row) => (
                    <InlineStack
                      key={row.id}
                      align="space-between"
                      blockAlign="start"
                      gap="400"
                      wrap
                    >
                      <BlockStack gap="100">
                        <InlineStack gap="200" blockAlign="center">
                          <Badge tone={row.status === "SUCCESS" ? "success" : "critical"}>
                            {FAILURE_LABELS[row.status] || row.status}
                          </Badge>

                          {row.generationType === "REGENERATION" ? (
                            <Badge>Regeneration</Badge>
                          ) : null}

                          <Text as="span" fontWeight="semibold">
                            {row.product}
                          </Text>
                        </InlineStack>

                        <Text as="p" tone="subdued" variant="bodySm">
                          {row.modelKey || "(default model)"} ·{" "}
                          {row.resolution || "(no resolution)"} ·{" "}
                          {new Date(row.createdAt).toLocaleString()}
                        </Text>

                        {row.errorMessage ? (
                          <Text as="p" tone="critical" variant="bodySm">
                            {row.errorMessage}
                          </Text>
                        ) : null}
                      </BlockStack>

                      <BlockStack gap="100" inlineAlign="end">
                        <Text
                          as="p"
                          fontWeight="semibold"
                          tone={row.durationMs > CEILING_MS ? "critical" : undefined}
                        >
                          {seconds(row.durationMs)}
                        </Text>
                        <Text as="p" tone="subdued" variant="bodySm">
                          {money(row.estimatedCost)}
                        </Text>
                      </BlockStack>
                    </InlineStack>
                  ))}
                </BlockStack>
              </BlockStack>
            </Card>
          </>
        )}

        <Box paddingBlockEnd="500">
          <Text as="p" tone="subdued">
            Cost is an estimate: it applies the per-image rate configured against
            each AI model, so it is accurate only while those rates are kept
            current.
          </Text>
        </Box>
      </BlockStack>
    </Page>
  );
}
