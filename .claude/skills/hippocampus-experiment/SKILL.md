---
name: hippocampus-experiment
description: Run a structured experiment series to validate and improve a Hippocampus decision-memory system. Covers production quality (do agents write good records?) and cold-read validation (are records useful to a different agent?). Use when starting a new poc-NNN experiment or when the current system has known quality gaps.
origin: z10labs
---

# Hippocampus Experiment Skill

This skill runs two coupled experiment phases on a Hippocampus-equipped codebase:

- **Phase 1 — Production quality**: measure whether autonomous build agents log decisions with accurate Relationships and Alternatives fields. Iterate until the stopping condition is met.
- **Phase 2 — Cold-read validation**: measure whether a fresh agent can understand the architecture from the decision index alone, without reading source files. Iterate until file reads reach zero.

Each iteration follows the same structure: implement a change, build from a spec, read the records, write notes, score, decide whether to continue.

---

## Prerequisites

1. A Hippocampus-equipped project at a known path (e.g., `hippo-poc-003/`)
2. A running decision index (`hippocampus:index` has been run at least once)
3. An experiment log file for this series (e.g., `experiments/poc-004-experiment-log.md`)
4. A spec directory with versioned feature specs (e.g., `spec/v1.md`, `spec/v2.md`)

Check setup:
```bash
ls <project>/hippocampus/package.json
ls <project>/.decisions/records/
ls <project>/spec/
```

---

## Phase 1 — Production Quality

### What you are measuring

After each build run, read the records produced and score them:

| Metric | How to measure |
|--------|----------------|
| Records written | Count `.decisions/records/` files added since last run |
| Relationships non-empty | `grep -l "depends-on: DR" .decisions/records/*.md | wc -l` |
| Alternatives non-empty | Check `## Alternatives Skipped` / `## Alternatives Considered` section in each new record — non-empty means at least one line that is NOT "None documented" and NOT a pure fragment starting with "because" |
| Records with BOTH fields non-empty | Count where both Relationships and Alternatives are populated |
| Deferred entries (not records) | `tail -30 .decisions/deferred.md` — decisions that should have been standard records |

**Stopping condition**: ≥ 3 records per run where both Relationships AND Alternatives fields are non-empty.

---

### Iteration loop

Each iteration = one spec version + one build run.

#### Step 1 — Implement the current hypothesis fix

Before each build run, implement whatever fix was identified in the previous iteration's research notes. Common fixes:

**Extraction pattern gaps** (`hippocampus/src/logger.ts`):
```typescript
// In parseAlternativesFromDescription(), add patterns as needed:
const passiveRejected = s.match(/([\w][\w\s-]{2,50}?)\s+(?:is|was|are|were)\s+rejected\b/i)
const rejected = s.match(/\brejected\s+([^(,;\n.]+)/i)  // active — run only if passive did not fire
const rather = s.match(/rather than\s+([^(,;\n.]+)/i)
const fails = s.match(/^([\w][\w\s-]{2,40}?)\s+fails\b/i)  // sentence-start only
```

**Classifier false positives** (`hippocampus/src/classify.ts`):
- The deferred-trigger regex fires on option labels like "deferred evaluation" — narrow it to first-person intent phrases only
- Watch for category keywords that match common prose ("error" → error-handling when describing a design choice, not a bug)

**Auto-query quality** (`hippocampus/src/index.ts`):
- `surfaceRelated()` threshold: 0.20 is the production default; lower it if related DRs are being missed
- Add Why content to surfaceRelated output so agents see the decision rationale inline, not just the title

#### Step 2 — Write the spec

Write `spec/vN.md` with a feature that forces 3+ explicit decision forks.

**What makes a good spec for this experiment:**

- Name 3 distinct decision forks explicitly — "three forks, each with a clear rejected alternative"
- For each fork, reference the prior DRs it depends on by ID (e.g., "Depends on DR-0001 and DR-0009")
- Frame the decision surface as "the choice and its alternatives" — NOT using hippocampus vocabulary as option labels
- Instruct the agent to "query the index before logging each fork" and "log each as a standard decision record before writing code"

**Vocabulary traps to avoid in specs:**
- Do NOT use "deferred" as an option label — it triggers `writeDeferredEntry` instead of `writeStandardRecord`
- Do NOT use "heavy" / "standard" / "light" as option labels — they match classifier keywords
- Use neutral labels: "approach A vs approach B", "option 1 vs option 2"

