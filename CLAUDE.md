# Forge — Agent Instructions

Forge is a self-hosted background job processing server. Single Node.js process, no Redis, all state survives restart.

## Decision Records (Hippocampus)

Before any non-trivial decision, query past decisions:

```
cd hippocampus && npm run hippocampus:query -- "describe what you are about to do"
```

The query output now shows inline **Why**, **Rejected alternatives**, and **Depends-on** for each result — read these directly rather than opening every record file.

To trace the full dependency chain of a specific decision:

```
cd hippocampus && npm run hippocampus:chain -- DR-NNNN
```

After making any significant decision:

```
cd hippocampus && npm run hippocampus:log -- "what you decided and why" --autonomous
```

The log command automatically surfaces related past decisions with inline Why summaries. When it prints related DRs, check each one — if it constrained your choice, add `depends-on DR-NNNN` to your description and re-run.

Decision records live in: `.decisions/records/`

### Writing good log descriptions

For each decision, your description should cover three things in natural prose:
1. **What you chose** — name the approach
2. **What you rejected** — use "X is rejected because Y" or "rejected X because Y" for each alternative
3. **What this depends on** — use "depends on DR-NNNN" for each prior decision that constrained your choice

Example:
```
Use a single SQLite transaction for all bulk inserts. Individual inserts in a loop
are rejected because partial success leaves the queue in an ambiguous state.
A separate staging table is rejected because the concern is 1:1 with existing job rows.
depends on DR-0001 (SQLite single-process model), depends on DR-0003 (retry counter pattern).
```

## Setup (first run)

```bash
cd hippocampus
npm install
npm run hippocampus:index
```

## Technology Stack

| Concern | Choice |
|---------|--------|
| Language | TypeScript |
| Runtime | Node.js |

All other technology choices are decisions to be made and recorded.

## Constraints

- Single Node.js process
- No Redis, no external message broker
- All state must survive SIGTERM + restart
- ≤ 512 MB RAM at steady state with 10,000 queued jobs
- Enqueue p99 < 10ms, sustain 200 enqueues/second and 100 executions/second
