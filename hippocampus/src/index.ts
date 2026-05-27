#!/usr/bin/env node
import process from 'process'
import { buildIndex, loadIndex } from './indexer.js'
import { query } from './retriever.js'
import { classifyAuto, classifyInteractive } from './classify.js'
import { writeHeavyRecord, writeStandardRecord, writeDeferredEntry, writeInlineComment } from './logger.js'

const [, , command, ...args] = process.argv
const isAutonomous = !process.stdin.isTTY || args.includes('--autonomous')

async function runIndex() {
  const force = args.includes('--force')
  console.log(`Building index${force ? ' (full rebuild)' : ' (incremental)'}...\n`)
  const { indexed, skipped } = await buildIndex(force)
  console.log(`\nDone. ${indexed} document(s) indexed, ${skipped} unchanged.`)
}

function formatResult(r: Awaited<ReturnType<typeof query>>[number], verbose: boolean): string {
  const lines: string[] = []
  const badge = r.surfacedVia === 'direct'
    ? `[${r.score.toFixed(3)}]`
    : `[via ${r.relationshipType} from ${r.relevanceNote.split(' ').pop()}]`

  const meta = [r.category, r.weight].filter(Boolean).join(' · ')
  lines.push(`${r.id}  ${badge}  ${meta ? `(${meta})` : ''}`)
  lines.push(`  ${r.title}`)

  if (verbose || r.surfacedVia === 'direct') {
    if (r.why) {
      const wrapped = r.why.length > 160
        ? r.why.slice(0, 157) + '…'
        : r.why
      lines.push(`  Why: ${wrapped}`)
    }

    const alts = r.alternatives?.trim()
    if (alts) {
      const altLines = alts.split('\n').slice(0, 3)
      lines.push(`  Rejected: ${altLines[0]}`)
      for (const a of altLines.slice(1)) lines.push(`           ${a}`)
    } else {
      // Explicitly show absence so agents don't open files to check
      lines.push(`  Rejected: (none documented)`)
    }

    const deps = r.dependsOn ?? []
    if (deps.length > 0) {
      lines.push(`  Depends on: ${deps.join(', ')}`)
    }
  }

  return lines.join('\n')
}

async function runQuery() {
  const queryText = args.filter(a => !a.startsWith('--')).join(' ').trim()
  if (!queryText) {
    console.error('Usage: npm run hippocampus:query -- "describe the task"')
    process.exit(1)
  }

  const topN = parseInt(args.find(a => a.startsWith('--top='))?.split('=')?.[1] ?? '5', 10)
  const verbose = args.includes('--verbose')

  console.log(`\nQuerying: "${queryText}"\n`)
  const results = await query(queryText, topN)

  if (results.length === 0) {
    console.log('No relevant decisions found.')
    return
  }

  console.log('Relevant decisions:\n')
  console.log('─'.repeat(70))

  for (const r of results) {
    console.log(formatResult(r, verbose))
    console.log()
  }
}

async function surfaceRelated(description: string): Promise<void> {
  const index = loadIndex()
  if (index.entries.length === 0) return

  const results = await query(description, 5)
  const direct = results.filter(r => r.surfacedVia === 'direct' && r.score >= 0.20)

  if (direct.length === 0) return

  console.log('[Hippocampus] Related decisions — add depends-on DR-NNNN to your description if any apply:')
  console.log('─'.repeat(70))
  for (const r of direct) {
    console.log(`  ${r.id}  [${r.score.toFixed(3)}]  ${r.title}`)
    if (r.why) {
      const short = r.why.length > 120 ? r.why.slice(0, 117) + '…' : r.why
      console.log(`         Why: ${short}`)
    }
  }
  console.log()
}

async function runList() {
  const index = loadIndex()
  const category = args.find(a => a.startsWith('--category='))?.split('=')?.[1]?.toLowerCase()
  const weight = args.find(a => a.startsWith('--weight='))?.split('=')?.[1]?.toLowerCase()

  let entries = index.entries
  if (category) entries = entries.filter(e => e.category.toLowerCase() === category)
  if (weight)   entries = entries.filter(e => e.weight.toLowerCase() === weight)

  if (entries.length === 0) {
    console.log(`No records match the given filters.`)
    return
  }

  const filterDesc = [category && `category=${category}`, weight && `weight=${weight}`].filter(Boolean).join(', ')
  console.log(`\nDecision records${filterDesc ? ` (${filterDesc})` : ''}:\n`)
  console.log('─'.repeat(70))

  for (const e of entries.sort((a, b) => a.id.localeCompare(b.id))) {
    console.log(`${e.id}  (${e.category} · ${e.weight})  ${e.date}`)
    console.log(`  ${e.title}`)
    if (e.why) {
      const short = e.why.length > 120 ? e.why.slice(0, 117) + '…' : e.why
      console.log(`  Why: ${short}`)
    }
    const deps = e.relationships.filter(r => r.type === 'depends-on').map(r => r.target)
    if (deps.length > 0) console.log(`  Depends on: ${deps.join(', ')}`)
    console.log()
  }
}

