/**
 * src/router/classifier.test.ts — Phase 3 async routing contract.
 *
 * Tests for routeAsync (heuristic→classifier→low-confidence-default) + classifyIntent.
 *
 * Routing decision tree:
 *   1. override chip set → {pillar: override, reason:'manual-override'}, classifier NOT called.
 *   2. heuristicPillar(messages) clear → route without classifier (cost/latency saving).
 *   3. ambiguous message → classifyIntent called; returns its pillar/reason.
 *   4. low confidence (<τ) → default to 'coach' with reason containing 'low_confidence' (safe default).
 *
 * Offline — generateObject and modelFor are mocked so no real API calls are made.
 *
 * Pure logic tests — no Firestore, no Firebase, no Next.js.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Mock generateObject and modelFor ────────────────────────────────────────
// vi.hoisted ensures mock variables are initialized before vi.mock factories run.

const mocks = vi.hoisted(() => {
  return {
    mockGenerateObject: vi.fn(),
    mockModelFor: vi.fn(async () => ({ /* fake LanguageModel handle */ })),
  }
})

vi.mock('ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ai')>()
  return {
    ...actual,
    generateObject: mocks.mockGenerateObject,
  }
})

vi.mock('@/src/llm/provider', () => ({
  modelFor: mocks.mockModelFor,
}))

import { classifyIntent } from './classifier'
import { routeAsync, ROUTER_CONFIDENCE_THRESHOLD } from './index'

// ─── Helpers ──────────────────────────────────────────────────────────────────

const makeMessages = (content: string) => [{ role: 'user' as const, content }]

// Ambiguous message — no clear coach or finder keywords
const AMBIGUOUS = makeMessages('Tell me more about this.')

// Clear finder message
const FINDER_MSG = makeMessages('My lead has a budget of RM 600k, 2 bedroom preferred near KL.')

// Clear coach message
const COACH_MSG = makeMessages('I need help with my onboarding training checkpoint.')

describe('ROUTER_CONFIDENCE_THRESHOLD', () => {
  it('is exported and is a number between 0 and 1', () => {
    expect(typeof ROUTER_CONFIDENCE_THRESHOLD).toBe('number')
    expect(ROUTER_CONFIDENCE_THRESHOLD).toBeGreaterThan(0)
    expect(ROUTER_CONFIDENCE_THRESHOLD).toBeLessThanOrEqual(1)
  })
})

describe('classifyIntent — activated LLM classifier', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('calls modelFor("router") to resolve the model — never hard-coded', async () => {
    mocks.mockGenerateObject.mockResolvedValueOnce({
      object: { pillar: 'coach', confidence: 0.85, reason: 'onboarding question' },
    })

    await classifyIntent(makeMessages('How do I run a Meta ad campaign?'))

    expect(mocks.mockModelFor).toHaveBeenCalledWith('router')
  })

  it('calls generateObject and returns { pillar, confidence, reason }', async () => {
    mocks.mockGenerateObject.mockResolvedValueOnce({
      object: { pillar: 'finder', confidence: 0.9, reason: 'property matching request' },
    })

    const result = await classifyIntent(makeMessages('show me projects matching my lead'))

    expect(mocks.mockGenerateObject).toHaveBeenCalledTimes(1)
    expect(result.pillar).toBe('finder')
    expect(result.confidence).toBe(0.9)
    expect(result.reason).toBe('property matching request')
  })

  // ── REPLY-10 (Phase 4): the RouteSchema enum is now ternary. ──
  // The Phase-3 schema was ['coach','finder'] and REJECTED 'reply'. Plan 04-04 widened
  // it to ['coach','finder','reply'] so the classifier can route the third pillar.
  // These assertions (schema ACCEPTS 'reply') were EXPECTED-FAIL (`it.fails`) RED guards
  // against the binary enum; 04-04 widened the enum, so they are now real passing
  // assertions (the `.fails` markers have been removed — INVERTED per 04-RESEARCH §Q8).
  it('accepts "reply" in the RouteSchema enum (GREEN since Plan 04-04 widened the enum)', async () => {
    let capturedSchema: { parse?: (v: unknown) => unknown } | undefined
    mocks.mockGenerateObject.mockImplementationOnce(async ({ schema }: { schema: { parse?: (v: unknown) => unknown } }) => {
      capturedSchema = schema
      return { object: { pillar: 'reply', confidence: 0.9, reason: 'draft a reply request' } }
    })

    await classifyIntent(makeMessages('draft a reply to this lead message'))

    // The schema passed to generateObject MUST accept a 'reply' pillar without throwing.
    expect(() => capturedSchema?.parse?.({ pillar: 'reply', confidence: 0.9, reason: 'test' })).not.toThrow()
  })

  it('the RouteSchema passed to generateObject validates a reply classification', async () => {
    // Capture the schema the classifier hands to generateObject and assert it
    // VALIDATES a reply result. Before 04-04 the binary enum rejected 'reply' on parse;
    // 04-04 widened the enum so the parse now succeeds and returns pillar:'reply'.
    let capturedSchema: { parse?: (v: unknown) => unknown } | undefined
    mocks.mockGenerateObject.mockImplementationOnce(async ({ schema }: { schema: { parse?: (v: unknown) => unknown } }) => {
      capturedSchema = schema
      return { object: { pillar: 'reply', confidence: 0.92, reason: 'inbound WhatsApp paste, draft a reply' } }
    })

    await classifyIntent(makeMessages('lead said: "still thinking" — what should I reply?'))

    const parsed = capturedSchema?.parse?.({ pillar: 'reply', confidence: 0.92, reason: 'draft a reply' }) as
      | { pillar?: string }
      | undefined
    expect(parsed?.pillar).toBe('reply')
  })
})

