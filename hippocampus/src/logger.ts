import fs from 'fs'
import path from 'path'
import readline from 'readline'
import type { ClassificationResult, DecisionCategory } from './types.js'

const REPO_ROOT = path.resolve(import.meta.dirname, '../../')
const DECISIONS_DIR = path.join(REPO_ROOT, '.decisions')
const RECORDS_DIR = path.join(DECISIONS_DIR, 'records')
const DEFERRED_FILE = path.join(DECISIONS_DIR, 'deferred.md')

function prompt(rl: readline.Interface, question: string): Promise<string> {
  return new Promise(resolve => rl.question(question, resolve))
}

function parseRelationshipsFromDescription(description: string): string {
  const seen = new Set<string>()
  // Split on sentence boundaries, then collect all DR-NNNN tokens from any
  // sentence that contains a "depends on" or "depends-on" phrase — handles
  // natural prose ("Depends on DR-0001 and DR-0002") and token form ("depends-on DR-0001")
  const sentences = description.split(/(?<=[.!?])\s+|(?<=\n)/)
  for (const sentence of sentences) {
    if (/depends[\s-]on/i.test(sentence)) {
      const ids = sentence.match(/DR-\d{4}/gi) ?? []
      for (const id of ids) seen.add(id.toUpperCase())
    }
  }
  if (seen.size === 0) return '- (none)'
  return [...seen].map(id => `- depends-on: ${id}`).join('\n')
}

function parseAlternativesFromDescription(description: string): string {
  const found: string[] = []
  const sentences = description.split(/(?<=[.!?])\s+|(?<=\n)/)

  for (const s of sentences) {
    // "preferable to X (and to Y)"
    if (/preferr?able to/i.test(s)) {
      const parts = s.split(/preferr?able to/i)
      for (const part of parts.slice(1)) {
        const first = part.split(/\s*\(|\s+and\s+to\s/i)[0].trim()
        if (first) found.push(first)
        const andTo = part.match(/\s+and\s+to\s+([^(,;\n.]+)/i)
        if (andTo) found.push(andTo[1].trim())
      }
    }
    // "rather than X"
    const rather = s.match(/rather than\s+([^(,;\n.]+)/i)
    if (rather) found.push(rather[1].trim())
    // "instead of X"
    const instead = s.match(/instead of\s+([^(,;\n.]+)/i)
    if (instead) found.push(instead[1].trim())
    // "X would be simpler/easier/cleaner/etc" — X is the named-but-rejected option
    const would = s.match(/(?:^|;\s*)([\w][\w\s]{2,50}?)\s+would\s+be\s+(?:simpler|easier|faster|cleaner|sufficient|more|less)/i)
    if (would) found.push(would[1].trim())
  }

  const seen = new Set<string>()
  const unique: string[] = []
  for (const f of found) {
    const key = f.toLowerCase().slice(0, 40)
    if (!seen.has(key) && f.length > 2) {
      seen.add(key)
      unique.push(`- ${f.slice(0, 80).trim()}`)
    }
  }
  return unique.length > 0 ? unique.join('\n') : 'None documented'
}

function today(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function nextId(): number {
  const files = fs.readdirSync(RECORDS_DIR).filter(f => /^\d{4}-/.test(f))
  if (files.length === 0) return 1
  return Math.max(...files.map(f => parseInt(f.slice(0, 4), 10))) + 1
}

const LOCK_FILE = path.join(DECISIONS_DIR, '.log.lock')

function withIdLock<T>(fn: () => T): T {
  const deadline = Date.now() + 5000
  while (Date.now() < deadline) {
    try {
      fs.writeFileSync(LOCK_FILE, String(process.pid), { flag: 'wx' })
      try {
        return fn()
      } finally {
        try { fs.unlinkSync(LOCK_FILE) } catch { /* ignore */ }
      }
    } catch (e: any) {
      if (e.code !== 'EEXIST') throw e
      // synchronous 50ms wait — safe on Node.js main thread
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50)
    }
  }
  throw new Error('Could not acquire decision log lock within 5 seconds')
}

function writeRecordAtomic(buildContent: (id: string, drId: string) => string, slug: string): string {
  return withIdLock(() => {
    const id = String(nextId()).padStart(4, '0')
    const filePath = path.join(RECORDS_DIR, `${id}-${slug}.md`)
    fs.writeFileSync(filePath, buildContent(id, `DR-${id}`))
    return filePath
  })
}

export async function writeHeavyRecord(
  description: string,
  autonomous: boolean,
  classification: ClassificationResult
): Promise<string> {
  const date = today()
  const deciders = autonomous
    ? `autonomous session ${date} ${new Date().toTimeString().slice(0, 5)}`
    : 'Claude Code'

  let title = description.slice(0, 60)
  let context = description
  let decision = ''
  let alternativesA = ''
  let alternativesB = ''
  let positiveConsequences = ''
  let negativeConsequences = ''
  let risks = ''
  let relationships = ''
  let reviewTrigger = ''

  if (!autonomous) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
    try {
      title = (await prompt(rl, `Title [${title}]: `)).trim() || title
      context = (await prompt(rl, 'Context (2-5 sentences):\n> ')).trim() || description
      decision = (await prompt(rl, 'Decision (present tense):\n> ')).trim()
      alternativesA = (await prompt(rl, 'Alternative A (or Enter to skip):\n> ')).trim()
      alternativesB = (await prompt(rl, 'Alternative B (or Enter to skip):\n> ')).trim()
      positiveConsequences = (await prompt(rl, 'Positive consequences:\n> ')).trim()
      negativeConsequences = (await prompt(rl, 'Negative trade-offs:\n> ')).trim()
      risks = (await prompt(rl, 'Risks (or Enter to skip):\n> ')).trim()
      relationships = (await prompt(rl, 'Relationships e.g. "depends-on: DR-0001" (or Enter):\n> ')).trim()
      reviewTrigger = (await prompt(rl, 'Review trigger (or Enter to skip):\n> ')).trim()
    } finally {
      rl.close()
    }
  }

  const altSection = [alternativesA, alternativesB].filter(Boolean).length > 0
    ? [alternativesA, alternativesB]
        .filter(Boolean)
        .map((a, i) => `### Option ${String.fromCharCode(65 + i)}\n- **Why rejected**: ${a}`)
        .join('\n\n')
    : parseAlternativesFromDescription(description)

  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 50)
  const finalRelationships = relationships || parseRelationshipsFromDescription(description)

  return writeRecordAtomic((id, drId) => `# ${drId}: ${title}

**Date**: ${date}
**Category**: ${classification.category}
**Status**: accepted
**Weight**: heavy
**Deciders**: ${deciders}

## Context

${context}

## Decision

${decision || context}

## Alternatives Considered

${altSection}

## Consequences

### Positive
- ${positiveConsequences || 'To be documented'}

### Negative / Trade-offs
- ${negativeConsequences || 'To be documented'}

### Risks
- ${risks || 'None identified'}

## Relationships

${finalRelationships}

## Review Trigger

${reviewTrigger || 'Not specified'}
`, slug)
}

export async function writeStandardRecord(
  description: string,
  autonomous: boolean,
  classification: ClassificationResult
): Promise<string> {
  const date = today()
  const deciders = autonomous
    ? `autonomous session ${date} ${new Date().toTimeString().slice(0, 5)}`
    : 'Claude Code'

  let title = description.slice(0, 60)
  let why = description
  let what = ''
  let tradeOff = ''
  let alternativesSkipped = ''
  let relationships = ''

  if (!autonomous) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
    try {
      title = (await prompt(rl, `Title [${title}]: `)).trim() || title
      why = (await prompt(rl, 'Why (1-3 sentences):\n> ')).trim() || description
      what = (await prompt(rl, 'What (the decision, plainly):\n> ')).trim()
      tradeOff = (await prompt(rl, 'Trade-off:\n> ')).trim()
      alternativesSkipped = (await prompt(rl, 'Alternatives skipped:\n> ')).trim()
      relationships = (await prompt(rl, 'Relationships e.g. "depends-on: DR-0001" (or Enter):\n> ')).trim()
    } finally {
      rl.close()
    }
  }

  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 50)
  const finalRelationships = relationships || parseRelationshipsFromDescription(description)
  const finalAlternatives = alternativesSkipped || parseAlternativesFromDescription(description)

  return writeRecordAtomic((id, drId) => `# ${drId}: ${title}

**Date**: ${date}
**Category**: ${classification.category}
**Status**: accepted
**Weight**: standard
**Deciders**: ${deciders}

## Why

${why}

## What

${what || why}

## Trade-off

${tradeOff || 'Not documented'}

## Alternatives Skipped

${finalAlternatives}

## Relationships

${finalRelationships}
`, slug)
}

