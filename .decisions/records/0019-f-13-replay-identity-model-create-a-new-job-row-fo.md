# DR-0019: F-13 replay identity model: create a new job row for each re

**Date**: 2026-05-27
**Category**: compliance
**Status**: accepted
**Weight**: heavy
**Deciders**: autonomous session 2026-05-27 00:44

## Context

F-13 replay identity model: create a new job row for each replay and mark the original DLQ job as 'replayed' with a pointer (replayed_as column) to the new job's ID. Reusing the same job ID is rejected because the audit log (DR-0006) records state transitions keyed by job_id — mutating a job back to pending would make audit history ambiguous and violate the append-only compliance record. Cloning rows into a separate replay_queue table is rejected because it duplicates the entire jobs schema without benefit; the status column can already represent 'replayed' as a first-class value per the spec constraint. The new-row approach is clean, auditable, and consistent with how DR-0001 models SQLite state: each row represents a distinct unit of work with its own lifecycle. A new attempt counter starts at 0 and the new job inherits maxRetries and priority from the original. depends on DR-0001, depends on DR-0006

## Decision

F-13 replay identity model: create a new job row for each replay and mark the original DLQ job as 'replayed' with a pointer (replayed_as column) to the new job's ID. Reusing the same job ID is rejected because the audit log (DR-0006) records state transitions keyed by job_id — mutating a job back to pending would make audit history ambiguous and violate the append-only compliance record. Cloning rows into a separate replay_queue table is rejected because it duplicates the entire jobs schema without benefit; the status column can already represent 'replayed' as a first-class value per the spec constraint. The new-row approach is clean, auditable, and consistent with how DR-0001 models SQLite state: each row represents a distinct unit of work with its own lifecycle. A new attempt counter starts at 0 and the new job inherits maxRetries and priority from the original. depends on DR-0001, depends on DR-0006

## Alternatives Considered

- because the audit log
- Reusing the same job ID
- because it duplicates the entire jobs schema without benefit
- Cloning rows into a separate replay_queue table

## Consequences

### Positive
- To be documented

### Negative / Trade-offs
- To be documented

### Risks
- None identified

## Relationships

- depends-on: DR-0001
- depends-on: DR-0006

## Review Trigger

Not specified
