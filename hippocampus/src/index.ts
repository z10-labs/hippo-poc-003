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

async function runQuery() {
  const queryText = args.filter(a => !a.startsWith('--')).join(' ').trim()
  if (!queryText) {
    console.error('Usage: npm run hippocampus:query -- "describe the task"')
    process.exit(1)
  }

  const topN = parseInt(args.find(a => a.startsWith('--top='))?.split('=')?.[1] ?? '5', 10)

  console.log(`\nQuerying: "${queryText}"\n`)
  const results = await query(queryText, topN)

  if (results.length === 0) {
    console.log('No relevant decisions found.')
    return
  }

  console.log('Relevant decisions:\n')
  console.log('─'.repeat(70))

  for (const r of results) {
    const badge = r.surfacedVia === 'direct'
      ? `[direct  | score: ${r.score.toFixed(3)}]`
      : `[via ${r.relationshipType?.padEnd(11)} | ${r.relevanceNote}]`

    console.log(`${r.id.padEnd(10)} ${badge}`)
    console.log(`  Title   : ${r.title}`)
    console.log(`  File    : ${r.filePath}`)
    console.log()
  }
}

async function surfaceRelated(description: string): Promise<void> {
  const index = loadIndex()
  if (index.entries.length === 0) return

  const results = await query(description, 5)
  const direct = results.filter(r => r.surfacedVia === 'direct' && r.score >= 0.20)

  if (direct.length === 0) return

  console.log('[Hippocampus] Related decisions found — add depends-on to your description if any influenced this choice:')
  console.log('─'.repeat(70))
  for (const r of direct) {
    console.log(`  ${r.id.padEnd(10)} [score: ${r.score.toFixed(3)}]  ${r.title}`)
  }
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
  npm run hippocampus:log   -- "desc"    Classify and record a decision
      `.trim())
  }
}

main().catch(err => {
  console.error('Fatal error:', err.message ?? err)
  process.exit(1)
})
