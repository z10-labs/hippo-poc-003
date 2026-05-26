/**
 * F-11 Job Batching — batch assembly and dispatch.
 *
 * DR-0014: batch assembly storage — separate batch_staging table + batch_id
 *          column on jobs. Survives restart without resetting the maxWaitMs
 *          deadline clock.
 * DR-0015: partial failure semantics — when the batch handler rejects, each
 *          job retries individually using its own attempt counter and backoff.
 * DR-0016: rate limit interaction — a batch counts as one dispatch token,
 *          preserving F-10's per-dispatch semantics (DR-0012).
 */

import { randomUUID } from 'node:crypto';
import { getDb } from '../db/client.js';
import { getAllRegistered } from './registry.js';
import { audit } from '../audit.js';
import { tryConsume, getQueueLimit } from './rate-limiter.js';
import { withTimeout, calcBackoffMs } from '../utils.js';
import { fireWebhook } from '../webhook.js';
import type { JobRow } from '../types.js';

// ---------------------------------------------------------------------------
// Batch assembly
// ---------------------------------------------------------------------------

/**
 * For each registered batch type, inspect pending jobs and either
 * - create a new batch_staging row and assign jobs to it, or
 * - extend an existing in-flight batch with newly enqueued jobs.
 *
 * A batch is dispatched immediately once maxSize is reached.
 * A batch that has not reached maxSize is dispatched once
 * oldest_enqueued_at + maxWaitMs <= now.
 */
