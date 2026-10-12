/**
 * Reads for the AI generation report (NFR-03, NFR-04, NFR-06).
 *
 * SERVER ONLY. The arithmetic lives in `generation-stats.js` so the admin page
 * and the reliability-run script cannot disagree about what the numbers mean.
 */

import prisma from "../db.server.js";
import { asArray } from "./normalize.js";
import {
  RANGE_OPTIONS,
  groupBy,
  riskyGroups,
  summarize,
} from "./generation-stats.js";

const RANGE_MS = {
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000,
};

/** @returns {boolean} whether the value is one the report accepts. */
export function isSupportedRange(value) {
  return RANGE_OPTIONS.some((option) => option.value === value);
}

export function rangeStart(range, now = Date.now()) {
  const span = RANGE_MS[range];

  return span ? new Date(now - span) : null;
}

/**
 * Everything the report page needs, in one read.
 *
 * `take` is a hard cap rather than pagination: the page shows aggregates, and
 * an unbounded read on a busy shop would be the slowest query in the app. The
 * cap is reported back so the page can say the figures are a sample rather than
 * quietly presenting a truncated total as the whole picture.
 */
export async function loadGenerationReport(
  shop,
  { range = "7d", take = 2000, now = Date.now() } = {},
) {
  const since = rangeStart(range, now);

  const where = { shop };

  if (since) {
    where.createdAt = { gte: since };
  }

  const [logs, total] = await Promise.all([
    prisma.generationLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take,
      include: {
        productMapping: {
          select: { shopifyProductTitle: true, designLabel: true },
        },
      },
    }),
    prisma.generationLog.count({ where }),
  ]);

  const rows = asArray(logs);
  const groups = groupBy(rows);

  return {
    range,
    since: since ? since.toISOString() : null,
    truncated: total > rows.length,
    total,
    summary: summarize(rows),
    groups,
    risks: riskyGroups(groups),
    recent: rows.slice(0, 25).map((row) => ({
      id: row.id,
      createdAt: row.createdAt,
      status: row.status,
      generationType: row.generationType,
      durationMs: row.durationMs,
      estimatedCost: row.estimatedCost,
      modelKey: row.modelKey,
      resolution: row.resolution,
      product: row.productMapping?.shopifyProductTitle || "(unmapped)",
      errorMessage: row.errorMessage || "",
    })),
  };
}

/**
 * Regenerations per accepted order (NFR-06).
 *
 * Counted from `Customization`, not from the log: the requirement is about the
 * artwork a customer *accepted*, so attempts they abandoned must not inflate it.
 */
export async function loadRegenerationStats(shop, { range = "7d", now = Date.now() } = {}) {
  const since = rangeStart(range, now);

  const where = { shop };

  if (since) {
    where.createdAt = { gte: since };
  }

  const rows = asArray(
    await prisma.customization.findMany({
      where,
      select: { generationCount: true },
    }),
  );

  // Rows written before Milestone 4 have a zero count, because the upload was
  // itself the artwork. Averaging them in would understate the real figure.
  const counted = rows.filter((row) => Number(row.generationCount) > 0);

  const totalGenerations = counted.reduce(
    (sum, row) => sum + Number(row.generationCount),
    0,
  );

  return {
    acceptedDesigns: rows.length,
    withGenerations: counted.length,
    totalGenerations,
    averagePerAcceptedOrder: counted.length ? totalGenerations / counted.length : null,
    regenerated: counted.filter((row) => Number(row.generationCount) > 1).length,
  };
}
