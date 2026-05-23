# Forge — Agent Instructions

Forge is a self-hosted background job processing server. Single Node.js process, no Redis, all state survives restart.

## Decision Records (Hippocampus)

Before any non-trivial decision, query past decisions:

```
cd hippocampus && npm run hippocampus:query -- "describe what you are about to do"
```

After making any significant decision:

```
cd hippocampus && npm run hippocampus:log -- "what you decided and why" --autonomous
```

The log command automatically surfaces related past decisions. When it prints related DRs, check each one — if it constrained your choice, add `depends-on DR-NNNN` to your description and re-run.

Decision records live in: `.decisions/records/`

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