function assembleAndDispatch(): void {
  const db = getDb();
  const now = Date.now();

  for (const [type, handlerDef] of getAllRegistered()) {
    if (!handlerDef.batch || !handlerDef.batchHandler) continue;

    const { maxSize, maxWaitMs } = handlerDef.batch;

    // -----------------------------------------------------------------------
    // Step 1 — collect any pending jobs not yet assigned to a batch.
    // Respect priority ordering (F-09): highest priority first, then oldest.
    // -----------------------------------------------------------------------
    const unassigned = db
      .prepare(
        `SELECT * FROM jobs
          WHERE type = ? AND status = 'pending' AND eligible_at <= ? AND batch_id IS NULL
          ORDER BY priority DESC, enqueued_at ASC`,
      )
      .all(type, now) as JobRow[];

    if (unassigned.length > 0) {
      // Find or create the current open batch for this type.
      const openBatch = db
        .prepare(
          `SELECT batch_id, oldest_enqueued_at FROM batch_staging WHERE type = ? LIMIT 1`,
        )
        .get(type) as { batch_id: string; oldest_enqueued_at: number } | undefined;

      if (openBatch) {
        // Assign newly eligible unassigned jobs to the existing open batch.
        const assign = db.prepare(
          `UPDATE jobs SET batch_id = ? WHERE id = ? AND status = 'pending' AND batch_id IS NULL`,
        );
        for (const job of unassigned) {
          assign.run(openBatch.batch_id, job.id);
        }
        // Keep oldest_enqueued_at accurate.
        const newOldest = Math.min(openBatch.oldest_enqueued_at, ...unassigned.map((j) => j.enqueued_at));
        if (newOldest < openBatch.oldest_enqueued_at) {
          db.prepare(`UPDATE batch_staging SET oldest_enqueued_at = ? WHERE batch_id = ?`)
            .run(newOldest, openBatch.batch_id);
        }
      } else {
        // No open batch — create one and assign these jobs.
        const batchId = randomUUID();
        const oldestEnqueuedAt = Math.min(...unassigned.map((j) => j.enqueued_at));
        db.prepare(
          `INSERT INTO batch_staging (batch_id, type, oldest_enqueued_at, created_at)
           VALUES (?, ?, ?, ?)`,
        ).run(batchId, type, oldestEnqueuedAt, now);

        const assign = db.prepare(
          `UPDATE jobs SET batch_id = ? WHERE id = ? AND status = 'pending' AND batch_id IS NULL`,
        );
        for (const job of unassigned) {
          assign.run(batchId, job.id);
        }
      }
    }

    // -----------------------------------------------------------------------
    // Step 2 — check whether any open batch for this type is ready to fire.
    // -----------------------------------------------------------------------
    const openBatch = db
      .prepare(
        `SELECT batch_id, oldest_enqueued_at FROM batch_staging WHERE type = ? LIMIT 1`,
      )
      .get(type) as { batch_id: string; oldest_enqueued_at: number } | undefined;

    if (!openBatch) continue;

    // Count jobs assigned to this batch.
    const { count: batchCount } = db
      .prepare(
        `SELECT COUNT(*) AS count FROM jobs WHERE batch_id = ? AND status = 'pending'`,
      )
      .get(openBatch.batch_id) as { count: number };

    const deadlineExpired = now >= openBatch.oldest_enqueued_at + maxWaitMs;
    const batchFull = batchCount >= maxSize;

    if (batchCount === 0) {
      // All jobs were claimed or cancelled — clean up the staging row.
      db.prepare(`DELETE FROM batch_staging WHERE batch_id = ?`).run(openBatch.batch_id);
      continue;
    }

    if (!batchFull && !deadlineExpired) continue;

    // -----------------------------------------------------------------------
    // Step 3 — dispatch the batch (one rate-limit token per batch — DR-0016).
    // -----------------------------------------------------------------------

    // Fetch the queue for the first job in this batch (all jobs share queue).
    const firstJob = db
      .prepare(`SELECT queue FROM jobs WHERE batch_id = ? AND status = 'pending' LIMIT 1`)
      .get(openBatch.batch_id) as { queue: string } | undefined;

    if (!firstJob) {
      db.prepare(`DELETE FROM batch_staging WHERE batch_id = ?`).run(openBatch.batch_id);
      continue;
    }

    const { allowed, isNewThrottle } = tryConsume(firstJob.queue);

    if (!allowed) {
      if (isNewThrottle) {
        const { pending_count } = db
          .prepare(
            `SELECT COUNT(*) AS pending_count FROM jobs WHERE queue = ? AND status = 'pending'`,
          )
          .get(firstJob.queue) as { pending_count: number };
        const limit = getQueueLimit(firstJob.queue) ?? 0;
        audit.queueRateLimited({ queue: firstJob.queue, pending_count, limit });
      }
      continue;
    }

    // Fetch the full job rows for the batch before changing status.
    const batchJobRows = db
      .prepare(
        `SELECT * FROM jobs WHERE batch_id = ? AND status = 'pending'
         ORDER BY priority DESC, enqueued_at ASC`,
      )
      .all(openBatch.batch_id) as JobRow[];

    if (batchJobRows.length === 0) {
      db.prepare(`DELETE FROM batch_staging WHERE batch_id = ?`).run(openBatch.batch_id);
      continue;
    }

    const batchId = openBatch.batch_id;

    // Atomically claim all jobs in the batch.
    const claim = db.prepare(
      `UPDATE jobs SET status = 'running', started_at = ?, attempt = attempt + 1
        WHERE id = ? AND status = 'pending' AND batch_id = ?`,
    );

    const claimedJobs: JobRow[] = [];
    for (const job of batchJobRows) {
      const result = claim.run(now, job.id, batchId);
      if (result.changes === 1) {
        claimedJobs.push({ ...job, attempt: job.attempt + 1 });
      }
    }

    if (claimedJobs.length === 0) {
      db.prepare(`DELETE FROM batch_staging WHERE batch_id = ?`).run(batchId);
      continue;
    }

    // Remove the staging row — batch is now in flight.
    db.prepare(`DELETE FROM batch_staging WHERE batch_id = ?`).run(batchId);

    // Insert attempt rows for each job.
    const insertAttempt = db.prepare(
      `INSERT INTO attempts (job_id, attempt, started_at) VALUES (?, ?, ?)`,
    );
    for (const job of claimedJobs) {
      insertAttempt.run(job.id, job.attempt, now);
    }

    audit.jobBatchDispatched({
      batch_id: batchId,
      type,
      job_ids: claimedJobs.map((j) => j.id),
      batch_size: claimedJobs.length,
    });

    const batchHandler = handlerDef.batchHandler;
    const timeout = handlerDef.timeout;

    // Run the batch handler asynchronously.
    void executeBatch(
      batchId,
      type,
      claimedJobs,
      batchHandler,
      timeout,
      handlerDef.maxRetries,
      handlerDef.backoff,
    );
  }
}

