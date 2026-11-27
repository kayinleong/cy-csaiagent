/**
 * finder-alternatives.test.ts — the chat half of quick-kayinleong-110: alternative groups,
 * the +N% badge, the "No exact match" refusal, the closing summary block, the summary
 * coercion in the decoder, and i18n parity for the new keys.
 *
 * Real renders through react-dom/server (no jsdom in this repo), like match-summaries.test.ts.
 */

import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { NextIntlClientProvider } from 'next-intl'
import { MatchList } from './match-list'
import { FinderSummary, summaryLines } from './finder-summary'
import {
  attachSummaries,
  decodeFinderOutput,
  normalizeFinderShape,
} from './decode-structured-output'
import { FinderOutputSchema, type FinderOutput, type FinderRow } from '@/src/agents/finder/schema'
import en from '@/src/i18n/messages/en.json'
import ms from '@/src/i18n/messages/ms.json'
import zh from '@/src/i18n/messages/zh.json'

function row(projectId: string, over: Partial<FinderRow> = {}): FinderRow {
  return {
    projectId,
    name: `Name ${projectId}`,
    priceValue: 900_000,
    bedrooms: 2,
    tenure: 'Freehold',
    locationText: 'Somewhere',
    vpStatus: false,
    bumiQuota: false,
    foreignEligible: true,
    sizeMinSqft: 800,
    sizeMaxSqft: 900,
    score: 0.5,
    ...over,
  }
}

function render(output: Partial<FinderOutput>, messages: unknown = en, locale = 'en'): string {
  const full = { matches: [], rows: [], ...output } as FinderOutput
  return renderToStaticMarkup(
    createElement(
      NextIntlClientProvider,
      { locale, messages: messages as never } as never,
      createElement(MatchList, { output: full }),
    ),
  )
}

const REFUSAL = {
  reason: 'no_match',
  explanation: 'Nothing in Bangsar fits RM 700,000.',
  nextSteps: ['Ask about a higher budget.'],
} as FinderOutput['refusal']

const ALT_ROWS = [
  row('ob1', { alternative: 'over_budget', overBudgetRM: 200_000, overBudgetPct: 28, priceValue: 900_000, locationMatch: 'in_area', locationArea: 'Bangsar' }),
  row('oa1', { alternative: 'other_area', locationText: 'Cheras', priceValue: 650_000 }),
]

describe('MatchGroups — alternatives', () => {
  it('keeps alternative rows out of recommended / nearby and orders the groups', () => {
    const html = render({
      matches: [{ projectId: 'm1' } as never],
      rows: [
        row('rec1', { locationMatch: 'in_area', locationArea: 'Bangsar' }),
        row('near1', { locationMatch: 'nearby', locationArea: 'Bangsar' }),
        ...ALT_ROWS,
      ],
    })
    const idx = (k: string) => html.indexOf(`data-slot="match-group-${k}"`)
    expect(idx('recommended')).toBeGreaterThan(-1)
    expect(idx('recommended')).toBeLessThan(idx('nearby'))
    expect(idx('nearby')).toBeLessThan(idx('over_budget'))
    expect(idx('over_budget')).toBeLessThan(idx('other_area'))
    expect(html).toContain('Slightly above your budget')
    expect(html).toContain('In other areas')

    // Each project id appears in exactly one group's table.
    const group = (k: string) => {
      const start = idx(k)
      const next = html.indexOf('data-slot="match-group-', start + 10)
      return html.slice(start, next === -1 ? undefined : next)
    }
    expect(group('recommended')).toContain('data-project-id="rec1"')
    expect(group('recommended')).not.toContain('ob1')
    expect(group('recommended')).not.toContain('oa1')
    expect(group('nearby')).not.toContain('ob1')
    expect(group('nearby')).not.toContain('oa1')
    expect(group('over_budget')).toContain('data-project-id="ob1"')
    expect(group('other_area')).toContain('data-project-id="oa1"')
  })

  it('shows the +N% badge only on an over_budget row', () => {
    const html = render({ refusal: REFUSAL, rows: ALT_ROWS })
    expect(html.match(/data-slot="over-budget-badge"/g)?.length).toBe(1)
    expect(html).toContain('+28%')
  })

  it('shows no badge without overBudgetPct, and never for an unknown price', () => {
    const html = render({
      refusal: REFUSAL,
      rows: [
        row('a', { alternative: 'over_budget' }),
        row('b', { alternative: 'over_budget', overBudgetPct: 10, priceValue: 0 }),
      ],
    })
    expect(html).not.toContain('over-budget-badge')
    expect(html).not.toContain('RM 0')
  })
})

