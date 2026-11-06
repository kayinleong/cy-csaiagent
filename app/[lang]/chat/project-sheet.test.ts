/**
 * app/[lang]/chat/project-sheet.test.ts — the client half of quick-kayinleong-103:
 * the nearby group heading, attaching project sheets to a details answer, the stream
 * metadata, and the WhatsApp share text. No jsdom in this repo, so the pure helpers carry
 * the logic and the source is read as text for the wiring checks.
 */

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { groupHeadingBefore } from './match-table'
import { projectSheetShareText } from './project-sheet'
import { attachProjectSheets, decodeFinderOutput } from './decode-structured-output'
import { parseMessageMetadata } from './decode-stream-chunk'
import type { ProjectSheet } from '@/src/agents/finder/schema'
import en from '@/src/i18n/messages/en.json'
import ms from '@/src/i18n/messages/ms.json'
import zh from '@/src/i18n/messages/zh.json'

const SHEET: ProjectSheet = {
  projectId: 'pid-1',
  name: 'Example Residensi',
  contacts: [{ role: 'pic', name: 'Alex' }],
  whatsappGroupUrl: 'https://chat.whatsapp.com/AbCdEfGhIjKlMnOpQrStUv',
  links: [
    { type: 'project-info', url: 'https://drive.google.com/drive/folders/p', group: 'project' },
    { type: 'reels', url: 'https://drive.google.com/drive/folders/r', group: 'marketing' },
  ],
}

describe('groupHeadingBefore — in-area rows, then "Other projects around <area>"', () => {
  const row = (locationMatch?: 'in_area' | 'nearby') => ({
    locationMatch,
    locationArea: locationMatch ? 'Damansara Heights' : undefined,
  })

  it('puts the nearby heading above the first nearby row, and the in-area heading on top', () => {
    const page = [row('in_area'), row('in_area'), row('nearby'), row('nearby')]
    expect(page.map((_, i) => groupHeadingBefore(page, i, true))).toEqual(['in_area', null, 'nearby', null])
  })

  it('repeats the nearby heading on a page that starts with nearby rows', () => {
    const page = [row('nearby'), row('nearby')]
    expect(page.map((_, i) => groupHeadingBefore(page, i, true))).toEqual(['nearby', null])
  })

  it('shows no in-area heading when every row is in the area', () => {
    const page = [row('in_area'), row('in_area')]
    expect(page.map((_, i) => groupHeadingBefore(page, i, false))).toEqual([null, null])
  })

  it('shows no heading at all without a location preference', () => {
    const page = [row(), row()]
    expect(page.map((_, i) => groupHeadingBefore(page, i, false))).toEqual([null, null])
  })
})

describe('attachProjectSheets', () => {
  const answer = decodeFinderOutput(JSON.stringify({ matches: [], answer: '### Example Residensi' }))!

  it('attaches the server sheets to a details answer', () => {
    expect(attachProjectSheets(answer, [SHEET]).projectSheets).toEqual([SHEET])
  })

  it('replaces whatever the model wrote, and drops a sheet with nothing to show', () => {
    const modelWrote = { ...answer, projectSheets: [{ ...SHEET, name: 'Invented' }] }
    const empty: ProjectSheet = { ...SHEET, projectId: 'pid-2', contacts: [], whatsappGroupUrl: null, links: [] }
    expect(attachProjectSheets(modelWrote, [SHEET, empty]).projectSheets).toEqual([SHEET])
  })

  it('leaves a shortlist, and a call without sheets, unchanged', () => {
    const shortlist = { ...answer, answer: undefined }
    expect(attachProjectSheets(shortlist, [SHEET])).toBe(shortlist)
    expect(attachProjectSheets(answer, undefined)).toBe(answer)
    expect(attachProjectSheets(answer, [])).toBe(answer)
  })

  it('a persisted answer with sheets decodes with them', () => {
    const persisted = JSON.stringify(attachProjectSheets(answer, [SHEET]))
    expect(decodeFinderOutput(persisted)?.projectSheets).toEqual([SHEET])
  })
})

describe('parseMessageMetadata: projectSheets', () => {
  const finish = (meta: Record<string, unknown>) =>
    JSON.stringify({ type: 'finish', messageMetadata: { pillar: 'finder', ...meta } })

  it('recovers the sheets and drops a malformed one item by item', () => {
    const bad = { ...SHEET, projectId: 'pid-bad', whatsappGroupUrl: 'javascript:alert(1)' }
    const meta = parseMessageMetadata(finish({ projectSheets: [SHEET, bad] }))
    expect(meta?.projectSheets).toEqual([SHEET])
  })
})

