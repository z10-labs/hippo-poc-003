# DR-0017: F-12 timeout enforcement mechanism: use Promise.race with a 

**Date**: 2026-05-27
**Category**: performance
**Status**: accepted
**Weight**: standard
**Deciders**: autonomous session 2026-05-27 00:25

## Why

F-12 timeout enforcement mechanism: use Promise.race with a rejection timeout (existing withTimeout utility) combined with a per-job AbortController signal passed to the handler. The handler is trusted in-process code so AbortSignal cooperation is acceptable. Worker thread termination is rejected because it would require per-job thread spawning which adds unacceptable overhead (memory and startup latency) for a single-process system constrained to 512MB RAM and 100 executions/second. Raw Promise.race without AbortSignal is rejected because the handler would continue consuming resources even after the timeout fires. Chosen approach: extend withTimeout to also reject with a typed TimeoutError, detect TimeoutError in executeJob, and pass an AbortSignal to handlers that declare timeoutMs so well-behaved handlers can clean up — but enforcement is via Promise.race timeout rejection regardless of handler cooperation. depends on DR-0001 (single process, no external workers), depends on DR-0002 (concurrency tracked per type, not per thread)

## What

F-12 timeout enforcement mechanism: use Promise.race with a rejection timeout (existing withTimeout utility) combined with a per-job AbortController signal passed to the handler. The handler is trusted in-process code so AbortSignal cooperation is acceptable. Worker thread termination is rejected because it would require per-job thread spawning which adds unacceptable overhead (memory and startup latency) for a single-process system constrained to 512MB RAM and 100 executions/second. Raw Promise.race without AbortSignal is rejected because the handler would continue consuming resources even after the timeout fires. Chosen approach: extend withTimeout to also reject with a typed TimeoutError, detect TimeoutError in executeJob, and pass an AbortSignal to handlers that declare timeoutMs so well-behaved handlers can clean up — but enforcement is via Promise.race timeout rejection regardless of handler cooperation. depends on DR-0001 (single process, no external workers), depends on DR-0002 (concurrency tracked per type, not per thread)

## Trade-off

Not documented

## Alternatives Skipped

- because it would require per-job thread spawning which adds unacceptable overhea
- because the handler would continue consuming resources even after the timeout fi

## Relationships

- depends-on: DR-0001
- depends-on: DR-0002
