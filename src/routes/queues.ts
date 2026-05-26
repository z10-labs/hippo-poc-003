import { Hono } from 'hono';
import { randomUUID } from 'node:crypto';
import { getDb } from '../db/client.js';
import { getRunningByType } from '../queue/worker.js';
import { getHandler } from '../queue/registry.js';
import { getQueueLimit, currentRateForQueue } from '../queue/rate-limiter.js';
import { percentile } from '../utils.js';
import { audit } from '../audit.js';
import type { JobRow } from '../types.js';

const app = new Hono();

// GET /queues
app.get('/', (c) => {
  const db = getDb();

  const queueNames = db
    .prepare(`SELECT DISTINCT queue FROM jobs`)
    .all() as { queue: string }[];

  const windowMs = 60_000;
  const since = Date.now() - windowMs;
  const metricsSince = Date.now() - 5 * 60_000;

  const queues = queueNames.map(({ queue }) => {
    const { depth } = db
      .prepare(
        `SELECT COUNT(*) AS depth FROM jobs
          WHERE queue = ? AND status = 'pending'`,
      )
      .get(queue) as { depth: number };

    // Priority band breakdown: high (>0), normal (=0), low (<0)
    const { depthHigh } = db
      .prepare(
        `SELECT COUNT(*) AS depthHigh FROM jobs
          WHERE queue = ? AND status = 'pending' AND priority > 0`,
      )
      .get(queue) as { depthHigh: number };

    const { depthNormal } = db
      .prepare(
        `SELECT COUNT(*) AS depthNormal FROM jobs
          WHERE queue = ? AND status = 'pending' AND priority = 0`,
      )
      .get(queue) as { depthNormal: number };

    const { depthLow } = db
      .prepare(
        `SELECT COUNT(*) AS depthLow FROM jobs
          WHERE queue = ? AND status = 'pending' AND priority < 0`,
      )
      .get(queue) as { depthLow: number };

    const { running } = db
      .prepare(
        `SELECT COUNT(*) AS running FROM jobs
          WHERE queue = ? AND status = 'running'`,
      )
      .get(queue) as { running: number };

    const { throughput } = db
      .prepare(
        `SELECT COUNT(*) AS throughput FROM jobs
          WHERE queue = ? AND status = 'completed' AND completed_at >= ?`,
      )
      .get(queue, since) as { throughput: number };

    // Durations from recent completed attempts for this queue
    const durations = (
      db
        .prepare(
          `SELECT a.duration_ms FROM attempts a
            JOIN jobs j ON j.id = a.job_id
           WHERE j.queue = ?
             AND a.completed_at >= ?
             AND a.duration_ms IS NOT NULL
             AND a.error IS NULL`,
        )
        .all(queue, metricsSince) as { duration_ms: number }[]
    ).map((r) => r.duration_ms);

    const avgDuration =
      durations.length > 0
        ? Math.round(durations.reduce((s, v) => s + v, 0) / durations.length)
        : null;
    const p95Duration = durations.length > 0 ? percentile(durations, 95) : null;

    const { totalAttempts } = db
      .prepare(
        `SELECT COUNT(*) AS totalAttempts FROM attempts a
          JOIN jobs j ON j.id = a.job_id
         WHERE j.queue = ? AND a.completed_at >= ?`,
      )
      .get(queue, metricsSince) as { totalAttempts: number };

    const { failedAttempts } = db
      .prepare(
        `SELECT COUNT(*) AS failedAttempts FROM attempts a
          JOIN jobs j ON j.id = a.job_id
         WHERE j.queue = ? AND a.completed_at >= ? AND a.error IS NOT NULL`,
      )
      .get(queue, metricsSince) as { failedAttempts: number };

    // Collect type-level concurrency for this queue for informational purposes
    const types = (
      db
        .prepare(`SELECT DISTINCT type FROM jobs WHERE queue = ?`)
        .all(queue) as { type: string }[]
    ).map(({ type }) => {
      const def = getHandler(type);
      return {
        type,
        running: getRunningByType().get(type) ?? 0,
        concurrency: def?.concurrency ?? null,
      };
    });

    return {
      queue,
      depth,
      depth_by_priority: {
        high: depthHigh,
        normal: depthNormal,
        low: depthLow,
      },
      running,
      throughput_per_minute: throughput,
      avg_duration_ms: avgDuration,
      p95_duration_ms: p95Duration,
      failure_rate:
        totalAttempts > 0
          ? parseFloat((failedAttempts / totalAttempts).toFixed(4))
          : null,
      // F-10: rate limiting fields
      rate_limit: getQueueLimit(queue),
      current_rate: currentRateForQueue(queue),
      types,
    };
  });

  return c.json(queues);
});

// POST /queues/:queue/replay — F-13: bulk replay all DLQ jobs in a queue
// DR-0019: new row per replay, original marked 'replayed'.
// DR-0020: single transaction for atomicity.
// DR-0021: one audit event per job inside the transaction.
app.post('/:queue/replay', (c) => {
  const db = getDb();
  const queue = c.req.param('queue');
  const { limit: limitParam = '100' } = c.req.query();
  const limit = Math.min(parseInt(limitParam) || 100, 1000);

  const dlqJobs = db
    .prepare(
      `SELECT * FROM jobs
        WHERE queue = ? AND status = 'dlq'
        ORDER BY completed_at ASC
        LIMIT ?`,
    )
    .all(queue, limit) as JobRow[];

  if (dlqJobs.length === 0) {
    return c.json({ replayed: [], total: 0 });
  }

  const now = Date.now();
  const pairs: { original_id: string; new_id: string }[] = [];

  // Single transaction — DR-0020: atomicity, no partial success.
  const txn = db.transaction(() => {
    for (const original of dlqJobs) {
      const newId = randomUUID();

      db.prepare(
        `INSERT INTO jobs
           (id, type, queue, payload, status, priority, eligible_at, enqueued_at,
            webhook_url, webhook_events)
         VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?)`,
      ).run(
        newId,
        original.type,
        original.queue,
        original.payload,
        original.priority,
        now,
        now,
        original.webhook_url,
        original.webhook_events,
      );

      db.prepare(
        `UPDATE jobs SET status = 'replayed', replayed_as = ? WHERE id = ?`,
      ).run(newId, original.id);

      // DR-0021: one audit row per job, not a single batched row.
      audit.jobReplayed({
        original_id: original.id,
        new_id: newId,
        queue,
        bulk: true,
      });

      pairs.push({ original_id: original.id, new_id: newId });
    }
  });

  txn();

  return c.json({ replayed: pairs, total: pairs.length });
});

export default app;
