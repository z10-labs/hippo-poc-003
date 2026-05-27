# Forge + Hippocampus — poc-003

A self-hosted background job processing server built to validate the **Hippocampus** decision-memory system across a real, multi-feature implementation.

## What this is

**Forge** is the application under test — a TypeScript background job processor with no Redis, no external broker, and full ACID persistence via SQLite. It implements 13 features (F-01 through F-13) across 7 spec versions, each introduced as a separate build session.

**Hippocampus** is the decision-memory layer. Autonomous agents query past architectural decisions before acting, and log new ones at every fork. The system stores structured records with relationship links (`depends-on DR-NNNN`) and extracted rejected alternatives.

**The experiment series** (poc-003 and poc-004) tested two things:

1. **Production quality** — will agents actually write decision records with accurate Relationships and Alternatives fields?
2. **Cold-read usability** — can a fresh agent understand the architecture from the decision index alone, without reading source files or git history?

## Results

| Phase | Experiment | Outcome |
|-------|-----------|---------|
| Production quality | 3.1–3.7 | Stopping condition met: 3/3 records per run with both Relationships and Alternatives non-empty |
| Cold-read validation | 4.1–4.3 | File reads reduced from 13/21 → 1/21 → **0/21** |

Agent verdict on the mature system: *"The decision graph turns a flat collection of notes into a navigable causal model. The chain command makes ripple-effect analysis instantaneous rather than manual. Decisively better than git log for understanding why the architecture is constrained the way it is."*

## Decision records

21 records spanning F-01 through F-13. The deepest dependency chain reaches 5 levels:

```
DR-0021 → DR-0020 → DR-0019 → DR-0006 → DR-0001
```

All records live in `.decisions/records/`. The deferred decisions log is at `.decisions/deferred.md`.

## Hippocampus commands

All run from the `hippocampus/` subdirectory:

```bash
# Query — inline Why, Rejected alternatives, and Depends-on in output
npm run hippocampus:query -- "describe what you are deciding"

# Browse by category or weight
npm run hippocampus:list -- --category=data
npm run hippocampus:list -- --weight=heavy

# Trace full dependency chain
npm run hippocampus:chain -- DR-NNNN

# Record a decision
npm run hippocampus:log -- "what you chose and why" --autonomous

# Rebuild index (run after adding records manually)
npm run hippocampus:index
```

Query output format:
```
DR-0001  [0.589]  (state · standard)
  Use SQLite via better-sqlite3 as the sole persistence layer.
  Why: ACID durability, restart-survival. No Redis, no external broker required.
  Rejected: (none documented)

DR-0018  [0.471]  (data · standard)
  F-12 escalation counter storage: add two new columns to the jobs table
  Why: Counter is 1:1 with job row. In-memory fails restart-survival requirement.
  Rejected: pure in-memory storage because the spec explicitly requires the escalat…
             a separate job_timeout_state table because the counter is 1:1 with a j…
  Depends on: DR-0001, DR-0003, DR-0014
```

## Forge — running the application

```bash
npm install
npm run dev          # development mode with watch
npm run build        # compile TypeScript
npm start            # run compiled output
```

The server starts on port 3000. See `src/index.ts` for the full route list and `src/types.ts` for the complete job status state machine.

## Setup for new sessions

```bash
cd hippocampus
npm install
npm run hippocampus:index   # builds the vector index from .decisions/records/
```

## Experiment log

Full notes for poc-003 (experiments 3.1–3.7) and poc-004 (experiments 4.1–4.3):

- `../experiments/poc-003-experiment-log.md`
- `../experiments/poc-004-experiment-log.md`

The experiment methodology is documented as a reusable skill:

- `.claude/skills/hippocampus-experiment/SKILL.md`
- `../experiments/hippocampus-experiment-skill.md`
