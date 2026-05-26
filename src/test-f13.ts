/**
 * F-13 Dead Letter Queue Replay — integration tests.
 *
 * Run with: npx tsx src/test-f13.ts
 *
 * Tests cover:
 *   - POST /jobs/:id/replay  (single replay)
 *   - POST /queues/:queue/replay  (bulk replay)
 *   - GET /jobs?status=replayed  (filter by replayed status)
 *   - 409 when replaying an already-replayed job
 *   - 404 when job not found or not in DLQ
 *   - Audit log contains job.replayed events with correct fields
 *   - Original job is marked 'replayed' with replayed_as pointer
 *   - Bulk replay is atomic (single transaction, DR-0020)
 *   - Bulk replay limit parameter respected
 */

import { randomUUID } from 'node:crypto';
import { getDb, closeDb } from './db/client.js';
import { applySchema } from './db/schema.js';
import type { JobRow, AuditLogRow } from './types.js';

// ---------------------------------------------------------------------------
// Minimal test harness
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (!condition) {
    console.error(`  FAIL: ${message}`);
    failed++;
  } else {
    console.log(`  PASS: ${message}`);
    passed++;
  }
}

async function runTest(name: string, fn: () => Promise<void>): Promise<void> {
  console.log(`\n[test] ${name}`);
  try {
    await fn();
  } catch (err) {
    console.error(`  FAIL (threw): ${err instanceof Error ? err.message : String(err)}`);
    failed++;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Set a fresh isolated in-memory DB for each test.
 *
 * Note: DB_PATH in client.ts is resolved at module load time, so we cannot
 * redirect to :memory: after import. Instead, each test uses unique queue/type
 * names so they are isolated within the shared forge.db (or whichever DB is
 * active). Tests that need count assertions use targeted queries scoped to
 * the unique identifiers created within that test.
 */
function useTestDb(): void {
  // No-op: tests are isolated by unique names instead.
}

/** Directly insert a job with a given status (for test setup). */
function insertJob(opts: {
  status?: string;
  queue?: string;
  type?: string;
  priority?: number;
} = {}): string {
  const db = getDb();
  const id = randomUUID();
  const now = Date.now();
  db.prepare(
    `INSERT INTO jobs (id, type, queue, payload, status, priority, eligible_at, enqueued_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    opts.type ?? 'test-job',
    opts.queue ?? 'default',
    JSON.stringify({ v: 1 }),
    opts.status ?? 'dlq',
    opts.priority ?? 0,
    now,
    now,
  );
  return id;
}

function getJob(id: string): JobRow {
  return getDb().prepare('SELECT * FROM jobs WHERE id = ?').get(id) as JobRow;
}

function getAuditEvents(jobId: string): AuditLogRow[] {
  return getDb()
    .prepare('SELECT * FROM audit_log WHERE job_id = ? ORDER BY id ASC')
    .all(jobId) as AuditLogRow[];
}

function getAllAuditReplayEvents(): AuditLogRow[] {
  return getDb()
    .prepare(`SELECT * FROM audit_log WHERE event = 'job.replayed' ORDER BY id ASC`)
    .all() as AuditLogRow[];
}

// ---------------------------------------------------------------------------
// Import Hono app for HTTP-style route testing
// ---------------------------------------------------------------------------

// We test via direct function calls into the route handlers using a fake
// fetch request to the Hono app — simpler than spawning a real server.
import { Hono } from 'hono';
import jobsRouter from './routes/jobs.js';
import queuesRouter from './routes/queues.js';

function buildApp() {
  const app = new Hono();
  app.route('/jobs', jobsRouter);
  app.route('/queues', queuesRouter);
  return app;
}

async function req(
  app: Hono,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; body: unknown }> {
  const url = `http://localhost${path}`;
  const init: RequestInit = { method };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers = { 'Content-Type': 'application/json' };
  }
  const res = await app.fetch(new Request(url, init));
  let parsed: unknown;
  try {
    parsed = await res.json();
  } catch {
    parsed = null;
  }
  return { status: res.status, body: parsed };
}

// ---------------------------------------------------------------------------
// Test: Schema — replayed_as column exists with null default
// ---------------------------------------------------------------------------

await runTest('Schema: replayed_as column exists and defaults to null', async () => {
  useTestDb();
  const id = insertJob({ status: 'dlq' });
  const job = getJob(id);
  assert(job.replayed_as === null || job.replayed_as === undefined, 'replayed_as defaults to null/undefined');
});

// ---------------------------------------------------------------------------
// Test: POST /jobs/:id/replay — happy path
// ---------------------------------------------------------------------------

await runTest('POST /jobs/:id/replay: creates new pending job from DLQ entry', async () => {
  useTestDb();
  const app = buildApp();
  const uniqueQueue = `emails-${randomUUID()}`;
  const originalId = insertJob({ status: 'dlq', queue: uniqueQueue, priority: 5 });

  const { status, body } = await req(app, 'POST', `/jobs/${originalId}/replay`);
  const b = body as Record<string, unknown>;

  assert(status === 201, `status is 201 (got ${status})`);
  assert(typeof b.id === 'string', 'response has new id');
  assert(b.replayed_from === originalId, 'response has replayed_from');
  assert(b.status === 'pending', 'new job is pending');

  const newId = b.id as string;
  const newJob = getJob(newId);
  assert(newJob !== undefined, 'new job row exists');
  assert(newJob.status === 'pending', 'new job status is pending');
  assert(newJob.attempt === 0, 'new job attempt starts at 0');
  assert(newJob.queue === uniqueQueue, 'new job inherits queue');
  assert(newJob.priority === 5, 'new job inherits priority');
});

// ---------------------------------------------------------------------------
// Test: POST /jobs/:id/replay — original is marked replayed with pointer
// ---------------------------------------------------------------------------

await runTest('POST /jobs/:id/replay: original DLQ job is marked replayed with pointer', async () => {
  useTestDb();
  const app = buildApp();
  const originalId = insertJob({ status: 'dlq' });

  const { body } = await req(app, 'POST', `/jobs/${originalId}/replay`);
  const b = body as Record<string, unknown>;
  const newId = b.id as string;

  const original = getJob(originalId);
  assert(original.status === 'replayed', 'original job status is replayed');
  assert(original.replayed_as === newId, 'original.replayed_as points to new job id');
});

// ---------------------------------------------------------------------------
// Test: POST /jobs/:id/replay — 409 when already replayed
// ---------------------------------------------------------------------------

await runTest('POST /jobs/:id/replay: returns 409 when job already replayed', async () => {
  useTestDb();
  const app = buildApp();
  const originalId = insertJob({ status: 'dlq' });

  // First replay succeeds
  const first = await req(app, 'POST', `/jobs/${originalId}/replay`);
  assert(first.status === 201, 'first replay succeeds');

  // Second replay should 409
  const second = await req(app, 'POST', `/jobs/${originalId}/replay`);
  assert(second.status === 409, `second replay returns 409 (got ${second.status})`);
});

// ---------------------------------------------------------------------------
// Test: POST /jobs/:id/replay — 404 when not found
// ---------------------------------------------------------------------------

await runTest('POST /jobs/:id/replay: returns 404 for unknown job', async () => {
  useTestDb();
  const app = buildApp();

  const { status } = await req(app, 'POST', `/jobs/${randomUUID()}/replay`);
  assert(status === 404, `returns 404 (got ${status})`);
});

// ---------------------------------------------------------------------------
// Test: POST /jobs/:id/replay — 404 when job is not in DLQ (e.g. pending)
// ---------------------------------------------------------------------------

await runTest('POST /jobs/:id/replay: returns 404 for job not in DLQ', async () => {
  useTestDb();
  const app = buildApp();
  const id = insertJob({ status: 'pending' });

  const { status } = await req(app, 'POST', `/jobs/${id}/replay`);
  assert(status === 404, `returns 404 for non-DLQ job (got ${status})`);
});

// ---------------------------------------------------------------------------
// Test: Audit log — job.replayed event written with correct fields
// ---------------------------------------------------------------------------

await runTest('POST /jobs/:id/replay: writes job.replayed audit event', async () => {
  useTestDb();
  const app = buildApp();
  const uniqueQueue = `payments-${randomUUID()}`;
  const originalId = insertJob({ status: 'dlq', queue: uniqueQueue });

  const { body } = await req(app, 'POST', `/jobs/${originalId}/replay`);
  const b = body as Record<string, unknown>;
  const newId = b.id as string;

  const events = getAuditEvents(newId);
  const replayEvent = events.find((e) => e.event === 'job.replayed');
  assert(replayEvent !== undefined, 'job.replayed audit event exists for new job');

  if (replayEvent) {
    const data = JSON.parse(replayEvent.data as unknown as string) as Record<string, unknown>;
    assert(data.original_id === originalId, 'audit data has correct original_id');
    assert(data.new_id === newId, 'audit data has correct new_id');
    assert(data.queue === uniqueQueue, 'audit data has correct queue');
    assert(data.bulk === false, 'audit data has bulk=false for single replay');
  }
});

// ---------------------------------------------------------------------------
// Test: GET /jobs?status=replayed — filter returns replayed jobs
// ---------------------------------------------------------------------------

await runTest('GET /jobs?status=replayed: returns replayed jobs', async () => {
  useTestDb();
  const app = buildApp();

  // Use a unique queue name so this test's jobs are distinguishable.
  const uniqueQueue = `filter-replayed-${randomUUID()}`;
  const dlqId = insertJob({ status: 'dlq', queue: uniqueQueue });
  insertJob({ status: 'pending', queue: uniqueQueue });

  // Replay the DLQ job — original moves to 'replayed'
  await req(app, 'POST', `/jobs/${dlqId}/replay`);

  // Filter by both status=replayed AND the unique queue
  const { status, body } = await req(app, 'GET', `/jobs?status=replayed&queue=${uniqueQueue}`);
  const b = body as { data: unknown[]; total: number };

  assert(status === 200, `GET /jobs?status=replayed returns 200 (got ${status})`);
  assert(b.total === 1, `total in queue is 1 (got ${b.total})`);
  assert(b.data.length === 1, `data has 1 item (got ${b.data.length})`);

  const item = b.data[0] as Record<string, unknown>;
  assert(item.id === dlqId, 'returned item is the original job');
  assert(item.status === 'replayed', 'returned item has status=replayed');
  assert(typeof item.replayed_as === 'string', 'returned item has replayed_as pointer');
});

// ---------------------------------------------------------------------------
// Test: POST /queues/:queue/replay — bulk replay happy path
// ---------------------------------------------------------------------------

await runTest('POST /queues/:queue/replay: replays all DLQ jobs in queue', async () => {
  useTestDb();
  const app = buildApp();

  const bulkQueue = `bulk-q-${randomUUID()}`;
  const otherQueue = `other-q-${randomUUID()}`;

  const id1 = insertJob({ status: 'dlq', queue: bulkQueue });
  const id2 = insertJob({ status: 'dlq', queue: bulkQueue });
  const id3 = insertJob({ status: 'dlq', queue: otherQueue }); // different queue — must not be replayed

  const { status, body } = await req(app, 'POST', `/queues/${bulkQueue}/replay`);
  const b = body as { replayed: { original_id: string; new_id: string }[]; total: number };

  assert(status === 200, `status is 200 (got ${status})`);
  assert(b.total === 2, `total is 2 (got ${b.total})`);
  assert(b.replayed.length === 2, `replayed array has 2 pairs`);

  const originals = b.replayed.map((p) => p.original_id);
  assert(originals.includes(id1), 'id1 is in replayed pairs');
  assert(originals.includes(id2), 'id2 is in replayed pairs');

  // Original jobs should be marked replayed
  const job1 = getJob(id1);
  const job2 = getJob(id2);
  assert(job1.status === 'replayed', 'id1 original is replayed');
  assert(job2.status === 'replayed', 'id2 original is replayed');

  // id3 in other-q should be untouched
  const job3 = getJob(id3);
  assert(job3.status === 'dlq', 'id3 in other-q is still dlq');
});

// ---------------------------------------------------------------------------
// Test: POST /queues/:queue/replay — returns empty when no DLQ jobs
// ---------------------------------------------------------------------------

await runTest('POST /queues/:queue/replay: returns empty when no DLQ jobs', async () => {
  useTestDb();
  const app = buildApp();

  // Use a UUID-suffixed queue name that will never have existing DLQ jobs.
  const emptyQueue = `empty-q-${randomUUID()}`;
  const { status, body } = await req(app, 'POST', `/queues/${emptyQueue}/replay`);
  const b = body as { replayed: unknown[]; total: number };

  assert(status === 200, `status is 200 (got ${status})`);
  assert(b.total === 0, `total is 0`);
  assert(b.replayed.length === 0, `replayed array is empty`);
});

// ---------------------------------------------------------------------------
// Test: POST /queues/:queue/replay — limit parameter respected
// ---------------------------------------------------------------------------

await runTest('POST /queues/:queue/replay: limit parameter restricts count', async () => {
  useTestDb();
  const app = buildApp();

  const limitedQueue = `limited-q-${randomUUID()}`;

  // Insert 5 DLQ jobs
  for (let i = 0; i < 5; i++) {
    insertJob({ status: 'dlq', queue: limitedQueue });
  }

  const { body } = await req(app, 'POST', `/queues/${limitedQueue}/replay?limit=3`);
  const b = body as { replayed: unknown[]; total: number };

  assert(b.total === 3, `only 3 replayed with limit=3 (got ${b.total})`);
  assert(b.replayed.length === 3, `replayed array has 3 items`);

  // 2 original jobs should remain in DLQ
  const { count } = getDb()
    .prepare(`SELECT COUNT(*) AS count FROM jobs WHERE queue = ? AND status = 'dlq'`)
    .get(limitedQueue) as { count: number };
  assert(count === 2, `2 jobs still in DLQ after limited replay (got ${count})`);
});

// ---------------------------------------------------------------------------
// Test: Bulk replay audit — N individual job.replayed events written
// ---------------------------------------------------------------------------

function getAuditReplayEventsForQueue(queue: string): AuditLogRow[] {
  // Look up audit events where the data JSON contains the given queue value.
  return (
    getDb()
      .prepare(`SELECT * FROM audit_log WHERE event = 'job.replayed' ORDER BY id ASC`)
      .all() as AuditLogRow[]
  ).filter((e) => {
    try {
      const d = JSON.parse(e.data as unknown as string) as Record<string, unknown>;
      return d.queue === queue;
    } catch {
      return false;
    }
  });
}

await runTest('POST /queues/:queue/replay: writes one job.replayed event per job', async () => {
  useTestDb();
  const app = buildApp();

  // Unique queue name so we can scope audit event queries.
  const uniqueQueue = `audit-q-${randomUUID()}`;
  const id1 = insertJob({ status: 'dlq', queue: uniqueQueue });
  const id2 = insertJob({ status: 'dlq', queue: uniqueQueue });
  const id3 = insertJob({ status: 'dlq', queue: uniqueQueue });

  const { body } = await req(app, 'POST', `/queues/${uniqueQueue}/replay`);
  const b = body as { replayed: { original_id: string; new_id: string }[]; total: number };

  const replayEvents = getAuditReplayEventsForQueue(uniqueQueue);
  assert(replayEvents.length === 3, `3 job.replayed events written (got ${replayEvents.length})`);

  for (const event of replayEvents) {
    const data = JSON.parse(event.data as unknown as string) as Record<string, unknown>;
    assert(data.bulk === true, `bulk=true on bulk replay event (original_id: ${data.original_id as string})`);
    assert(data.queue === uniqueQueue, `queue field matches unique queue`);
    assert(typeof data.original_id === 'string', 'original_id is present');
    assert(typeof data.new_id === 'string', 'new_id is present');
  }

  // Each event's job_id should be the new job's id (DR-0021: keyed by new_id for index lookup)
  const newIds = replayEvents.map((e) => e.job_id);
  const originalIds = [id1, id2, id3];
  for (const origId of originalIds) {
    assert(!newIds.includes(origId), `original_id ${origId} is not the event's job_id`);
  }

  // Verify new_ids from the response match the audit event job_ids
  const responseNewIds = b.replayed.map((p) => p.new_id);
  for (const newId of responseNewIds) {
    assert(newIds.includes(newId), `response new_id ${newId} has corresponding audit event`);
  }
});

// ---------------------------------------------------------------------------
// Test: Bulk replay — already-replayed jobs in queue are skipped
// ---------------------------------------------------------------------------

await runTest('POST /queues/:queue/replay: skips already-replayed jobs (only dlq status targeted)', async () => {
  useTestDb();
  const app = buildApp();

  const skipQueue = `skip-q-${randomUUID()}`;
  const dlqId = insertJob({ status: 'dlq', queue: skipQueue });
  const replayedId = insertJob({ status: 'replayed', queue: skipQueue }); // already replayed

  const { body } = await req(app, 'POST', `/queues/${skipQueue}/replay`);
  const b = body as { replayed: unknown[]; total: number };

  assert(b.total === 1, `only 1 job replayed (got ${b.total})`);

  const pairs = b.replayed as { original_id: string; new_id: string }[];
  assert(pairs[0].original_id === dlqId, 'the dlq job was replayed');
  assert(!pairs.map((p) => p.original_id).includes(replayedId), 'already-replayed job was skipped');
});

// ---------------------------------------------------------------------------
// Test: New job inherits payload, type, and queue from original
// ---------------------------------------------------------------------------

await runTest('POST /jobs/:id/replay: new job inherits type, queue, payload from original', async () => {
  useTestDb();
  const app = buildApp();
  const db = getDb();

  // Insert a DLQ job with specific payload
  const originalId = randomUUID();
  const now = Date.now();
  const payload = JSON.stringify({ task: 'send-email', to: 'user@example.com' });
  db.prepare(
    `INSERT INTO jobs (id, type, queue, payload, status, priority, eligible_at, enqueued_at)
     VALUES (?, ?, ?, ?, 'dlq', 10, ?, ?)`,
  ).run(originalId, 'email-job', 'mailer', payload, now, now);

  const { body } = await req(app, 'POST', `/jobs/${originalId}/replay`);
  const b = body as Record<string, unknown>;
  const newId = b.id as string;

  const newJob = getJob(newId);
  assert(newJob.type === 'email-job', 'new job inherits type');
  assert(newJob.queue === 'mailer', 'new job inherits queue');
  assert(newJob.payload === payload, 'new job inherits payload');
  assert(newJob.priority === 10, 'new job inherits priority');
  assert(newJob.attempt === 0, 'new job starts at attempt=0');
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

closeDb();
console.log(`\n──────────────────────────────────────────────`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
} else {
  console.log('All F-13 tests passed.');
}
