# DR-0012: F-10 rate limit algorithm: fixed window (1-second). Token bu

**Date**: 2026-05-27
**Category**: data
**Status**: accepted
**Weight**: standard
**Deciders**: autonomous session 2026-05-27 00:09

## Why

F-10 rate limit algorithm: fixed window (1-second). Token bucket allows configurable burst above the per-second limit and requires storing fractional token counts, which complicates persistence and the window-restoration logic from DR-0011. Sliding window requires storing individual dispatch timestamps (O(n) per queue per second) and is overkill for a jobs-per-second limit that does not need sub-second granularity. Fixed window: the in-memory state is (windowStart: number, count: number) per queue. On each tick, if now >= windowStart + 1000ms we reset count to 0 and advance windowStart. If count >= limit we skip dispatch for this queue for this tick — no jobs dropped, they wait for the next window. This is the simplest algorithm that correctly enforces the spec limit, integrates cleanly with the two-pass tick from DR-0009 (rate limit check wraps the per-queue block before both passes), and maps directly to the hybrid storage in DR-0011. Priority ordering from F-09 is preserved because rate limiting gates whether the queue gets a dispatch slot at all, not which job within the queue is chosen. Depends on DR-0009, DR-0011.

## What

F-10 rate limit algorithm: fixed window (1-second). Token bucket allows configurable burst above the per-second limit and requires storing fractional token counts, which complicates persistence and the window-restoration logic from DR-0011. Sliding window requires storing individual dispatch timestamps (O(n) per queue per second) and is overkill for a jobs-per-second limit that does not need sub-second granularity. Fixed window: the in-memory state is (windowStart: number, count: number) per queue. On each tick, if now >= windowStart + 1000ms we reset count to 0 and advance windowStart. If count >= limit we skip dispatch for this queue for this tick — no jobs dropped, they wait for the next window. This is the simplest algorithm that correctly enforces the spec limit, integrates cleanly with the two-pass tick from DR-0009 (rate limit check wraps the per-queue block before both passes), and maps directly to the hybrid storage in DR-0011. Priority ordering from F-09 is preserved because rate limiting gates whether the queue gets a dispatch slot at all, not which job within the queue is chosen. Depends on DR-0009, DR-0011.

## Trade-off

Not documented

## Alternatives Skipped

None documented

## Relationships

- depends-on: DR-0009
- depends-on: DR-0011
