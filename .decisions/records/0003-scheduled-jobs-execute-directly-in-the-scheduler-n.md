# DR-0003: Scheduled jobs execute directly in the scheduler, not throug

**Date**: 2026-05-24
**Category**: data
**Status**: accepted
**Weight**: standard
**Deciders**: autonomous session 2026-05-24 20:48

## Why

Scheduled jobs execute directly in the scheduler, not through POST /jobs queue. Tracked in scheduled_jobs table with last-20 history. Catch-up: if next_run_at is past on startup, fire once then recompute.

## What

Scheduled jobs execute directly in the scheduler, not through POST /jobs queue. Tracked in scheduled_jobs table with last-20 history. Catch-up: if next_run_at is past on startup, fire once then recompute.

## Trade-off

Not documented

## Alternatives Skipped

None documented

## Relationships

- (none)
