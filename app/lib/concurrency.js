/**
 * Queueing, rate limiting and timeouts for AI generation jobs (NFR-10).
 *
 * Client-safe: pure JavaScript with no imports, so it can be unit tested
 * without a database or a network.
 *
 * Why a queue at all: Gemini is slow and rate limited, and the reliability gate
 * requires that several customers generating at the same time all succeed
 * within the agreed ceiling. Letting every request call the model at once
 * turns a burst into a wave of 429s and timeouts; admitting a fixed number at a
 * time and making the rest wait their turn keeps each individual run inside its
 * budget.
 */

/**
 * Run at most `concurrency` jobs at once; queue the rest in arrival order.
 *
 * @param {object} [options]
 * @param {number} [options.concurrency]
 * @param {number} [options.maxQueue] Reject rather than queue past this depth,
 *   so a stampede fails fast with a "try again" instead of every customer
 *   waiting minutes for a slot that will have timed out by the time it arrives.
 */
export function createLimiter({ concurrency = 3, maxQueue = 50 } = {}) {
  const limit = Math.max(1, Math.floor(concurrency));
  const queueLimit = Math.max(0, Math.floor(maxQueue));

  let active = 0;
  const queue = [];

  function next() {
    if (active >= limit || queue.length === 0) {
      return;
    }

    const job = queue.shift();

    active += 1;

    // The slot is released BEFORE the caller's promise settles, so anyone
    // awaiting a job sees capacity that is genuinely free. Releasing in a
    // trailing `.finally` instead leaves a window where the job is finished but
    // still counted, which reads as an off-by-one to every caller.
    const release = () => {
      active -= 1;
      next();
    };

    // The job function is invoked here, not when it was submitted: that is the
    // whole point — the work does not start until a slot is free.
    Promise.resolve()
      .then(job.run)
      .then(
        (value) => {
          release();
          job.resolve(value);
        },
        (error) => {
          release();
          job.reject(error);
        },
      );
  }

  return {
    run(job) {
      if (queue.length >= queueLimit && active >= limit) {
        const error = new Error("The generation queue is full.");
        error.code = "QUEUE_FULL";

        return Promise.reject(error);
      }

      return new Promise((resolve, reject) => {
        queue.push({ run: job, resolve, reject });
        next();
      });
    },

    get stats() {
      return { active, queued: queue.length, limit };
    },
  };
}

/**
 * A sliding-window rate limiter, keyed per caller.
 *
 * Used to stop one shopper (or one script) from spending the shop's AI budget:
 * regeneration is a normal customer action, but at a human pace.
 */
export function createRateLimiter({ points = 10, windowMs = 60000 } = {}) {
  const hits = new Map();

  return {
    /** @returns {{ ok: boolean, retryAfterMs?: number, remaining?: number }} */
    take(key, now = Date.now()) {
      const identity = String(key || "anonymous");
      const cutoff = now - windowMs;

      const recent = (hits.get(identity) || []).filter((at) => at > cutoff);

      if (recent.length >= points) {
        return {
          ok: false,
          // The oldest hit is the one that has to age out before a slot frees.
          retryAfterMs: Math.max(0, recent[0] + windowMs - now),
          remaining: 0,
        };
      }

      recent.push(now);
      hits.set(identity, recent);

      // Keys are unbounded (one per shopper), so idle ones are swept rather
      // than left to grow the map for the lifetime of the process.
      if (hits.size > 5000) {
        for (const [otherKey, timestamps] of hits) {
          if (timestamps.every((at) => at <= cutoff)) {
            hits.delete(otherKey);
          }
        }
      }

      return { ok: true, remaining: points - recent.length };
    },

    get size() {
      return hits.size;
    },
  };
}

/**
 * Reject a promise that outruns its budget.
 *
 * The generation ceiling is a hard pass-or-fail at Milestones 4 and 5, so a
 * slow model call must surface as a clean, timed failure the customer can
 * retry — never as a request that hangs until the browser gives up (AC-06).
 */
export function withTimeout(promise, timeoutMs, message = "Timed out") {
  const budget = Number(timeoutMs);

  if (!Number.isFinite(budget) || budget <= 0) {
    return promise;
  }

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      const error = new Error(message);
      error.code = "TIMED_OUT";
      reject(error);
    }, budget);

    Promise.resolve(promise)
      .then(resolve, reject)
      .finally(() => clearTimeout(timer));
  });
}
