import test from "node:test";
import assert from "node:assert/strict";

import {
  CEILING_MS,
  TARGET_MS,
  evaluateGate,
  groupBy,
  percentile,
  riskyGroups,
  summarize,
} from "../app/lib/generation-stats.js";

function run(overrides = {}) {
  return {
    status: "SUCCESS",
    durationMs: 20000,
    estimatedCost: 0.04,
    generationType: "INITIAL",
    modelKey: "gemini-2.5-flash-image",
    resolution: "2K",
    productMappingId: "map_mug",
    productMapping: { shopifyProductTitle: "11oz Mug" },
    ...overrides,
  };
}

test("headline figures count runs, successes and failures", () => {
  const stats = summarize([
    run(),
    run(),
    run({ status: "TIMED_OUT", durationMs: 34000, estimatedCost: null }),
  ]);

  assert.equal(stats.runs, 3);
  assert.equal(stats.successes, 2);
  assert.equal(stats.failures, 1);
  assert.equal(Number(stats.successRate.toFixed(2)), 0.67);
  assert.equal(stats.byStatus.SUCCESS, 2);
  assert.equal(stats.byStatus.TIMED_OUT, 1);
});

test("timing covers successful runs only", () => {
  // A generation that failed fast is not evidence the pipeline is quick.
  const stats = summarize([
    run({ durationMs: 20000 }),
    run({ durationMs: 30000 }),
    run({ status: "GENERATION_FAILED", durationMs: 500 }),
  ]);

  assert.equal(stats.durations.count, 2);
  assert.equal(stats.durations.average, 25000);
  assert.equal(stats.durations.slowest, 30000);
});

test("the ceiling is measured, not assumed", () => {
  // Derived from the constant, never a literal. The ceiling is a commercial
  // term, not a fact about the code — it moved from 40s to 60s to accommodate
  // gemini-3-pro-image — and a test that hard-codes it fails for the wrong
  // reason and gets "fixed" by editing the number rather than the behaviour.
  const stats = summarize([
    run({ durationMs: TARGET_MS - 1000 }),
    run({ durationMs: CEILING_MS + 1000 }),
    run({ durationMs: CEILING_MS - 1000 }),
  ]);

  assert.equal(stats.durations.overCeiling, 1);
  assert.equal(stats.durations.withinTarget, 1);
});

test("p95 exposes a slow tail an average would hide", () => {
  // 10% of runs blow the ceiling. The mean still reads as comfortable, which is
  // exactly the reading that would let a failing configuration go live.
  const fast = Array.from({ length: 18 }, () => run({ durationMs: 15000 }));
  const slow = Array.from({ length: 2 }, () => run({ durationMs: CEILING_MS + 1000 }));
  const stats = summarize([...fast, ...slow]);

  // The claim is a relationship, not a number: the mean sits inside the soft
  // target and reads as comfortable, while the tail is already over the hard
  // ceiling. Asserting a literal here made the test fail when the ceiling moved,
  // for a reason that had nothing to do with what it is checking.
  assert.ok(stats.durations.average < TARGET_MS, "the average looks healthy");
  assert.ok(stats.durations.p95 > CEILING_MS, "p95 does not");
  assert.equal(stats.durations.overCeiling, 2);
});

test("percentile handles the empty and single-value cases", () => {
  assert.equal(percentile([], 0.95), null);
  assert.equal(percentile([7], 0.5), 7);
  assert.equal(percentile([1, 2, 3, 4], 0.5), 2);
});

test("cost is totalled, and unpriced runs are reported rather than counted free", () => {
  const stats = summarize([
    run({ estimatedCost: 0.04 }),
    run({ estimatedCost: 0.04 }),
    run({ estimatedCost: null }),
  ]);

  assert.equal(Number(stats.cost.total.toFixed(2)), 0.08);
  assert.equal(stats.cost.priced, 2);
  assert.equal(stats.cost.unpriced, 1);
  assert.equal(stats.cost.perGeneration, 0.04);
});

