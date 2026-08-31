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
  it('left-aligns the pillar tabs on mobile instead of centring them', () => {
    // `justify-center` on a container that is ALSO `overflow-x-auto` clips both ends once
    // the content overflows. At 375px the tabs read "ach … Find" — Auto and Reply gone.
    expect(HEADER).toContain('justify-start overflow-x-auto sm:justify-center')
  })

  it('lets the tab strip shrink so a scroll box can form', () => {
    // Without min-w-0 the flex item refuses to shrink below its content and overflows the
    // header instead of scrolling inside it.
    expect(HEADER).toMatch(/min-w-0 flex-1 justify-start/)
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