describe('routeAsync — three-tier routing (override→heuristic→classifier)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // ─── override-wins ────────────────────────────────────────────────────────
  it('override-wins: manual override returns the override pillar without calling classifyIntent', async () => {
    const result = await routeAsync(AMBIGUOUS, { override: 'finder' })

    expect(result.pillar).toBe('finder')
    expect(result.reason).toBe('manual-override')
    // The classifier (generateObject) must NOT have been called
    expect(mocks.mockGenerateObject).not.toHaveBeenCalled()
  })

  it('override-wins: override:"coach" wins even on a finder-keyword message', async () => {
    const result = await routeAsync(FINDER_MSG, { override: 'coach' })

    expect(result.pillar).toBe('coach')
    expect(result.reason).toBe('manual-override')
    expect(mocks.mockGenerateObject).not.toHaveBeenCalled()
  })

  // ─── clear-keyword-finder ─────────────────────────────────────────────────
  it('clear-keyword-finder: finder keywords route to finder WITHOUT calling classifyIntent', async () => {
    const result = await routeAsync(FINDER_MSG)

    expect(result.pillar).toBe('finder')
    // Classifier must NOT have been called — heuristic handled it
    expect(mocks.mockGenerateObject).not.toHaveBeenCalled()
  })

  // ─── clear-keyword-coach ──────────────────────────────────────────────────
  it('clear-keyword-coach: coach keywords route to coach WITHOUT calling classifyIntent', async () => {
    const result = await routeAsync(COACH_MSG)

    expect(result.pillar).toBe('coach')
    // Classifier must NOT have been called — heuristic handled it
    expect(mocks.mockGenerateObject).not.toHaveBeenCalled()
  })

  // ─── ambiguous→classifier ─────────────────────────────────────────────────
  it('ambiguous: ambiguous message calls classifyIntent and returns its pillar/reason', async () => {
    mocks.mockGenerateObject.mockResolvedValueOnce({
      object: { pillar: 'finder', confidence: 0.82, reason: 'property inquiry detected' },
    })

    const result = await routeAsync(AMBIGUOUS)

    expect(mocks.mockGenerateObject).toHaveBeenCalledTimes(1)
    expect(result.pillar).toBe('finder')
    // Reason encodes the classifier tier
    expect(result.reason).toContain('classifier')
    expect(result.reason).toContain('property inquiry detected')
  })

  it('ambiguous: classifier result for coach pillar is returned correctly', async () => {
    mocks.mockGenerateObject.mockResolvedValueOnce({
      object: { pillar: 'coach', confidence: 0.75, reason: 'onboarding question' },
    })

    const result = await routeAsync(makeMessages('What should I do next?'))

    expect(result.pillar).toBe('coach')
    expect(result.reason).toContain('classifier')
  })

  // ─── low_confidence→coach ─────────────────────────────────────────────────
  it('low_confidence: classifier below threshold defaults to coach with low_confidence reason', async () => {
    // Return finder with low confidence — below ROUTER_CONFIDENCE_THRESHOLD
    const lowConfidence = Math.max(0, ROUTER_CONFIDENCE_THRESHOLD - 0.3)
    mocks.mockGenerateObject.mockResolvedValueOnce({
      object: { pillar: 'finder', confidence: lowConfidence, reason: 'uncertain property intent' },
    })

    const result = await routeAsync(AMBIGUOUS)

    // Safe default: coach on low confidence
    expect(result.pillar).toBe('coach')
    // Reason must contain 'low_confidence' for eval observability (D-02)
    expect(result.reason).toContain('low_confidence')
    // And encode the classifier's reason
    expect(result.reason).toContain('uncertain property intent')
  })

  it('low_confidence: confidence exactly at threshold is accepted (not defaulted)', async () => {
    // Exactly at threshold → accept (threshold is the lower bound that passes)
    mocks.mockGenerateObject.mockResolvedValueOnce({
      object: { pillar: 'finder', confidence: ROUTER_CONFIDENCE_THRESHOLD, reason: 'at boundary' },
    })

    const result = await routeAsync(AMBIGUOUS)

    // At threshold: result should be the classifier's pillar (not defaulted)
    expect(result.pillar).toBe('finder')
    expect(result.reason).not.toContain('low_confidence')
  })

  it('low_confidence: confidence of 0.2 defaults to coach regardless of classifier pillar', async () => {
    mocks.mockGenerateObject.mockResolvedValueOnce({
      object: { pillar: 'finder', confidence: 0.2, reason: 'very uncertain' },
    })

    const result = await routeAsync(AMBIGUOUS)

    expect(result.pillar).toBe('coach')
    expect(result.reason).toContain('low_confidence')
  })

  // ─── reason encodes deciding tier (D-02) ─────────────────────────────────
  it('reason encodes the heuristic tier for observable routeDecision', async () => {
    const result = await routeAsync(FINDER_MSG)
    // Heuristic path — reason should indicate heuristic, not classifier
    expect(result.reason).toMatch(/heuristic/i)
    expect(result.reason).not.toContain('low_confidence')
  })

  it('reason encodes the classifier tier when classifier is used', async () => {
    mocks.mockGenerateObject.mockResolvedValueOnce({
      object: { pillar: 'coach', confidence: 0.78, reason: 'training question' },
    })

    const result = await routeAsync(AMBIGUOUS)
    expect(result.reason).toMatch(/classifier/i)
  })
})

