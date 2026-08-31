/**
 * dialog-mobile-width.test.ts — every <DialogContent> stays on-screen and centred on a phone
 * (quick-kayinleong-084).
 *
 * The AI disclosure modal passed `className="max-w-sm mx-4"` and was the element in four
 * consecutive "mobile UI is not responsive" screenshots. Both halves were wrong:
 *
 *   - `mx-4` adds margin-left to an element centred with `left-1/2 -translate-x-1/2`. There
 *     is no margin-right to balance it (the right edge is not laid out against anything), so
 *     the dialog sits 2rem right of centre. Measured at 440x956: 44px left gutter, 12px right.
 *   - `max-w-sm` UNPREFIXED replaces the base `max-w-[calc(100%-2rem)]` at every width, not
 *     just from sm up, so the mobile gutter rule was gone.
 *
 * The vendored components/ui/dialog.tsx already gets this right:
 *   `w-full max-w-[calc(100%-2rem)] ... sm:max-w-sm`
 * i.e. 16px gutters below sm, a fixed cap from sm up. A caller that wants a different
 * DESKTOP cap must therefore say `sm:max-w-lg`, never bare `max-w-lg`.
 *
 * This is a source assertion, which is honest for CSS — for a utility class, its presence IS
 * the behaviour. It scans every call site rather than the one that broke, because the same
 * mistake was sitting in three other dialogs at the time.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'

const ROOT = join(import.meta.dirname, '..')

/** Every .tsx under app/ that renders a DialogContent. */
function callSites(): string[] {
  const out = execFileSync(
    'grep',
    ['-rl', '--include=*.tsx', '<DialogContent', 'app'],
    { cwd: ROOT, encoding: 'utf8' },
  )
  return out.split('\n').filter(Boolean)
}

/** The className string of each <DialogContent> in a file, in source order. */
function dialogClassNames(source: string): string[] {
  const found: string[] = []
  // Match the opening tag up to its `>`, then pull className out of it. DialogContent is
  // sometimes written multi-line with other props, so this cannot be a single flat regex.
  for (const tag of source.match(/<DialogContent[\s\S]*?>/g) ?? []) {
    const cls = tag.match(/className="([^"]*)"/)
    if (cls) found.push(cls[1])
  }
  return found
}

describe('DialogContent width overrides', () => {
  const files = callSites()

  it('finds the call sites at all', () => {
    // If grep stops matching, every assertion below passes vacuously.
    expect(files.length).toBeGreaterThan(0)
    expect(files).toContain('app/[lang]/chat/disclosure-modal.tsx')
  })

  it('never uses a horizontal margin on a translate-centred dialog', () => {
    const offenders: string[] = []
    for (const file of files) {
      for (const cls of dialogClassNames(readFileSync(join(ROOT, file), 'utf8'))) {
        // mx-*, ml-*, mr-* — any of the three unbalances left-1/2 -translate-x-1/2.
        if (/(^|\s)(?:sm:|md:|lg:|min-\[\d+px\]:)?m[xlr]-\S+/.test(cls)) {
          offenders.push(`${file}: "${cls}"`)
        }
      }
    }
    expect(offenders).toEqual([])
  })

  it('prefixes every max-width override with a breakpoint', () => {
    const offenders: string[] = []
    for (const file of files) {
      for (const cls of dialogClassNames(readFileSync(join(ROOT, file), 'utf8'))) {
        for (const token of cls.split(/\s+/)) {
          // A bare `max-w-*` beats the base mobile gutter rule at ALL widths. Only a
          // breakpoint-prefixed one (`sm:max-w-lg`) leaves the phone case alone.
          if (/^max-w-/.test(token)) offenders.push(`${file}: "${token}"`)
        }
      }
    }
    expect(offenders).toEqual([])
  })
})

describe('the vendored dialog still supplies the mobile default', () => {
  // Every assertion above assumes the base handles phones. If someone edits the vendored
  // component and drops that, the guards above become meaningless rather than failing.
  const BASE = readFileSync(join(ROOT, 'components/ui/dialog.tsx'), 'utf8')

  it('caps width against the viewport below sm', () => {
    expect(BASE).toContain('max-w-[calc(100%-2rem)]')
  })

  it('still applies a fixed cap from sm up', () => {
    expect(BASE).toMatch(/sm:max-w-/)
  })
})