describe('MatchList — refusal with alternatives and summary', () => {
  const summary = { asked: 'Bangsar, up to RM 700k', found: 'Two alternatives', suggestion: 'Raise the budget' }

  it('renders the refusal, then the alternatives, then the summary, headed "No exact match"', () => {
    const html = render({ refusal: REFUSAL, rows: ALT_ROWS, summary })
    expect(html).toContain('data-state="refusal"')
    expect(html).toContain('No exact match')
    expect(html).not.toContain('No match found')
    const a = html.indexOf('data-slot="refusal-card"')
    const b = html.indexOf('data-slot="match-group-over_budget"')
    const c = html.indexOf('data-slot="finder-summary"')
    expect(a).toBeLessThan(b)
    expect(b).toBeLessThan(c)
  })

  it('keeps "No match found" for a refusal with no alternatives, and "Eligibility issue" for ineligible', () => {
    expect(render({ refusal: REFUSAL })).toContain('No match found')
    const inel = render({
      refusal: { ...REFUSAL, reason: 'ineligible' } as FinderOutput['refusal'],
      rows: ALT_ROWS,
    })
    expect(inel).toContain('Eligibility issue')
  })

  it('renders the summary after the tables on a matches answer', () => {
    const html = render({
      matches: [{ projectId: 'm1' } as never],
      rows: [row('rec1')],
      summary,
    })
    expect(html.indexOf('match-group-recommended')).toBeLessThan(html.indexOf('data-slot="finder-summary"'))
  })

  it('renders the summary at the end of the matches card fallback and the answer branch', () => {
    const fallback = render({
      matches: [
        {
          projectId: 'm1',
          rationale: 'ok',
          matchedCriteria: { segment: 'unknown', nationality: 'unknown', bumiputera: null, priceMax: null, locationPref: null, bedrooms: null },
        } as never,
      ],
      summary,
    })
    expect(fallback).toContain('data-slot="match-card"')
    expect(fallback.indexOf('match-card')).toBeLessThan(fallback.indexOf('finder-summary'))
    expect(render({ answer: 'Freehold.', summary })).toContain('data-slot="finder-summary"')
  })

  it('renders no summary block when the lines are all empty or absent', () => {
    expect(render({ refusal: REFUSAL })).not.toContain('finder-summary')
    expect(render({ refusal: REFUSAL, summary: {} })).not.toContain('finder-summary')
    expect(render({ refusal: REFUSAL, summary: { asked: '  ' } })).not.toContain('finder-summary')
  })
})

describe('FinderSummary', () => {
  const wrap = (summary: FinderOutput['summary']) =>
    renderToStaticMarkup(
      createElement(
        NextIntlClientProvider,
        { locale: 'en', messages: en as never } as never,
        createElement(FinderSummary, { summary }),
      ),
    )

  it('skips missing lines and keeps the labelled ones in order', () => {
    const html = wrap({ asked: 'A thing', suggestion: 'Do it' })
    expect(html).toContain('You asked for')
    expect(html).toContain('Suggestion')
    expect(html).not.toContain('What fits')
    expect(html.indexOf('You asked for')).toBeLessThan(html.indexOf('Suggestion'))
    expect(html).toContain('Summary')
    expect(html).toContain('whitespace-pre-line')
  })

  it('is plain text: markup in a line is escaped, not rendered', () => {
    const html = wrap({ found: '<b>bold</b> **x**' })
    expect(html).not.toContain('<b>')
    expect(html).toContain('&lt;b&gt;')
    expect(html).toContain('**x**')
  })

  it('summaryLines drops blanks', () => {
    expect(summaryLines({ asked: ' ', found: 'x' })).toEqual([{ key: 'found', text: 'x' }])
    expect(summaryLines(undefined)).toEqual([])
  })
})

