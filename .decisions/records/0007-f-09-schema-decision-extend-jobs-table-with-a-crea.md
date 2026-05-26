# DR-0007: F-09 schema decision: extend jobs table with a created_at co

**Date**: 2026-05-27
**Category**: data
**Status**: accepted
**Weight**: standard
**Deciders**: autonomous session 2026-05-27 00:01

## Why

F-09 schema decision: extend jobs table with a created_at column (aliased from enqueued_at semantics already present) and add a composite index idx_jobs_priority_dispatch on (queue, type, status, priority DESC, enqueued_at ASC) to support starvation-prevention polling. No new table needed — priority integer column already exists in jobs, starvation is measured from enqueued_at (already present), no additional persisted state required. Depends on DR-0001 (SQLite as sole persistence), constraint from spec: no new tables unless strictly necessary.

## What

F-09 schema decision: extend jobs table with a created_at column (aliased from enqueued_at semantics already present) and add a composite index idx_jobs_priority_dispatch on (queue, type, status, priority DESC, enqueued_at ASC) to support starvation-prevention polling. No new table needed — priority integer column already exists in jobs, starvation is measured from enqueued_at (already present), no additional persisted state required. Depends on DR-0001 (SQLite as sole persistence), constraint from spec: no new tables unless strictly necessary.

## Trade-off

Not documented

## Alternatives Skipped

None documented

## Relationships

- depends-on: DR-0001
