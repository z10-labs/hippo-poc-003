# DR-0010: F-09 promotion audit event: reuse the existing audit.ts writ

**Date**: 2026-05-27
**Category**: compliance
**Status**: accepted
**Weight**: heavy
**Deciders**: autonomous session 2026-05-27 00:01

## Context

F-09 promotion audit event: reuse the existing audit.ts write() machinery from F-08 by adding a new jobPromoted() method to the audit object. Event type: 'job.promoted'. Data payload: { job_id, priority, wait_ms, max_wait_ms }. This avoids a separate write path, keeps audit_log as the single compliance sink (DR-0006), and is consistent with all other audit events. A separate path would require its own table or file and contradict DR-0006's single-table decision. Depends on DR-0006 (F-08 audit log machinery and audit_log table).

## Decision

F-09 promotion audit event: reuse the existing audit.ts write() machinery from F-08 by adding a new jobPromoted() method to the audit object. Event type: 'job.promoted'. Data payload: { job_id, priority, wait_ms, max_wait_ms }. This avoids a separate write path, keeps audit_log as the single compliance sink (DR-0006), and is consistent with all other audit events. A separate path would require its own table or file and contradict DR-0006's single-table decision. Depends on DR-0006 (F-08 audit log machinery and audit_log table).

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

- depends-on: DR-0006

## Review Trigger

Not specified
