import { getDb } from './db/client.js';
import { enqueueWebhookDelivery } from './webhook-queue.js';

const DEGRADED_THRESHOLD = parseInt(process.env.FORGE_WEBHOOK_DEGRADED_THRESHOLD ?? '5');

export interface DeliveryResult {
  outcome: 'success' | 'failed';
  statusCode: number | null;
  responseTime: number;
  error: string | null;
}

export async function deliverWebhook(
  jobId: string,
  url: string,
  event: string,
  body: unknown,
): Promise<DeliveryResult> {
  const db = getDb();
  const start = Date.now();
  let statusCode: number | null = null;
  let outcome: 'success' | 'failed' = 'failed';
  let error: string | null = null;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event, job: body }),
      signal: AbortSignal.timeout(10_000),
    });
    statusCode = response.status;
    outcome = response.ok ? 'success' : 'failed';
    if (!response.ok) error = `HTTP ${response.status}`;
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }

  const responseTime = Date.now() - start;

  db.prepare(
    `INSERT INTO webhook_deliveries
       (job_id, event, attempted_at, status_code, response_time_ms, outcome, error)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(jobId, event, start, statusCode, responseTime, outcome, error);

  const endpoint = db.prepare(
    `SELECT consecutive_failures, degraded FROM webhook_endpoints WHERE url = ?`,
  ).get(url) as { consecutive_failures: number; degraded: number } | undefined;

  if (outcome === 'success') {
    db.prepare(
      `INSERT INTO webhook_endpoints (url, consecutive_failures, degraded)
       VALUES (?, 0, 0)
       ON CONFLICT(url) DO UPDATE SET consecutive_failures = 0, degraded = 0`,
    ).run(url);
  } else {
    const failures = (endpoint?.consecutive_failures ?? 0) + 1;
    const degraded = failures >= DEGRADED_THRESHOLD ? 1 : (endpoint?.degraded ?? 0);

    db.prepare(
      `INSERT INTO webhook_endpoints (url, consecutive_failures, degraded)
       VALUES (?, ?, ?)
       ON CONFLICT(url) DO UPDATE SET consecutive_failures = ?, degraded = ?`,
    ).run(url, failures, degraded, failures, degraded);

    if (degraded && !endpoint?.degraded) {
      console.error(`[forge:webhook] ${url} marked degraded after ${failures} consecutive failures`);
    }
  }

  return { outcome, statusCode, responseTime, error };
}

export function fireWebhook(
  jobId: string,
  webhookUrl: string | null,
  webhookEvents: string | null,
  event: 'completed' | 'failed' | 'dlq',
  jobSnapshot: unknown,
): void {
  if (!webhookUrl) return;
  const events: string[] = webhookEvents ? (JSON.parse(webhookEvents) as string[]) : [];
  if (!events.includes(event)) return;

  enqueueWebhookDelivery(jobId, webhookUrl, event, jobSnapshot);
}
