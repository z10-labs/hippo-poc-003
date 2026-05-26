import { getDb } from '../db/client.js';
import { getAllRegistered, getHandler } from './registry.js';
import { fireWebhook } from '../webhook.js';
import { withTimeout, calcBackoffMs, TimeoutError } from '../utils.js';
import { audit } from '../audit.js';
import { tryConsume, loadWindowsFromDb, getQueueLimit } from './rate-limiter.js';
import { randomUUID } from 'node:crypto';
import type { JobRow } from '../types.js';

const WORKER_ID = process.pid.toString();

const runningByType = new Map<string, number>();

function getRunning(type: string): number {
  return runningByType.get(type) ?? 0;
}

function incRunning(type: string): void {
  runningByType.set(type, getRunning(type) + 1);
}

function decRunning(type: string): void {
  runningByType.set(type, Math.max(0, getRunning(type) - 1));
}

export function getRunningByType(): ReadonlyMap<string, number> {
  return runningByType;
}

async function executeJob(job: JobRow): Promise<void> {
  const handler = getHandler(job.type);
  if (!handler) return;

  const db = getDb();
  const now = Date.now();

  // Atomically claim the job — guards against double-dispatch
  const claim = db
    .prepare(
      `UPDATE jobs
          SET status = 'running', started_at = ?, attempt = attempt + 1
        WHERE id = ? AND status = 'pending'`,
    )
    .run(now, job.id);

  if (claim.changes === 0) return;

  incRunning(job.type);

  const attempt = job.attempt + 1;
  const attemptStart = Date.now();

  // F-12: resolve the effective timeout — timeoutMs takes precedence when declared
  // alongside timeoutPolicy; falls back to the legacy timeout field.
  const effectiveTimeoutMs = handler.timeoutMs ?? handler.timeout;

  db.prepare(
    `INSERT INTO attempts (job_id, attempt, started_at) VALUES (?, ?, ?)`,
  ).run(job.id, attempt, attemptStart);

  audit.jobStarted({ job_id: job.id, attempt, worker_id: WORKER_ID });

  let errorMsg: string | null = null;
  let success = false;
  let timedOut = false;

  try {
    await withTimeout(
      Promise.resolve(
        handler.handler({
          id: job.id,
          type: job.type,
          payload: JSON.parse(job.payload) as unknown,
          attempt,
        }),
      ),
      effectiveTimeoutMs,
    );
    success = true;
  } catch (err) {
    if (err instanceof TimeoutError) {
      timedOut = true;
      errorMsg = err.message;
    } else {
      errorMsg = err instanceof Error ? err.message : String(err);
    }
  } finally {
    decRunning(job.type);
  }

  const finishedAt = Date.now();
  const duration = finishedAt - attemptStart;

  db.prepare(
    `UPDATE attempts SET completed_at = ?, duration_ms = ?, error = ?
      WHERE job_id = ? AND attempt = ?`,
  ).run(finishedAt, duration, errorMsg, job.id, attempt);

  const snapshot = {
    id: job.id,
    type: job.type,
    queue: job.queue,
    payload: JSON.parse(job.payload) as unknown,
  };

  if (success) {
    // On success, reset the consecutive_timeout_count (escalation resets — spec).
    db.prepare(
      `UPDATE jobs
          SET status = 'completed', completed_at = ?, error = NULL,
              consecutive_timeout_count = 0
        WHERE id = ?`,
    ).run(finishedAt, job.id);

    audit.jobCompleted({ job_id: job.id, attempt, duration_ms: duration });
    fireWebhook(job.id, job.webhook_url, job.webhook_events, 'completed', snapshot);
  } else if (timedOut && handler.timeoutPolicy) {
    // F-12: timeout with an explicit policy declared — apply escalation logic.
    // Read the current consecutive count from DB (not from the in-memory job row
    // snapshot, which may be stale after a restart).
    const { consecutive_timeout_count: prevCount } = db
      .prepare(`SELECT consecutive_timeout_count FROM jobs WHERE id = ?`)
      .get(job.id) as { consecutive_timeout_count: number };

    const newCount = prevCount + 1;

    // Update timeout tracking fields unconditionally.
    db.prepare(
      `UPDATE jobs
          SET timed_out_at = ?, consecutive_timeout_count = ?
        WHERE id = ?`,
    ).run(finishedAt, newCount, job.id);

    const policy = handler.timeoutPolicy;

    // Determine effective action: 'retry' | 'dlq'
    let action: 'retry' | 'dlq';
    if (policy === 'retry') {
      action = 'retry';
    } else if (policy === 'dlq') {
      action = 'dlq';
    } else {
      // escalate: first consecutive timeout → retry; second+ → dlq
      action = newCount >= 2 ? 'dlq' : 'retry';
    }

    audit.jobTimeout({
      job_id: job.id,
      type: job.type,
      duration_ms: duration,
      policy,
      attempt,
    });

    if (action === 'dlq') {
      db.prepare(
        `UPDATE jobs SET status = 'dlq', error = ?, completed_at = ? WHERE id = ?`,
      ).run(errorMsg, finishedAt, job.id);

      audit.jobDlq({ job_id: job.id, final_attempt: attempt, reason: errorMsg ?? 'timeout' });
      fireWebhook(job.id, job.webhook_url, job.webhook_events, 'dlq', snapshot);
    } else {
      // Retry: count as a failed attempt and reschedule with backoff.
      const delay = calcBackoffMs(handler.backoff.strategy, handler.backoff.delayMs, attempt);
      db.prepare(
        `UPDATE jobs SET status = 'pending', error = ?, eligible_at = ? WHERE id = ?`,
      ).run(errorMsg, finishedAt + delay, job.id);

      audit.jobFailed({ job_id: job.id, attempt, error_message: errorMsg ?? 'timeout' });
    }
  } else {
    // Normal failure (non-timeout, or timeout without an explicit timeoutPolicy).
    audit.jobFailed({ job_id: job.id, attempt, error_message: errorMsg ?? 'unknown' });
    fireWebhook(job.id, job.webhook_url, job.webhook_events, 'failed', snapshot);

    if (attempt > handler.maxRetries) {
      db.prepare(
        `UPDATE jobs SET status = 'dlq', error = ?, completed_at = ? WHERE id = ?`,
      ).run(errorMsg, finishedAt, job.id);

      audit.jobDlq({ job_id: job.id, final_attempt: attempt, reason: errorMsg ?? 'unknown' });
      fireWebhook(job.id, job.webhook_url, job.webhook_events, 'dlq', snapshot);
    } else {
      const delay = calcBackoffMs(handler.backoff.strategy, handler.backoff.delayMs, attempt);
      db.prepare(
        `UPDATE jobs SET status = 'pending', error = ?, eligible_at = ? WHERE id = ?`,
      ).run(errorMsg, finishedAt + delay, job.id);
    }
  }
}

