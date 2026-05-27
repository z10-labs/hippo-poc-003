import readline from 'readline'
import type { ClassificationResult, DecisionCategory, DecisionWeight } from './types.js'

const CATEGORIES: { value: DecisionCategory; label: string }[] = [
  { value: 'architectural', label: 'Architectural — overall system structure' },
  { value: 'domain', label: 'Domain — real-world concept modelling' },
  { value: 'data', label: 'Data — storage, schema, migration' },
  { value: 'security', label: 'Security — auth, encryption, trust boundaries' },
  { value: 'api', label: 'API / Interface — contracts between systems' },
  { value: 'performance', label: 'Performance — speed, scale, resource tradeoffs' },
  { value: 'dependency', label: 'Dependency — external packages' },
  { value: 'testing', label: 'Testing — what gets tested, at what level' },
  { value: 'error-handling', label: 'Error Handling — failures, retries, alerts' },
  { value: 'state', label: 'State — where state lives and how it flows' },
  { value: 'naming', label: 'Naming — conventions and ubiquitous language' },
  { value: 'operational', label: 'Operational — deployment, observability, rollback' },
  { value: 'compliance', label: 'Compliance / Legal — regulatory constraints' },
  { value: 'cost', label: 'Cost — build vs buy, licensing, resources' },
  { value: 'team', label: 'Team / Ownership — responsibilities' },
  { value: 'ux-product', label: 'UX / Product — interaction model choices' },
]

const HEAVY_CATEGORIES: DecisionCategory[] = ['architectural', 'security', 'compliance', 'cost', 'domain']

function prompt(rl: readline.Interface, question: string): Promise<string> {
  return new Promise(resolve => rl.question(question, resolve))
}

// Heuristic auto-classification for autonomous (non-interactive) mode.
export function classifyAuto(description: string): ClassificationResult {
  const lower = description.toLowerCase()

  if (/\b(variable name|file name|formatting|split function|helper location)\b/.test(lower)) {
    return { weight: 'skip', category: null, reason: 'Implementation-level detail' }
  }

  // Only trigger deferral on clearly intentional first-person phrases.
  // Avoid false positives from architectural option labels like "deferred evaluation"
  // or "not yet indexed" — these describe system behaviour, not a decision being deferred.
  if (/\b(skip for now|revisit later|post-mvp|hold off|consciously not deciding|not deciding yet|choosing not to decide)\b/.test(lower)) {
    return { weight: 'deferred', category: null, reason: 'Explicit deferral detected' }
  }

  let category: DecisionCategory = 'architectural'

  if (/\b(auth|authentication|authoriz|encrypt|secret|credential|trust|permission)\b/.test(lower))
    category = 'security'
  else if (/\b(gdpr|compliance|legal|regulation|residency|retention|policy)\b/.test(lower))
    category = 'compliance'
  else if (/\b(cost|budget|license|pricing|build vs buy)\b/.test(lower))
    category = 'cost'
  else if (/\b(schema|migration|database|storage|table|index|data model)\b/.test(lower))
    category = 'data'
  else if (/\b(api|rest|graphql|endpoint|contract|versioning|interface)\b/.test(lower))
    category = 'api'
  else if (/\b(performance|cache|latency|throughput|async|scale)\b/.test(lower))
    category = 'performance'
  else if (/\b(package|dependency|library|npm|yarn|upgrade|remove)\b/.test(lower))
    category = 'dependency'
  else if (/\b(test|coverage|e2e|unit|integration|mock)\b/.test(lower))
    category = 'testing'
  else if (/\b(error|exception|retry|fallback|alert|log)\b/.test(lower))
    category = 'error-handling'
  else if (/\b(state|client state|server state|cache invalidation)\b/.test(lower))
    category = 'state'
  else if (/\b(naming|convention|ubiquitous language)\b/.test(lower))
    category = 'naming'
  else if (/\b(deploy|observability|rollback|monitoring|ci|cd|prod)\b/.test(lower))
    category = 'operational'
  else if (/\b(aggregate|entity|domain model|bounded context)\b/.test(lower))
    category = 'domain'
  else if (/\b(team|owner|ownership|responsibility)\b/.test(lower))
    category = 'team'
  else if (/\b(ux|ui|user flow|interaction|product)\b/.test(lower))
    category = 'ux-product'

  const isHeavy =
    HEAVY_CATEGORIES.includes(category) ||
    /\b(multiple services|significant rework|irreversible|compliance|legal|cost commitment|serious mistake)\b/.test(lower)

  const weight: DecisionWeight = isHeavy ? 'heavy' : 'standard'
  return { weight, category, reason: `Auto-classified as ${category} (${weight})` }
}

// Interactive classification following the spec algorithm.
export async function classifyInteractive(description: string): Promise<ClassificationResult> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })

  try {
    console.log('\n--- Classification Algorithm ---\n')
    console.log(`Decision: "${description}"\n`)

    // Step 1
    const step1 = await prompt(rl,
      'Step 1 — Is this implementation-level? (would the reason be obvious from reading the code?) [y/N]: ')
    if (step1.trim().toLowerCase() === 'y') {
      return { weight: 'skip', category: null, reason: 'Implementation-level — skip' }
    }

    // Step 2
    const step2 = await prompt(rl,
      'Step 2 — Is this a deliberate deferral? (conscious choice to NOT decide yet) [y/N]: ')
    if (step2.trim().toLowerCase() === 'y') {
      return { weight: 'deferred', category: null, reason: 'Deliberate deferral' }
    }

    // Step 3 — category
    console.log('\nStep 3 — Select a category:')
    CATEGORIES.forEach((c, i) => console.log(`  ${String(i + 1).padStart(2)}. ${c.label}`))
    const catInput = await prompt(rl, '\nEnter number: ')
    const catIndex = parseInt(catInput.trim(), 10) - 1
    if (isNaN(catIndex) || catIndex < 0 || catIndex >= CATEGORIES.length) {
      throw new Error('Invalid category selection')
    }
    const category = CATEGORIES[catIndex].value

    // Step 4 — weight
    const isLikelyHeavy = HEAVY_CATEGORIES.includes(category)
    console.log(`\nStep 4 — Weight (${isLikelyHeavy ? 'likely Heavy for this category' : 'likely Standard for this category'}):`)
    console.log('  1. Heavy   — Full Decision Record (multiple modules, hard to reverse, security/cost/compliance)')
    console.log('  2. Standard — Decision Log Entry (one module, alternatives considered, risk contained)')
    console.log('  3. Light   — Inline comment in source code (single file, one sentence)')
    const weightInput = await prompt(rl, 'Enter number: ')

    const weightMap: Record<string, DecisionWeight> = { '1': 'heavy', '2': 'standard', '3': 'light' }
    const weight = weightMap[weightInput.trim()]
    if (!weight) throw new Error('Invalid weight selection')

    return { weight, category, reason: `Interactively classified as ${category} (${weight})` }
  } finally {
    rl.close()
  }
}