**Decision fork depth**: the best specs have at least one fork that depends on a prior DR from a *previous* spec. This tests the virtuous cycle (does the agent trace the graph?).

Example fork framing that works well:
```markdown
1. **Batch assembly storage**: where does the partially-assembled batch live between ticks?
   In-memory is fast but fails restart-survival. A separate `batch_staging` table is durable
   but adds schema complexity. A flag on the existing jobs table avoids a new table but requires
   careful status semantics. Depends on DR-0001.
```

#### Step 3 — Run the build agent

Spawn an agent with this prompt structure:

```
You are working in <project-path>. Implement <feature> from spec/<vN>.md.

Before writing any code, log each of the N decision forks described in the spec
as STANDARD decision records. Do NOT use the deferred log path.

Logging workflow:
1. cd hippocampus && npm run hippocampus:query -- "describe the decision"
2. Read the printed related decisions — note DR-NNNN IDs of relevant ones
3. cd hippocampus && npm run hippocampus:log -- "description" --autonomous
   - Include "X is rejected because Y" or "rejected X because Y" for each alternative
   - Include "depends on DR-NNNN" for each prior decision that constrained this choice

After all forks are logged, implement the feature. Run tests when done.
```

#### Step 4 — Read the records

After the agent completes, read every new record:

```bash
# List new records (sort by mtime descending)
ls -lt <project>/.decisions/records/ | head -10

# For each new record, check the two key sections:
grep -A 10 "## Relationships" <record-file>
grep -A 10 "## Alternatives Skipped" <record-file>
grep -A 10 "## Alternatives Considered" <record-file>

# Check for deferred entries that should have been records:
tail -40 <project>/.decisions/deferred.md
```

**For each new record, ask:**
1. Does `## Relationships` have `- depends-on: DR-NNNN` entries? If yes ✅, if `- (none)` investigate why — were related DRs surfaced during the log call?
2. Does the Alternatives section have named alternatives (not just "None documented" or pure "because Y" fragments)?
3. Is the reason the field is empty: (a) the agent never wrote rejection prose, (b) the prose exists but no pattern matched, or (c) the pattern matched but extracted the wrong part?

**Diagnosing extraction failures:**

Read the record's Why/What section and look for rejection prose. Common forms the agent uses:

| Prose form | Extraction pattern | Status as of 3.7 |
|------------|-------------------|------------------|
| `X is rejected because Y` | passive: `([\w][\w\s-]{2,50}?)\s+(?:is\|was\|are\|were)\s+rejected\b` | ✅ implemented |
| `rejected X because Y` | active: `\brejected\s+([^(,;\n.]+)` (only if passive didn't fire) | ✅ implemented |
| `rather than X` | `rather than\s+([^(,;\n.]+)` | ✅ implemented |
| `instead of X` | `instead of\s+([^(,;\n.]+)` | ✅ implemented |
| `preferable to X` | `preferr?able to` | ✅ implemented |
| `X fails [requirement]` | sentence-start `^([\w][\w\s-]{2,40}?)\s+fails\b` | ✅ implemented |
| `X allows/requires [cost]` | sentence-start with anaphoric filter | ✅ implemented |
| `X would be simpler` | `would\s+be\s+(?:simpler\|easier\|faster\|cleaner)` | ✅ implemented |
| New form observed | Add new regex to `parseAlternativesFromDescription` | Your job |

**Noise patterns to filter:**
- Entries starting with "because " → pure reason fragments, filter them
- When passive pattern fires for a sentence, do NOT also run the active pattern on that sentence

#### Step 5 — Write research notes

In the experiment log, add a section for this iteration. Structure:

```markdown
## Experiment N.M

**Date**: YYYY-MM-DD
**Spec**: vN (feature name)
**Hypothesis**: [what change you implemented and what you expected it to do]

### Actual Decisions Logged

| DR | Maps to | Relationships field | Alternatives field | Notes |
|----|---------|--------------------|--------------------|-------|
| DR-NNNN | [decision description] | `DR-XXXX, DR-YYYY` or `(none)` | listed / None documented | [what you observed — prose form, extraction hit or miss] |

### Scoring

| Metric | Previous | This run | Target |
|--------|----------|----------|--------|
| Relationships non-empty | N | N | ≥ 3 |
| Alternatives non-empty | N | N | ≥ 3 |
| Records with both non-empty | N | N | ≥ 3 |

### Key Observations

**1. [Most important finding]**
Be specific: which DR, which prose form, which pattern fired or didn't.

**2. [Second finding]**

### What We Learned

One paragraph. What does this change in your understanding of the problem?

### Changes for next iteration

What specific code change + spec change will you make next?
```

#### Step 6 — Check stopping condition

If ≥ 3 records with both fields non-empty: Phase 1 is complete. Move to Phase 2.

If not: identify the remaining gap (what prose form is still not extracted?), implement the fix, write the next spec, and repeat from Step 1.

**Common failure modes and their fixes:**

| Symptom | Root cause | Fix |
|---------|-----------|-----|
| Relationships `(none)` despite agent mentioning prior DRs | Agent wrote natural prose ("as with DR-0002") but not `depends-on DR-NNNN` | Improve `surfaceRelated()` output — show Why inline so the agent is more likely to recognize and cite specific DRs |
| Alternatives "None documented" despite clear rejection prose | Prose form not matched by any regex | Read the Why section, identify the exact prose pattern, add regex |
| Record went to deferred.md | Classifier matched "deferred" in description | Narrow the deferred-trigger to first-person intent phrases only |
| Correct alternative name extracted but "because Y" noise also present | Active pattern firing on same sentence as passive pattern | Run passive first; skip active for that sentence if passive matched |
| Agent logs all forks as one combined record | Skill instruction not explicit enough | Add to spec: "log each fork as a separate decision record before writing the code for that fork" |

---

## Phase 2 — Cold-Read Validation

Once Phase 1 stopping condition is met, test whether the records are *useful* to a different agent who has never seen the codebase.

### What you are measuring

| Metric | Target |
|--------|--------|
| Record files opened | 0 (query output should be self-sufficient) |
| Architecture questions answered correctly | All from commands alone |
| Design extension cited correct prior DRs | Yes |
| Agent self-report vs git log | "Better for why-questions" |

### Cold-read test design

Spawn a fresh agent with NO source file access and NO git log access. Give it three tasks:

**Task 1 — Comprehension**
> "Answer: what persistence mechanism does [system] use, and why was it chosen over alternatives?"

Ask the agent to report how many queries and file reads it needed.

**Task 2 — Design extension**
Give it a new feature to design. Ask it to:
- Cite prior DR-NNNN records its design depends on
- Name alternatives it rejected with reasons
- NOT read source files — use only the decision index

**Task 3 — Self-assessment**
Ask explicitly:
1. How many queries did you run?
2. How many record files did you open?
3. Could you answer Task 1 entirely from query output?
4. Did the chain command add value?
5. Would reading `git log` + diffs have been faster or slower?
6. What is missing?

Cold-read agent prompt template:
```
You are a cold-read agent. You have NEVER seen the [system] codebase.
You cannot read any source files. You cannot use git log.
You have only: hippocampus:query, hippocampus:list, hippocampus:chain commands
and the .decisions/records/ files as a fallback.

Try to answer each task from command output BEFORE opening any files.

Commands:
  cd <project>/hippocampus && npm run hippocampus:query -- "question"
  cd <project>/hippocampus && npm run hippocampus:list -- --category=data
  cd <project>/hippocampus && npm run hippocampus:chain -- DR-NNNN

[Task 1, Task 2, Task 3 here]
```

### Iteration loop

Each iteration = one set of usability improvements + one cold-read run.

**Common improvements and their impact (ranked by observed effect):**

1. **Show Why inline in query output** — single biggest reduction in file opens. Agents need content, not filenames.
   - In `runQuery()`, format each result with the `why` field from `IndexEntry`
   - In `surfaceRelated()`, show the first ~120 chars of Why next to each result

2. **Show "Rejected: (none documented)" explicitly** — eliminates file opens caused by "is there more below the truncation?" uncertainty.
   - When `alternatives` is empty/null, render `Rejected: (none documented)` rather than omitting the field

3. **Add `hippocampus:chain DR-NNNN` command** — turns ripple-effect analysis from 4+ queries to one command.
   - Traverse `depends-on` links recursively, printing Why and Rejected at each node
   - Track visited set to avoid cycles

4. **Add `hippocampus:list --category=X` command** — enables discovery of records that semantic queries miss.
   - Without this, records outside the agent's initial query vocabulary are invisible
   - Category sweep (`data`, `api`, `architectural`, `state`, `compliance`) usually surfaces 2-4 records that no single query found

5. **Add `why` and `alternatives` as parsed fields in `IndexEntry`** — prerequisite for all display improvements.
   - Parse `## Why` / `## Context` section: trim to ~200 chars
   - Parse `## Alternatives Skipped` / `## Alternatives Considered`: extract bullet lines, filter "because" fragments

### Write research notes (same format as Phase 1)

Track the file-read count per iteration:

| Iteration | Key change | File reads | Agent verdict |
|-----------|-----------|-----------|---------------|
| Baseline | Current system | N | [quote from self-assessment] |
| +1 | [change] | N | [quote] |

**Stopping condition**: 0 record files opened AND agent explicitly says the system is useful for understanding architectural intent (not just "it worked fine").

---

## What a Mature System Looks Like

After both phases complete, the system should satisfy all of these:

**Production quality (Phase 1):**
- ≥ 3 records per build with non-empty Relationships
- ≥ 3 records per build with non-empty Alternatives
- Virtuous cycle confirmed: DRs logged early in a session appear as structured depends-on links in later DRs of the same session
- No false deferred entries for decisions that were actually made

**Cold-read usability (Phase 2):**
- Query output includes Why, Rejected, Depends-on inline — agents read decisions from results, not files
- "Rejected: (none documented)" visible for records with no documented alternatives
- `hippocampus:chain` available for dependency tree traversal
- `hippocampus:list --category=X` available for discovery by category
- A cold-read agent can design a new feature with correct DR citations without opening any source files

**The system's value proposition:**
> Git log tells you what was built. The decision graph tells you why the architecture is constrained the way it is — specifically, what was rejected and which future decisions are load-bearing on each prior choice. For cold-read design work, the decision graph is faster and more reliable than commit-history archaeology.

---

## Reference: Experiment Log Structure

Keep a single log file per poc series (e.g., `experiments/poc-003-experiment-log.md`).

Top-level structure:
```markdown
# POC-NNN Experiment Log

[One paragraph: what is being tested, why it matters]

**Project**: [path and description]
**Stopping condition**: [specific, measurable]

---

## Experiment N.1

**Status**: Complete / Planned
**Hypothesis**: ...
[... sections per iteration template above ...]

---

## Experiment N.2

...

---

## Experiment Series Summary

[Table of all iterations with key change and outcome]
[What the series proved or disproved]
[Known remaining gaps]
```

---

## Reference: Hippocampus System Files

| File | What it does | When to edit |
|------|-------------|-------------|
| `hippocampus/src/logger.ts` | `parseAlternativesFromDescription()` and `parseRelationshipsFromDescription()` | When a new prose pattern isn't being extracted |
| `hippocampus/src/classify.ts` | `classifyAuto()` — maps description prose to weight/category | When records are misclassified (wrong weight, false deferred) |
| `hippocampus/src/index.ts` | `runQuery()`, `runLog()`, `surfaceRelated()`, `runChain()`, `runList()` | When changing what agents see during query or log |
| `hippocampus/src/indexer.ts` | `buildIndex()`, `parseDecisionFile()`, `IndexEntry` schema | When adding new parsed fields to the index |
| `hippocampus/src/retriever.ts` | `query()` — vector similarity + graph traversal | When changing how results are ranked or expanded |
| `hippocampus/src/types.ts` | `RelationshipType`, `RetrievalResult`, `IndexEntry` | When adding new relationship types or result fields |

After any change to extraction logic, run a **force rebuild** to re-parse all existing records:
```bash
cd hippocampus && npm run hippocampus:index -- --force
```

---

## Reference: Decision Record Sections by Weight

**Standard record** (`writeStandardRecord`):
- `## Why` — the log description prose
- `## What` — same prose (can be overridden interactively)
- `## Trade-off` — "Not documented" unless filled interactively
- `## Alternatives Skipped` — extracted from prose by `parseAlternativesFromDescription`
- `## Relationships` — extracted from prose by `parseRelationshipsFromDescription`

**Heavy record** (`writeHeavyRecord`):
- `## Context` — the log description prose
- `## Decision` — same prose
- `## Alternatives Considered` — extracted from prose (uses `parseAlternativesFromDescription` as fallback)
- `## Consequences` — "To be documented" unless filled interactively
- `## Relationships` — extracted from prose
- `## Review Trigger` — "Not specified" unless filled interactively

The Alternatives section name differs (`Skipped` vs `Considered`) — ensure any display code handles both patterns when parsing for display:
```typescript
content.match(/## Alternatives(?:\s+(?:Skipped|Considered))?\n([\s\S]*?)(?:\n##|$)/)
```