/**
 * Attempt to dispatch one job respecting the queue rate limit (F-10, DR-0012).
 * Returns true if the dispatch was allowed and started, false if rate-limited.
 * When rate-limited for the first time in a throttle window, emits the
 * queue.rate_limited audit event (edge-triggered, DR-0013).
 */
function dispatchWithRateLimit(db: ReturnType<typeof getDb>, job: JobRow): boolean {
  const { allowed, isNewThrottle } = tryConsume(job.queue);

  if (!allowed) {
    if (isNewThrottle) {
      const { pending_count } = db
        .prepare(`SELECT COUNT(*) AS pending_count FROM jobs WHERE queue = ? AND status = 'pending'`)
        .get(job.queue) as { pending_count: number };

      const limit = getQueueLimit(job.queue) ?? 0;
      audit.queueRateLimited({ queue: job.queue, pending_count, limit });
    }
    return false;
  }

  executeJob(job).catch((err: unknown) => {
    console.error(`[forge:worker] Unhandled error executing job ${job.id}:`, err);
  });
  return true;
}

function tick(): void {
  const db = getDb();
  const now = Date.now();

  for (const [type, handlerDef] of getAllRegistered()) {
    // F-11: batch types are handled by the batch worker, not the scalar worker.
    if (handlerDef.batch) continue;

    let available = handlerDef.concurrency - getRunning(type);
    if (available <= 0) continue;

    const starvationCutoff = now - handlerDef.maxWaitMs;

    // Pass 1 — starvation candidates: jobs waiting longer than maxWaitMs,
    // regardless of priority, ordered by wait time (oldest first).
    const starvedJobs = db
      .prepare(
        `SELECT * FROM jobs
          WHERE type = ? AND status = 'pending' AND eligible_at <= ?
            AND enqueued_at <= ?
          ORDER BY enqueued_at ASC
          LIMIT ?`,
      )
      .all(type, now, starvationCutoff, available) as JobRow[];

    const dispatched = new Set<string>();

    for (const job of starvedJobs) {
      if (!dispatchWithRateLimit(db, job)) continue;
      // Only log promotion once we know the dispatch was actually allowed.
      const waitMs = now - job.enqueued_at;
      audit.jobPromoted({
        job_id: job.id,
        priority: job.priority,
        wait_ms: waitMs,
        max_wait_ms: handlerDef.maxWaitMs,
      });
      dispatched.add(job.id);
    }

    available -= dispatched.size;
    if (available <= 0) continue;

    // Pass 2 — normal priority dispatch: highest priority first, then oldest first,
    // excluding already-dispatched starvation promotions.
    const priorityJobs = db
      .prepare(
        `SELECT * FROM jobs
          WHERE type = ? AND status = 'pending' AND eligible_at <= ?
            AND enqueued_at > ?
          ORDER BY priority DESC, enqueued_at ASC
          LIMIT ?`,
      )
      .all(type, now, starvationCutoff, available) as JobRow[];

    for (const job of priorityJobs) {
      if (dispatched.has(job.id)) continue;
      dispatchWithRateLimit(db, job);
    }
  }
}

let workerTimer: NodeJS.Timeout | null = null;

export function startWorker(): void {
  // Warm rate-limit windows from SQLite so a restart does not reset the counter (DR-0011).
  loadWindowsFromDb();
  workerTimer = setInterval(tick, 100);
}

export function stopWorker(): void {
  if (workerTimer) {
    clearInterval(workerTimer);
    workerTimer = null;
  }
}

// Re-export so routes can call it without importing registry
export { randomUUID };
