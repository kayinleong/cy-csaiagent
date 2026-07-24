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

// ─── quick-kayinleong-041: expanded Finder vocabulary (Auto-mode misroute fix) ──────
//
// These phrasings previously had NO finder keyword → heuristicPillar returned null →
// routeAsync fell to the coach-biased LLM classifier → misrouted to coach in Auto mode.
// The widened FINDER_PATTERNS now catch property-type nouns, tenure, standalone price
// shapes, size units, and bedroom shorthand so they route deterministically to finder.

describe('heuristicPillar() — expanded Finder vocabulary (quick-041)', () => {
  const FINDER_PHRASINGS: Array<[label: string, content: string]> = [
    ['condo (no budget word)', 'Find me a condo in TRX'],
    ['apartment', 'any apartment in Mont Kiara for my client'],
    ['penthouse', 'looking for a penthouse near KLCC'],
    ['studio', 'a small studio in Cyberjaya'],
    ['landed', 'landed only, Petaling Jaya'],
    ['terrace', 'double storey terrace in Setia Alam'],
    ['semi-d', 'semi-d in Kajang please'],
    ['bungalow', 'a bungalow in Damansara Heights'],
    ['townhouse', 'townhouse near the LRT'],
    ['soho', 'a soho unit in Cheras'],
    ['unit', 'any 2 room unit available in KL'],
    ['freehold', 'must be freehold, KL city'],
    ['leasehold', 'leasehold is fine, Subang'],
    ['RM no-space amount', 'something around RM800000'],
    ['standalone 800k', 'find me a place, 800k max, TRX'],
    ['1.2m million shape', 'around 1.2m in Bangsar'],
    ['sqft', 'at least 1000 sqft, KL'],
    ['psf', 'below 900 psf in Cheras'],
    ['bedroom shorthand 2BR', '2BR in TRX please'],
  ]

  it.each(FINDER_PHRASINGS)('routes "%s" to finder without the classifier', (_label, content) => {
    const result = heuristicPillar([{ role: 'user', content }])
    expect(result).not.toBeNull()
    expect(result?.pillar).toBe('finder')
  })

  // Coach-regression guard: the new price/property patterns must NOT steal coach traffic.
  it('coach regression: "in-house training this week" still routes to coach', () => {
    const result = heuristicPillar([{ role: 'user', content: 'is there in-house training this week?' }])
    expect(result?.pillar).toBe('coach')
  })

  it('coach regression: "I finished my onboarding checkpoint" still routes to coach', () => {
    const result = heuristicPillar([{ role: 'user', content: 'I finished my onboarding checkpoint' }])
    expect(result?.pillar).toBe('coach')
  })

  // Reply precedence guard: a pasted inbound mentioning a NEW finder keyword ("unit")
  // must still route to reply (structural Reply signals run before the Finder scan).
  it('reply precedence: "draft a reply: still keen on the unit?" stays reply, not finder', () => {
    const result = heuristicPillar([
      { role: 'user', content: 'draft a reply to this: hi, still keen on the unit?' },
    ])
    expect(result?.pillar).toBe('reply')
  })
})

// ─── REPLY-10 (Phase 4) — Reply heuristic patterns + precedence (GREEN, Plan 04-04) ──
//
// Plan 04-04 added REPLY_PATTERNS (e.g. /draft (a )?repl/i, /reply to (this|him|her)/i,
// /what (should|do) i (say|reply)/i, /(lead|client) (said|wrote|sent|asked)/i) AND
// checks Reply STRUCTURAL signals BEFORE the generic Finder keyword scan (Pitfall C).
//
// Before 04-04: a "draft a reply" message had no finder/coach keyword → heuristicPillar
// returned null (route() then defaulted to 'coach'); and a paste mentioning "RM" hit
// FINDER_PATTERNS first → routed to 'finder'. These assertions were EXPECTED-FAIL
// (`it.fails`) RED guards; 04-04 landed REPLY_PATTERNS + precedence ordering, so they
// are now real passing assertions.

describe('heuristicPillar() — Reply patterns (REPLY-10, GREEN since Plan 04-04)', () => {
  it('"draft a reply to this: …" routes to pillar:"reply"', () => {
    const result = heuristicPillar([
      { role: 'user', content: 'draft a reply to this: hi, still keen on the unit?' },
    ])
    expect(result).not.toBeNull()
    expect(result?.pillar).toBe('reply')
  })

  it('"what should I reply" routes to pillar:"reply"', () => {
    const result = heuristicPillar([
      { role: 'user', content: 'the lead said they want to think about it — what should I reply?' },
    ])
    expect(result?.pillar).toBe('reply')
  })

  it('precedence (Pitfall C): a pasted inbound with "RM" + "draft a reply" routes to reply, NOT finder', () => {
    // "RM" matches FINDER_PATTERNS, so before 04-04 this mis-routed to 'finder'. The
    // Reply structural signals are now checked first, so the inbound paste routes to 'reply'.
    const result = heuristicPillar([
      { role: 'user', content: 'lead said: "can you do RM 600k?" — draft a reply for me' },
    ])
    expect(result?.pillar).toBe('reply')
  })

  it('precedence preserved: a PURE Finder query (no reply signal) still routes to finder', () => {
    // Regression guard for Pitfall C ordering: REPLY_PATTERNS must not steal Finder traffic.
    const result = heuristicPillar([
      { role: 'user', content: 'show me projects matching my lead, budget RM500k, own-stay' },
    ])
    expect(result?.pillar).toBe('finder')
  })
})
