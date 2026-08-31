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
  it('gives the pillar strip its own row only on genuinely narrow screens', () => {
    expect(HEADER).toContain('order-last flex min-w-0 basis-full justify-center')
  })

  it('gates the wrap at 400px, NOT at sm', () => {
    // The bug this pins. quick-082 gated on `sm`, and Tailwind's `sm` is 640px — so a 440px
    // iPhone 16 Pro Max got a two-row header despite fitting one comfortably. Measured after
    // the fix: 399px -> two rows, 400px -> one row, 56px tall, no overflow.
    expect(HEADER).toContain('min-[400px]:flex-nowrap')
    expect(HEADER).toContain('min-[400px]:order-none min-[400px]:basis-0 min-[400px]:flex-1')
    expect(HEADER).toContain('min-[400px]:flex-none')
  })

  it('does not gate the wrap on sm anywhere', () => {
    // A stray sm:-gated wrap rule would reintroduce the 440px regression.
    expect(HEADER).not.toContain('sm:flex-nowrap')
    expect(HEADER).not.toContain('sm:basis-0')
  })

  it('lets the header grow when it wraps', () => {
    // A fixed h-14 would clip the second row rather than making room for it.
    expect(HEADER).toContain('min-h-14')
    expect(HEADER).toContain('flex-wrap')
    expect(HEADER).toContain('min-[400px]:h-14')
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