async function runChain() {
  const targetId = args.find(a => /^DR-\d+$/i.test(a))?.toUpperCase()
  if (!targetId) {
    console.error('Usage: npm run hippocampus:chain -- DR-NNNN')
    process.exit(1)
  }

  const index = loadIndex()
  const entryById = new Map(index.entries.map(e => [e.id, e]))

  function printChain(id: string, depth: number, visited: Set<string>) {
    if (visited.has(id)) return
    visited.add(id)
    const entry = entryById.get(id)
    if (!entry) {
      console.log(`${'  '.repeat(depth)}${id}  (not in index)`)
      return
    }
    const indent = '  '.repeat(depth)
    const marker = depth === 0 ? '▶' : '└─'
    console.log(`${indent}${marker} ${entry.id}  (${entry.category} · ${entry.weight})`)
    console.log(`${indent}   ${entry.title}`)
    if (entry.why) {
      const short = entry.why.length > 100 ? entry.why.slice(0, 97) + '…' : entry.why
      console.log(`${indent}   Why: ${short}`)
    }
    const alts = entry.alternatives?.trim()
    if (alts) {
      const first = alts.split('\n')[0]
      console.log(`${indent}   Rejected: ${first}`)
    }
    const deps = entry.relationships.filter(r => r.type === 'depends-on')
    const unvisitedDeps = deps.filter(d => !visited.has(d.target))
    if (unvisitedDeps.length > 0) {
      console.log(`${indent}   ─── depends on ───`)
      for (const dep of deps) {
        printChain(dep.target, depth + 1, visited)
      }
    }
  }

  console.log(`\nDecision chain for ${targetId}:\n`)
  printChain(targetId, 0, new Set())
  console.log()
}

async function runLog() {
  const description = args.filter(a => !a.startsWith('--')).join(' ').trim()

  if (!description) {
    console.error('Usage: npm run hippocampus:log -- "description of the decision"')
    process.exit(1)
  }

  console.log(`\nClassifying: "${description}"\n`)

  const classification = isAutonomous
    ? classifyAuto(description)
    : await classifyInteractive(description)

  console.log(`\nClassification: ${classification.weight} | ${classification.category ?? 'N/A'}`)
  console.log(`Reason: ${classification.reason}\n`)

  if (classification.weight === 'skip') {
    console.log('Implementation-level decision — not recorded.')
    return
  }

  // Surface related decisions before writing — agent sees them at the moment of logging
  await surfaceRelated(description)

  let filePath: string

  if (classification.weight === 'deferred') {
    filePath = await writeDeferredEntry(description, isAutonomous)
    console.log(`\nDeferred decision appended to: ${filePath}`)
    return
  }

  if (classification.weight === 'light') {
    const comment = writeInlineComment(description)
    console.log('\nAdd this inline comment to the relevant source file:\n')
    console.log(comment)
    return
  }

  if (classification.weight === 'heavy') {
    filePath = await writeHeavyRecord(description, isAutonomous, classification)
    console.log(`\nFull Decision Record written to: ${filePath}`)
    await buildIndex(false)
    return
  }

  // standard
  filePath = await writeStandardRecord(description, isAutonomous, classification)
  console.log(`\nStandard decision record written to: ${filePath}`)
  await buildIndex(false)
}

async function main() {
  switch (command) {
    case 'index':
      await runIndex()
      break
    case 'query':
      await runQuery()
      break
    case 'list':
      await runList()
      break
    case 'chain':
      await runChain()
      break
    case 'log':
      await runLog()
      break
    default:
      console.log(`
Hippocampus — Codebase Memory Layer

Commands:
  npm run hippocampus:index              Build/update the vector index
  npm run hippocampus:index -- --force   Full rebuild of the index
  npm run hippocampus:query -- "task"    Query relevant past decisions
  npm run hippocampus:query -- "task" --verbose  Include Why/Alternatives for all results
  npm run hippocampus:list                       List all records with inline Why
  npm run hippocampus:list -- --category=data    Filter by category
  npm run hippocampus:list -- --weight=heavy     Filter by weight
  npm run hippocampus:chain -- DR-NNNN           Trace full dependency chain from a record
  npm run hippocampus:log   -- "desc"            Classify and record a decision
      `.trim())
  }
}

main().catch(err => {
  console.error('Fatal error:', err.message ?? err)
  process.exit(1)
})
