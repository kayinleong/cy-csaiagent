/**
 * match-summaries.test.ts — the project summaries under the Finder table
 * (quick-kayinleong-106): attaching the server's layouts, the stream metadata, the
 * formatters, the i18n keys, and a real render of the component to static HTML.
 *
 * Run: npx vitest run "app/[lang]/chat/match-summaries.test.ts"
 */

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { NextIntlClientProvider } from 'next-intl'
import {
  MatchSummaries,
  buildSummaryEntries,
  compactRM,
  DETAIL_ITEM_KEYS,
  formatLayoutLine,
  formatRMRange,
} from './match-summaries'
import { attachSummaries, decodeFinderOutput } from './decode-structured-output'
import { parseMessageMetadata } from './decode-stream-chunk'
import {
  FinderMatchSchema,
  MatchSummarySchema,
  type FinderMatch,
  type FinderRow,
  type MatchSummary,
  type SummaryLayoutRow,
} from '@/src/agents/finder/schema'
import en from '@/src/i18n/messages/en.json'
import ms from '@/src/i18n/messages/ms.json'
import zh from '@/src/i18n/messages/zh.json'

const LABELS = { sqft: 'sqft', bed: 'bed', nett: 'Nett', gross: 'Gross' }

function layout(over: Partial<SummaryLayoutRow> = {}): SummaryLayoutRow {
  return {
    label: 'Type A',
    sizeSqft: 1_076,
    bedrooms: 2,
    priceMinRM: 1_200_000,
    priceMaxRM: 1_350_000,
    grossMinRM: 1_400_000,
    grossMaxRM: 1_500_000,
    soldOut: false,
    ...over,
  }
}

function match(projectId: string, over: Partial<FinderMatch> = {}): FinderMatch {
  return FinderMatchSchema.parse({
    projectId,
    name: projectId,
    rationale: 'ok',
    ...over,
  })
}

function row(projectId: string, over: Partial<FinderRow> = {}): FinderRow {
  return {
    projectId,
    name: `Name ${projectId}`,
    priceValue: 1_000_000,
    bedrooms: 2,
    tenure: 'Freehold',
    locationText: 'KL',
    vpStatus: false,
    bumiQuota: false,
    foreignEligible: true,
    sizeMinSqft: 900,
    sizeMaxSqft: 1_200,
    score: 0.5,
    ...over,
  }
}

// ─── schema ───────────────────────────────────────────────────────────────────

describe('FinderMatchSchema: bestFor / sellingPoints', () => {
  it('a match without either still decodes', () => {
    const m = FinderMatchSchema.parse({ projectId: 'p', rationale: 'r' })
    expect(m.bestFor).toBeUndefined()
    expect(m.sellingPoints).toBeUndefined()
  })

  it('an over-long or non-string value never deletes the match', () => {
    const long = FinderMatchSchema.parse({
      projectId: 'p',
      rationale: 'r',
      bestFor: 'x'.repeat(300),
      sellingPoints: 'y'.repeat(900),
    })
    expect(long.bestFor).toHaveLength(140)
    expect(long.bestFor?.endsWith('…')).toBe(true)
    expect(long.sellingPoints).toHaveLength(260)
    const bad = FinderMatchSchema.safeParse({ projectId: 'p', rationale: 'r', bestFor: ['a'], sellingPoints: 7 })
    expect(bad.success).toBe(true)
    expect(bad.success && bad.data.bestFor).toBeUndefined()
  })

  it('an over-long line is cut at a word boundary, never mid-word', () => {
    const text = 'Buyers or investors wanting an immediately liveable luxury freehold unit with hotel-integrated lifestyle and direct access to the mall and the offices'
    const m = FinderMatchSchema.parse({ projectId: 'p', rationale: 'r', bestFor: text })
    expect(m.bestFor!.length).toBeLessThanOrEqual(140)
    expect(m.bestFor).toMatch(/ the…$|[a-z]…$/)
    expect(text.startsWith(m.bestFor!.slice(0, -1))).toBe(true)
    expect(text.split(' ')).toContain(m.bestFor!.slice(0, -1).split(' ').at(-1))
    // Short lines are only trimmed.
    expect(FinderMatchSchema.parse({ projectId: 'p', rationale: 'r', bestFor: '  Families  ' }).bestFor).toBe('Families')
  })

  it('decodeFinderOutput keeps a match that has no bestFor', () => {
    const out = decodeFinderOutput(
      JSON.stringify({ matches: [{ projectId: 'p1', rationale: 'r', bestFor: 'Modern prestige' }, { projectId: 'p2', rationale: 'r' }] }),
    )
    expect(out?.matches.map((m) => m.projectId)).toEqual(['p1', 'p2'])
    expect(out?.matches[0].bestFor).toBe('Modern prestige')
  })
})

