/**
 * sanitize-markdown.test.ts — the dangling-link guardrail (quick-kayinleong-056).
 *
 * The reported screenshot showed `[End Financier Info](https://firebasestorage…` printed
 * as source text because the turn was cut off before the closing paren. These pin that it
 * degrades to the label, and — just as importantly — that a well-formed message is
 * returned untouched.
 */

import { describe, it, expect } from 'vitest'
import { sanitizeMarkdown } from './sanitize-markdown'

describe('sanitizeMarkdown', () => {
  it('reduces a never-closed link to its label', () => {
    expect(
      sanitizeMarkdown('3. [End Financier Info](https://firebasestorage.googleapis.com/v0/b/x?token=3678'),
    ).toBe('3. End Financier Info')
  })

  it('does NOT close it with a paren — a severed URL must not become a live link', () => {
    const out = sanitizeMarkdown('[Brochure](https://x/b.pdf?token=abc')
    expect(out).not.toContain('https://')
    expect(out).toBe('Brochure')
  })

  it('leaves complete links alone', () => {
    const md = '1. [Carpark Plan](https://x/a.pdf)\n2. [Sales Kit](https://x/b.pdf)'
    expect(sanitizeMarkdown(md)).toBe(md)
  })

  it('keeps earlier complete links when only the last one is broken', () => {
    expect(
      sanitizeMarkdown('1. [Carpark Plan](https://x/a.pdf)\n2. [Sales Kit](https://x/b'),
    ).toBe('1. [Carpark Plan](https://x/a.pdf)\n2. Sales Kit')
  })

  it('handles a dangling image the same way', () => {
    expect(sanitizeMarkdown('![floor plan](https://x/p.png')).toBe('floor plan')
  })

  it('passes ordinary prose straight through', () => {
    expect(sanitizeMarkdown('Confirmed 2-bedroom, priced at RM900,000.')).toBe(
      'Confirmed 2-bedroom, priced at RM900,000.',
    )
    expect(sanitizeMarkdown('')).toBe('')
  })

  it('does not touch a bare parenthesis or a bare URL', () => {
    expect(sanitizeMarkdown('VP not yet completed (Q3 2027).')).toBe(
      'VP not yet completed (Q3 2027).',
    )
    expect(sanitizeMarkdown('See https://x/a.pdf for details')).toBe(
      'See https://x/a.pdf for details',
    )
  })

  it('does not mangle a markdown table row containing brackets', () => {
    const md = '| Field | Info |\n| --- | --- |\n| Tenure | Leasehold 2119 |'
    expect(sanitizeMarkdown(md)).toBe(md)
  })
})
