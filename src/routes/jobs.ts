import { Hono } from 'hono';
import { randomUUID } from 'node:crypto';
import { getDb } from '../db/client.js';
import { audit } from '../audit.js';
import type { JobRow, AttemptRow, WebhookDeliveryRow, WebhookQueueRow } from '../types.js';

const app = new Hono();

function formatJob(row: JobRow) {
  return {
    id: row.id,
    type: row.type,
    queue: row.queue,
    payload: JSON.parse(row.payload) as unknown,
    status: row.status,
    priority: row.priority,
    attempt: row.attempt,
    eligible_at: row.eligible_at,
    enqueued_at: row.enqueued_at,
    started_at: row.started_at,
    completed_at: row.completed_at,
    error: row.error,
    /** F-13: ID of the new pending job when this DLQ job was replayed, or null. */
    replayed_as: row.replayed_as ?? null,
    /** F-12: timestamp of the most recent timeout (ms), or null. */
    timed_out_at: row.timed_out_at ?? null,
    /** F-12: number of consecutive timeouts without a successful run. */
    consecutive_timeout_count: row.consecutive_timeout_count ?? 0,
  };
}

// POST /jobs
app.post('/', async (c) => {
  let body: Record<string, unknown>;
  try {
    body = (await c.req.json()) as Record<string, unknown>;
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  const { type, payload, queue = 'default', priority = 0, delayMs = 0, webhook } = body;

  if (!type || typeof type !== 'string') {
    return c.json({ error: '"type" is required and must be a string' }, 400);
  }

  const db = getDb();
  const id = randomUUID();
  const now = Date.now();
  const eligibleAt = now + (typeof delayMs === 'number' ? delayMs : 0);
  const wh = webhook as { url?: string; events?: string[] } | undefined;

  const resolvedQueue = typeof queue === 'string' ? queue : 'default';
  const resolvedPriority = typeof priority === 'number' ? priority : 0;
  const payloadJson = JSON.stringify(payload ?? null);

  db.prepare(
    `INSERT INTO jobs
       (id, type, queue, payload, status, priority, eligible_at, enqueued_at, webhook_url, webhook_events)
     VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?)`,
  ).run(
    id,
    type,
    resolvedQueue,
    payloadJson,
    resolvedPriority,
    eligibleAt,
    now,
    wh?.url ?? null,
    wh?.events ? JSON.stringify(wh.events) : null,
  );

  audit.jobEnqueued({
    job_id: id, type, queue: resolvedQueue, priority: resolvedPriority,
    delay_ms: typeof delayMs === 'number' ? delayMs : 0, payload: payloadJson,
  });

  return c.json({ id, type, queue, status: 'pending', enqueued_at: now }, 201);
});

// GET /jobs
app.get('/', (c) => {
  const db = getDb();
  const { queue, status, type, limit = '20', offset = '0' } = c.req.query();

  const conditions: string[] = [];
  const params: (string | number)[] = [];

  if (queue) { conditions.push('queue = ?'); params.push(queue); }
  if (status) { conditions.push('status = ?'); params.push(status); }
  if (type) { conditions.push('type = ?'); params.push(type); }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const lim = Math.min(parseInt(limit) || 20, 200);
  const off = parseInt(offset) || 0;

  const jobs = db
    .prepare(`SELECT * FROM jobs ${where} ORDER BY enqueued_at DESC LIMIT ? OFFSET ?`)
    .all(...params, lim, off) as JobRow[];

  const { count } = db
    .prepare(`SELECT COUNT(*) AS count FROM jobs ${where}`)
    .get(...params) as { count: number };

  return c.json({ data: jobs.map(formatJob), total: count, limit: lim, offset: off });
});

// GET /jobs/:id
app.get('/:id', (c) => {
  const db = getDb();
  const job = db
    .prepare('SELECT * FROM jobs WHERE id = ?')
    .get(c.req.param('id')) as JobRow | undefined;
  if (!job) return c.json({ error: 'Not found' }, 404);
  return c.json(formatJob(job));
});

// DELETE /jobs/:id — cancel if pending
app.delete('/:id', (c) => {
  const db = getDb();
  const id = c.req.param('id');

  const result = db
    .prepare(`UPDATE jobs SET status = 'cancelled' WHERE id = ? AND status = 'pending'`)
    .run(id);

  if (result.changes === 0) {
    const job = db.prepare('SELECT id FROM jobs WHERE id = ?').get(id);
    if (!job) return c.json({ error: 'Not found' }, 404);
    return c.json({ message: 'No-op: job is not in pending state' });
  }

  audit.jobCancelled({ job_id: id, cancelled_by: 'api' });
  return c.json({ message: 'Cancelled' });
});

// GET /jobs/:id/attempts
app.get('/:id/attempts', (c) => {
  const db = getDb();
  const id = c.req.param('id');

  const job = db.prepare('SELECT id FROM jobs WHERE id = ?').get(id);
  if (!job) return c.json({ error: 'Not found' }, 404);

  const attempts = db
    .prepare('SELECT * FROM attempts WHERE job_id = ? ORDER BY attempt ASC')
    .all(id) as AttemptRow[];

  return c.json(attempts);
});

// POST /jobs/:id/replay — F-13: re-enqueue a DLQ job as a new pending job
app.post('/:id/replay', (c) => {
  const db = getDb();
  const id = c.req.param('id');

  const original = db
    .prepare(`SELECT * FROM jobs WHERE id = ? AND status = 'dlq'`)
    .get(id) as JobRow | undefined;

  if (!original) {
    // Check if it exists but is already replayed (409) or simply not found (404).
    const job = db.prepare(`SELECT status FROM jobs WHERE id = ?`).get(id) as { status: string } | undefined;
    if (job?.status === 'replayed') return c.json({ error: 'Job has already been replayed' }, 409);
    return c.json({ error: 'Not found' }, 404);
  }

  const newId = randomUUID();
  const now = Date.now();

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
  ).run(newId, id);

  audit.jobReplayed({
    original_id: id,
    new_id: newId,
    queue: original.queue,
    bulk: false,
  });

  return c.json({ id: newId, replayed_from: id, status: 'pending', enqueued_at: now }, 201);
});

// GET /jobs/:id/webhooks
app.get('/:id/webhooks', (c) => {
  const db = getDb();
  const id = c.req.param('id');

  const job = db.prepare('SELECT id FROM jobs WHERE id = ?').get(id);
  if (!job) return c.json({ error: 'Not found' }, 404);

  const queue = db
    .prepare(
      `SELECT id, job_id, event, status, attempt, eligible_at, created_at, last_error
         FROM webhook_queue WHERE job_id = ? ORDER BY created_at DESC`,
    )
    .all(id) as Omit<WebhookQueueRow, 'url' | 'body'>[];

  const deliveries = db
    .prepare('SELECT * FROM webhook_deliveries WHERE job_id = ? ORDER BY attempted_at DESC')
    .all(id) as WebhookDeliveryRow[];

  return c.json({ queue, deliveries });
});

export default app;
