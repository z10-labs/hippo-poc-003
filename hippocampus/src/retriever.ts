import { embed, loadIndex } from './indexer.js'
import type { RelationshipType, RetrievalResult } from './types.js'

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0
  let magA = 0
  let magB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    magA += a[i] * a[i]
    magB += b[i] * b[i]
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB)
  return denom === 0 ? 0 : dot / denom
}

function relationshipNote(type: RelationshipType, fromId: string): string {
  switch (type) {
    case 'overrides': return `Overrides ${fromId}`
    case 'depends-on': return `Depends on ${fromId}`
    case 'inferred-by': return `Follows from ${fromId}`
    case 'supersedes': return `Supersedes ${fromId}`
  }
}

export async function query(queryText: string, topN = 5): Promise<RetrievalResult[]> {
  const index = loadIndex()

  if (index.entries.length === 0) {
    console.error(
      '\nNo index found or index is empty. Run "npm run hippocampus:index" first.\n'
    )
    process.exit(1)
  }

  const queryEmbedding = await embed(queryText)

  // Score all entries by cosine similarity
  const scored = index.entries.map(entry => ({
    entry,
    score: cosineSimilarity(queryEmbedding, entry.embedding),
  }))

  scored.sort((a, b) => b.score - a.score)

  const topEntries = scored.slice(0, topN)
  const seenIds = new Set(topEntries.map(r => r.entry.id))
  const entryById = new Map(index.entries.map(e => [e.id, e]))

  const directResults: RetrievalResult[] = topEntries.map(({ entry, score }) => ({
    id: entry.id,
    title: entry.title,
    filePath: entry.filePath,
    score,
    surfacedVia: 'direct',
    relevanceNote: `Similarity: ${score.toFixed(3)}`,
    why: entry.why,
    alternatives: entry.alternatives,
    category: entry.category,
    weight: entry.weight,
    dependsOn: entry.relationships
      .filter(r => r.type === 'depends-on')
      .map(r => r.target),
  }))

  // Relationship expansion — follow links from top results
  const relationshipResults: RetrievalResult[] = []

  for (const { entry } of topEntries) {
    for (const rel of entry.relationships) {
      if (seenIds.has(rel.target)) continue

      const related = entryById.get(rel.target)
      if (!related) continue

      seenIds.add(rel.target)
      relationshipResults.push({
        id: rel.target,
        title: related.title,
        filePath: related.filePath,
        score: 0,
        surfacedVia: 'relationship',
        relationshipType: rel.type as RelationshipType,
        relevanceNote: relationshipNote(rel.type as RelationshipType, entry.id),
        why: related.why,
        alternatives: related.alternatives,
        category: related.category,
        weight: related.weight,
        dependsOn: related.relationships
          .filter(r => r.type === 'depends-on')
          .map(r => r.target),
      })
    }
  }

  return [...directResults, ...relationshipResults]
}