// ─── quick-kayinleong-069: the classifier failing must not kill the turn ──────
//
// Reproduced end to end against the local dev server: when the Anthropic account ran out of
// credit, classifyIntent threw AI_APICallError, nothing caught it, and the agent got HTTP
// 500 with an EMPTY body — no message, no explanation. A router is an optimisation over the
// heuristic; a provider outage, billing lapse, rate limit or bad model id should cost
// routing ACCURACY, not the whole turn.

describe('routeAsync — the classifier is optional, not load-bearing', () => {
  it('falls back to coach when the classifier THROWS, instead of propagating', async () => {
    mocks.mockGenerateObject.mockRejectedValueOnce(
      Object.assign(new Error('Your credit balance is too low'), { name: 'AI_APICallError' }),
    )

    const result = await routeAsync(AMBIGUOUS)

    expect(result.pillar).toBe('coach')
    expect(result.reason).toBe('classifier_unavailable')
  })

  it('makes the failure observable in routeDecision rather than silent', async () => {
    // `${pillar}:${reason}` is what lands on every message (D-02), so a turn routed by
    // fallback is distinguishable from one the classifier actually decided.
    mocks.mockGenerateObject.mockRejectedValueOnce(new Error('ECONNRESET'))
    const result = await routeAsync(AMBIGUOUS)
    expect(`${result.pillar}:${result.reason}`).toBe('coach:classifier_unavailable')
  })

  it('never reaches the classifier when the heuristic already decided', async () => {
    // The fallback must not mask a heuristic hit — a Finder question with the classifier
    // down still routes to Finder.
    mocks.mockGenerateObject.mockRejectedValue(new Error('should not be called'))
    const result = await routeAsync(FINDER_MSG)
    expect(result.pillar).toBe('finder')
    expect(result.reason).not.toBe('classifier_unavailable')
  })

  it('still honours the manual override with the classifier down', async () => {
    mocks.mockGenerateObject.mockRejectedValue(new Error('down'))
    const result = await routeAsync(AMBIGUOUS, { override: 'reply' })
    expect(result).toEqual({ pillar: 'reply', reason: 'manual-override' })
  })
})
