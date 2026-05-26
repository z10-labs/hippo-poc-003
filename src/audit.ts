import { createHash } from 'node:crypto';
import { getDb } from './db/client.js';

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function write(event: string, jobId: string | null, data: Record<string, unknown>): void {
  getDb()
    .prepare(`INSERT INTO audit_log (event, job_id, created_at, data) VALUES (?, ?, ?, ?)`)
    .run(event, jobId, Date.now(), JSON.stringify(data));
}

export const audit = {
  jobEnqueued(p: {
    job_id: string; type: string; queue: string;
    priority: number; delay_ms: number; payload: string;
  }): void {
    write('job.enqueued', p.job_id, {
      job_id: p.job_id, type: p.type, queue: p.queue,
      priority: p.priority, delay_ms: p.delay_ms, payload_hash: sha256(p.payload),
    });
  },

  jobStarted(p: { job_id: string; attempt: number; worker_id: string }): void {
    write('job.started', p.job_id, p);
  },

  jobCompleted(p: { job_id: string; attempt: number; duration_ms: number }): void {
    write('job.completed', p.job_id, p);
  },

  jobFailed(p: { job_id: string; attempt: number; error_message: string }): void {
    write('job.failed', p.job_id, p);
  },

  jobDlq(p: { job_id: string; final_attempt: number; reason: string }): void {
    write('job.dlq', p.job_id, p);
  },

  jobCancelled(p: { job_id: string; cancelled_by: string }): void {
    write('job.cancelled', p.job_id, p);
  },

  /**
   * F-13: fired for each job replay (single or bulk).
   * Fields per spec: original_id, new_id, queue, bulk.
   * DR-0021: one row written per job even in bulk replay.
   */
  jobReplayed(p: { original_id: string; new_id: string; queue: string; bulk: boolean }): void {
    write('job.replayed', p.new_id, p);
  },

  webhookSent(p: { job_id: string; url: string; http_status: number; duration_ms: number }): void {
    write('webhook.sent', p.job_id, {
      job_id: p.job_id, url_hash: sha256(p.url),
      http_status: p.http_status, duration_ms: p.duration_ms,
    });
  },

  webhookFailed(p: { job_id: string; url: string; error: string }): void {
    write('webhook.failed', p.job_id, {
      job_id: p.job_id, url_hash: sha256(p.url), error: p.error,
    });
  },

  webhookDlq(p: { job_id: string; url: string; attempts: number }): void {
    write('webhook.dlq', p.job_id, {
      job_id: p.job_id, url_hash: sha256(p.url), attempts: p.attempts,
    });
  },

  jobPromoted(p: { job_id: string; priority: number; wait_ms: number; max_wait_ms: number }): void {
    write('job.promoted', p.job_id, p);
  },

  scheduledFired(p: { job_type: string; scheduled_at: number; fired_at: number }): void {
    write('scheduled.fired', null, p);
  },

  scheduledSkipped(p: { job_type: string; reason: string }): void {
    write('scheduled.skipped', null, p);
  },

  /**
   * F-10: fired when a queue's rate limit is hit for the first time in a
   * throttle window (edge-triggered, per DR-0013).
   */
  queueRateLimited(p: { queue: string; pending_count: number; limit: number }): void {
    write('queue.rate_limited', null, p);
  },

  /**
   * F-11: fired when a batch is dispatched to the handler.
   * job_id is null since the event is batch-level, not per-job.
   */
  jobBatchDispatched(p: { batch_id: string; type: string; job_ids: string[]; batch_size: number }): void {
    write('job.batch_dispatched', null, p);
  },

  /**
   * F-11: fired for each individual job when the batch handler rejects.
   */
  jobBatchFailed(p: { job_id: string; batch_id: string; attempt: number; error: string }): void {
    write('job.batch_failed', p.job_id, p);
  },

  /**
   * F-12: fired when a handler exceeds its declared timeoutMs.
   * Fields match the spec: job_id, type, duration_ms, policy, attempt.
   */
  jobTimeout(p: {
    job_id: string;
    type: string;
    duration_ms: number;
    policy: string;
    attempt: number;
  }): void {
    write('job.timeout', p.job_id, p);
  },
};
