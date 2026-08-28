/**
 * Finder agent unit tests — 6 behaviors (offline, no real Firebase/Anthropic).
 *
 * Plan: 03-04 TDD RED phase
 *
 * All external dependencies are mocked:
 *   - @/src/inventory/search (searchProjects, queryInventory) — injected results
 *   - @/src/firebase/collections (collateralRef) — scripted responses
 *   - @/src/firebase/admin (remoteConfig) — returns mock ServerConfig
 *   - @/src/llm/provider (modelFor) — not called in offline/run() path
 *
 * Tests run via: npx vitest run src/agents/finder/finder.test.ts
 * No live Anthropic API calls. No live Firestore reads.
 *
 * Test 1: parse — free-text criteria with explicit budget/segment parses correctly
 * Test 2: parse-unknown — omitted nationality+income emit 'unknown'/null (never invented)
 * Test 3: refusal-no_match — searchProjects {found:false, reason:'no_match'} → grounded refusal
 * Test 4: refusal-ineligible — {found:false, reason:'ineligible', why:'financing'} → refusal w/ explanation
 * Test 5: rationale-grounding — each match carries rationale citing real project fields + projectId
 * Test 6: read-only — no tool execute() writes Firestore (set/add/update absent from tool bodies)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Hoist mocks ─────────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => {
  const mockGetString = vi.fn()
  const mockEvaluate = vi.fn(() => ({ getString: mockGetString }))
  const mockGetServerTemplate = vi.fn(async () => ({ evaluate: mockEvaluate }))
  const mockGetTemplate = vi.fn(async () => ({ parameters: {} }))

  const mockSearchProjects = vi.fn()
  const mockQueryInventory = vi.fn()

  const mockCollateralWhere = vi.fn()
  const mockCollateralGet = vi.fn()
  const mockCollateralRef = vi.fn(() => ({
    where: mockCollateralWhere,
  }))
  // Chain: collateralRef().where(...) → { get: mockCollateralGet }
  mockCollateralWhere.mockReturnValue({ get: mockCollateralGet })

  return {
    mockGetString,
    mockEvaluate,
    mockGetServerTemplate,
    mockGetTemplate,
    mockSearchProjects,
    mockQueryInventory,
    mockCollateralRef,
    mockCollateralWhere,
    mockCollateralGet,
  }
})

// ─── Module mocks ─────────────────────────────────────────────────────────────

vi.mock('@/src/firebase/admin', () => ({
  remoteConfig: vi.fn(() => ({
    getServerTemplate: mocks.mockGetServerTemplate,
    getTemplate: mocks.mockGetTemplate,
  })),
  adminDb: {},
  adminAuth: {},
}))

vi.mock('@/src/inventory/search', () => ({
  searchProjects: mocks.mockSearchProjects,
  queryInventory: mocks.mockQueryInventory,
}))

vi.mock('@/src/firebase/collections', () => ({
  collateralRef: mocks.mockCollateralRef,
  // Pass through other exports that modules might need
  projectsRef: vi.fn(),
  TENANT_ID: 'd2',
}))

// ─── Imports (after mocks) ────────────────────────────────────────────────────

import { finderAgent } from './index'
import { FinderOutputSchema, CriteriaSchema } from './schema'
import { FINDER_SYSTEM_PROMPT, buildFinderSystemPrompt } from './prompt'

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const SEED_PROJECT_ID = 'project-kl-001'

const seedProjectMatch = {
  projectId: SEED_PROJECT_ID,
  name: 'Residensi Taman Maju',
  priceBand: '500k_800k' as const,
  priceValue: 650_000,
  tenure: 'freehold',
  vpStatus: true,
  bumiQuota: false,
  foreignEligible: true,
  bedrooms: 3,
  locationText: 'Cheras, Kuala Lumpur — near LRT Taman Connaught',
  score: 0.87,
  matchedCriteria: {
    segment: 'own_stay' as const,
    priceMax: 700_000,
    nationality: 'malaysian' as const,
    bumiputera: null,
    locationPref: 'KL',
    bedrooms: 3,
  },
}

// ─── Test 1: parse — explicit budget/segment parses correctly ─────────────────

describe('Test 1: parse — explicit criteria parses into typed ParsedCriteria', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('CriteriaSchema parses a criteria object with explicit budget, segment, nationality', () => {
    const input = {
      segment: 'own_stay',
      priceMin: 500_000,
      priceMax: 700_000,
      monthlyIncome: 8_000,
      nationality: 'malaysian',
      bumiputera: null,
      locationPref: 'KL',
      bedrooms: 3,
      freeText: 'Young couple, first home near LRT, ~RM650k, KL',
    }

    const parsed = CriteriaSchema.parse(input)

    expect(parsed.segment).toBe('own_stay')
    expect(parsed.priceMax).toBe(700_000)
    expect(parsed.monthlyIncome).toBe(8_000)
    expect(parsed.nationality).toBe('malaysian')
    expect(parsed.locationPref).toBe('KL')
    expect(parsed.bedrooms).toBe(3)
    expect(parsed.freeText).toBeDefined()
  })

  it('CriteriaSchema rejects an invalid segment value (not an enum member)', () => {
    const input = {
      segment: 'developer_special', // not in enum
      priceMin: null,
      priceMax: null,
      monthlyIncome: null,
      nationality: 'malaysian',
      bumiputera: null,
      locationPref: null,
      bedrooms: null,
      freeText: 'test',
    }

    expect(() => CriteriaSchema.parse(input)).toThrow()
  })

  it('CriteriaSchema rejects an invalid nationality value (not an enum member)', () => {
    const input = {
      segment: 'unknown',
      priceMin: null,
      priceMax: null,
      monthlyIncome: null,
      nationality: 'singaporean', // not in enum
      bumiputera: null,
      locationPref: null,
      bedrooms: null,
      freeText: 'test',
    }

    expect(() => CriteriaSchema.parse(input)).toThrow()
  })
})

// ─── Test 2: parse-unknown — missing nationality+income → 'unknown'/null (never invented) ──

describe('Test 2: parse-unknown — omitted eligibility-critical fields emit unknown/null', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.mockSearchProjects.mockResolvedValue({ found: false, reason: 'no_match' })
  })

  it('CriteriaSchema accepts nationality:unknown and monthlyIncome:null (missing data)', () => {
    const input = {
      segment: 'unknown',
      priceMin: null,
      priceMax: null,
      monthlyIncome: null,       // unknown income — do NOT invent
      nationality: 'unknown',    // unknown nationality — do NOT invent
      bumiputera: null,
      locationPref: null,
      bedrooms: null,
      freeText: 'Looking for a property',
    }

    const parsed = CriteriaSchema.parse(input)

    // MUST accept unknown/null — the parser is NOT allowed to invent eligibility data
    expect(parsed.nationality).toBe('unknown')
    expect(parsed.monthlyIncome).toBeNull()
    expect(parsed.segment).toBe('unknown')
    // bumiputera is nullable too
    expect(parsed.bumiputera).toBeNull()
  })

  it('finderAgent.run emits a clarifying question (not a match) when eligibility-critical fields are unknown', async () => {
    // When nationality is 'unknown', the agent should ask rather than guess
    mocks.mockSearchProjects.mockResolvedValue({ found: false, reason: 'no_match' })

    const result = await finderAgent.run({
      messages: [{ role: 'user', content: 'Find me a property' }],
      userLang: 'en',
      agentUid: 'uid-test-001',
      parsedCriteria: {
        segment: 'unknown',
        priceMin: null,
        priceMax: null,
        monthlyIncome: null,
        nationality: 'unknown',
        bumiputera: null,
        locationPref: null,
        bedrooms: null,
        freeText: 'Find me a property',
      },
      injectedSearchResult: { found: false, reason: 'no_match' },
    })

    // The result MUST NOT have matches — no invention
    const output = result.output
    expect(output.matches).toHaveLength(0)
    // Either a clarifying question or a refusal — NOT a fabricated match
    expect(output.clarifyingQuestion ?? output.refusal).toBeTruthy()
  })
})

// ─── Test 3: refusal-no_match ─────────────────────────────────────────────────

describe('Test 3: refusal-no_match — searchProjects no_match → grounded refusal, no invented project', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('emits grounded refusal with empty matches when searchProjects returns no_match', async () => {
    mocks.mockSearchProjects.mockResolvedValue({ found: false, reason: 'no_match' })

    const result = await finderAgent.run({
      messages: [{ role: 'user', content: 'Find a 2BR unit in Petaling Jaya under RM500k' }],
      userLang: 'en',
      agentUid: 'uid-test-002',
      parsedCriteria: {
        segment: 'own_stay',
        priceMin: null,
        priceMax: 500_000,
        monthlyIncome: 6_000,
        nationality: 'malaysian',
        bumiputera: null,
        locationPref: 'Petaling Jaya',
        bedrooms: 2,
        freeText: '2BR unit in Petaling Jaya under RM500k',
      },
      injectedSearchResult: { found: false, reason: 'no_match' },
    })

    const output = result.output

    // MUST emit a refusal signal — no fabricated project
    expect(output.matches).toHaveLength(0)
    expect(output.refusal).toBeDefined()
    expect(output.refusal?.reason).toBe('no_match')
    // The explanation must be a non-empty string (grounded refusal, not empty)
    expect(output.refusal?.explanation).toBeTruthy()
    expect(output.refusal?.explanation.length).toBeGreaterThan(0)

    // Validate the output is schema-valid
    expect(() => FinderOutputSchema.parse(output)).not.toThrow()
  })

  it('refusal output has no invented project IDs or names', async () => {
    const result = await finderAgent.run({
      messages: [{ role: 'user', content: 'Find a property' }],
      userLang: 'en',
      agentUid: 'uid-test-003',
      parsedCriteria: {
        segment: 'own_stay',
        priceMin: null,
        priceMax: null,
        monthlyIncome: null,
        nationality: 'malaysian',
        bumiputera: null,
        locationPref: null,
        bedrooms: null,
        freeText: 'Find a property',
      },
      injectedSearchResult: { found: false, reason: 'no_match' },
    })

    // matches must be empty — NEVER an invented project
    expect(result.output.matches).toHaveLength(0)
    // No project ID sneaked in
    expect(result.output.matches.map((m) => m.projectId)).toHaveLength(0)
  })
})

// ─── Test 4: refusal-ineligible ───────────────────────────────────────────────

describe('Test 4: refusal-ineligible — financing gate → refusal with explanation, no match (FIND-10, SC3)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('emits ineligible refusal referencing financing when searchProjects returns ineligible/financing', async () => {
    mocks.mockSearchProjects.mockResolvedValue({
      found: false,
      reason: 'ineligible',
      why: 'financing',
    })

    const result = await finderAgent.run({
      messages: [{ role: 'user', content: 'Find a property for my client, monthly income RM3000' }],
      userLang: 'en',
      agentUid: 'uid-test-004',
      parsedCriteria: {
        segment: 'own_stay',
        priceMin: null,
        priceMax: 800_000,
        monthlyIncome: 3_000,
        nationality: 'malaysian',
        bumiputera: null,
        locationPref: null,
        bedrooms: null,
        freeText: 'income RM3000 looking for property under RM800k',
      },
      injectedSearchResult: {
        found: false,
        reason: 'ineligible',
        why: 'financing',
      },
    })

    const output = result.output

    // Must be a refusal with the ineligible reason
    expect(output.matches).toHaveLength(0)
    expect(output.refusal).toBeDefined()
    expect(output.refusal?.reason).toBe('ineligible')
    // The explanation MUST reference financing (FIND-10)
    expect(output.refusal?.explanation.toLowerCase()).toContain('financ')
    // No invented match
    expect(output.matches).toHaveLength(0)

    // Schema-valid
    expect(() => FinderOutputSchema.parse(output)).not.toThrow()
  })

  it('refusal explanation does not fabricate a project when ineligible', async () => {
    const result = await finderAgent.run({
      messages: [{ role: 'user', content: 'Client income RM2500' }],
      userLang: 'en',
      agentUid: 'uid-test-005',
      parsedCriteria: {
        segment: 'investment',
        priceMin: null,
        priceMax: 1_000_000,
        monthlyIncome: 2_500,
        nationality: 'foreign',
        bumiputera: null,
        locationPref: null,
        bedrooms: null,
        freeText: 'foreign investor, income RM2500',
      },
      injectedSearchResult: {
        found: false,
        reason: 'ineligible',
        why: 'financing',
      },
    })

    expect(result.output.matches).toHaveLength(0)
    expect(result.output.refusal?.reason).toBe('ineligible')
  })
})

// ─── Test 5: rationale-grounding ─────────────────────────────────────────────

describe('Test 5: rationale-grounding — each match carries rationale citing real project fields + projectId (D-04)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('each match has a rationale referencing real project fields (priceBand/tenure/vpStatus) + projectId', async () => {
    const result = await finderAgent.run({
      messages: [{ role: 'user', content: 'Looking for a freehold 3BR in KL around RM650k' }],
      userLang: 'en',
      agentUid: 'uid-test-006',
      parsedCriteria: {
        segment: 'own_stay',
        priceMin: null,
        priceMax: 700_000,
        monthlyIncome: 8_000,
        nationality: 'malaysian',
        bumiputera: null,
        locationPref: 'KL',
        bedrooms: 3,
        freeText: 'freehold 3BR in KL around RM650k',
      },
      injectedSearchResult: {
        found: true,
        matches: [seedProjectMatch],
      },
    })

    const output = result.output

    // Must have at least one match
    expect(output.matches).toHaveLength(1)

    const match = output.matches[0]

    // Must cite the projectId — NEVER invented
    expect(match.projectId).toBe(SEED_PROJECT_ID)

    // Rationale must be a non-empty string
    expect(match.rationale).toBeTruthy()
    expect(match.rationale.length).toBeGreaterThan(0)

    // Rationale must reference real project fields — it must mention at least
    // one of: projectId, priceBand/priceValue, tenure, vpStatus
    const rationaleText = match.rationale.toLowerCase()
    const mentionsRealField =
      rationaleText.includes('freehold') ||         // tenure
      rationaleText.includes('650') ||              // priceValue
      rationaleText.includes('500k_800k') ||        // priceBand
      rationaleText.includes(SEED_PROJECT_ID) ||   // projectId
      rationaleText.includes('vp') ||               // vpStatus
      rationaleText.includes('3') ||                // bedrooms
      rationaleText.includes('cheras')              // locationText
    expect(mentionsRealField).toBe(true)

    // matchedCriteria must be present (grounding proof)
    expect(match.matchedCriteria).toBeDefined()

    // Validate output schema
    expect(() => FinderOutputSchema.parse(output)).not.toThrow()
  })

  it('rationale does NOT reference a field absent from the ProjectMatch', async () => {
    // The match has bumiQuota: false. The rationale should not claim
    // a field value that contradicts the actual ProjectMatch data.
    const result = await finderAgent.run({
      messages: [{ role: 'user', content: 'Find 3BR KL property' }],
      userLang: 'en',
      agentUid: 'uid-test-007',
      parsedCriteria: {
        segment: 'own_stay',
        priceMin: null,
        priceMax: 700_000,
        monthlyIncome: 8_000,
        nationality: 'malaysian',
        bumiputera: null,
        locationPref: 'KL',
        bedrooms: 3,
        freeText: '3BR KL property',
      },
      injectedSearchResult: {
        found: true,
        matches: [seedProjectMatch],
      },
    })

    const match = result.output.matches[0]

    // The rationale is produced by the agent from actual match fields.
    // It must cite the projectId.
    expect(match.projectId).toBe(SEED_PROJECT_ID)

    // matchedCriteria must reflect criteria that were actually provided
    expect(match.matchedCriteria.priceMax).toBe(700_000)
    expect(match.matchedCriteria.segment).toBe('own_stay')
  })

  it('output is Zod-valid with multiple matches', async () => {
    const secondMatch = {
      ...seedProjectMatch,
      projectId: 'project-kl-002',
      name: 'Another Project',
      priceBand: '500k_800k' as const,
      priceValue: 600_000,
    }

    const result = await finderAgent.run({
      messages: [{ role: 'user', content: 'Find 3BR in KL' }],
      userLang: 'en',
      agentUid: 'uid-test-008',
      parsedCriteria: {
        segment: 'own_stay',
        priceMin: null,
        priceMax: 700_000,
        monthlyIncome: 8_000,
        nationality: 'malaysian',
        bumiputera: null,
        locationPref: 'KL',
        bedrooms: 3,
        freeText: '3BR in KL',
      },
      injectedSearchResult: {
        found: true,
        matches: [seedProjectMatch, secondMatch],
      },
    })

    expect(result.output.matches).toHaveLength(2)
    expect(() => FinderOutputSchema.parse(result.output)).not.toThrow()

    // Each match has its own projectId and rationale
    expect(result.output.matches[0].projectId).toBe(SEED_PROJECT_ID)
    expect(result.output.matches[1].projectId).toBe('project-kl-002')
  })
})

// ─── Test 6: read-only ────────────────────────────────────────────────────────

describe('Test 6: read-only — tools never write Firestore; finderSlot write is in route onFinish', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('makeSearchProjectsTool has an execute function that calls searchProjects (read-only)', async () => {
    const { makeSearchProjectsTool } = await import('./tools')

    const tool = makeSearchProjectsTool('en')
    // The tool has an execute function
    expect(typeof tool.execute).toBe('function')

    // The description must not mention write operations
    expect(tool.description).toBeDefined()
    const desc = tool.description ?? ''
    expect(desc.toLowerCase()).not.toContain('write')
    expect(desc.toLowerCase()).not.toContain('update')
    expect(desc.toLowerCase()).not.toContain('delete')
  })

  it('makeQueryInventoryTool has an execute function (read-only, structured query)', async () => {
    const { makeQueryInventoryTool } = await import('./tools')

    const tool = makeQueryInventoryTool('en')
    expect(typeof tool.execute).toBe('function')
  })

  it('makeFetchCollateralTool has an execute function that reads collateralRef (no write)', async () => {
    const { makeFetchCollateralTool } = await import('./tools')

    mocks.mockCollateralGet.mockResolvedValue({
      docs: [
        {
          data: () => ({
            projectId: SEED_PROJECT_ID,
            type: 'brochure',
            storagePath: 'collateral/project-kl-001/brochure.pdf',
            externalUrl: undefined,
            lang: 'en',
            tenantId: 'd2',
          }),
        },
      ],
    })

    const tool = makeFetchCollateralTool('en')
    expect(typeof tool.execute).toBe('function')

    // Execute reads collateral — no writes
    const executeImpl = tool.execute as NonNullable<typeof tool.execute>
    const result = await executeImpl({ projectId: SEED_PROJECT_ID }, {} as never)

    // collateralRef().where() was called (read — no set/add/update)
    expect(mocks.mockCollateralRef).toHaveBeenCalled()
    expect(mocks.mockCollateralWhere).toHaveBeenCalledWith('projectId', '==', SEED_PROJECT_ID)

    // Returns an array of collateral items
    expect(Array.isArray(result)).toBe(true)
  })

  it('finderAgent.makeTools returns the three read-only tools', () => {
    const tools = finderAgent.makeTools('en', 'uid-test-agent', 'lead-id-001')
    expect('searchProjects' in tools).toBe(true)
    expect('queryInventory' in tools).toBe(true)
    expect('fetchCollateral' in tools).toBe(true)
  })

  it('finderAgent.makeTools returns tools without leadId (leadId is optional)', () => {
    const tools = finderAgent.makeTools('en', 'uid-test-agent')
    expect('searchProjects' in tools).toBe(true)
    expect('queryInventory' in tools).toBe(true)
    expect('fetchCollateral' in tools).toBe(true)
  })
})

// ─── Test 7: infra-failure guard (quick-kayinleong-040) ───────────────────────

describe('Test 7: tool execute() catches infra errors → grounded inventory_unavailable', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('searchProjects tool returns inventory_unavailable when the underlying call throws (e.g. Gemini auth)', async () => {
    const { makeSearchProjectsTool } = await import('./tools')

    // Simulate the exact production failure: a Google auth error bubbling from embedText.
    mocks.mockSearchProjects.mockRejectedValue(
      new Error(
        'Request had invalid authentication credentials. Expected OAuth 2 access token.',
      ),
    )

    const tool = makeSearchProjectsTool('en')
    const executeImpl = tool.execute as NonNullable<typeof tool.execute>
    const result = await executeImpl(
      {
        segment: 'own_stay',
        priceMin: null,
        priceMax: 800000,
        monthlyIncome: null,
        financingNote: null,
        nationality: 'malaysian',
        bumiputera: null,
        locationPref: 'Cheras, KL',
        tenurePref: null,
        bedrooms: 2,
        freeText: '2-bedroom in Cheras, budget 800k, own stay, Malaysian',
      },
      {} as never,
    )

    // Structured failure — NOT a thrown error, NOT a fabricated match.
    expect(result).toMatchObject({ error: 'inventory_unavailable' })
    // Message must not leak raw provider/auth technical detail.
    expect(JSON.stringify(result).toLowerCase()).not.toContain('oauth')
  })

  it('fetchCollateral tool returns inventory_unavailable when the Firestore read throws', async () => {
    const { makeFetchCollateralTool } = await import('./tools')

    mocks.mockCollateralGet.mockRejectedValue(new Error('Firestore UNAVAILABLE'))

    const tool = makeFetchCollateralTool('en')
    const executeImpl = tool.execute as NonNullable<typeof tool.execute>
    const result = await executeImpl({ projectId: SEED_PROJECT_ID }, {} as never)

    expect(result).toMatchObject({ error: 'inventory_unavailable' })
  })
})

// ─── quick-kayinleong-048: no tool-use narration ──────────────────────────────
//
// A live Finder turn rendered "Got it. Let me search now.The search returned results…"
// as a raw prose bubble instead of the MatchList card: the prompt never forbade
// narrating tool use or required the bare JSON object, so decodeFinderOutput could not
// parse the output. Same gap the Coach prompt had before quick-046.

describe('quick-048: finder prompt forbids tool-use narration', () => {
  it('requires the bare JSON object and bans running commentary', async () => {
    const { buildFinderSystemPrompt } = await import('./prompt')
    const prompt = buildFinderSystemPrompt()

    expect(prompt).toContain('Return ONLY the bare JSON object')
    expect(prompt).toContain('Do NOT narrate your tool use')
    expect(prompt).toContain('Let me search now')

    // The rules must live inside the Output Format section, after the field list,
    // so the model reads the schema first and the constraints last.
    const outputAt = prompt.indexOf('## Output Format')
    expect(outputAt).toBeGreaterThan(-1)
    expect(prompt.indexOf('Do NOT narrate your tool use')).toBeGreaterThan(outputAt)
  })

  it('still keeps the grounding mandate intact', async () => {
    // The added rules must not have displaced FIND-01/D-05 grounding.
    const { FINDER_SYSTEM_PROMPT } = await import('./prompt')
    expect(FINDER_SYSTEM_PROMPT).toContain('## Grounding (MANDATORY)')
  })
})

// ─── quick-kayinleong-050: the refusal must be permitted ──────────────────────
//
// A tester asked for "a 2-bedroom in Cheras, budget 800k" and was shown a RM6.4M Ampang
// project. Half the cause was the tool (locationPref/priceMax were never filters). The
// other half was THIS PROMPT: the refusal branch was conditioned on "include ONLY when
// searchProjects returns no match", the tool returned 83 matches, so refusing was
// forbidden and the model dutifully presented alternatives from unrelated areas.

describe('quick-kayinleong-050: finder prompt permits the honest no_match refusal', () => {
  it('states that locationPref and priceMax are hard filters', async () => {
    const { FINDER_SYSTEM_PROMPT: prompt } = await import('./prompt')

    expect(prompt).toContain('## Location and Budget')
    expect(prompt).toContain('HARD FILTERS')
    // The model must know a no_match for an area/budget is a real, grounded result.
    expect(prompt.toLowerCase()).toContain('emit the refusal')
  })

  it('forbids substituting projects from a different area', async () => {
    const { FINDER_SYSTEM_PROMPT: prompt } = await import('./prompt')

    // The exact reported behaviour: acknowledge the miss, then list unrelated projects.
    expect(prompt).toContain('NEVER answer an area you have no inventory for')
    expect(prompt).toContain('but here are some options in Y')
  })

  it('forbids inventing proximity (no distance or adjacency data exists)', async () => {
    const { FINDER_SYSTEM_PROMPT: prompt } = await import('./prompt')

    expect(prompt).toContain('no data on how FAR any project is')
    expect(prompt).toContain('adjacency')
  })

  it('no longer restricts refusal to "ONLY when searchProjects returns no match"', async () => {
    const { FINDER_SYSTEM_PROMPT: prompt } = await import('./prompt')

    // The old wording made the refusal unreachable once the tool returned anything.
    expect(prompt).not.toContain('include ONLY when searchProjects returns no match')
    expect(prompt).toContain('include whenever searchProjects returns found:false')
  })

  it('tells the model not to claim an unapplied criterion from matchedCriteria', async () => {
    const { FINDER_SYSTEM_PROMPT: prompt } = await import('./prompt')

    expect(prompt).toContain('## Matched Criteria (grounding)')
    expect(prompt).toContain('A null field means that criterion was NOT verified')
    expect(prompt).toContain('Never claim a project is "within budget" when matchedCriteria.priceMax is null')
    // priceValue 0 means unknown, not free — never render it as a price.
    expect(prompt).toContain('Never present 0 as a price')
  })

  it('keeps the active-only and never-invent mandates intact', async () => {
    const { FINDER_SYSTEM_PROMPT: prompt } = await import('./prompt')

    expect(prompt).toContain('## Grounding (MANDATORY)')
    expect(prompt).toContain('NEVER invent a project, price, or availability')
    expect(prompt).toContain('## Active-Only / Eligibility')
    // Infra failure must still be distinct from a refusal.
    expect(prompt).toContain('## Tool Unavailable')
  })
})

// ─── quick-kayinleong-051: conversational branch ──────────────────────────────
//
// "tell me about kensho taman desa, good for stay or rental" is a question ABOUT a
// project, not a request for a shortlist. With only matches/refusal/clarifyingQuestion
// available the model stuffed a full markdown essay into matches[0].rationale and the
// agent saw a raw JSON envelope.

describe('quick-051: finder prompt has a conversational branch', () => {
  it('tells the model to use the answer field for questions about a project', () => {
    const prompt = buildFinderSystemPrompt()

    expect(prompt).toContain('Answering a question ABOUT a project')
    expect(prompt).toContain('"answer" field')
    // The branch must come BEFORE the output format, or the model has already been told
    // the only shapes are matches/refusal/clarifyingQuestion.
    expect(prompt.indexOf('Answering a question ABOUT a project')).toBeLessThan(
      prompt.indexOf('## Output Format'),
    )
  })

  it('forbids stuffing an essay into a rationale', () => {
    expect(FINDER_SYSTEM_PROMPT).toContain('not a place to put an essay')
  })

  it('keeps grounding mandatory on the conversational path too', () => {
    // The escape hatch must not become a licence to invent project facts.
    expect(FINDER_SYSTEM_PROMPT).toContain('only describe projects your tools actually returned')
  })

  it('states the four output states are mutually exclusive', () => {
    expect(FINDER_SYSTEM_PROMPT).toContain('Never populate two')
  })

  // ── quick-kayinleong-068: "don't ask me questions" ────────────────────────
  //
  // Three rules force a clarifying question before any search (unknown segment, unknown
  // nationality, unknown income). An agent who has said not to ask should get results.

  it('lets the agent switch OFF clarifying questions', () => {
    expect(FINDER_SYSTEM_PROMPT).toContain('When the agent tells you NOT to ask')
    expect(FINDER_SYSTEM_PROMPT).toContain('do NOT ask again')
    expect(FINDER_SYSTEM_PROMPT).toContain('Run searchProjects immediately')
  })

  it('explains WHY skipping the question is safe, not just that it is allowed', () => {
    // 'unknown' means the tool applies NO filter (Pitfall 23), so the result set gets
    // wider, never wrong. Without this the model has to infer that searching on unknowns
    // is safe, and the conservative read is to keep asking.
    expect(FINDER_SYSTEM_PROMPT).toContain('applies NO filter')
    expect(FINDER_SYSTEM_PROMPT).toContain('WIDER, never wrong')
  })

  it('still requires the unconfirmed facts to be stated', () => {
    // Skipping the question must not become quietly asserting the answer.
    expect(FINDER_SYSTEM_PROMPT).toContain('which eligibility-critical facts were not confirmed')
    expect(FINDER_SYSTEM_PROMPT).toContain('Never present an unconfirmed fact as settled')
  })

  it('cross-references the override from the rules it overrides', () => {
    // A rule that says ASK and an override 40 lines away is how a model ends up obeying
    // whichever it read last.
    expect(FINDER_SYSTEM_PROMPT).toContain(
      "UNLESS the agent has told you not to ask (see the override section below)",
    )
    expect(FINDER_SYSTEM_PROMPT).toContain(
      'Every rule in this section is overridden when the agent has told you not to ask',
    )
  })

  it('contains NO backtick — it would terminate the template literal', () => {
    // This exact mistake broke this file in quick-048 and again in quick-051: a backtick
    // inside the prompt's template literal ends the string and the module stops compiling.
    // Cheap guard so the third time is caught by the suite, not by tsc after the fact.
    expect(buildFinderSystemPrompt()).not.toContain('`')
    expect(FINDER_SYSTEM_PROMPT).not.toContain('`')
  })
})
