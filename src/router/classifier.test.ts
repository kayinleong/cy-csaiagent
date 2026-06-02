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
// These are intercepted so classifyIntent never makes real API calls.

const mockGenerateObject = vi.fn()

vi.mock('ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ai')>()
  return {
    ...actual,
    generateObject: mockGenerateObject,
  }
})

vi.mock('@/src/llm/provider', () => ({
  modelFor: vi.fn(async () => ({ /* fake LanguageModel handle */ })),
}))

import { classifyIntent } from './classifier'
import { routeAsync, ROUTER_CONFIDENCE_THRESHOLD } from './index'
import { modelFor } from '@/src/llm/provider'

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
    mockGenerateObject.mockResolvedValueOnce({
      object: { pillar: 'coach', confidence: 0.85, reason: 'onboarding question' },
    })

    await classifyIntent(makeMessages('How do I run a Meta ad campaign?'))

    expect(modelFor).toHaveBeenCalledWith('router')
  })

  it('calls generateObject and returns { pillar, confidence, reason }', async () => {
    mockGenerateObject.mockResolvedValueOnce({
      object: { pillar: 'finder', confidence: 0.9, reason: 'property matching request' },
    })

    const result = await classifyIntent(makeMessages('show me projects matching my lead'))

    expect(mockGenerateObject).toHaveBeenCalledTimes(1)
    expect(result.pillar).toBe('finder')
    expect(result.confidence).toBe(0.9)
    expect(result.reason).toBe('property matching request')
  })

  it('does not include "reply" pillar in the schema (Phase 4 only)', async () => {
    // The schema enum is ['coach','finder'] — passing 'reply' should fail Zod validation.
    // We test this by verifying that generateObject is called with a schema that rejects 'reply'.
    // We do this indirectly: mockGenerateObject receives the call args.
    mockGenerateObject.mockImplementationOnce(async ({ schema }: { schema: { parse?: (v: unknown) => unknown } }) => {
      // The schema should reject 'reply'
      let threw = false
      try {
        schema.parse?.({ pillar: 'reply', confidence: 0.9, reason: 'test' })
      } catch {
        threw = true
      }
      expect(threw).toBe(true)

      return { object: { pillar: 'coach', confidence: 0.8, reason: 'safe default' } }
    })

    await classifyIntent(makeMessages('ambiguous message'))
    expect(mockGenerateObject).toHaveBeenCalledTimes(1)
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
    expect(mockGenerateObject).not.toHaveBeenCalled()
  })

  it('override-wins: override:"coach" wins even on a finder-keyword message', async () => {
    const result = await routeAsync(FINDER_MSG, { override: 'coach' })

    expect(result.pillar).toBe('coach')
    expect(result.reason).toBe('manual-override')
    expect(mockGenerateObject).not.toHaveBeenCalled()
  })

  // ─── clear-keyword-finder ─────────────────────────────────────────────────
  it('clear-keyword-finder: finder keywords route to finder WITHOUT calling classifyIntent', async () => {
    const result = await routeAsync(FINDER_MSG)

    expect(result.pillar).toBe('finder')
    // Classifier must NOT have been called — heuristic handled it
    expect(mockGenerateObject).not.toHaveBeenCalled()
  })

  // ─── clear-keyword-coach ──────────────────────────────────────────────────
  it('clear-keyword-coach: coach keywords route to coach WITHOUT calling classifyIntent', async () => {
    const result = await routeAsync(COACH_MSG)

    expect(result.pillar).toBe('coach')
    // Classifier must NOT have been called — heuristic handled it
    expect(mockGenerateObject).not.toHaveBeenCalled()
  })

  // ─── ambiguous→classifier ─────────────────────────────────────────────────
  it('ambiguous: ambiguous message calls classifyIntent and returns its pillar/reason', async () => {
    mockGenerateObject.mockResolvedValueOnce({
      object: { pillar: 'finder', confidence: 0.82, reason: 'property inquiry detected' },
    })

    const result = await routeAsync(AMBIGUOUS)

    expect(mockGenerateObject).toHaveBeenCalledTimes(1)
    expect(result.pillar).toBe('finder')
    // Reason encodes the classifier tier
    expect(result.reason).toContain('classifier')
    expect(result.reason).toContain('property inquiry detected')
  })

  it('ambiguous: classifier result for coach pillar is returned correctly', async () => {
    mockGenerateObject.mockResolvedValueOnce({
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
    mockGenerateObject.mockResolvedValueOnce({
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
    mockGenerateObject.mockResolvedValueOnce({
      object: { pillar: 'finder', confidence: ROUTER_CONFIDENCE_THRESHOLD, reason: 'at boundary' },
    })

    const result = await routeAsync(AMBIGUOUS)

    // At threshold: result should be the classifier's pillar (not defaulted)
    expect(result.pillar).toBe('finder')
    expect(result.reason).not.toContain('low_confidence')
  })

  it('low_confidence: confidence of 0.2 defaults to coach regardless of classifier pillar', async () => {
    mockGenerateObject.mockResolvedValueOnce({
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
    mockGenerateObject.mockResolvedValueOnce({
      object: { pillar: 'coach', confidence: 0.78, reason: 'training question' },
    })

    const result = await routeAsync(AMBIGUOUS)
    expect(result.reason).toMatch(/classifier/i)
  })
})
