# DR-0013: F-10 audit event path for queue.rate_limited: reuse existing

**Date**: 2026-05-27
**Category**: compliance
**Status**: accepted
**Weight**: heavy
**Deciders**: autonomous session 2026-05-27 00:09

## Context

F-10 audit event path for queue.rate_limited: reuse existing audit.ts write() machinery by adding a new queueRateLimited() method to the audit object. This is consistent with DR-0010 (job.promoted added the same way) and DR-0006 (audit_log is the single compliance sink). The concern about per-tick volume is real — queue.rate_limited fires each tick a queue is throttled (every 100ms) rather than per-job. To avoid audit log spam, we deduplicate: queueRateLimited() only writes if the queue was not rate-limited in the previous tick (edge-triggered, not level-triggered). This keeps the single-sink invariant from DR-0006 intact without creating a separate write path, and avoids the volume problem without compromising the compliance requirement. A completely separate path would violate DR-0006 and duplicate write logic. Depends on DR-0006, DR-0010.

## Decision

F-10 audit event path for queue.rate_limited: reuse existing audit.ts write() machinery by adding a new queueRateLimited() method to the audit object. This is consistent with DR-0010 (job.promoted added the same way) and DR-0006 (audit_log is the single compliance sink). The concern about per-tick volume is real — queue.rate_limited fires each tick a queue is throttled (every 100ms) rather than per-job. To avoid audit log spam, we deduplicate: queueRateLimited() only writes if the queue was not rate-limited in the previous tick (edge-triggered, not level-triggered). This keeps the single-sink invariant from DR-0006 intact without creating a separate write path, and avoids the volume problem without compromising the compliance requirement. A completely separate path would violate DR-0006 and duplicate write logic. Depends on DR-0006, DR-0010.

## Alternatives Considered

- per-job

## Consequences

### Positive
- To be documented

### Negative / Trade-offs
- To be documented

### Risks
- None identified

## Relationships

- depends-on: DR-0006
- depends-on: DR-0010

## Review Trigger

Not specified
