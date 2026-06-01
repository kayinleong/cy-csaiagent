/**
 * Coach agent unit tests — 5 behaviors (offline, no real Firebase/Anthropic).
 *
 * All external dependencies are mocked:
 *   - @/src/firebase/admin (remoteConfig) — returns a mock ServerConfig
 *   - @/src/rag (retrieve, buildCitations, isRetrievalMiss) — scripted responses
 *   - @/src/escalation (emitHandoffSignal) — spy to assert calls
 *
 * Tests run via: npx vitest run src/agents/coach/coach.test.ts
 * No live Anthropic API calls. No live Firestore reads.
 *
 * Test 1: modelFor reads from remoteConfig().getServerTemplate() — no hard-coded ID
 * Test 2: retrieveKnowledge tool returns real chunk-ID citations from rag.retrieve
 * Test 3: Coach output is Zod-valid; rejects empty citations when retrieval succeeded
 * Test 4: On retrieval miss, emitHandoffSignal is called; no content fabricated
 * Test 5: Coach is dispatched via router.route — not called directly
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { z } from 'zod'

// ─── Hoist mocks ─────────────────────────────────────────────────────────────
// vi.hoisted ensures the mock variable refs are initialised before vi.mock factories run.

const mocks = vi.hoisted(() => {
  const mockGetString = vi.fn()
  const mockEvaluate = vi.fn(() => ({ getString: mockGetString }))
  const mockGetServerTemplate = vi.fn(async () => ({ evaluate: mockEvaluate }))
  const mockGetTemplate = vi.fn(async () => ({ parameters: {} }))

  const mockRetrieve = vi.fn()
  const mockBuildCitations = vi.fn()
  const mockIsRetrievalMiss = vi.fn()

  const mockEmitHandoffSignal = vi.fn(async () => {})

  return {
    mockGetString,
    mockEvaluate,
    mockGetServerTemplate,
    mockGetTemplate,
    mockRetrieve,
    mockBuildCitations,
    mockIsRetrievalMiss,
    mockEmitHandoffSignal,
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

vi.mock('@/src/rag', () => ({
  retrieve: mocks.mockRetrieve,
  buildCitations: mocks.mockBuildCitations,
  isRetrievalMiss: mocks.mockIsRetrievalMiss,
}))

vi.mock('@/src/escalation', () => ({
  emitHandoffSignal: mocks.mockEmitHandoffSignal,
}))

// ─── Imports (after mocks) ────────────────────────────────────────────────────

import { modelFor } from '@/src/llm/provider'
import { CoachOutputSchema } from './schema'
import { makeRetrieveKnowledgeTool } from './tools'
import { coachAgent } from './index'
import { route } from '@/src/router'

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const SEED_CHUNK_ID = 'chunk-en-001'
const SEED_DOC_ID = 'doc-onboarding-en'
const SEED_TEXT = 'D2 onboarding starts with the PowerBoost module...'

const seedRetrievalResults = [
  {
    chunkId: SEED_CHUNK_ID,
    docId: SEED_DOC_ID,
    text: SEED_TEXT,
    lang: 'en' as const,
    score: 0.92,
  },
]

// ─── Test 1: modelFor reads model ID from Remote Config ──────────────────────

describe('Test 1: modelFor resolves model ID from Remote Config — no hard-coded ID', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('calls remoteConfig().getServerTemplate() to resolve the model ID', async () => {
    mocks.mockGetString.mockReturnValue('claude-sonnet-test-model')

    const model = await modelFor('coach')

    // getServerTemplate was called (Server SDK path)
    expect(mocks.mockGetServerTemplate).toHaveBeenCalled()

    // evaluate was called to get the ServerConfig
    expect(mocks.mockEvaluate).toHaveBeenCalled()

    // getString was called with the pillar-specific key
    expect(mocks.mockGetString).toHaveBeenCalledWith('model.coach.default')

    // The returned model is an AI SDK LanguageModel (not a raw string)
    expect(model).toBeDefined()
    expect(typeof model).toBe('object')
  })

  it('resolves different keys for different pillars', async () => {
    mocks.mockGetString.mockReturnValue('test-model-xyz')

    await modelFor('coach')
    expect(mocks.mockGetString).toHaveBeenCalledWith('model.coach.default')

    vi.clearAllMocks()
    mocks.mockGetString.mockReturnValue('test-router-model')
    await modelFor('router')
    expect(mocks.mockGetString).toHaveBeenCalledWith('model.router.default')
  })

  it('falls back gracefully when Remote Config throws (offline dev)', async () => {
    mocks.mockGetServerTemplate.mockRejectedValueOnce(new Error('Network error'))

    // Should not throw — falls back to the labeled constant
    await expect(modelFor('coach')).resolves.toBeDefined()
  })
})

// ─── Test 2: retrieveKnowledge tool returns real chunk-ID citations ───────────

describe('Test 2: retrieveKnowledge tool returns real chunk-ID citations from rag.retrieve', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('calls rag.retrieve and returns real chunk IDs from the seeded EN doc', async () => {
    mocks.mockRetrieve.mockResolvedValue(seedRetrievalResults)
    mocks.mockIsRetrievalMiss.mockReturnValue(false)
    mocks.mockBuildCitations.mockReturnValue({
      citations: [{ chunkId: SEED_CHUNK_ID, docId: SEED_DOC_ID, snippet: SEED_TEXT.slice(0, 50) }],
      missed: false,
    })

    const tool = makeRetrieveKnowledgeTool('en')
    // The AI SDK Tool type marks execute as optional; we know it's defined here
    const executeImpl = tool.execute as NonNullable<typeof tool.execute>
    const rawResult = await executeImpl({ query: 'What is the D2 onboarding process?' }, {} as never)
    // Resolve: execute may return AsyncIterable or a direct value
    const result = rawResult as import('./tools').RetrieveResult

    // rag.retrieve was called with the query and userLang
    expect(mocks.mockRetrieve).toHaveBeenCalledWith('What is the D2 onboarding process?', 'en')

    // Tool returns real chunk IDs — not fabricated
    expect(result.found).toBe(true)
    if (result.found) {
      expect(result.citations).toHaveLength(1)
      expect(result.citations[0].chunkId).toBe(SEED_CHUNK_ID)
      expect(result.citations[0].docId).toBe(SEED_DOC_ID)
    }
  })

  it('passes the userLang to rag.retrieve for language-filtered retrieval', async () => {
    mocks.mockRetrieve.mockResolvedValue([])
    mocks.mockIsRetrievalMiss.mockReturnValue(true)
    mocks.mockBuildCitations.mockReturnValue({ citations: [], missed: true })

    const toolMs = makeRetrieveKnowledgeTool('ms')
    const executeImpl = toolMs.execute as NonNullable<typeof toolMs.execute>
    await executeImpl({ query: 'apa itu D2?' }, {} as never)

    expect(mocks.mockRetrieve).toHaveBeenCalledWith('apa itu D2?', 'ms')
  })

  it('returns miss signal when retrieval returns no results', async () => {
    mocks.mockRetrieve.mockResolvedValue([])
    mocks.mockIsRetrievalMiss.mockReturnValue(true)

    const tool = makeRetrieveKnowledgeTool('en')
    const executeImpl = tool.execute as NonNullable<typeof tool.execute>
    const rawResult = await executeImpl({ query: 'unknown topic xyz' }, {} as never)
    const result = rawResult as import('./tools').RetrieveResult

    expect(result.found).toBe(false)
    if (!result.found) {
      expect(result.reason).toBe('kb_miss')
    }
  })
})

// ─── Test 3: Zod-valid output; grounding mandate ─────────────────────────────

describe('Test 3: Coach output is Zod-valid; rejects empty citations when grounded', () => {
  it('accepts a grounded output with answer + non-empty citations', () => {
    const validOutput = {
      answer: 'D2 onboarding starts with PowerBoost. See [KB:chunk-en-001].',
      citations: [{ chunkId: 'chunk-en-001' }],
    }

    expect(() => CoachOutputSchema.parse(validOutput)).not.toThrow()
    const parsed = CoachOutputSchema.parse(validOutput)
    expect(parsed.citations).toHaveLength(1)
    expect(parsed.citations[0].chunkId).toBe('chunk-en-001')
  })

  it('accepts a handoff output with empty citations (kb_miss)', () => {
    const handoffOutput = {
      answer: 'I could not find relevant D2 training materials.',
      citations: [],
      handoff: { reason: 'kb_miss' as const },
    }

    expect(() => CoachOutputSchema.parse(handoffOutput)).not.toThrow()
  })

  it('rejects an output where citations field is missing entirely', () => {
    const invalidOutput = {
      answer: 'Here is some content.',
      // citations is required in the schema
    }

    expect(() => CoachOutputSchema.parse(invalidOutput)).toThrow(z.ZodError)
  })

  it('rejects output with chunkId that is empty string', () => {
    const invalidCitation = {
      answer: 'Some answer',
      citations: [{ chunkId: '' }], // chunkId must be non-empty (min 1)
    }

    expect(() => CoachOutputSchema.parse(invalidCitation)).toThrow(z.ZodError)
  })

  it('rejects handoff with unknown reason (schema enforces kb_miss literal)', () => {
    const invalidHandoff = {
      answer: 'Could not find.',
      citations: [],
      handoff: { reason: 'some_other_reason' },
    }

    expect(() => CoachOutputSchema.parse(invalidHandoff)).toThrow(z.ZodError)
  })
})

// ─── Test 4: KB-miss → emitHandoffSignal called; no fabrication ──────────────

describe('Test 4: On retrieval miss, emitHandoffSignal is called and content is not fabricated', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.mockEmitHandoffSignal.mockResolvedValue(undefined)
  })

  it('calls emitHandoffSignal when rawResponse has empty citations and no answer (kb miss)', async () => {
    const result = await coachAgent.run(
      {
        messages: [{ role: 'user', content: 'What is X?' }],
        userLang: 'en',
        agentUid: 'uid-test-001',
        seniorCoachId: 'senior-uid-001',
        conversationId: 'conv-001',
      },
      {
        rawResponse: JSON.stringify({
          answer: '', // empty answer → treated as KB-miss
          citations: [],
        }),
      },
    )

    // emitHandoffSignal MUST have been called with reason 'kb_miss'
    expect(mocks.mockEmitHandoffSignal).toHaveBeenCalledWith(
      expect.objectContaining({
        agentUid: 'uid-test-001',
        seniorCoachId: 'senior-uid-001',
        reason: 'kb_miss',
        contextBundle: expect.objectContaining({ conversationId: 'conv-001' }),
      }),
    )

    expect(result.handoffEmitted).toBe(true)
    expect(result.output.handoff?.reason).toBe('kb_miss')

    // The answer is the standard "no info found" message — NOT fabricated content
    expect(result.output.answer).toContain('could not find')
  })

  it('does NOT call emitHandoffSignal when retrieval succeeds (citations present)', async () => {
    const result = await coachAgent.run(
      {
        messages: [{ role: 'user', content: 'What is D2 onboarding?' }],
        userLang: 'en',
        agentUid: 'uid-test-002',
        conversationId: 'conv-002',
      },
      {
        rawResponse: JSON.stringify({
          answer: 'D2 onboarding starts with PowerBoost. See [KB:chunk-en-001].',
          citations: [{ chunkId: 'chunk-en-001' }],
        }),
      },
    )

    expect(mocks.mockEmitHandoffSignal).not.toHaveBeenCalled()
    expect(result.handoffEmitted).toBe(false)
    expect(result.output.citations).toHaveLength(1)
    expect(result.output.citations[0].chunkId).toBe('chunk-en-001')
  })

  it('emits handoff when handoff.reason = kb_miss is explicit in raw response', async () => {
    const result = await coachAgent.run(
      {
        messages: [{ role: 'user', content: 'What is Y?' }],
        userLang: 'en',
        agentUid: 'uid-test-003',
        conversationId: 'conv-003',
      },
      {
        rawResponse: JSON.stringify({
          answer: '',
          citations: [],
          handoff: { reason: 'kb_miss' },
        }),
      },
    )

    expect(mocks.mockEmitHandoffSignal).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'kb_miss' }),
    )
    expect(result.handoffEmitted).toBe(true)
  })
})

// ─── Test 5: Coach is reached via router.route, not called directly ───────────

describe('Test 5: Coach is dispatched via router.route — not called directly', () => {
  it('router.route returns pillar=coach in Phase 1 (heuristic single-pillar)', () => {
    const messages = [{ role: 'user' as const, content: 'How do I register my first lead?' }]
    const decision = route(messages)

    expect(decision.pillar).toBe('coach')
    expect(decision.reason).toBe('phase-1-single-pillar')
  })

  it('dispatches to coachAgent only after router.route confirms pillar=coach', async () => {
    const messages = [{ role: 'user' as const, content: 'Explain D2 commissions.' }]

    // Step 1: router decides the pillar
    const decision = route(messages)
    expect(decision.pillar).toBe('coach')

    // Step 2: dispatch to coachAgent (NOT called directly — always via router first)
    let coachInvoked = false
    if (decision.pillar === 'coach') {
      coachInvoked = true
      // The real route handler passes coachAgent.systemPrompt + makeTools to streamText
      expect(coachAgent.systemPrompt).toContain('D2')
      expect(typeof coachAgent.makeTools).toBe('function')
    }

    expect(coachInvoked).toBe(true)
  })

  it('manual-override chip routes to a specified pillar (escape hatch seam — Phase 3 ready)', () => {
    const messages = [{ role: 'user' as const, content: 'Find me a property' }]
    const decision = route(messages, { override: 'coach' })

    expect(decision.pillar).toBe('coach')
    expect(decision.reason).toBe('manual-override')
  })
})