// ---------------------------------------------------------------------------
// Batch execution
// ---------------------------------------------------------------------------

async function executeBatch(
  batchId: string,
  type: string,
  jobs: JobRow[],
  batchHandler: (jobs: { id: string; payload: unknown }[]) => Promise<void> | void,
  timeout: number,
  maxRetries: number,
  backoff: { strategy: 'fixed' | 'linear' | 'exponential'; delayMs: number },
): Promise<void> {
  const db = getDb();
  const dispatchStart = Date.now();

  const jobContexts = jobs.map((j) => ({
    id: j.id,
    payload: JSON.parse(j.payload) as unknown,
  }));

  let errorMsg: string | null = null;

  try {
    await withTimeout(Promise.resolve(batchHandler(jobContexts)), timeout);
  } catch (err) {
    errorMsg = err instanceof Error ? err.message : String(err);
  }

  const finishedAt = Date.now();

  if (errorMsg === null) {
    // All jobs in the batch succeeded.
    const completeJob = db.prepare(
      `UPDATE jobs SET status = 'completed', completed_at = ?, error = NULL, batch_id = NULL
        WHERE id = ?`,
    );
    const completeAttempt = db.prepare(
      `UPDATE attempts SET completed_at = ?, duration_ms = ?, error = NULL
        WHERE job_id = ? AND attempt = ?`,
    );

    for (const job of jobs) {
      completeJob.run(finishedAt, job.id);
      completeAttempt.run(finishedAt, finishedAt - dispatchStart, job.id, job.attempt);
      audit.jobCompleted({
        job_id: job.id,
        attempt: job.attempt,
        duration_ms: finishedAt - dispatchStart,
      });
      const snapshot = {
        id: job.id,
        type,
        queue: job.queue,
        payload: JSON.parse(job.payload) as unknown,
      };
      fireWebhook(job.id, job.webhook_url, job.webhook_events, 'completed', snapshot);
    }
  } else {
    // Batch handler rejected — each job retries individually (DR-0015).
    for (const job of jobs) {
      const duration = finishedAt - dispatchStart;
      db.prepare(
        `UPDATE attempts SET completed_at = ?, duration_ms = ?, error = ?
          WHERE job_id = ? AND attempt = ?`,
      ).run(finishedAt, duration, errorMsg, job.id, job.attempt);

      audit.jobBatchFailed({
        job_id: job.id,
        batch_id: batchId,
        attempt: job.attempt,
        error: errorMsg,
      });

      const snapshot = {
        id: job.id,
        type,
        queue: job.queue,
        payload: JSON.parse(job.payload) as unknown,
      };

      if (job.attempt > maxRetries) {
        // Exhausted retries — send to DLQ individually.
        db.prepare(
          `UPDATE jobs SET status = 'dlq', error = ?, completed_at = ?, batch_id = NULL WHERE id = ?`,
        ).run(errorMsg, finishedAt, job.id);
        audit.jobDlq({ job_id: job.id, final_attempt: job.attempt, reason: errorMsg });
        fireWebhook(job.id, job.webhook_url, job.webhook_events, 'dlq', snapshot);
      } else {
        // Reset to pending with backoff so it can join the next batch.
        const delay = calcBackoffMs(backoff.strategy, backoff.delayMs, job.attempt);
        db.prepare(
          `UPDATE jobs SET status = 'pending', error = ?, eligible_at = ?, batch_id = NULL
            WHERE id = ?`,
        ).run(errorMsg, finishedAt + delay, job.id);
        audit.jobFailed({ job_id: job.id, attempt: job.attempt, error_message: errorMsg });
        fireWebhook(job.id, job.webhook_url, job.webhook_events, 'failed', snapshot);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

let batchTimer: NodeJS.Timeout | null = null;

export function startBatchWorker(): void {
  batchTimer = setInterval(assembleAndDispatch, 100);
}

export function stopBatchWorker(): void {
  if (batchTimer) {
    clearInterval(batchTimer);
    batchTimer = null;
  }
}
