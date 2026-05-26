# DR-0009: F-09 worker polling query approach: use a two-pass query per

**Date**: 2026-05-27
**Category**: data
**Status**: accepted
**Weight**: standard
**Deciders**: autonomous session 2026-05-27 00:01

## Why

F-09 worker polling query approach: use a two-pass query per tick — pass 1 fetches eligible jobs that have waited longer than maxWaitMs (starvation candidates) ordered by enqueued_at ASC, pass 2 fetches remaining slots ordered by priority DESC, enqueued_at ASC. Both queries use the existing idx_jobs_dispatch index. This is preferable to weighted round-robin (requires complex in-process state) and to strict priority-only ordering (starves low-priority). SQLite ORDER BY with the composite index is fast; two queries per type per tick is still well under p99 10ms enqueue constraint. Depends on DR-0007 (composite index on priority+enqueued_at), DR-0008 (maxWaitMs per type), DR-0002 (tick loops over registered types).

## What

F-09 worker polling query approach: use a two-pass query per tick — pass 1 fetches eligible jobs that have waited longer than maxWaitMs (starvation candidates) ordered by enqueued_at ASC, pass 2 fetches remaining slots ordered by priority DESC, enqueued_at ASC. Both queries use the existing idx_jobs_dispatch index. This is preferable to weighted round-robin (requires complex in-process state) and to strict priority-only ordering (starves low-priority). SQLite ORDER BY with the composite index is fast; two queries per type per tick is still well under p99 10ms enqueue constraint. Depends on DR-0007 (composite index on priority+enqueued_at), DR-0008 (maxWaitMs per type), DR-0002 (tick loops over registered types).

## Trade-off

Not documented

## Alternatives Skipped

None documented

## Relationships

- depends-on: DR-0007
- depends-on: DR-0008
- depends-on: DR-0002
