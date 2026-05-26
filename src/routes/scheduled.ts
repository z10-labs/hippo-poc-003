import { Hono } from 'hono';
import { getDb } from '../db/client.js';
import type { ScheduledJobRow, ScheduledResult } from '../types.js';

const app = new Hono();

// GET /scheduled
app.get('/', (c) => {
  const db = getDb();

  const rows = db
    .prepare(`SELECT * FROM scheduled_jobs ORDER BY type ASC`)
    .all() as ScheduledJobRow[];

  const data = rows.map((row) => ({
    type: row.type,
    cron: row.cron,
    last_run_at: row.last_run_at,
    next_run_at: row.next_run_at,
    results: JSON.parse(row.last_20_results) as ScheduledResult[],
  }));

  return c.json(data);
});

export default app;
