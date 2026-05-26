# DR-0001: Use SQLite via better-sqlite3 as the sole persistence layer.

**Date**: 2026-05-24
**Category**: state
**Status**: accepted
**Weight**: standard
**Deciders**: autonomous session 2026-05-24 20:48

## Why

Use SQLite via better-sqlite3 as the sole persistence layer. WAL mode for concurrent reads, synchronous writes, ACID guarantees. No Redis, no external broker. State survives SIGTERM because SQLite writes directly to disk on every commit.

## What

Use SQLite via better-sqlite3 as the sole persistence layer. WAL mode for concurrent reads, synchronous writes, ACID guarantees. No Redis, no external broker. State survives SIGTERM because SQLite writes directly to disk on every commit.

## Trade-off

Not documented

## Alternatives Skipped

None documented

## Relationships

- (none)