export async function writeDeferredEntry(description: string, autonomous: boolean): Promise<string> {
  const date = today()
  let topic = description.slice(0, 60)
  let whatDeferred = description
  let whyDeferred = ''
  let reviewTrigger = ''
  let riskOfDeferral = ''
  let owner = 'TBD'

  if (!autonomous) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
    try {
      topic = (await prompt(rl, `Topic [${topic}]: `)).trim() || topic
      whatDeferred = (await prompt(rl, 'What was deferred:\n> ')).trim() || description
      whyDeferred = (await prompt(rl, 'Why deferred:\n> ')).trim()
      reviewTrigger = (await prompt(rl, 'Review trigger:\n> ')).trim()
      riskOfDeferral = (await prompt(rl, 'Risk of deferral:\n> ')).trim()
      owner = (await prompt(rl, 'Owner [TBD]: ')).trim() || 'TBD'
    } finally {
      rl.close()
    }
  }

  const entry = `\n---\n\n## ${date} — ${topic}\n\n**What was deferred**: ${whatDeferred}\n**Why deferred**: ${whyDeferred || 'Not documented'}\n**Review trigger**: ${reviewTrigger || 'Not specified'}\n**Risk of deferral**: ${riskOfDeferral || 'Not documented'}\n**Owner**: ${owner}\n`

  fs.appendFileSync(DEFERRED_FILE, entry)

  return DEFERRED_FILE
}

export function writeInlineComment(description: string): string {
  const date = today()
  return `// ## DECISION: ${date}\n// ${description}`
}

