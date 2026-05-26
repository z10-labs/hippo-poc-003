# DR-0004: schedulerTick calls initScheduledJobs at the top of every ti

**Date**: 2026-05-24
**Category**: architectural
**Status**: accepted
**Weight**: heavy
**Deciders**: autonomous session 2026-05-24 20:55

## Context

schedulerTick calls initScheduledJobs at the top of every tick so handlers registered after startScheduler() are picked up within 10 seconds. ON CONFLICT only updates cron expression, preserving existing next_run_at for restart catch-up. depends-on DR-0003

## Decision

schedulerTick calls initScheduledJobs at the top of every tick so handlers registered after startScheduler() are picked up within 10 seconds. ON CONFLICT only updates cron expression, preserving existing next_run_at for restart catch-up. depends-on DR-0003

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
