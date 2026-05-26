/**
 * F-10 Per-Queue Rate Limiting — fixed-window, 1-second granularity.
 *
 * DR-0011: hybrid storage — in-memory Map for hot path, SQLite upsert per
 *          dispatch for restart-survival.
 * DR-0012: fixed-window algorithm — simplest that satisfies the spec, maps
 *          cleanly to the hybrid storage, and integrates with the DR-0009
 *          two-pass tick without altering priority ordering.
 */

import { getDb } from '../db/client.js';

interface WindowState {
  windowStart: number;
  count: number;
}

/** Configured limits: queue name → jobs per second (null = unlimited). */
const limits = new Map<string, number>();

/** In-memory hot state (DR-0011 hybrid). */
const windows = new Map<string, WindowState>();

/** Tracks which queues were rate-limited in the previous tick (DR-0013 edge-trigger). */
const wasLimited = new Set<string>();

const WINDOW_MS = 1_000;

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export function setQueueLimit(queue: string, rateLimit: number): void {
  limits.set(queue, rateLimit);
}

export function getQueueLimit(queue: string): number | null {
  return limits.get(queue) ?? null;
}

export function getAllLimits(): ReadonlyMap<string, number> {
  return limits;
}

// ---------------------------------------------------------------------------
// Startup — warm in-memory state from SQLite (DR-0011)
// ---------------------------------------------------------------------------

export function loadWindowsFromDb(): void {
  const rows = getDb()
    .prepare(`SELECT queue, window_start, count FROM rate_limit_windows`)
    .all() as { queue: string; window_start: number; count: number }[];

  for (const row of rows) {
    windows.set(row.queue, { windowStart: row.window_start, count: row.count });
  }
}

// ---------------------------------------------------------------------------
// Rate limit check — called once per queue per tick (DR-0012)
// ---------------------------------------------------------------------------

/**
 * Returns true if a dispatch is allowed for this queue right now.
 * Increments the counter and flushes to SQLite when a dispatch IS allowed.
 *
 * When false is returned the caller must NOT dispatch and must log a
 * queue.rate_limited audit event (edge-triggered: only on the first tick
 * the queue becomes throttled — DR-0013).
 */
export function tryConsume(queue: string): { allowed: boolean; isNewThrottle: boolean } {
  const limit = limits.get(queue);
  if (limit === undefined) {
    // No limit configured — always allowed, clear any prior throttle state.
    wasLimited.delete(queue);
    return { allowed: true, isNewThrottle: false };
  }

  const now = Date.now();
  let state = windows.get(queue);

  if (!state || now >= state.windowStart + WINDOW_MS) {
    // New window — reset counter.
    state = { windowStart: now, count: 0 };
    windows.set(queue, state);
  }

  if (state.count >= limit) {
    const isNew = !wasLimited.has(queue);
    wasLimited.add(queue);
    return { allowed: false, isNewThrottle: isNew };
  }

  // Allow the dispatch: increment and flush.
  state.count += 1;
  wasLimited.delete(queue);

  getDb()
    .prepare(
      `INSERT INTO rate_limit_windows (queue, window_start, count)
       VALUES (?, ?, ?)
       ON CONFLICT(queue) DO UPDATE SET window_start = excluded.window_start,
                                        count        = excluded.count`,
    )
    .run(queue, state.windowStart, state.count);

  return { allowed: true, isNewThrottle: false };
}

// ---------------------------------------------------------------------------
// Metrics — dispatches over the last 10 seconds per queue (for GET /queues)
// ---------------------------------------------------------------------------

/**
 * Returns the number of dispatches recorded in the last 10 seconds for a queue.
 * Uses the audit_log `job.started` events as the dispatch record.
 */
export function currentRateForQueue(queue: string): number {
  const since = Date.now() - 10_000;
  const { count } = getDb()
    .prepare(
      `SELECT COUNT(*) AS count
         FROM audit_log al
         JOIN jobs j ON j.id = al.job_id
        WHERE al.event = 'job.started'
          AND al.created_at >= ?
          AND j.queue = ?`,
    )
    .get(since, queue) as { count: number };
  return count;
}
