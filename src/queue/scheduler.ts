import cronParser from 'cron-parser';
import { getDb } from '../db/client.js';
import { getHandler, getAllRegistered } from './registry.js';
import { withTimeout } from '../utils.js';
import { audit } from '../audit.js';
import type { ScheduledJobRow, ScheduledResult } from '../types.js';

const runningScheduled = new Set<string>();

function nextRunTime(cron: string): number {
  return cronParser.parseExpression(cron).next().getTime();
}

export function initScheduledJobs(): void {
  const db = getDb();
  for (const [type, def] of getAllRegistered()) {
    if (!def.cron) continue;
    const next = nextRunTime(def.cron);
    db.prepare(
      `INSERT INTO scheduled_jobs (type, cron, next_run_at, last_20_results)
       VALUES (?, ?, ?, '[]')
       ON CONFLICT(type) DO UPDATE SET cron = excluded.cron`,
    ).run(type, def.cron, next);
  }
}

async function runScheduledJob(row: ScheduledJobRow): Promise<void> {
  const handler = getHandler(row.type);
  if (!handler) return;

  const db = getDb();
  const next = nextRunTime(row.cron);

  runningScheduled.add(row.type);
  db.prepare(
    `UPDATE scheduled_jobs SET last_run_at = ?, next_run_at = ? WHERE type = ?`,
  ).run(Date.now(), next, row.type);

  const start = Date.now();
  let errorMsg: string | null = null;
  let success = false;

  try {
    await withTimeout(
      Promise.resolve(
        handler.handler({
          id: `scheduled:${row.type}:${start}`,
          type: row.type,
          payload: null,
          attempt: 1,
        }),
      ),
      handler.timeout,
    );
    success = true;
  } catch (err) {
    errorMsg = err instanceof Error ? err.message : String(err);
    console.error(`[forge:scheduler] ${row.type} failed:`, errorMsg);
  } finally {
    runningScheduled.delete(row.type);
  }

  const duration = Date.now() - start;
  const results: ScheduledResult[] = JSON.parse(row.last_20_results) as ScheduledResult[];
  results.unshift({ timestamp: start, duration_ms: duration, success, error: errorMsg });
  const trimmed = results.slice(0, 20);

  db.prepare(
    `UPDATE scheduled_jobs SET last_20_results = ? WHERE type = ?`,
  ).run(JSON.stringify(trimmed), row.type);
}

function schedulerTick(): void {
  initScheduledJobs(); // sync up handlers registered after startup
  const db = getDb();
  const now = Date.now();

  const due = db
    .prepare(`SELECT * FROM scheduled_jobs WHERE next_run_at <= ?`)
    .all(now) as ScheduledJobRow[];

  for (const row of due) {
    if (runningScheduled.has(row.type)) {
      console.log(`[forge:scheduler] Skipping ${row.type} — previous run still active`);
      db.prepare(`UPDATE scheduled_jobs SET next_run_at = ? WHERE type = ?`).run(
        nextRunTime(row.cron),
        row.type,
      );
      audit.scheduledSkipped({ job_type: row.type, reason: 'overlap' });
      continue;
    }

    audit.scheduledFired({ job_type: row.type, scheduled_at: row.next_run_at, fired_at: now });
    runScheduledJob(row).catch((err: unknown) => {
      console.error(`[forge:scheduler] Unhandled error for ${row.type}:`, err);
    });
  }
}

let schedulerTimer: NodeJS.Timeout | null = null;

export function startScheduler(): void {
  initScheduledJobs();
  schedulerTick(); // catch-up on startup
  schedulerTimer = setInterval(schedulerTick, 10_000);
}

export function stopScheduler(): void {
  if (schedulerTimer) {
    clearInterval(schedulerTimer);
    schedulerTimer = null;
  }
}
