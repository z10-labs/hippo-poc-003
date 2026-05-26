# DR-0015: F-11 partial failure semantics: when a batch handler rejects

**Date**: 2026-05-27
**Category**: error-handling
**Status**: accepted
**Weight**: standard
**Deciders**: autonomous session 2026-05-27 00:16

## Why

F-11 partial failure semantics: when a batch handler rejects, each job retries individually (per-job retry) — rejected whole-batch retry (penalises jobs that would have succeeded and conflates unrelated job lifecycles; the spec explicitly says 'each job retries individually on the next attempt'). Per-job retry increments each job's own attempt counter and sets it back to pending with its own backoff delay; a job that has exhausted retries is excluded from the next batch and sent to DLQ individually. This is consistent with the existing retry machinery in worker.ts and the attempt counter semantics from F-03. Depends on DR-0003, DR-0009, DR-0014.

## What

F-11 partial failure semantics: when a batch handler rejects, each job retries individually (per-job retry) — rejected whole-batch retry (penalises jobs that would have succeeded and conflates unrelated job lifecycles; the spec explicitly says 'each job retries individually on the next attempt'). Per-job retry increments each job's own attempt counter and sets it back to pending with its own backoff delay; a job that has exhausted retries is excluded from the next batch and sent to DLQ individually. This is consistent with the existing retry machinery in worker.ts and the attempt counter semantics from F-03. Depends on DR-0003, DR-0009, DR-0014.

## Trade-off

Not documented

## Alternatives Skipped

None documented

## Relationships

- depends-on: DR-0003
- depends-on: DR-0009
- depends-on: DR-0014
