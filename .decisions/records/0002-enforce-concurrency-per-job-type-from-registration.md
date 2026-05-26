# DR-0002: Enforce concurrency per job type (from registration options)

**Date**: 2026-05-24
**Category**: api
**Status**: accepted
**Weight**: standard
**Deciders**: autonomous session 2026-05-24 20:48

## Why

Enforce concurrency per job type (from registration options), not per queue name. Queue is a routing/grouping label for API filtering and monitoring. runningByType Map tracks in-flight counts.

## What

Enforce concurrency per job type (from registration options), not per queue name. Queue is a routing/grouping label for API filtering and monitoring. runningByType Map tracks in-flight counts.

## Trade-off

Not documented

## Alternatives Skipped

None documented

## Relationships

- (none)
