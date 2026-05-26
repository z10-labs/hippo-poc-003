# Deferred Decisions

Decisions consciously not made yet. Each entry records what was deferred, why, and when to revisit.

---

## 2026-05-27 — F-12 timeout policy evaluation point: evaluate the timeout p

**What was deferred**: F-12 timeout policy evaluation point: evaluate the timeout policy immediately at the moment of timeout detection inside executeJob (synchronous, in the same async call that catches the TimeoutError), not deferred to the next tick. Rejected deferred evaluation because the existing retry machinery (F-03) defers via eligible_at timestamp already — the job is simply set back to pending with a future eligible_at, meaning the next tick will pick it up naturally. Immediate evaluation is not only simpler but also more correct: the timeout handler already holds the job lock (the job is in 'running' state), and setting it back to 'pending' or 'dlq' inside the same error handler maintains the same transaction boundary as normal failure handling. Deferring would require an intermediate 'timed_out' status column or a separate timeout queue, adding schema complexity without benefit. The dispatch path is not affected: executeJob fires as a detached async call from tick(), so immediate policy evaluation inside executeJob does not block or couple the dispatch loop. depends on DR-0003 (retry deferral via eligible_at established the pattern), depends on DR-0009 (dispatch tick fires executeJob detached, so immediate handling in executeJob is safe), depends on DR-0017 (enforcement via Promise.race, timeout detected as TimeoutError in catch block of executeJob), depends on DR-0018 (counter updated in same SQL transaction)
**Why deferred**: Not documented
**Review trigger**: Not specified
**Risk of deferral**: Not documented
**Owner**: TBD
