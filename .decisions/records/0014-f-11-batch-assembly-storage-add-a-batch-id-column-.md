# DR-0014: F-11 batch assembly storage: add a 'batch_id' column to the 

**Date**: 2026-05-27
**Category**: data
**Status**: accepted
**Weight**: standard
**Deciders**: autonomous session 2026-05-27 00:16

## Why

F-11 batch assembly storage: add a 'batch_id' column to the jobs table and a 'batch_staging' table tracking (batch_id, type, oldest_enqueued_at, created_at) — rejected in-memory (fails restart-survival, same reason DR-0011 rejected pure in-memory for rate-limit counters) and rejected a status flag on the jobs table alone (status semantics are already load-bearing for dispatch queries; a new 'batching' pseudo-status would break idx_jobs_dispatch and the two-pass tick from DR-0009). Separate batch_staging table keeps the jobs table status clean and gives a single indexed row per in-flight batch for the maxWaitMs deadline check. Depends on DR-0001, DR-0009.

## What

F-11 batch assembly storage: add a 'batch_id' column to the jobs table and a 'batch_staging' table tracking (batch_id, type, oldest_enqueued_at, created_at) — rejected in-memory (fails restart-survival, same reason DR-0011 rejected pure in-memory for rate-limit counters) and rejected a status flag on the jobs table alone (status semantics are already load-bearing for dispatch queries; a new 'batching' pseudo-status would break idx_jobs_dispatch and the two-pass tick from DR-0009). Separate batch_staging table keeps the jobs table status clean and gives a single indexed row per in-flight batch for the maxWaitMs deadline check. Depends on DR-0001, DR-0009.

## Trade-off

Not documented

## Alternatives Skipped

None documented

## Relationships

- depends-on: DR-0001
- depends-on: DR-0009
