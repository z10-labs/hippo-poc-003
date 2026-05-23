export type DecisionCategory =
  | 'architectural'
  | 'domain'
  | 'data'
  | 'security'
  | 'api'
  | 'performance'
  | 'dependency'
  | 'testing'
  | 'error-handling'
  | 'state'
  | 'naming'
  | 'operational'
  | 'compliance'
  | 'cost'
  | 'team'
  | 'ux-product'

export type DecisionWeight = 'heavy' | 'standard' | 'light' | 'deferred' | 'skip'

export type DecisionStatus = 'proposed' | 'accepted' | 'deprecated' | `superseded by DR-${string}`

export type RelationshipType = 'overrides' | 'inferred-by' | 'depends-on'

export interface Relationship {
  type: RelationshipType
  target: string // DR-NNNN
}

export interface ClassificationResult {
  weight: DecisionWeight
  category: DecisionCategory | null
  reason: string
}

export interface DecisionRecord {
  id: string // DR-NNNN
  title: string
  category: DecisionCategory
  status: DecisionStatus
  date: string // YYYY-MM-DD
  deciders: string
  filePath: string
  relationships: Relationship[]
  content: string // full Markdown text
}

export interface LogEntry {
  date: string
  title: string
  why: string
  what: string
  tradeOff: string
  alternativesSkipped: string
  category: DecisionCategory
  filePath: string
}

export interface DeferredEntry {
  date: string
  topic: string
  whatDeferred: string
  whyDeferred: string
  reviewTrigger: string
  riskOfDeferral: string
  owner: string
}

export interface RetrievalResult {
  id: string
  title: string
  filePath: string
  score: number
  surfacedVia: 'direct' | 'relationship'
  relationshipType?: RelationshipType
  relevanceNote: string
}

export interface IndexMetadata {
  id: string
  title: string
  category: string
  status: string
  date: string
  filePath: string
  relationships: string // JSON stringified Relationship[]
}
