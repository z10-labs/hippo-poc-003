# DR-0005: F-07: Use a parallel webhook delivery queue (webhook_queue t

**Date**: 2026-05-26
**Category**: compliance
**Status**: accepted
**Weight**: heavy
**Deciders**: autonomous session 2026-05-26 23:43

## Context

F-07: Use a parallel webhook delivery queue (webhook_queue table + webhook worker) rather than reusing the job queue machinery. New webhook_queue table in the existing SQLite file holds pending deliveries with status, eligible_at, attempt count and url. A webhook-worker polls every second using the same setInterval pattern as worker.ts. Failed deliveries retry with exponential backoff independent of job retry policy. Entries that exhaust MAX_ATTEMPTS move to status='dlq', which is the webhook dead-letter store — separate from the jobs DLQ (jobs with status='dlq'). On restart, any stuck 'sending' entries are reset to 'pending'. GET /jobs/:id/webhooks now returns { queue: [...], deliveries: [...] } to expose durable state. Depends on DR-0001 (SQLite sole persistence) and DR-0002 (concurrency model: reusing pattern not code).

## Decision

F-07: Use a parallel webhook delivery queue (webhook_queue table + webhook worker) rather than reusing the job queue machinery. New webhook_queue table in the existing SQLite file holds pending deliveries with status, eligible_at, attempt count and url. A webhook-worker polls every second using the same setInterval pattern as worker.ts. Failed deliveries retry with exponential backoff independent of job retry policy. Entries that exhaust MAX_ATTEMPTS move to status='dlq', which is the webhook dead-letter store — separate from the jobs DLQ (jobs with status='dlq'). On restart, any stuck 'sending' entries are reset to 'pending'. GET /jobs/:id/webhooks now returns { queue: [...], deliveries: [...] } to expose durable state. Depends on DR-0001 (SQLite sole persistence) and DR-0002 (concurrency model: reusing pattern not code).

## Alternatives Considered

_No alternatives documented._

## Consequences

### Positive
- To be documented

### Negative / Trade-offs
- To be documented

### Risks
- None identified

## Relationships

- (none)

## Review Trigger

Not specified