// ─── attachSummaries ──────────────────────────────────────────────────────────

describe('attachSummaries', () => {
  const output = (matchIds: string[], summaries?: MatchSummary[]) =>
    ({
      matches: matchIds.map((id) => match(id)),
      rows: [],
      ...(summaries ? { summaries } : {}),
    }) as unknown as import('@/src/agents/finder/schema').FinderOutput

  const server: MatchSummary[] = [
    { projectId: 'a', layouts: [layout()], sections: [] },
    { projectId: 'z', layouts: [layout()], sections: [] },
  ]

  it('replaces whatever the model wrote (server truth wins)', () => {
    const modelWrote = output(['a'], [{ projectId: 'a', layouts: [layout({ label: 'MODEL INVENTED' })], sections: [] }])
    expect(attachSummaries(modelWrote, server).summaries?.[0].layouts[0].label).toBe('Type A')
  })

  it('keeps every server summary, also for a top row the model left out of matches', () => {
    const ids = attachSummaries(output(['a']), server).summaries?.map((s) => s.projectId)
    expect(ids).toEqual(server.filter((x) => x.layouts.length > 0).map((x) => x.projectId))
  })

  it('is a no-op when the list is empty or undefined', () => {
    const o = output(['a'])
    expect(attachSummaries(o, [])).toBe(o)
    expect(attachSummaries(o, undefined)).toBe(o)
  })

  it('is a no-op for an answer with no matches', () => {
    const o = output([])
    expect(attachSummaries(o, server)).toBe(o)
  })
})

describe('parseMessageMetadata: summaries', () => {
  it('reads summaries, dropping a malformed entry only', () => {
    const line = JSON.stringify({
      type: 'finish',
      messageMetadata: {
        summaries: [{ projectId: 'a', layouts: [layout()], sections: [] }, { nope: true }],
      },
    })
    const meta = parseMessageMetadata(line)
    expect(meta?.summaries).toHaveLength(1)
    expect(meta?.summaries?.[0].projectId).toBe('a')
  })

  it('yields no summaries key when none are sent', () => {
    expect(parseMessageMetadata('{"type":"start","messageMetadata":{"pillar":"finder"}}')?.summaries).toBeUndefined()
  })
})

// ─── formatters ───────────────────────────────────────────────────────────────

describe('RM formatters', () => {
  it('never prints RM 0 or a figure for a missing price', () => {
    for (const bad of [0, -5, null, undefined, Number.NaN]) {
      expect(compactRM(bad as number)).toBeNull()
    }
    expect(formatRMRange(0, 0)).toBeNull()
    expect(formatRMRange(null, null)).toBeNull()
  })

  it('formats compact figures and ranges', () => {
    expect(compactRM(850_000)).toBe('RM850k')
    expect(compactRM(1_200_000)).toBe('RM1.2m')
    expect(compactRM(1_350_000)).toBe('RM1.35m')
    expect(formatRMRange(1_200_000, 1_350_000)).toBe('RM1.2m–1.35m')
    expect(formatRMRange(1_350_000, 1_200_000)).toBe('RM1.2m–1.35m')
    expect(formatRMRange(1_200_000, 1_200_000)).toBe('RM1.2m')
    expect(formatRMRange(0, 900_000)).toBe('RM900k')
  })
})

describe('formatLayoutLine', () => {
  it('builds the label · size · beds · Nett · Gross line', () => {
    expect(formatLayoutLine(layout(), LABELS)).toBe(
      'Type A · 1,076 sqft · 2 bed · Nett RM1.2m–1.35m · Gross RM1.4m–1.5m',
    )
  })

  it('leaves out gross when not on file, and everything unstated', () => {
    expect(formatLayoutLine(layout({ grossMinRM: null, grossMaxRM: null }), LABELS)).toBe(
      'Type A · 1,076 sqft · 2 bed · Nett RM1.2m–1.35m',
    )
    expect(
      formatLayoutLine(layout({ sizeSqft: null, bedrooms: 0, priceMinRM: 0, priceMaxRM: null, grossMinRM: null, grossMaxRM: null }), LABELS),
    ).toBe('Type A')
  })

  it('a sold-out layout carries no price even if its data did', () => {
    const line = formatLayoutLine(layout({ soldOut: true }), LABELS)
    expect(line).not.toMatch(/RM|Nett|Gross/)
  })
})

