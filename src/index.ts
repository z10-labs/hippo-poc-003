import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { register } from './queue/registry.js';
import { setQueueLimit } from './queue/rate-limiter.js';
import { startWorker, stopWorker } from './queue/worker.js';
import { startBatchWorker, stopBatchWorker } from './queue/batch-worker.js';
import { startScheduler, stopScheduler } from './queue/scheduler.js';
import { startWebhookWorker, stopWebhookWorker } from './webhook-queue.js';
import { closeDb } from './db/client.js';
import jobsRouter from './routes/jobs.js';
import queuesRouter from './routes/queues.js';
import dlqRouter from './routes/dlq.js';
import scheduledRouter from './routes/scheduled.js';
import auditRouter from './routes/audit.js';
import type { BatchHandler, Handler, HandlerOptions } from './types.js';

const app = new Hono();

app.route('/jobs', jobsRouter);
app.route('/queues', queuesRouter);
app.route('/dlq', dlqRouter);
app.route('/scheduled', scheduledRouter);
app.route('/audit', auditRouter);

app.get('/', (c) =>
  c.html(`<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Forge</title>
<style>body{font-family:monospace;max-width:640px;margin:40px auto;padding:0 16px}
h1{font-size:1.4rem}a{color:#2563eb}li{margin:.25rem 0}</style>
</head>
<body>
<h1>Forge — Job Processor</h1>
<ul>
  <li><a href="/queues">GET /queues</a> — queue stats</li>
  <li><a href="/jobs">GET /jobs</a> — all jobs</li>
  <li><a href="/dlq">GET /dlq</a> — dead-letter queue</li>
  <li><a href="/scheduled">GET /scheduled</a> — scheduled jobs</li>
  <li><a href="/audit">GET /audit</a> — audit log</li>
  <li><a href="/audit/export">GET /audit/export</a> — export NDJSON</li>
</ul>
</body></html>`),
);

const PORT = parseInt(process.env.PORT ?? '3000', 10);

const server = serve({ fetch: app.fetch, port: PORT }, () => {
  console.log(`[forge] Listening on http://localhost:${PORT}`);
});

startWorker();
startBatchWorker();
startScheduler();
startWebhookWorker();

function shutdown(): void {
  console.log('[forge] Shutting down...');
  stopWorker();
  stopBatchWorker();
  stopScheduler();
  stopWebhookWorker();
  server.close(() => {
    closeDb();
    process.exit(0);
  });
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// Public API surface for in-process registration
export const forge = {
  register: (type: string, handler: Handler | BatchHandler, options?: HandlerOptions) =>
    register(type, handler, options),
  /** F-10: configure a per-second dispatch rate limit for a named queue. */
  setQueueLimit: (queue: string, options: { rateLimit: number }) =>
    setQueueLimit(queue, options.rateLimit),
};

export type { BatchHandler, BatchJobContext, Handler, HandlerOptions, JobContext, TimeoutPolicy } from './types.js';
