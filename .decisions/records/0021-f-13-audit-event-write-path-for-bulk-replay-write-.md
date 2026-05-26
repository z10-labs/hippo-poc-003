# DR-0021: F-13 audit event write path for bulk replay: write one job.r

**Date**: 2026-05-27
**Category**: data
**Status**: accepted
**Weight**: standard
**Deciders**: autonomous session 2026-05-27 00:45

## Why

F-13 audit event write path for bulk replay: write one job.replayed audit event per job inside the transaction loop, consistent with how every other audit event is written (DR-0006, DR-0010). A single batched audit event listing all replayed job IDs is rejected because querying 'when was job X replayed?' would require a table scan over a JSON array field instead of a direct index lookup on job_id — this degrades the per-job queryability that DR-0006 established as a core property of the audit_log schema. Rejected a batched write because the audit index on job_id (established in DR-0006) only works when each row carries a single job_id; a batch row with a JSON array of IDs would be opaque to that index. Writing N individual rows inside the same SQLite transaction (DR-0020) keeps atomicity while preserving per-job granularity. depends on DR-0006, depends on DR-0010, depends on DR-0020

## What

F-13 audit event write path for bulk replay: write one job.replayed audit event per job inside the transaction loop, consistent with how every other audit event is written (DR-0006, DR-0010). A single batched audit event listing all replayed job IDs is rejected because querying 'when was job X replayed?' would require a table scan over a JSON array field instead of a direct index lookup on job_id — this degrades the per-job queryability that DR-0006 established as a core property of the audit_log schema. Rejected a batched write because the audit index on job_id (established in DR-0006) only works when each row carries a single job_id; a batch row with a JSON array of IDs would be opaque to that index. Writing N individual rows inside the same SQLite transaction (DR-0020) keeps atomicity while preserving per-job granularity. depends on DR-0006, depends on DR-0010, depends on DR-0020

## Trade-off

Not documented

## Alternatives Skipped

- a direct index lookup on job_id — this degrades the per-job queryability that DR
- because querying 'when was job X replayed?' would require a table scan over a JS
- le batched audit event listing all replayed job IDs
- a batched write because the audit index on job_id

## Relationships

- depends-on: DR-0006
- depends-on: DR-0010
- depends-on: DR-0020
