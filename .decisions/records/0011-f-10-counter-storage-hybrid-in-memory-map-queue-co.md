# DR-0011: F-10 counter storage: hybrid — in-memory Map<queue, {count, 

**Date**: 2026-05-27
**Category**: data
**Status**: accepted
**Weight**: standard
**Deciders**: autonomous session 2026-05-27 00:08

## Why

F-10 counter storage: hybrid — in-memory Map<queue, {count, windowStart}> with SQLite flush on each dispatch. Pure in-memory fails the restart-survival requirement (spec: a restart must not reset the window). Pure SQLite adds a synchronous write per dispatch which risks regressing enqueue latency (constraint: p99 < 10ms, 200 enqueues/sec). Hybrid: in-process Map holds the hot counter; on every dispatch we also persist the current window (queue, window_start_ms, dispatch_count) to a new rate_limit_windows table using a single upsert — fast because it is one row per queue, not one row per job. On process start, windows are loaded from SQLite so the counter is warm. This satisfies both the restart-survival constraint and the write-contention constraint. A queue_config table is explicitly avoided (DR-0008 shows no existing hook for it); instead the rate limit is passed via forge.setQueueLimit() and stored in a module-level Map. Depends on DR-0001, DR-0009.

## What

F-10 counter storage: hybrid — in-memory Map<queue, {count, windowStart}> with SQLite flush on each dispatch. Pure in-memory fails the restart-survival requirement (spec: a restart must not reset the window). Pure SQLite adds a synchronous write per dispatch which risks regressing enqueue latency (constraint: p99 < 10ms, 200 enqueues/sec). Hybrid: in-process Map holds the hot counter; on every dispatch we also persist the current window (queue, window_start_ms, dispatch_count) to a new rate_limit_windows table using a single upsert — fast because it is one row per queue, not one row per job. On process start, windows are loaded from SQLite so the counter is warm. This satisfies both the restart-survival constraint and the write-contention constraint. A queue_config table is explicitly avoided (DR-0008 shows no existing hook for it); instead the rate limit is passed via forge.setQueueLimit() and stored in a module-level Map. Depends on DR-0001, DR-0009.

## Trade-off

Not documented

## Alternatives Skipped

None documented

## Relationships

- depends-on: DR-0001
- depends-on: DR-0009
