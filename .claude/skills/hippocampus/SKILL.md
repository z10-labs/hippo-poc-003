---
name: hippocampus
description: Query past architectural decisions before acting, and record new ones after. Use in any project that has a hippocampus/ directory. Replaces reading CLAUDE.md for decision workflow.
origin: z10labs
---

# Hippocampus — Decision Memory Skill

Two operations, two moments in your workflow:

- **Query** — before you act on anything non-trivial
- **Log** — at each decision fork, before you write the code

## Prerequisites

Check that the project has hippocampus set up:

```bash
ls hippocampus/package.json
```

If missing, the system is not installed. Skip this skill.

---

## Operation 1 — Query (before acting)

Run this before any decision that touches architecture, security, data models, external contracts, or design choices:

```bash
cd hippocampus && npm run hippocampus:query -- "describe what you are about to do"
```

**When to query:**

- Before choosing a library or dependency
- Before designing a data model or schema
- Before choosing an interface or API contract
- Before any change that touches multiple modules
- Before anything that looks like a past decision point

**When NOT to query:**

- Routine bug fixes where the fix is obvious from the code
- Pure refactors with no behavior change
- Formatting, renaming variables, extracting helpers

**Reading the output:**

```
DR-0007    [direct  | score: 0.242]   ← vector similarity hit
  Title   : Local JSON vector store for index persistence
  File    : .decisions/records/0007-local-json-vector-store.md

DR-0002    [via inferred-by | Follows from DR-0004]  ← graph traversal hit
  Title   : Two-Layer Retrieval Architecture
```

- `direct` results are semantically similar to your query — read them
- `via inferred-by` / `via depends-on` are linked decisions pulled in by the graph — skim them for context
- `score` above ~0.25 is meaningful; below ~0.15 is noise
- If a result is directly relevant, read the full file before proceeding
- If nothing is returned, proceed — no relevant past decisions exist

---

## Operation 2 — Recognise, Log, then Implement

**You are at a decision fork when:**

- Choosing between two libraries or approaches for the same job
- Deciding where data lives — which table, file, or module owns it
- Deciding how a failure surfaces — throw, log, retry, or silent
- Adding a new external dependency
- Choosing how two modules communicate — direct call, event, shared state
- Any spec requirement that can be satisfied more than one way

When you hit a fork: stop, log the decision, then write the code. Log before you write the implementation, not after the feature is done.

**One decision per log call.** If a feature involves multiple distinct choices (storage backend, retry algorithm, concurrency model), log each one separately before implementing each one.

Record it:

```bash
cd hippocampus && npm run hippocampus:log -- "description of the decision" --autonomous
```

Always pass `--autonomous` when running non-interactively. Without it, the CLI tries to open an interactive prompt.

**The log command automatically surfaces related past decisions.** When you run `hippocampus:log`, the system queries the index and prints any related DRs before writing the record:

```
[Hippocampus] Related decisions found — add depends-on to your description if any influenced this choice:
──────────────────────────────────────────────────────────────────────
  DR-0002     [score: 0.412]  Use SQLite via better-sqlite3
  DR-0007     [score: 0.287]  V3 custom domain routing via Host header
```

When you see this output, check each listed DR. If it constrained your options or your choice builds on it, re-run the log with `depends-on DR-NNNN` added to the description. This is how the decision graph is built. Every relationship you skip is a permanent gap.

**How to write the description — caveman mode:**

One sentence. No fluff. State what was chosen, why it beat the alternative, and which prior decisions it depends on.

```
# Good — specific, with explicit relationships
"use in-process LRU for redirect cache instead of Redis — depends-on DR-0002 (SQLite already primary), Redis would exceed RAM budget"
"cache key is workspaceId:slug not slug alone — depends-on DR-0007 (custom domains), two workspaces can share a slug on different hosts"
"defer billing processor selection — depends-on DR-0018 (quota enforcement model), processor choice follows from how we meter"

# Bad — vague, no relationship, no alternative named
"decided on storage approach"
"use SQLite for rate limits"
"made a decision about caching"
```

---

## Combined Workflow

```
1. Hit a decision fork?
   → npm run hippocampus:query -- "what you're deciding"
   → Note any DR-NNNN IDs that directly constrain your options

2. Picked an approach?
   → npm run hippocampus:log -- "what you chose and why" --autonomous
   → READ the related decisions the command prints
   → If any listed DR influenced your choice, re-run with depends-on DR-NNNN in the description
   → Then write the code for that one decision only
   → Repeat step 2 for every additional fork in the same feature

3. End of session (if any logs were written)?
   → npm run hippocampus:index
```

The log comes before the implementation, not after the feature. Each fork is its own log call.

---

## Decision Categories

Use these in your log description to help auto-classification:

| Category | Keywords to include |
|----------|-------------------|
| architectural | structure, framework, monolith, services |
| security | auth, encrypt, secret, credential, trust |
| data | schema, migration, database, storage |
| api | endpoint, contract, versioning, rest, graphql |
| performance | cache, latency, throughput, scale |
| dependency | package, library, npm, upgrade |
| testing | test, coverage, e2e, mock |
| error-handling | error, retry, fallback, alert |
| compliance | gdpr, legal, regulation, retention |
| cost | budget, license, pricing, build vs buy |
| naming | convention, naming, ubiquitous language |
| operational | deploy, ci, cd, monitoring, rollback |

---

## Anti-Patterns

- Logging every file edit — only log decisions with real alternatives and real consequences
- Running `log` without `--autonomous` in an agent — it will hang waiting for stdin
- Skipping the initial query step — you may duplicate a past decision or miss a constraint
- Logging after an autonomous session without running `index` — new records won't be searchable
- Description contains "and" — that's two decisions, split into two calls
- Logging at the end of a feature as a summary — log at each fork, before the code is written
- Bundling multiple choices (storage + algorithm + concurrency) into one log call — each is its own record
- Ignoring the related decisions printed by the log command — those are your depends-on candidates