describe('summary decode', () => {
  it('normalizeFinderShape: a bare string becomes the suggestion; other shapes are removed', () => {
    expect((normalizeFinderShape({ matches: [], summary: 'Try Cheras' }) as { summary: unknown }).summary).toEqual({
      suggestion: 'Try Cheras',
    })
    for (const bad of [['a'], 5, null, '   ']) {
      expect('summary' in (normalizeFinderShape({ matches: [], summary: bad }) as object)).toBe(false)
    }
    const obj = { asked: 'x' }
    expect((normalizeFinderShape({ matches: [], summary: obj }) as { summary: unknown }).summary).toEqual(obj)
  })

  it('decodeFinderOutput keeps a string summary, and a summary alone is not a card', () => {
    const withRefusal = decodeFinderOutput(
      JSON.stringify({ refusal: { reason: 'no_match', explanation: 'None.' }, summary: 'Try Cheras' }),
    )
    expect(withRefusal?.summary).toEqual({ suggestion: 'Try Cheras' })
    expect(decodeFinderOutput(JSON.stringify({ summary: { asked: 'x' } }))).toBeNull()
  })

  it('a persisted refusal envelope with rows, summaries and summary decodes and renders', () => {
    const decoded = decodeFinderOutput(
      JSON.stringify({
        refusal: { reason: 'no_match', explanation: 'None in Bangsar.' },
        rows: ALT_ROWS,
        summaries: [
          {
            projectId: 'ob1',
            layouts: [
              { label: 'Type A', sizeSqft: 900, bedrooms: 2, priceMinRM: 900_000, priceMaxRM: 950_000, grossMinRM: null, grossMaxRM: null, soldOut: false },
            ],
            sections: [],
          },
        ],
        summary: { found: 'Two alternatives' },
      }),
    )
    expect(decoded?.rows.length).toBe(2)
    const html = render(decoded as FinderOutput)
    expect(html).toContain('No exact match')
    expect(html).toContain('data-slot="match-group-over_budget"')
    expect(html).toContain('data-slot="match-group-other_area"')
    expect(html).toContain('Two alternatives')
    expect(html).toContain('data-expandable="true"')
  })

  it('attachSummaries applies to a refusal that carries alternatives', () => {
    const out = FinderOutputSchema.parse({ refusal: { reason: 'no_match', explanation: 'x' } })
    const s = {
      projectId: 'ob1',
      layouts: [
        { label: 'Type A', sizeSqft: 900, bedrooms: 2, priceMinRM: 900_000, priceMaxRM: 950_000, grossMinRM: null, grossMaxRM: null, soldOut: false },
      ],
      sections: [],
    }
    expect(attachSummaries(out, [s as never]).summaries?.length).toBe(1)
    // no refusal and no matches: still a no-op
    const bare = FinderOutputSchema.parse({ answer: 'x' })
    expect(attachSummaries(bare, [s as never])).toBe(bare)
    expect(attachSummaries(out, undefined)).toBe(out)
  })
})

describe('i18n parity for the alternatives and summary keys', () => {
  const KEYS = [
    'chat.matchTable.overBudgetHeading',
    'chat.matchTable.otherAreasHeading',
    'chat.matchTable.overBudgetBadge',
    'chat.refusal.noExactMatch',
    'chat.refusal.noMatchTitle',
    'chat.refusal.ineligibleTitle',
    'chat.summary.title',
    'chat.summary.asked',
    'chat.summary.found',
    'chat.summary.suggestion',
  ]
  const get = (c: unknown, p: string) =>
    p.split('.').reduce<unknown>((a, k) => (a as Record<string, unknown> | undefined)?.[k], c)

  for (const [lang, cat] of Object.entries({ en, ms, zh })) {
    it(`${lang} has every key`, () => {
      for (const k of KEYS) {
        const v = get(cat, k)
        expect(typeof v, `${lang}:${k}`).toBe('string')
        expect((v as string).length).toBeGreaterThan(0)
      }
      expect(get(cat, 'chat.matchTable.overBudgetBadge')).toContain('{pct}')
    })
  }

  it('renders in ms and zh without missing-message markers', () => {
    for (const [lang, cat] of [['ms', ms], ['zh', zh]] as const) {
      const html = render({ refusal: REFUSAL, rows: ALT_ROWS, summary: { asked: 'x' } }, cat, lang)
      expect(html).not.toContain('chat.')
    }
  })
})
