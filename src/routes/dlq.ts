import { Hono } from 'hono';
import { randomUUID } from 'node:crypto';
import { getDb } from '../db/client.js';
import { audit } from '../audit.js';
import type { JobRow, AttemptRow } from '../types.js';

const app = new Hono();

// GET /dlq
app.get('/', (c) => {
  const db = getDb();
  const { limit = '20', offset = '0' } = c.req.query();

  const lim = Math.min(parseInt(limit) || 20, 200);
  const off = parseInt(offset) || 0;

  const jobs = db
    .prepare(
      `SELECT * FROM jobs WHERE status = 'dlq'
        ORDER BY completed_at DESC LIMIT ? OFFSET ?`,
    )
    .all(lim, off) as JobRow[];

  const { count } = db
    .prepare(`SELECT COUNT(*) AS count FROM jobs WHERE status = 'dlq'`)
    .get() as { count: number };

  const data = jobs.map((job) => {
    const attempts = db
      .prepare('SELECT * FROM attempts WHERE job_id = ? ORDER BY attempt ASC')
      .all(job.id) as AttemptRow[];

    return {
      id: job.id,
      type: job.type,
      queue: job.queue,
      payload: JSON.parse(job.payload) as unknown,
      final_error: job.error,
      enqueued_at: job.enqueued_at,
      completed_at: job.completed_at,
      attempt_count: job.attempt,
      attempts,
    };
  });

  return c.json({ data, total: count, limit: lim, offset: off });
});

// POST /dlq/:id/replay — re-enqueue as a new job (F-13: also available at POST /jobs/:id/replay)
app.post('/:id/replay', (c) => {
  const db = getDb();
  const id = c.req.param('id');

  const original = db
    .prepare(`SELECT * FROM jobs WHERE id = ? AND status = 'dlq'`)
    .get(id) as JobRow | undefined;

  if (!original) {
    const job = db.prepare(`SELECT status FROM jobs WHERE id = ?`).get(id) as { status: string } | undefined;
    if (job?.status === 'replayed') return c.json({ error: 'Job has already been replayed' }, 409);
    return c.json({ error: 'DLQ entry not found' }, 404);
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

// DELETE /dlq/:id
app.delete('/:id', (c) => {
  const db = getDb();
  const id = c.req.param('id');

  const result = db
    .prepare(`DELETE FROM jobs WHERE id = ? AND status = 'dlq'`)
    .run(id);

  if (result.changes === 0) return c.json({ error: 'DLQ entry not found' }, 404);
  return c.json({ message: 'Deleted' });
});

export default app;
