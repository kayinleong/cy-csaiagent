/**
 * Tests for src/router/heuristic.ts — Phase 1 heuristic router.
 *
 * Behaviors proved:
 *   1. Any user message routes to 'coach' (Phase 1 single-pillar mode).
 *   2. Even Finder-ish content still routes to 'coach' (heuristic = always Coach).
 *   3. manual-override chip: route(messages, { override:'finder' }) returns 'finder'.
 *   4. classifier.ts is dormant — classifyIntent() is NOT called during routing.
 *
 * Pure logic — no Firestore, no Firebase, no Next.js. Offline-safe.
 */

import { describe, it, expect, vi } from 'vitest'

// ─── Behavior 4 guard: ensure classifier module is not called by heuristic ────
//
// We spy on the classifier module. If route() ever calls classifyIntent(),
// the test will fail. classifyIntent() should ONLY exist as a dormant seam.
vi.mock('./classifier', () => ({
  classifyIntent: vi.fn(() => {
    throw new Error('classifyIntent should NOT be called in Phase 1 — it is a dormant Phase-3 seam')
  }),
  NotActivatedError: class NotActivatedError extends Error {
    constructor(msg?: string) { super(msg) }
  },
}))

import { route } from './heuristic'
import { classifyIntent } from './classifier'

describe('route (Phase 1 heuristic router)', () => {
  it('Behavior 1: any onboarding message routes to coach', () => {
    const result = route([{ role: 'user', content: 'How do I run my first Meta ad?' }])

    expect(result.pillar).toBe('coach')
    expect(result.reason).toBeDefined()
    expect(result.reason.length).toBeGreaterThan(0)
  })

  it('Behavior 2: finder-ish content still routes to coach in Phase 1 (single-pillar)', () => {
    const result = route([{ role: 'user', content: 'show me projects under 500k near KL' }])

    expect(result.pillar).toBe('coach')
    expect(result.reason).toBeDefined()
  })

  it('Behavior 3: manual-override chip wins — override:"finder" returns pillar:"finder"', () => {
    const result = route(
      [{ role: 'user', content: 'show me projects under 500k' }],
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

  it('Behavior 4: classifyIntent is NOT called during Phase 1 routing', () => {
    // route() runs without throwing — if classifyIntent were called, the vi.mock spy
    // would throw "classifyIntent should NOT be called in Phase 1"
    expect(() => {
      route([{ role: 'user', content: 'anything at all' }])
    }).not.toThrow()

    // Confirm classifyIntent mock was never invoked
    expect(classifyIntent).not.toHaveBeenCalled()
  })
})
