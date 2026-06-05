/**
 * src/reply/diff.test.ts — RED tests for editRatio (REPLY-09, Wave 0).
 *
 * The Reply edit-as-signal capture (D-18/D-20) needs a numeric `editRatio`
 * (normalized char-level edit distance) — NOT a diff library (none is installed;
 * RESEARCH §Standard Stack). Plan 04-07 adds the ~15-line core util `src/reply/diff.ts`
 * exporting `editRatio(original: string, edited: string): number` in [0,1].
 *
 * GREEN as of Plan 04-07 (Wave 4): `@/src/reply/diff` now exists and exports
 * `editRatio`, so the dynamic imports resolve and the assertions pass. The prior
 * `it.fails` / `@ts-expect-error` RED guards have been removed.
 *
 * Core/shell rule: this file must NOT import from app/ or next (REPLY util is portable).
 */

import { describe, it, expect } from 'vitest'
import { editRatio } from '@/src/reply/diff'

describe('editRatio (REPLY-09) — GREEN since Plan 04-07 (src/reply/diff.ts)', () => {
  it('identical strings → ratio 0 (no edit)', () => {
    const s = 'Hi, thanks for reaching out — happy to help with the Cheras unit.'
    expect(editRatio(s, s)).toBe(0)
  })

  it('complete rewrite → ratio near 1', () => {
    const original = 'aaaaaaaaaaaaaaaaaaaa'
    const edited = 'zzzzzzzzzzzzzzzzzzzz'
    const ratio = editRatio(original, edited)
    expect(ratio).toBeGreaterThan(0.9)
    expect(ratio).toBeLessThanOrEqual(1)
  })

  it('a small edit → a small ratio in (0,1)', () => {
    const original = 'Thanks for your message, I will get back to you shortly.'
    const edited = 'Thanks for your message, I will get back to you soon.'
    const ratio = editRatio(original, edited)
    expect(ratio).toBeGreaterThan(0)
    expect(ratio).toBeLessThan(0.5)
  })

  it('ratio is always within [0,1] (normalized)', () => {
    const ratio = editRatio('short', 'a much much longer edited reply than the original draft was')
    expect(ratio).toBeGreaterThanOrEqual(0)
    expect(ratio).toBeLessThanOrEqual(1)
  })

  it('both empty → ratio 0 (clean denominator)', () => {
    expect(editRatio('', '')).toBe(0)
  })
})
