import { Hono } from 'hono';
import { getDb } from '../db/client.js';
import type { AuditLogRow } from '../types.js';

const app = new Hono();

function formatRow(row: AuditLogRow) {
  return {
    id: row.id,
    event: row.event,
    job_id: row.job_id,
    created_at: row.created_at,
    data: JSON.parse(row.data) as unknown,
  };
}

// GET /audit
app.get('/', (c) => {
  const db = getDb();
  const { job_id, event, from, to, limit = '50', offset = '0' } = c.req.query();

  const conditions: string[] = [];
  const params: (string | number)[] = [];

  if (job_id) { conditions.push('job_id = ?'); params.push(job_id); }
  if (event) { conditions.push('event = ?'); params.push(event); }
  if (from) { conditions.push('created_at >= ?'); params.push(parseInt(from)); }
  if (to) { conditions.push('created_at <= ?'); params.push(parseInt(to)); }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const lim = Math.min(parseInt(limit) || 50, 500);
  const off = parseInt(offset) || 0;

  const rows = db
    .prepare(
      `SELECT * FROM audit_log ${where} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`,
    )
    .all(...params, lim, off) as AuditLogRow[];

  const { count } = db
    .prepare(`SELECT COUNT(*) AS count FROM audit_log ${where}`)
    .get(...params) as { count: number };

  return c.json({ data: rows.map(formatRow), total: count, limit: lim, offset: off });
});

// GET /audit/export
app.get('/export', (c) => {
  const db = getDb();
  const { from, to } = c.req.query();

  const conditions: string[] = [];
  const params: (string | number)[] = [];

  if (from) { conditions.push('created_at >= ?'); params.push(parseInt(from)); }
  if (to) { conditions.push('created_at <= ?'); params.push(parseInt(to)); }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const rows = db
    .prepare(`SELECT * FROM audit_log ${where} ORDER BY created_at ASC, id ASC`)
    .all(...params) as AuditLogRow[];

  const ndjson = rows.map((row) => JSON.stringify(formatRow(row))).join('\n');

  return new Response(ndjson, {
    headers: {
      'Content-Type': 'application/x-ndjson',
      'Content-Disposition': 'attachment; filename="audit-export.ndjson"',
    },
  });
});

export default app;
