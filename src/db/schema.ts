import type Database from 'better-sqlite3';

export function applySchema(db: Database.Database): void {
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS jobs (
      id            TEXT    PRIMARY KEY,
      type          TEXT    NOT NULL,
      queue         TEXT    NOT NULL DEFAULT 'default',
      payload       TEXT    NOT NULL,
      status        TEXT    NOT NULL DEFAULT 'pending',
      priority      INTEGER NOT NULL DEFAULT 0,
      eligible_at   INTEGER NOT NULL,
      enqueued_at   INTEGER NOT NULL,
      started_at    INTEGER,
      completed_at  INTEGER,
      attempt       INTEGER NOT NULL DEFAULT 0,
      result        TEXT,
      error         TEXT,
      webhook_url   TEXT,
      webhook_events TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_jobs_dispatch
      ON jobs (type, status, priority DESC, eligible_at ASC)
      WHERE status = 'pending';

    CREATE INDEX IF NOT EXISTS idx_jobs_queue_status
      ON jobs (queue, status);

    -- Starvation promotion index: scan pending jobs by queue+type ordered by enqueued_at
    -- Used by the two-pass worker polling query introduced in F-09
    CREATE INDEX IF NOT EXISTS idx_jobs_starvation
      ON jobs (type, status, enqueued_at ASC)
      WHERE status = 'pending';

    CREATE TABLE IF NOT EXISTS attempts (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id       TEXT    NOT NULL,
      attempt      INTEGER NOT NULL,
      started_at   INTEGER NOT NULL,
      completed_at INTEGER,
      duration_ms  INTEGER,
      error        TEXT,
      FOREIGN KEY (job_id) REFERENCES jobs(id)
    );

    CREATE INDEX IF NOT EXISTS idx_attempts_job ON attempts (job_id);

    CREATE TABLE IF NOT EXISTS scheduled_jobs (
      type             TEXT    PRIMARY KEY,
      cron             TEXT    NOT NULL,
      last_run_at      INTEGER,
      next_run_at      INTEGER NOT NULL,
      last_20_results  TEXT    NOT NULL DEFAULT '[]'
    );

    CREATE TABLE IF NOT EXISTS webhook_deliveries (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id          TEXT    NOT NULL,
      event           TEXT    NOT NULL,
      attempted_at    INTEGER NOT NULL,
      status_code     INTEGER,
      response_time_ms INTEGER,
      outcome         TEXT    NOT NULL,
      error           TEXT,
      FOREIGN KEY (job_id) REFERENCES jobs(id)
    );

    CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_job
      ON webhook_deliveries (job_id);

    CREATE TABLE IF NOT EXISTS webhook_endpoints (
      url                  TEXT    PRIMARY KEY,
      consecutive_failures INTEGER NOT NULL DEFAULT 0,
      degraded             INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS webhook_queue (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id      TEXT    NOT NULL,
      url         TEXT    NOT NULL,
      event       TEXT    NOT NULL,
      body        TEXT    NOT NULL,
      status      TEXT    NOT NULL DEFAULT 'pending',
      attempt     INTEGER NOT NULL DEFAULT 0,
      eligible_at INTEGER NOT NULL,
      created_at  INTEGER NOT NULL,
      last_error  TEXT,
      FOREIGN KEY (job_id) REFERENCES jobs(id)
    );

    CREATE INDEX IF NOT EXISTS idx_webhook_queue_dispatch
      ON webhook_queue (eligible_at)
      WHERE status = 'pending';

    CREATE TABLE IF NOT EXISTS audit_log (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      event      TEXT    NOT NULL,
      job_id     TEXT,
      created_at INTEGER NOT NULL,
      data       TEXT    NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_audit_created_at ON audit_log (created_at);
    CREATE INDEX IF NOT EXISTS idx_audit_job_id     ON audit_log (job_id) WHERE job_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_audit_event      ON audit_log (event);

    -- F-10: per-queue fixed-window rate limit counters (one row per queue).
    -- Survives restart so the window is not reset after SIGTERM (DR-0011).
    CREATE TABLE IF NOT EXISTS rate_limit_windows (
      queue        TEXT    PRIMARY KEY,
      window_start INTEGER NOT NULL,
      count        INTEGER NOT NULL DEFAULT 0
    );

    -- F-11: batch assembly state — one row per in-flight batch (DR-0014).
    -- Survives restart: the worker re-reads this table on startup to resume
    -- any partially-assembled batches without resetting the maxWaitMs clock.
    CREATE TABLE IF NOT EXISTS batch_staging (
      batch_id           TEXT    PRIMARY KEY,
      type               TEXT    NOT NULL,
      oldest_enqueued_at INTEGER NOT NULL,
      created_at         INTEGER NOT NULL
    );

  `);

  // F-11: add batch_id column to jobs if it doesn't exist yet.
  // SQLite doesn't support IF NOT EXISTS for ALTER TABLE ADD COLUMN, so catch
  // the duplicate-column error and continue (idempotent on restart).
  try {
    db.exec(`ALTER TABLE jobs ADD COLUMN batch_id TEXT REFERENCES batch_staging(batch_id)`);
  } catch {
    // Column already exists — nothing to do.
  }

  // F-12: add timeout tracking columns to jobs (DR-0018).
  // Two separate try/catch blocks so one failing does not suppress the other.
  try {
    db.exec(`ALTER TABLE jobs ADD COLUMN timed_out_at INTEGER`);
  } catch {
    // Column already exists — nothing to do.
  }
  try {
    db.exec(`ALTER TABLE jobs ADD COLUMN consecutive_timeout_count INTEGER NOT NULL DEFAULT 0`);
  } catch {
    // Column already exists — nothing to do.
  }

  // F-13: replayed_as is a pointer from a DLQ job to the new pending job
  // created by the replay operation (DR-0019).
  try {
    db.exec(`ALTER TABLE jobs ADD COLUMN replayed_as TEXT REFERENCES jobs(id)`);
  } catch {
    // Column already exists — nothing to do.
  }
}
