/**
 * mobile-layout.test.ts — the two non-obvious mobile fixes (quick-kayinleong-081).
 *
 * Both were found by driving a real 375x812 viewport, and both are the kind of class that
 * looks removable during a tidy-up. These are source assertions, which is honest for CSS —
 * for a utility class, being present IS the behaviour. They exist to carry the REASON, so
 * the next person does not delete them and re-break the layout.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const HEADER = readFileSync(new URL('./chat-header.tsx', import.meta.url), 'utf8')
const LIST = readFileSync(new URL('./conversation-list.tsx', import.meta.url), 'utf8')

describe('chat header at 375px', () => {
  it('gives the pillar strip its own full-width row on mobile', () => {
    // quick-081 left-aligned the overflow, which fixed 375px and still clipped at 320px
    // ("Finde", Reply off-screen). Trading header items against tab width only ever buys one
    // breakpoint. `basis-full` + `order-last` wraps the strip onto its own row instead, so it
    // fits at ANY width — verified at 320 and 375.
    expect(HEADER).toContain('order-last flex min-w-0 basis-full justify-center')
  })

  it('restores the single centred row from sm upwards', () => {
    // Desktop must be untouched: sm:basis-0 + sm:flex-1 is the original flex-1 behaviour.
    expect(HEADER).toContain('sm:order-none sm:basis-0 sm:flex-1 sm:justify-center')
  })

  it('lets the header wrap, and grow, only below sm', () => {
    // A fixed h-14 would clip the second row rather than making room for it.
    expect(HEADER).toContain('min-h-14')
    expect(HEADER).toContain('flex-wrap')
    expect(HEADER).toContain('sm:h-14')
    expect(HEADER).toContain('sm:flex-nowrap')
  })

  it('lets the left group fill row 1 so the right group sits at the edge', () => {
    expect(HEADER).toContain('flex min-w-0 flex-1 items-center gap-2 sm:flex-none')
  })

  it('makes "Talk to my coach" icon-only on mobile', () => {
    // ~135px of a 375px header, taken from the primary control.
    expect(HEADER).toContain('sm:h-8 sm:w-auto sm:px-3')
    expect(HEADER).toMatch(/<span className="hidden sm:inline">\{t\('talkToCoach'\)\}<\/span>/)
    // Icon-only still has to be announced.
    expect(HEADER).toMatch(/aria-label=\{t\('talkToCoach'\)\}/)
  })

  it('keeps the AI badge on mobile — CHAT-05 requires it to be persistent', () => {
    // The decorative logo was the thing dropped to make room, not the disclosure.
    expect(HEADER).toContain("t('aiBadge')")
    expect(HEADER).not.toMatch(/hidden[^"']*sm:(flex|block)[^"']*"[^>]*>\s*\{t\('aiBadge'\)/)
  })
})

describe('conversation history drawer at 375px', () => {
  it('forces the Radix ScrollArea viewport wrapper to block', () => {
    // Radix renders `<div style="min-width:100%;display:table">` inside its Viewport. A
    // table box sizes to CONTENT, so `w-full` on the row resolved against the widest title,
    // `truncate` never engaged, and titles ran past the sheet edge with no ellipsis.
    expect(LIST).toContain('[&>[data-radix-scroll-area-viewport]>div]:!block')
  })

  it('still asks the row title to truncate', () => {
    // The override above is only half of it — without `truncate` there is no ellipsis.
    expect(LIST).toMatch(/text-sm font-medium truncate/)
  })

  it('caps the sheet against the viewport on small screens', () => {
    // w-80 is 320px; on a 360px phone that leaves 40px of scrim to tap out of.
    expect(LIST).toContain('w-[85vw] max-w-80 sm:w-80')
  })
})
