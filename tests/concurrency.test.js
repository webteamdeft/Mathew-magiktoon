import test from "node:test";
import assert from "node:assert/strict";

import {
  createLimiter,
  createRateLimiter,
  withTimeout,
} from "../app/lib/concurrency.js";

const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

test("no more than the configured number of jobs run at once", async () => {
  const limiter = createLimiter({ concurrency: 2 });

  let running = 0;
  let peak = 0;

  const job = async () => {
    running += 1;
    peak = Math.max(peak, running);
    await tick(10);
    running -= 1;
    return "done";
  };

  const results = await Promise.all(
    Array.from({ length: 6 }, () => limiter.run(job)),
  );

  assert.equal(peak, 2, `expected at most 2 concurrent, saw ${peak}`);
  assert.deepEqual(results, Array(6).fill("done"));
});

test("queued work still completes, in arrival order", async () => {
  const limiter = createLimiter({ concurrency: 1 });
  const order = [];

  await Promise.all(
    [1, 2, 3].map((n) =>
      limiter.run(async () => {
        await tick(5);
        order.push(n);
      }),
    ),
  );

  assert.deepEqual(order, [1, 2, 3]);
});

test("a failing job frees its slot instead of wedging the queue", async () => {
  const limiter = createLimiter({ concurrency: 1 });

  await assert.rejects(
    limiter.run(async () => {
      throw new Error("the model exploded");
    }),
    /the model exploded/,
  );

  // The next job must still get in.
  assert.equal(await limiter.run(async () => "recovered"), "recovered");
  assert.equal(limiter.stats.active, 0);
});

test("a stampede is refused rather than queued forever", async () => {
  const limiter = createLimiter({ concurrency: 1, maxQueue: 2 });

  const slow = () => limiter.run(() => tick(30));

  const accepted = [slow(), slow(), slow()];

  await assert.rejects(slow(), (error) => error.code === "QUEUE_FULL");

  await Promise.all(accepted);
});

test("a caller is limited to its budget inside the window", () => {
  const limiter = createRateLimiter({ points: 3, windowMs: 1000 });
  const start = 1000000;

  assert.equal(limiter.take("shopper-a", start).ok, true);
  assert.equal(limiter.take("shopper-a", start + 10).ok, true);
  assert.equal(limiter.take("shopper-a", start + 20).ok, true);

  const blocked = limiter.take("shopper-a", start + 30);

  assert.equal(blocked.ok, false);
  assert.ok(blocked.retryAfterMs > 0);
});

test("a burst from one shopper does not block another", () => {
  const limiter = createRateLimiter({ points: 1, windowMs: 1000 });
  const start = 1000000;

  assert.equal(limiter.take("shopper-a", start).ok, true);
  assert.equal(limiter.take("shopper-a", start).ok, false);
  assert.equal(limiter.take("shopper-b", start).ok, true);
});

test("the window slides, so a caller recovers", () => {
  const limiter = createRateLimiter({ points: 1, windowMs: 1000 });
  const start = 1000000;

  assert.equal(limiter.take("shopper-a", start).ok, true);
  assert.equal(limiter.take("shopper-a", start + 500).ok, false);
  assert.equal(limiter.take("shopper-a", start + 1001).ok, true);
});

test("a slow call fails cleanly instead of hanging", async () => {
  await assert.rejects(
    withTimeout(tick(50).then(() => "late"), 10, "Generation timed out"),
    (error) => error.code === "TIMED_OUT" && /timed out/i.test(error.message),
  );
});

test("a call inside its budget is untouched", async () => {
  assert.equal(await withTimeout(Promise.resolve("quick"), 1000), "quick");
});

test("a job that rejects before the deadline keeps its own error", async () => {
  await assert.rejects(
    withTimeout(Promise.reject(new Error("upstream 500")), 1000),
    /upstream 500/,
  );
});
