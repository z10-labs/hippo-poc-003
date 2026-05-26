# DR-0020: F-13 bulk replay transaction boundary: wrap all INSERT state

**Date**: 2026-05-27
**Category**: state
**Status**: accepted
**Weight**: standard
**Deciders**: autonomous session 2026-05-27 00:44

## Why

F-13 bulk replay transaction boundary: wrap all INSERT statements for a bulk replay operation in a single SQLite transaction so the entire batch succeeds or fails atomically. Individual inserts in a loop are rejected because partial success is confusing — if 47 of 100 replays insert and 53 fail, the queue is left in an ambiguous state where some jobs are pending and others are still DLQ with no clear recovery path. A single transaction is chosen because Forge uses a single Node.js process with better-sqlite3 (DR-0001) so there is no write contention from other processes; the write lock held during the transaction is not a concern. Rejected individual inserts because the spec requires returning a list of original_id/new_id pairs, which is only meaningful if the operation is all-or-nothing. depends on DR-0001, depends on DR-0019

## What

F-13 bulk replay transaction boundary: wrap all INSERT statements for a bulk replay operation in a single SQLite transaction so the entire batch succeeds or fails atomically. Individual inserts in a loop are rejected because partial success is confusing — if 47 of 100 replays insert and 53 fail, the queue is left in an ambiguous state where some jobs are pending and others are still DLQ with no clear recovery path. A single transaction is chosen because Forge uses a single Node.js process with better-sqlite3 (DR-0001) so there is no write contention from other processes; the write lock held during the transaction is not a concern. Rejected individual inserts because the spec requires returning a list of original_id/new_id pairs, which is only meaningful if the operation is all-or-nothing. depends on DR-0001, depends on DR-0019

## Trade-off

Not documented

## Alternatives Skipped

- because partial success is confusing — if 47 of 100 replays insert and 53 fail
- Individual inserts in a loop
- individual inserts because the spec requires returning a list of original_id/new

## Relationships

- depends-on: DR-0001
- depends-on: DR-0019