describe('buildSummaryEntries', () => {
  it('follows the table row order and drops empty entries', () => {
    const rows = [row('c'), row('a'), row('b'), row('x')]
    const matches = [match('a', { bestFor: 'Families' }), match('b'), match('c', { sellingPoints: 'Freehold' })]
    const entries = buildSummaryEntries(rows, matches, [{ projectId: 'b', layouts: [layout()], sections: [] }], LABELS)
    expect(entries.map((e) => e.projectId)).toEqual(['c', 'a', 'b'])
    expect(buildSummaryEntries([row('b')], [match('b')], [], LABELS)).toEqual([])
  })

  it('a top row the model left out of matches still shows its layouts, with no prose lines', () => {
    const [e] = buildSummaryEntries([row('x')], [match('a', { bestFor: 'Families' })], [{ projectId: 'x', layouts: [layout()], sections: [] }], LABELS)
    expect(e.projectId).toBe('x')
    expect(e.layoutLines).toHaveLength(1)
    expect(e.bestFor).toBe('')
    expect(e.sellingPoints).toBe('')
  })

  it('groups sold-out layouts by name, with no price', () => {
    const [e] = buildSummaryEntries(
      [row('a')],
      [match('a')],
      [{ projectId: 'a', layouts: [layout(), layout({ label: 'Type C', soldOut: true, priceMinRM: null, priceMaxRM: null })], sections: [] }],
      LABELS,
    )
    expect(e.layoutLines).toHaveLength(1)
    expect(e.soldOut).toEqual(['Type C'])
  })
})

// ─── i18n ─────────────────────────────────────────────────────────────────────