describe('projectSheetShareText — what "Copy to share" puts on the clipboard', () => {
  const labels = {
    projectLinks: 'Project links',
    marketingLinks: 'Marketing materials',
    link: (l: ProjectSheet['links'][number]) => (l.type === 'reels' ? 'Reels' : 'Project info'),
  }
  const ANSWER = [
    '### Example Residensi',
    '**Quick Facts:**',
    '- **Developer:** Example Sdn Bhd [KB:abc123]',
    '- **Land Tenure:** Freehold',
    '  - [Site plan](https://example.com/plan.pdf)',
  ].join('\n')

  it('formats the quick facts for WhatsApp and adds the project and marketing links', () => {
    expect(projectSheetShareText(ANSWER, [SHEET], labels)).toBe(
      [
        '*Example Residensi*',
        '*Quick Facts:*',
        '• *Developer:* Example Sdn Bhd',
        '• *Land Tenure:* Freehold',
        '  • Site plan: https://example.com/plan.pdf',
        '',
        '*Project links*',
        '• Project info: https://drive.google.com/drive/folders/p',
        '',
        '*Marketing materials*',
        '• Reels: https://drive.google.com/drive/folders/r',
      ].join('\n'),
    )
  })

  it('never copies the PIC, the WhatsApp group invite or a KB citation', () => {
    const text = projectSheetShareText(ANSWER, [SHEET], labels)
    expect(text).not.toContain('Alex')
    expect(text).not.toContain('chat.whatsapp.com')
    expect(text).not.toContain('KB:')
  })

  it('turns a table, a rule and a quote into plain WhatsApp lines', () => {
    const answer = [
      '**Built-Up Sizes & Layouts:**',
      '',
      '| Type | Size | Nett Price |',
      '|---|---|---|',
      '| **Type S1** | 904 sqft | RM1.2mil – RM1.35mil |',
      '',
      '---',
      '',
      '> **Sold-out layouts:** A1, A2',
    ].join('\n')
    expect(projectSheetShareText(answer, [], labels)).toBe(
      [
        '*Built-Up Sizes & Layouts:*',
        '',
        '• Type: Size | Nett Price',
        '• *Type S1*: 904 sqft | RM1.2mil – RM1.35mil',
        '',
        '*Sold-out layouts:* A1, A2',
      ].join('\n'),
    )
  })

  it('keeps the blank line before a heading', () => {
    expect(projectSheetShareText('Intro line\n\n### Facilities\n- Pool', [], labels)).toBe(
      'Intro line\n\n*Facilities*\n• Pool',
    )
  })

  it('names each project above its links when the answer covers several', () => {
    const other: ProjectSheet = { ...SHEET, projectId: 'pid-2', name: 'Other Place' }
    expect(projectSheetShareText('x', [SHEET, other], labels)).toContain('*Project links (Other Place)*')
  })
})

describe('project sheet wiring and copy', () => {
  const LIST = readFileSync(new URL('./match-list.tsx', import.meta.url), 'utf8')
  const SHEET_SRC = readFileSync(new URL('./project-sheet.tsx', import.meta.url), 'utf8')

  it('the answer branch renders the sheets', () => {
    expect(LIST).toContain('output.projectSheets')
    expect(LIST).toContain('<ProjectSheetContacts')
    expect(LIST).toContain('<ProjectSheetLinks')
    expect(LIST).toContain('<ProjectSheetShare')
  })

  it('external links open in a new tab without an opener', () => {
    const anchors = SHEET_SRC.match(/<a\b[\s\S]*?>/g) ?? []
    expect(anchors.length).toBeGreaterThanOrEqual(2)
    for (const a of anchors) expect(a).toContain('rel="noopener noreferrer"')
  })

  type Tree = { [k: string]: string | Tree }
  const keys = (t: Tree, prefix = ''): string[] =>
    Object.entries(t).flatMap(([k, v]) => (typeof v === 'string' ? [`${prefix}${k}`] : keys(v, `${prefix}${k}.`)))

  it('chat.projectSheet has the same keys in all three languages, none empty', () => {
    const enKeys = keys(en.chat.projectSheet as Tree).sort()
    expect(enKeys.length).toBeGreaterThan(10)
    for (const [lang, catalog] of Object.entries({ ms, zh })) {
      expect(keys(catalog.chat.projectSheet as Tree).sort(), lang).toEqual(enKeys)
    }
    for (const catalog of [en, ms, zh]) {
      for (const k of enKeys) {
        const v = k.split('.').reduce<unknown>((o, p) => (o as Tree)[p], catalog.chat.projectSheet)
        expect(typeof v === 'string' && v.length > 0, k).toBe(true)
      }
    }
  })

  it('every key the sheet component calls exists in en.json', () => {
    const calls = [...SHEET_SRC.matchAll(/\bt\('([^']+)'\)/g)].map((m) => m[1])
    expect(calls.length).toBeGreaterThan(5)
    for (const key of calls) {
      const v = key.split('.').reduce<unknown>((o, p) => (o as Tree | undefined)?.[p], en.chat.projectSheet)
      expect(typeof v, key).toBe('string')
    }
    for (const role of ['pic', 'leader', 'co_leader']) {
      expect(typeof (en.chat.projectSheet.roles as Tree)[role]).toBe('string')
    }
  })
})
