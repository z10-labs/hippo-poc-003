import { getDb } from './db/client.js';
import { deliverWebhook } from './webhook.js';
import { calcBackoffMs } from './utils.js';
import { audit } from './audit.js';
import type { WebhookQueueRow } from './types.js';

const MAX_ATTEMPTS = parseInt(process.env.FORGE_WEBHOOK_MAX_RETRIES ?? '5');
const BACKOFF_MS = parseInt(process.env.FORGE_WEBHOOK_BACKOFF_MS ?? '1000');

export function enqueueWebhookDelivery(
  jobId: string,
  url: string,
  event: string,
  body: unknown,
): void {
  const now = Date.now();
  getDb()
    .prepare(
      `INSERT INTO webhook_queue
         (job_id, url, event, body, status, attempt, eligible_at, created_at)
       VALUES (?, ?, ?, ?, 'pending', 0, ?, ?)`,
    )
    .run(jobId, url, event, JSON.stringify(body), now, now);
}

function resetStuckDeliveries(): void {
  getDb()
    .prepare(`UPDATE webhook_queue SET status = 'pending', eligible_at = ? WHERE status = 'sending'`)
    .run(Date.now());
}

async function processDelivery(entry: WebhookQueueRow): Promise<void> {
  const db = getDb();

  const claim = db
    .prepare(`UPDATE webhook_queue SET status = 'sending' WHERE id = ? AND status = 'pending'`)
    .run(entry.id);
  if (claim.changes === 0) return;

  const attempt = entry.attempt + 1;
  const result = await deliverWebhook(entry.job_id, entry.url, entry.event, JSON.parse(entry.body) as unknown);

  if (result.outcome === 'success') {
    db.prepare(`UPDATE webhook_queue SET status = 'delivered', attempt = ? WHERE id = ?`).run(
      attempt,
      entry.id,
    );
    audit.webhookSent({
      job_id: entry.job_id,
      url: entry.url,
      http_status: result.statusCode!,
      duration_ms: result.responseTime,
    });
  } else {
    const errMsg = result.error ?? 'unknown error';
    if (attempt >= MAX_ATTEMPTS) {
      db.prepare(
        `UPDATE webhook_queue SET status = 'dlq', attempt = ?, last_error = ? WHERE id = ?`,
      ).run(attempt, errMsg, entry.id);
      audit.webhookDlq({ job_id: entry.job_id, url: entry.url, attempts: attempt });
    } else {
      const backoff = calcBackoffMs('exponential', BACKOFF_MS, attempt);
      db.prepare(
        `UPDATE webhook_queue SET status = 'pending', attempt = ?, eligible_at = ?, last_error = ? WHERE id = ?`,
      ).run(attempt, Date.now() + backoff, errMsg, entry.id);
      audit.webhookFailed({ job_id: entry.job_id, url: entry.url, error: errMsg });
    }
  }
}

function tick(): void {
  const now = Date.now();
  const entries = getDb()
    .prepare(
      `SELECT * FROM webhook_queue WHERE status = 'pending' AND eligible_at <= ? LIMIT 20`,
    )
    .all(now) as WebhookQueueRow[];

  for (const entry of entries) {
    processDelivery(entry).catch((err: unknown) => {
      console.error(`[forge:webhook-worker] Error processing delivery ${entry.id}:`, err);
    });
  }
}

let webhookTimer: NodeJS.Timeout | null = null;

export function startWebhookWorker(): void {
  resetStuckDeliveries();
  webhookTimer = setInterval(tick, 1_000);
}

export function stopWebhookWorker(): void {
  if (webhookTimer) {
    clearInterval(webhookTimer);
    webhookTimer = null;
  }
}
