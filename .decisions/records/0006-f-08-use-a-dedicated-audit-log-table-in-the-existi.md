# DR-0006: F-08: Use a dedicated audit_log table in the existing SQLite

**Date**: 2026-05-26
**Category**: compliance
**Status**: accepted
**Weight**: heavy
**Deciders**: autonomous session 2026-05-26 23:43

## Context

F-08: Use a dedicated audit_log table in the existing SQLite database file (not a separate file, not merged into jobs). WAL mode is already enabled from DR-0001 so concurrent reads do not block writes. Audit entries are stored as (id, event, job_id, created_at, data) where data is a JSON blob for event-specific fields. Indexes on created_at, job_id, and event support the range-scan and filter query patterns. Raw payloads are hashed with sha256 before writing; webhook URLs are also hashed. Compliance isolation achieved by convention: no DELETE or UPDATE routes are exposed for audit_log. GET /audit supports filtered paginated queries. GET /audit/export returns NDJSON. Writes are synchronous better-sqlite3 INSERTs which are fast enough not to block critical paths. Depends on DR-0001 (SQLite WAL mode already active).

## Decision

F-08: Use a dedicated audit_log table in the existing SQLite database file (not a separate file, not merged into jobs). WAL mode is already enabled from DR-0001 so concurrent reads do not block writes. Audit entries are stored as (id, event, job_id, created_at, data) where data is a JSON blob for event-specific fields. Indexes on created_at, job_id, and event support the range-scan and filter query patterns. Raw payloads are hashed with sha256 before writing; webhook URLs are also hashed. Compliance isolation achieved by convention: no DELETE or UPDATE routes are exposed for audit_log. GET /audit supports filtered paginated queries. GET /audit/export returns NDJSON. Writes are synchronous better-sqlite3 INSERTs which are fast enough not to block critical paths. Depends on DR-0001 (SQLite WAL mode already active).

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
