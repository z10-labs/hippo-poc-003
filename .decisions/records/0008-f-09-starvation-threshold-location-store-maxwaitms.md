# DR-0008: F-09 starvation threshold location: store maxWaitMs as a per

**Date**: 2026-05-27
**Category**: data
**Status**: accepted
**Weight**: standard
**Deciders**: autonomous session 2026-05-27 00:01

## Why

F-09 starvation threshold location: store maxWaitMs as a per-job-type option in HandlerOptions and RegisteredHandler (same pattern as concurrency from DR-0002). Default value: 30000ms. Per-type gives fine-grained control — a high-churn background type can afford longer wait; a critical-path type may need tighter anti-starvation. A global constant would be simpler but inflexible; per-queue config has no existing hook point since the DB has no queue config table. Depends on DR-0002 (per-type registration pattern established).

## What

F-09 starvation threshold location: store maxWaitMs as a per-job-type option in HandlerOptions and RegisteredHandler (same pattern as concurrency from DR-0002). Default value: 30000ms. Per-type gives fine-grained control — a high-churn background type can afford longer wait; a critical-path type may need tighter anti-starvation. A global constant would be simpler but inflexible; per-queue config has no existing hook point since the DB has no queue config table. Depends on DR-0002 (per-type registration pattern established).

## Trade-off

Not documented

## Alternatives Skipped

None documented

## Relationships

- depends-on: DR-0002
