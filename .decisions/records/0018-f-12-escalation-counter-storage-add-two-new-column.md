# DR-0018: F-12 escalation counter storage: add two new columns to the 

**Date**: 2026-05-27
**Category**: data
**Status**: accepted
**Weight**: standard
**Deciders**: autonomous session 2026-05-27 00:25

## Why

F-12 escalation counter storage: add two new columns to the jobs table — timed_out_at (INTEGER, nullable) and consecutive_timeout_count (INTEGER NOT NULL DEFAULT 0). Rejected pure in-memory storage because the spec explicitly requires the escalation counter to survive restart (a persistently-stuck job must not escape DLQ by restarting the process). Rejected a separate job_timeout_state table because the counter is 1:1 with a job row and adding a join on every GET /jobs/:id response adds overhead without benefit — DR-0014 chose a separate batch_staging table only because the job status column semantics were load-bearing and had to remain clean; timeout state has no such conflict. DR-0003 (retry attempt counter) set the precedent of storing per-job counters directly on the jobs table. Adding two nullable columns via ALTER TABLE IF NOT EXISTS guard (idempotent on restart) is consistent with the pattern established in DR-0014. depends on DR-0001 (SQLite sole persistence), depends on DR-0003 (retry counter precedent on jobs table), depends on DR-0014 (ALTER TABLE idempotent pattern)

## What

F-12 escalation counter storage: add two new columns to the jobs table — timed_out_at (INTEGER, nullable) and consecutive_timeout_count (INTEGER NOT NULL DEFAULT 0). Rejected pure in-memory storage because the spec explicitly requires the escalation counter to survive restart (a persistently-stuck job must not escape DLQ by restarting the process). Rejected a separate job_timeout_state table because the counter is 1:1 with a job row and adding a join on every GET /jobs/:id response adds overhead without benefit — DR-0014 chose a separate batch_staging table only because the job status column semantics were load-bearing and had to remain clean; timeout state has no such conflict. DR-0003 (retry attempt counter) set the precedent of storing per-job counters directly on the jobs table. Adding two nullable columns via ALTER TABLE IF NOT EXISTS guard (idempotent on restart) is consistent with the pattern established in DR-0014. depends on DR-0001 (SQLite sole persistence), depends on DR-0003 (retry counter precedent on jobs table), depends on DR-0014 (ALTER TABLE idempotent pattern)

## Trade-off

Not documented

## Alternatives Skipped

- pure in-memory storage because the spec explicitly requires the escalation count
- a separate job_timeout_state table because the counter is 1:1 with a job row and

## Relationships

- depends-on: DR-0001
- depends-on: DR-0003
- depends-on: DR-0014
