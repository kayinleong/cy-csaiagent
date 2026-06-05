/**
 * Tests for src/router/heuristic.ts — Phase 3 sync router (override + content heuristic).
 *
 * Behaviors proved (Phase 3 contract):
 *   1. Any onboarding message routes to 'coach' via sync route().
 *   2. Clear finder keywords (budget/RM/bedroom/project/paste/lead) → route() returns 'finder'
 *      via heuristicPillar — the Phase-1 "finder-ish always → coach" invariant is RETIRED here.
 *   3. manual-override chip wins over all heuristics.
 *   4. classifyIntent is NOT called on override or clear-keyword paths (cost/latency guard).
 *   5. sync route() shape unchanged — coach.test.ts call shapes still valid.
 *
 * Phase-1 invariants intentionally superseded:
 *   - "finder-ish content still routes to coach" → now routes to 'finder' on clear keywords.
 *   - "classifyIntent must never be called at all" → narrowed to "not on override/clear-keyword paths".
 *
 * Pure logic — no Firestore, no Firebase, no Next.js. Offline-safe.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Mock classifyIntent so it never makes real network calls ─────────────────
// classifyIntent should NOT be called on override or clear-keyword paths.
// If it IS called on those paths, the spy records the invocation and we assert.
vi.mock('./classifier', () => ({
  classifyIntent: vi.fn(async () => ({
    pillar: 'coach' as const,
    confidence: 0.9,
    reason: 'mock-classifier',
  })),
  NotActivatedError: class NotActivatedError extends Error {
    constructor(msg?: string) { super(msg) }
  },
}))

import { route, heuristicPillar } from './heuristic'
import { classifyIntent } from './classifier'

describe('route() — Phase 3 sync fast-path (override + content heuristic)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // ─── Behavior 1: coach keywords → sync coach ────────────────────────────────
  it('Behavior 1: onboarding message routes to coach via sync route()', () => {
    const result = route([{ role: 'user', content: 'How do I run my first Meta ad?' }])

    expect(result.pillar).toBe('coach')
    expect(result.reason).toBeDefined()
    expect(result.reason.length).toBeGreaterThan(0)
  })

  // ─── Behavior 2: finder keywords → heuristic returns finder ─────────────────
  it('Behavior 2: clear finder keywords route to finder via heuristic (budget/RM keyword)', () => {
    const result = route([{ role: 'user', content: 'My client has a budget of RM 650k, show me matching projects' }])

    expect(result.pillar).toBe('finder')
    expect(result.reason).toBeDefined()
  })

  it('Behavior 2b: bedroom keyword routes to finder via heuristic', () => {
    const result = route([{ role: 'user', content: '3 bedroom unit under 800k near LRT' }])

    expect(result.pillar).toBe('finder')
  })

  it('Behavior 2c: lead criteria keyword routes to finder via heuristic', () => {
    const result = route([{ role: 'user', content: 'paste lead details: young couple, first home, KL area' }])

    expect(result.pillar).toBe('finder')
  })

  // ─── Behavior 3: manual-override chip wins ───────────────────────────────────
  it('Behavior 3: manual-override chip wins — override:"finder" returns pillar:"finder"', () => {
    const result = route(
      [{ role: 'user', content: 'How do I run my first Meta ad?' }],
      { override: 'finder' }
    )

    expect(result.pillar).toBe('finder')
    expect(result.reason).toBe('manual-override')
  })

  it('Behavior 3b: manual-override chip wins — override:"reply" returns pillar:"reply"', () => {
    const result = route(
      [{ role: 'user', content: 'Help me reply to this message' }],
      { override: 'reply' }
    )

    expect(result.pillar).toBe('reply')
    expect(result.reason).toBe('manual-override')
  })

  it('Behavior 3c: manual-override with coach keyword message — override wins over heuristic', () => {
    const result = route(
      [{ role: 'user', content: 'show me projects under 500k' }],
      { override: 'coach' }
    )

    expect(result.pillar).toBe('coach')
    expect(result.reason).toBe('manual-override')
  })

  // ─── Behavior 4: classifyIntent NOT called on override or clear-keyword paths ─
  it('Behavior 4: classifyIntent is NOT called on manual-override paths', () => {
    route(
      [{ role: 'user', content: 'anything' }],
      { override: 'finder' }
    )

    expect(classifyIntent).not.toHaveBeenCalled()
  })

  it('Behavior 4b: classifyIntent is NOT called on clear coach-keyword paths', () => {
    route([{ role: 'user', content: 'How do I complete the onboarding checkpoint?' }])

    expect(classifyIntent).not.toHaveBeenCalled()
  })

  it('Behavior 4c: classifyIntent is NOT called on clear finder-keyword paths', () => {
    route([{ role: 'user', content: 'My lead has a budget of RM 500k, 2 bedroom preferred' }])

    expect(classifyIntent).not.toHaveBeenCalled()
  })

  // ─── Behavior 5: sync route() shape unchanged — coach.test.ts call shapes valid
  it('Behavior 5: sync route() with no opts returns a RouteDecision with pillar + reason', () => {
    const messages = [{ role: 'user' as const, content: 'How do I register my first lead?' }]
    const decision = route(messages)

    expect(decision).toHaveProperty('pillar')
    expect(decision).toHaveProperty('reason')
    expect(typeof decision.pillar).toBe('string')
    expect(typeof decision.reason).toBe('string')
  })

  it('Behavior 5b: sync route() with override returns finder (coach.test.ts override shape)', () => {
    const messages = [{ role: 'user' as const, content: 'Find me a property' }]
    const decision = route(messages, { override: 'coach' })

    expect(decision.pillar).toBe('coach')
    expect(decision.reason).toBe('manual-override')
  })
})

// ─── heuristicPillar unit tests ───────────────────────────────────────────────

describe('heuristicPillar() — content keyword classifier', () => {
  it('returns null for an ambiguous message (no clear keywords)', () => {
    const result = heuristicPillar([{ role: 'user', content: 'hello there' }])
    expect(result).toBeNull()
  })

  it('returns { pillar:"finder" } for a message with RM keyword', () => {
    const result = heuristicPillar([{ role: 'user', content: 'client has RM 700k budget' }])
    expect(result).not.toBeNull()
    expect(result?.pillar).toBe('finder')
  })

  it('returns { pillar:"finder" } for a message with "bedroom" keyword', () => {
    const result = heuristicPillar([{ role: 'user', content: 'looking for 3 bedroom apartment' }])
    expect(result?.pillar).toBe('finder')
  })

  it('returns { pillar:"finder" } for a message with "lead" keyword', () => {
    const result = heuristicPillar([{ role: 'user', content: 'paste lead info: young couple, first home' }])
    expect(result?.pillar).toBe('finder')
  })

  it('returns { pillar:"finder" } for a message with "budget" keyword', () => {
    const result = heuristicPillar([{ role: 'user', content: 'my client budget is under 500k' }])
    expect(result?.pillar).toBe('finder')
  })

  it('returns { pillar:"finder" } for a message with "investment" keyword', () => {
    const result = heuristicPillar([{ role: 'user', content: 'looking for investment property' }])
    expect(result?.pillar).toBe('finder')
  })

  it('returns { pillar:"coach" } for a message with "onboarding" keyword', () => {
    const result = heuristicPillar([{ role: 'user', content: 'I need help with my onboarding journey' }])
    expect(result).not.toBeNull()
    expect(result?.pillar).toBe('coach')
  })

  it('returns { pillar:"coach" } for a message with "training" keyword', () => {
    const result = heuristicPillar([{ role: 'user', content: 'when does training start?' }])
    expect(result?.pillar).toBe('coach')
  })

  it('returns { pillar:"coach" } for a message with "playbook" keyword', () => {
    const result = heuristicPillar([{ role: 'user', content: 'where can I find the playbook?' }])
    expect(result?.pillar).toBe('coach')
  })

  it('returns { pillar:"coach" } for a message with "checkpoint" keyword', () => {
    const result = heuristicPillar([{ role: 'user', content: 'I have completed my checkpoint' }])
    expect(result?.pillar).toBe('coach')
  })

  it('returns { pillar:"coach" } for a message with "meta ad" keyword', () => {
    const result = heuristicPillar([{ role: 'user', content: 'how do I set up a meta ad?' }])
    expect(result?.pillar).toBe('coach')
  })

  it('returns a reason string when a pillar is detected', () => {
    const result = heuristicPillar([{ role: 'user', content: 'RM 600k budget for my lead' }])
    expect(typeof result?.reason).toBe('string')
    expect(result?.reason.length).toBeGreaterThan(0)
  })
})

// ─── REPLY-10 (Phase 4) — Reply heuristic patterns + precedence (RED, Wave 0) ──
//
// Plan 04-04 adds REPLY_PATTERNS (e.g. /draft (a )?repl/i, /reply to (this|him|her)/i,
// /what (should|do) i (say|reply)/i, /(lead|client) (said|wrote|sent|asked)/i) AND
// checks Reply STRUCTURAL signals BEFORE the generic Finder keyword scan (Pitfall C).
//
// Today: a "draft a reply" message has no finder/coach keyword → heuristicPillar
// returns null (route() then defaults to 'coach'); and a paste mentioning "RM" hits
// FINDER_PATTERNS first → routes to 'finder'. Both assertions below are EXPECTED-FAIL
// (`it.fails`) so they fail RED against current code while keeping the offline suite
// green; they flip to passes when 04-04 lands the REPLY_PATTERNS + ordering.

describe('heuristicPillar() — Reply patterns (REPLY-10, RED until Plan 04-04)', () => {
  it.fails('"draft a reply to this: …" routes to pillar:"reply" (RED until Plan 04-04)', () => {
    const result = heuristicPillar([
      { role: 'user', content: 'draft a reply to this: hi, still keen on the unit?' },
    ])
    expect(result).not.toBeNull()
    expect(result?.pillar).toBe('reply')
  })

  it.fails('"what should I reply" routes to pillar:"reply" (RED until Plan 04-04)', () => {
    const result = heuristicPillar([
      { role: 'user', content: 'the lead said they want to think about it — what should I reply?' },
    ])
    expect(result?.pillar).toBe('reply')
  })

  it.fails('precedence (Pitfall C): a pasted inbound with "RM" + "draft a reply" routes to reply, NOT finder (RED until Plan 04-04)', () => {
    // "RM" matches FINDER_PATTERNS today, so this mis-routes to 'finder'. Plan 04-04
    // checks Reply structural signals first, so the inbound paste routes to 'reply'.
    const result = heuristicPillar([
      { role: 'user', content: 'lead said: "can you do RM 600k?" — draft a reply for me' },
    ])
    expect(result?.pillar).toBe('reply')
  })
})