describe('match-summaries i18n', () => {
  const SRC = readFileSync(new URL('./match-summaries.tsx', import.meta.url), 'utf8')
  const keys = [...SRC.matchAll(/\bt\('([^']+)'/g)].map((m) => m[1])
  const resolve = (c: unknown, path: string) =>
    path.split('.').reduce<unknown>((a, p) => (a as Record<string, unknown> | undefined)?.[p], c)

  it('the component declares the namespace it reads and calls keys at all', () => {
    expect(SRC).toContain("useTranslations('chat.matchTable')")
    expect(keys.length).toBeGreaterThanOrEqual(10)
  })

  for (const [lang, catalog] of Object.entries({ en, ms, zh })) {
    it(`every key resolves in ${lang}.json`, () => {
      for (const key of [...keys, 'summaryTitle', 'bestFor', 'layouts', 'sellingPoints', 'soldOut', 'sqft', 'bed', 'nett', 'gross']) {
        const v = resolve(catalog, `chat.matchTable.${key}`)
        expect(typeof v, `${lang}: ${key}`).toBe('string')
        expect((v as string).length, `${lang}: ${key}`).toBeGreaterThan(0)
      }
    })
  }

  for (const [lang, catalog] of Object.entries({ en, ms, zh })) {
    it(`every details key (fixed titles and item keys) resolves in ${lang}.json`, () => {
      for (const key of [
        'fullDetails', 'hide', 'show', 'quickFacts', 'layouts', 'pricesFees', 'topReasons', 'focusLists',
        ...DETAIL_ITEM_KEYS,
      ]) {
        const v = resolve(catalog, `chat.matchTable.details.${key}`)
        expect(typeof v, `${lang}: details.${key}`).toBe('string')
        expect((v as string).length, `${lang}: details.${key}`).toBeGreaterThan(0)
      }
    })
  }

  it('is rendered right after the table in match-list', () => {
    const LIST = readFileSync(new URL('./match-list.tsx', import.meta.url), 'utf8')
    expect(LIST.indexOf('<MatchTable')).toBeGreaterThan(-1)
    expect(LIST.indexOf('<MatchSummaries')).toBeGreaterThan(LIST.indexOf('<MatchTable'))
  })

  it('renders plain text only', () => {
    expect(SRC).not.toContain('dangerouslySetInnerHTML')
    expect(SRC).not.toMatch(/MarkdownMessage/)
  })
})

// ─── real render ──────────────────────────────────────────────────────────────

describe('MatchList: matches with a stray answer note (quick-kayinleong-107)', () => {
  it('keeps the table and the details, with the note above them', async () => {
    const { MatchList } = await import('./match-list')
    const output = {
      matches: [match('a', { bestFor: 'Modern prestige' })],
      rows: [row('a', { name: 'Pavilion Damansara Heights' })],
      answer: 'Here are the top matches. Nationality not confirmed.',
      summaries: [{ projectId: 'a', layouts: [layout()], sections: [] }],
    } as unknown as import('@/src/agents/finder/schema').FinderOutput
    const html = renderToStaticMarkup(
      createElement(NextIntlClientProvider, { locale: 'en', messages: en as never } as never, createElement(MatchList, { output })),
    )
    expect(html).toContain('data-state="matches"')
    expect(html).toContain('Nationality not confirmed')
    expect(html).toContain('Modern prestige')
    expect(html.indexOf('Nationality not confirmed')).toBeLessThan(html.indexOf('Modern prestige'))
  })

  it('an answer with no matches still renders as the conversational answer', async () => {
    const { MatchList } = await import('./match-list')
    const output = { matches: [], rows: [], answer: 'Tenure is freehold.' } as unknown as import('@/src/agents/finder/schema').FinderOutput
    const html = renderToStaticMarkup(
      createElement(NextIntlClientProvider, { locale: 'en', messages: en as never } as never, createElement(MatchList, { output })),
    )
    expect(html).toContain('data-state="answer"')
  })
})

function render(props: Parameters<typeof MatchSummaries>[0]): string {
  return renderToStaticMarkup(
    createElement(
      NextIntlClientProvider,
      { locale: 'en', messages: en as never } as never,
      createElement(MatchSummaries, props),
    ),
  )
}

describe('MatchSummaries render', () => {
  const rows = [
    row('a', { name: 'Pavilion Damansara Heights', locationMatch: 'in_area', locationArea: 'Damansara Heights' }),
    row('b', { name: 'Bangsar Peak', locationMatch: 'nearby', locationArea: 'Damansara Heights' }),
    row('c', { name: 'Empty One', locationMatch: 'nearby', locationArea: 'Damansara Heights' }),
  ]
  const matches = [
    match('a', { bestFor: 'Modern prestige', sellingPoints: 'Freehold with a link-bridge to the mall.' }),
    match('b', { bestFor: 'Urban living' }),
    match('c'),
  ]
  const summaries: MatchSummary[] = [
    {
      projectId: 'a',
      layouts: [
        layout(),
        layout({ label: 'Type B', sizeSqft: 1_400, bedrooms: 3, priceMinRM: 1_800_000, priceMaxRM: 1_900_000, grossMinRM: null, grossMaxRM: null }),
        layout({ label: 'Type C', soldOut: true, priceMinRM: null, priceMaxRM: null, grossMinRM: null, grossMaxRM: null }),
        layout({ label: 'Type D', soldOut: true, priceMinRM: null, priceMaxRM: null, grossMinRM: null, grossMaxRM: null }),
      ],
      sections: [
        { kind: 'quickFacts', items: [{ key: 'developer', value: 'Sunway Berhad' }, { label: 'Location', value: 'Jalan Test' }] },
        { kind: 'pricesFees', items: [{ key: 'fromPrice', value: 'RM 1,200,000' }, { key: 'maintenanceFee', value: '39 sen psf' }] },
        { kind: 'other', title: 'Facilities', items: [{ value: 'Swimming pool' }, { label: 'Gym', value: '24 hours' }] },
        { kind: 'other', title: 'Furnishing & Finishes', items: [{ value: 'Full air-conditioning' }] },
        { kind: 'topReasons', items: [{ value: 'Walk to the LRT' }] },
        { kind: 'focusLists', items: [{ value: 'Bangsar picks' }] },
      ],
    },
  ]
  const html = render({ rows, matches, summaries })

  it('renders numbered entries in rank order under the area headings', () => {
    expect(html).toContain('1. Pavilion Damansara Heights')
    expect(html).toContain('2. Bangsar Peak')
    expect(html.indexOf('In Damansara Heights')).toBeGreaterThan(-1)
    expect(html.indexOf('Other projects around Damansara Heights')).toBeGreaterThan(html.indexOf('1. Pavilion'))
    expect(html.indexOf('Other projects around Damansara Heights')).toBeLessThan(html.indexOf('2. Bangsar'))
    expect(html).toContain('Project summaries')
  })

  it('renders the three fields and the layout lines', () => {
    expect(html).toContain('Best for:')
    expect(html).toContain('Modern prestige')
    expect(html).toContain('Built-Up Sizes &amp; Layouts')
    expect(html).toContain('Type A · 1,076 sqft · 2 bed · Nett RM1.2m–1.35m · Gross RM1.4m–1.5m')
    expect(html).toContain('Type B · 1,400 sqft · 3 bed · Nett RM1.8m–1.9m')
    expect(html).toContain('Key selling points:')
    expect(html).toContain('Freehold with a link-bridge to the mall.')
  })

  it('names sold-out layouts in one line and never prices them', () => {
    expect(html).toContain('Sold out: Type C, Type D')
    expect(html).not.toMatch(/Type C[^<]*RM/)
    expect(html).not.toMatch(/Type D[^<]*RM/)
    expect(html).not.toContain('RM0')
    expect(html).not.toContain('RM 0')
  })

  it('has a Details button per entry and no entry for an empty summary', () => {
    expect(html.match(/data-slot="match-summary"/g)).toHaveLength(2)
    expect(html).not.toContain('Empty One')
    expect(html.match(/>Details</g)).toHaveLength(2)
  })

  it('renders the full details in order, open by default, with a real toggle', () => {
    const order = [
      'Best for:',
      'Key selling points:',
      'Full details',
      'Quick Facts',
      'Developer:',
      'Built-Up Sizes &amp; Layouts',
      'Prices &amp; Fees',
      'From price:',
      'Maintenance fee:',
      'Facilities',
      'Furnishing &amp; Finishes',
      'Top Reasons Why',
      'D2 focus lists',
    ].map((k) => html.indexOf(k))
    expect(order.every((i) => i > -1)).toBe(true)
    expect([...order].sort((a, b) => a - b)).toEqual(order)
    expect(html).toContain('Location:')
    expect(html).toContain('Swimming pool')
    expect(html).toMatch(/<button[^>]*aria-expanded="true"[^>]*>Hide</)
    expect(html).toContain('Nett RM1.2m')
  })

  it('an entry with only detail sections is still rendered', () => {
    const out = render({
      rows: [row('q')],
      matches: [],
      summaries: [{ projectId: 'q', layouts: [], sections: [{ kind: 'quickFacts', items: [{ key: 'tenure', value: 'Freehold' }] }] }],
    })
    expect(out).toContain('Tenure:')
    expect(out).toContain('Freehold')
  })

  it('an older summary without sections decodes to [], and the bounds hold', () => {
    const old = MatchSummarySchema.parse({ projectId: 'a', layouts: [layout()] })
    expect(old.sections).toEqual([])
    const tooMany = Array.from({ length: 15 }, () => ({ kind: 'other', items: [] }))
    expect(MatchSummarySchema.safeParse({ projectId: 'a', sections: tooMany }).success).toBe(false)
    expect(MatchSummarySchema.safeParse({ projectId: 'a', sections: [{ kind: 'bogus', items: [] }] }).success).toBe(false)
    expect(MatchSummarySchema.safeParse({ projectId: 'a', layouts: Array.from({ length: 41 }, () => layout()) }).success).toBe(false)
    expect(MatchSummarySchema.safeParse({ projectId: 'a', layouts: Array.from({ length: 40 }, () => layout()) }).success).toBe(true)
  })

  it('renders nothing at all when no entry has anything to show', () => {
    expect(render({ rows, matches: [match('a'), match('b'), match('c')], summaries: [] })).toBe('')
  })

  it('escapes model text rather than rendering it as HTML', () => {
    const out = render({
      rows: [row('a')],
      matches: [match('a', { bestFor: '<img src=x onerror=alert(1)>' })],
    })
    expect(out).not.toContain('<img')
    expect(out).toContain('&lt;img')
  })
})

describe('wiring', () => {
  const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8')

  it('the route persists and streams summaries, and the client merges them', () => {
    const route = readFileSync(new URL('../../api/chat/route.ts', import.meta.url), 'utf8')
    expect(route).toContain('attachSummaries(')
    expect(route).toMatch(/summaries:\s*\n\s*pillar === 'finder'/)
    const input = read('./chat-input.tsx')
    expect(input).toContain('serverSummaries')
    expect(input).toContain('attachSummaries(')
  })
})
