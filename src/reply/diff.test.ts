/**
 * src/reply/diff.test.ts — RED tests for editRatio (REPLY-09, Wave 0).
 *
 * The Reply edit-as-signal capture (D-18/D-20) needs a numeric `editRatio`
 * (normalized char-level edit distance) — NOT a diff library (none is installed;
 * RESEARCH §Standard Stack). Plan 04-07 adds the ~15-line core util `src/reply/diff.ts`
 * exporting `editRatio(original: string, edited: string): number` in [0,1].
 *
 * These are RED today: `@/src/reply/diff` does not exist yet. Each test dynamically
 * imports the module inside an `it.fails` block so the module-not-found failure
 * keeps the offline suite GREEN (exit 0) while documenting the contract. When 04-07
 * lands the util, the imports resolve, the assertions pass, and `it.fails` flips to
 * a failure — the implementer then removes `.fails`.
 *
 * Core/shell rule: this file must NOT import from app/ or next (REPLY util is portable).
 */

import { describe, it, expect } from 'vitest'

describe('editRatio (REPLY-09) — RED until Plan 04-07 adds src/reply/diff.ts', () => {
  it.fails('identical strings → ratio 0 (no edit)', async () => {
    // @ts-expect-error - module created in Plan 04-07 (Wave 4); import resolves then
    const { editRatio } = await import('@/src/reply/diff')
    const s = 'Hi, thanks for reaching out — happy to help with the Cheras unit.'
    expect(editRatio(s, s)).toBe(0)
  })

  it.fails('complete rewrite → ratio near 1', async () => {
    // @ts-expect-error - module created in Plan 04-07 (Wave 4); import resolves then
    const { editRatio } = await import('@/src/reply/diff')
    const original = 'aaaaaaaaaaaaaaaaaaaa'
    const edited = 'zzzzzzzzzzzzzzzzzzzz'
    const ratio = editRatio(original, edited)
    expect(ratio).toBeGreaterThan(0.9)
    expect(ratio).toBeLessThanOrEqual(1)
  })

  it.fails('a small edit → a small ratio in (0,1)', async () => {
    // @ts-expect-error - module created in Plan 04-07 (Wave 4); import resolves then
    const { editRatio } = await import('@/src/reply/diff')
    const original = 'Thanks for your message, I will get back to you shortly.'
    const edited = 'Thanks for your message, I will get back to you soon.'
    const ratio = editRatio(original, edited)
    expect(ratio).toBeGreaterThan(0)
    expect(ratio).toBeLessThan(0.5)
  })

  it.fails('ratio is always within [0,1] (normalized)', async () => {
    // @ts-expect-error - module created in Plan 04-07 (Wave 4); import resolves then
    const { editRatio } = await import('@/src/reply/diff')
    const ratio = editRatio('short', 'a much much longer edited reply than the original draft was')
    expect(ratio).toBeGreaterThanOrEqual(0)
    expect(ratio).toBeLessThanOrEqual(1)
  })
})
