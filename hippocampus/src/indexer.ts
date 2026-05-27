import fs from 'fs'
import path from 'path'
import { pipeline } from '@huggingface/transformers'
import type { Relationship, RelationshipType } from './types.js'

const REPO_ROOT = path.resolve(import.meta.dirname, '../../')
const RECORDS_DIR = path.join(REPO_ROOT, '.decisions/records')
const INDEX_DIR = path.join(REPO_ROOT, 'hippocampus/.index')
const INDEX_FILE = path.join(INDEX_DIR, 'index.json')
const TIMESTAMP_FILE = path.join(INDEX_DIR, 'last-indexed.txt')
const MODEL = 'Xenova/all-MiniLM-L6-v2'

export interface IndexEntry {
  id: string
  title: string
  category: string
  status: string
  weight: string
  date: string
  filePath: string
  relationships: Relationship[]
  embedding: number[]
  document: string
  why: string       // first ~200 chars of Why/Context section for inline display
  alternatives: string  // extracted alternatives list, newline-separated
}

export interface VectorIndex {
  entries: IndexEntry[]
  builtAt: number
}

let embedder: any

async function getEmbedder() {
  if (!embedder) {
    process.stdout.write('Loading embedding model (first run downloads ~60 MB)...')
    embedder = await (pipeline as any)('feature-extraction', MODEL, { revision: 'main' })
    process.stdout.write(' done\n')
  }
  return embedder
}

export async function embed(text: string): Promise<number[]> {
  const model = await getEmbedder()
  const output = await model(text, { pooling: 'mean', normalize: true })
  return Array.from(output.data as Float32Array)
}

export function loadIndex(): VectorIndex {
  if (!fs.existsSync(INDEX_FILE)) {
    return { entries: [], builtAt: 0 }
  }
  return JSON.parse(fs.readFileSync(INDEX_FILE, 'utf8')) as VectorIndex
}

function saveIndex(index: VectorIndex) {
  fs.mkdirSync(INDEX_DIR, { recursive: true })
  fs.writeFileSync(INDEX_FILE, JSON.stringify(index, null, 2))
  fs.writeFileSync(TIMESTAMP_FILE, String(index.builtAt))
}

function getLastIndexedTime(): number {
  if (!fs.existsSync(TIMESTAMP_FILE)) return 0
  const ts = parseInt(fs.readFileSync(TIMESTAMP_FILE, 'utf8').trim(), 10)
  return isNaN(ts) ? 0 : ts
}

function parseRelationships(content: string): Relationship[] {
  const section = content.match(/## Relationships\n([\s\S]*?)(?:\n##|$)/)?.[1] ?? ''
  const relationships: Relationship[] = []

  for (const line of section.split('\n')) {
    const match = line.match(/[-*]\s*(overrides|inferred-by|depends-on|supersedes):\s*(DR-\d+)/i)
    if (match) {
      relationships.push({
        type: match[1].toLowerCase() as RelationshipType,
        target: match[2].toUpperCase(),
      })
    }
  }

  return relationships
}

function parseWhy(content: string): string {
  // Works for both standard records (## Why) and heavy records (## Context)
  const section = content.match(/## (?:Why|Context)\n([\s\S]*?)(?:\n##|$)/)?.[1] ?? ''
  const trimmed = section.trim().replace(/\s+/g, ' ')
  return trimmed.length > 220 ? trimmed.slice(0, 217) + '…' : trimmed
}

function parseAlternativesSection(content: string): string {
  // Works for both "## Alternatives Skipped" (standard) and "## Alternatives Considered" (heavy)
  const section = content.match(/## Alternatives(?:\s+(?:Skipped|Considered))?\n([\s\S]*?)(?:\n##|$)/)?.[1] ?? ''
  const lines = section
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.startsWith('- ') && l.length > 3)
    .filter(l => {
      const body = l.slice(2).trim()
      // Filter out entries that are pure reason fragments (start with "because")
      return !/^because\b/i.test(body)
    })
    .map(l => l.slice(2, 82).trim()) // cap at 80 chars for display
  return lines.join('\n')
}

function parseDecisionFile(filePath: string): {
  id: string
  title: string
  category: string
  status: string
  weight: string
  date: string
  relationships: Relationship[]
  why: string
  alternatives: string
  content: string
} | null {
  const content = fs.readFileSync(filePath, 'utf8')
  const idMatch = content.match(/^# (DR-\d+):\s*(.+)/m)
  if (!idMatch) return null

  return {
    id: idMatch[1],
    title: idMatch[2].trim(),
    category: content.match(/\*\*Category\*\*:\s*(.+)/)?.[1]?.trim() ?? 'architectural',
    status: content.match(/\*\*Status\*\*:\s*(.+)/)?.[1]?.trim() ?? 'proposed',
    weight: content.match(/\*\*Weight\*\*:\s*(.+)/)?.[1]?.trim() ?? 'standard',
    date: content.match(/\*\*Date\*\*:\s*(.+)/)?.[1]?.trim() ?? '',
    relationships: parseRelationships(content),
    why: parseWhy(content),
    alternatives: parseAlternativesSection(content),
    content,
  }
}

export async function buildIndex(force = false): Promise<{ indexed: number; skipped: number }> {
  fs.mkdirSync(INDEX_DIR, { recursive: true })

  const lastIndexed = force ? 0 : getLastIndexedTime()
  const existing = force ? { entries: [], builtAt: 0 } : loadIndex()
  const existingById = new Map(existing.entries.map(e => [e.id, e]))

  let indexed = 0
  let skipped = 0

  const recordFiles = fs.existsSync(RECORDS_DIR)
    ? fs.readdirSync(RECORDS_DIR)
        .filter(f => f.endsWith('.md'))
        .sort()
        .map(f => path.join(RECORDS_DIR, f))
    : []

  for (const filePath of recordFiles) {
    const mtime = fs.statSync(filePath).mtimeMs
    const parsed = parseDecisionFile(filePath)

    if (!force && mtime <= lastIndexed && parsed && existingById.has(parsed.id)) {
      skipped++
      continue
    }

    if (!parsed) continue

    const textToEmbed = `${parsed.title}\n\n${parsed.content}`
    const embedding = await embed(textToEmbed)

    existingById.set(parsed.id, {
      id: parsed.id,
      title: parsed.title,
      category: parsed.category,
      status: parsed.status,
      weight: parsed.weight,
      date: parsed.date,
      filePath: path.relative(REPO_ROOT, filePath),
      relationships: parsed.relationships,
      embedding,
      document: textToEmbed,
      why: parsed.why,
      alternatives: parsed.alternatives,
    })

    indexed++
    console.log(`  Indexed ${parsed.id}: ${parsed.title}`)
  }

  const newIndex: VectorIndex = {
    entries: Array.from(existingById.values()),
    builtAt: Date.now(),
  }

  saveIndex(newIndex)
  return { indexed, skipped }
}