test("regenerations are counted separately", () => {
  const stats = summarize([
    run(),
    run({ generationType: "REGENERATION" }),
    run({ generationType: "REGENERATION" }),
  ]);

  assert.equal(stats.regenerations, 2);
});

test("runs group by product, model and resolution", () => {
  const groups = groupBy([
    run(),
    run(),
    run({ resolution: "4K", durationMs: 38000 }),
    run({
      modelKey: "gemini-3-pro-image",
      productMapping: { shopifyProductTitle: "Organic Tote Bag" },
      productMappingId: "map_tote",
    }),
  ]);

  assert.equal(groups.length, 3);

  const biggest = groups[0];

  assert.equal(biggest.product, "11oz Mug");
  assert.equal(biggest.resolution, "2K");
  assert.equal(biggest.runs, 2);
});

test("a group keeps what actually ran, not what the mapping says now", () => {
  // The mapping has since been switched to 4K; these runs were 2K and must
  // stay reported as 2K.
  const [group] = groupBy([run({ resolution: "2K" })]);

  assert.equal(group.resolution, "2K");
  assert.equal(group.model, "gemini-2.5-flash-image");
});

test("a combination over the ceiling is flagged", () => {
  const groups = groupBy([
    run({ durationMs: CEILING_MS + 3000 }),
    run({ durationMs: CEILING_MS + 4000 }),
  ]);
  const [risk] = riskyGroups(groups);

  assert.equal(risk.severity, "over");
});

test("a combination merely close to the ceiling is flagged before it fails", () => {
  // NFR-03 asks for a warning before the product goes live, not after.
  // Between the soft target and the hard ceiling, wherever those currently sit.
  const groups = groupBy([
    run({ durationMs: TARGET_MS + 5000 }),
    run({ durationMs: TARGET_MS + 6000 }),
  ]);
  const [risk] = riskyGroups(groups);

  assert.equal(risk.severity, "at-risk");
});

test("a comfortable combination is not flagged", () => {
  const groups = groupBy([run({ durationMs: 18000 }), run({ durationMs: 21000 })]);

  assert.deepEqual(riskyGroups(groups), []);
});

test("the gate passes on 50 clean runs inside the ceiling", () => {
  const logs = Array.from({ length: 50 }, () => run({ durationMs: 22000 }));
  const verdict = evaluateGate(logs);

  assert.equal(verdict.passed, true);
  assert.deepEqual(verdict.reasons, []);
  // A dirty failure cannot be seen in a log, so the gate never passes alone.
  assert.equal(verdict.requiresVisualReview, true);
});

test("the gate allows two clean failures and refuses a third", () => {
  const base = Array.from({ length: 48 }, () => run());

  const two = evaluateGate([...base, run({ status: "TIMED_OUT" }), run({ status: "TIMED_OUT" })]);
  assert.equal(two.passed, true);

  const three = evaluateGate([
    ...base,
    run({ status: "TIMED_OUT" }),
    run({ status: "TIMED_OUT" }),
    run({ status: "UNPROCESSABLE_IMAGE" }),
  ]);

  assert.equal(three.passed, false);
  assert.match(three.reasons.join(" "), /clean failures/);
});

test("a single run over the ceiling fails the gate", () => {
  const logs = Array.from({ length: 49 }, () => run({ durationMs: 20000 }));
  const verdict = evaluateGate([...logs, run({ durationMs: CEILING_MS + 1000 })]);

  assert.equal(verdict.passed, false);
  assert.match(verdict.reasons.join(" "), new RegExp(`exceeded the ${CEILING_MS / 1000}s ceiling`));
});

test("an incomplete run is reported as incomplete, not as a pass", () => {
  const verdict = evaluateGate(Array.from({ length: 10 }, () => run()));

  assert.equal(verdict.passed, false);
  assert.match(verdict.reasons.join(" "), /Only 10 of 50/);
});
