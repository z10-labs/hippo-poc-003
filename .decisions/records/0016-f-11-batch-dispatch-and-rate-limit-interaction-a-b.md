# DR-0016: F-11 batch dispatch and rate limit interaction: a batch coun

**Date**: 2026-05-27
**Category**: testing
**Status**: accepted
**Weight**: standard
**Deciders**: autonomous session 2026-05-27 00:16

## Why

F-11 batch dispatch and rate limit interaction: a batch counts as one token against the rate limit (one dispatch unit) — rejected N-token consumption (changing the semantics of the rateLimit config from 'dispatches per second' to 'jobs per second' would silently break all existing callers who set a per-second limit expecting per-dispatch semantics; DR-0012 defines the unit as 'dispatch' not 'job', and DR-0011 tracks count as dispatch count). One token preserves the fixed-window invariant from DR-0012 unchanged: tryConsume() is called once before the batch executeJob call, consistent with how the existing scalar dispatchWithRateLimit wraps every dispatch. Depends on DR-0011, DR-0012.

## What

F-11 batch dispatch and rate limit interaction: a batch counts as one token against the rate limit (one dispatch unit) — rejected N-token consumption (changing the semantics of the rateLimit config from 'dispatches per second' to 'jobs per second' would silently break all existing callers who set a per-second limit expecting per-dispatch semantics; DR-0012 defines the unit as 'dispatch' not 'job', and DR-0011 tracks count as dispatch count). One token preserves the fixed-window invariant from DR-0012 unchanged: tryConsume() is called once before the batch executeJob call, consistent with how the existing scalar dispatchWithRateLimit wraps every dispatch. Depends on DR-0011, DR-0012.

## Trade-off

Not documented

## Alternatives Skipped

None documented

## Relationships

- depends-on: DR-0011
- depends-on: DR-0012
