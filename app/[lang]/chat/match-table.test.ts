/**
 * match-table.test.ts — the Finder result table (quick-kayinleong-085).
 *
 * Real assertions where the `node` vitest environment allows (there is no jsdom in this
 * repo, so component rendering is not available), and source assertions that CARRY THEIR
 * REASON where it does not — the `mobile-layout.test.ts` precedent. For a utility class,
 * being present IS the behaviour; these exist so the next reader does not tidy one away
 * and re-break a layout that took four rounds to get right.
 *
 * The i18n check below is deliberately NOT a grep for a key name: it parses every `t(...)`
 * call out of the component and resolves each one in all three catalogs, so adding a
 * `t('nope')` call fails it.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { formatPrice, formatSize } from './match-table'

import en from '@/src/i18n/messages/en.json'
import ms from '@/src/i18n/messages/ms.json'
import zh from '@/src/i18n/messages/zh.json'

const TABLE = readFileSync(new URL('./match-table.tsx', import.meta.url), 'utf8')

/**
 * `TABLE` with comments stripped.
 *
 * The forbidden-class guards below have to read CODE, not prose: the component's own
 * comments explain WHY `overflow-x-auto` and `priceBand` must not appear, and a naive
 * `not.toContain` on the raw source fails on the explanation rather than on a real leak.
 */
const TABLE_CODE = TABLE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
const LIST = readFileSync(new URL('./match-list.tsx', import.meta.url), 'utf8')
const MESSAGE_LIST = readFileSync(new URL('./message-list.tsx', import.meta.url), 'utf8')
const SHELL = readFileSync(new URL('./chat-shell.tsx', import.meta.url), 'utf8')

// ─── formatPrice: D2's hard invariant ─────────────────────────────────────────

describe('formatPrice', () => {
  it('returns null for an UNKNOWN price — never a zero-valued currency string', () => {
    // 32 of 82 projects carry priceValue 0, and the price gate now ADMITS them (D2). The
    // whole decision rests on those rows not claiming a price they do not have. And note
    // what this function CANNOT do even if someone wanted it to: FinderRow does not carry
    // `priceBand`, so there is no cheapest-band fallback available to fall back to.
    expect(formatPrice(0)).toBeNull()
    expect(formatPrice(-1)).toBeNull()
    expect(formatPrice(Number.NaN)).toBeNull()
    expect(formatPrice(Number.POSITIVE_INFINITY)).toBeNull()
    expect(formatPrice(undefined as unknown as number)).toBeNull()
  })

  it('formats a real price as RM with thousands separators and no decimals', () => {
    expect(formatPrice(950_000)).toBe('RM 950,000')
    expect(formatPrice(1_000_000)).toBe('RM 1,000,000')
  })
})

describe('formatSize', () => {
  it('returns null when either bound is missing — half a range is not a range', () => {
    expect(formatSize(null, 1_800)).toBeNull()
    expect(formatSize(904, null)).toBeNull()
    expect(formatSize(null, null)).toBeNull()
  })

  it('renders a single number when the bounds are equal', () => {
    expect(formatSize(904, 904)).toBe('904')
  })

  it('renders a separated range otherwise, unit-free (the unit is in the header)', () => {
    expect(formatSize(1_600, 1_800)).toBe('1,600–1,800')
    expect(formatSize(904, 4_855)).toBe('904–4,855')
    expect(formatSize(5_296, 19_041)).toBe('5,296–19,041')
  })

  it('is order-insensitive rather than emitting an inverted range', () => {
    expect(formatSize(1_800, 1_600)).toBe('1,600–1,800')
  })
})

// ─── i18n: every t() call resolves in every catalog ───────────────────────────

type Catalog = Record<string, unknown>

function resolve(catalog: Catalog, path: string): unknown {
  return path
    .split('.')
    .reduce<unknown>((acc, part) => (acc as Catalog | undefined)?.[part], catalog)
}

/**
 * Extract `useTranslations('ns')` namespaces and every `t(...)` / `tCol(...)` key from the
 * component source, pairing each key with the namespace of the hook it was called on.
 */
function translationCalls(src: string): Array<{ hook: string; ns: string; key: string }> {
  const namespaces = new Map<string, string>()
  for (const m of src.matchAll(/const\s+(\w+)\s*=\s*useTranslations\('([^']+)'\)/g)) {
    namespaces.set(m[1], m[2])
  }
  expect(namespaces.size).toBeGreaterThan(0)

  const calls: Array<{ hook: string; ns: string; key: string }> = []
  for (const [hook, ns] of namespaces) {
    for (const m of src.matchAll(new RegExp(String.raw`\b${hook}\('([^']+)'`, 'g'))) {
      calls.push({ hook, ns, key: m[1] })
    }
  }
  return calls
}

describe('match-table i18n', () => {
  const calls = translationCalls(TABLE)

  it('finds the translation calls at all (so the check cannot pass vacuously)', () => {
    expect(calls.length).toBeGreaterThanOrEqual(8)
    expect(calls.some((c) => c.ns === 'chat.matchTable')).toBe(true)
    expect(calls.some((c) => c.ns === 'inventory')).toBe(true)
  })

  for (const [lang, catalog] of Object.entries({ en, ms, zh })) {
    it(`every key the table calls resolves in ${lang}.json`, () => {
      for (const { ns, key } of calls) {
        const value = resolve(catalog as Catalog, `${ns}.${key}`)
        expect(typeof value, `${lang}: ${ns}.${key}`).toBe('string')
        expect((value as string).length, `${lang}: ${ns}.${key}`).toBeGreaterThan(0)
      }
    })
  }

  it('the interpolated keys declare the placeholders the table passes them', () => {
    for (const [lang, catalog] of Object.entries({ en, ms, zh })) {
      const prompt = resolve(catalog as Catalog, 'chat.matchTable.showMorePrompt') as string
      expect(prompt, lang).toContain('{name}')
      expect(prompt, lang).toContain('{projectId}')
      expect(resolve(catalog as Catalog, 'chat.matchTable.showMoreAria'), lang).toContain(
        '{name}',
      )
      expect(resolve(catalog as Catalog, 'chat.matchTable.rowCount'), lang).toContain('{count}')
    }
  })

  it('the row-action prompt is a translated key, not an English literal', () => {
    // The agent replies in the language of the incoming message, so dispatching an English
    // prompt would flip a BM or 中文 conversation to English mid-thread.
    expect(TABLE).toContain("t('showMorePrompt', { name: row.name, projectId: row.projectId })")
    expect(TABLE_CODE).not.toMatch(/onAsk\?\.\(\s*[`'"]/)
  })

  it('the prompt asks for the supporting documents by name', () => {
    // The whole point of the button (CONTEXT: "show more detailed with supporting
    // documents"). fetchCollateral serves the follow-up turn for a project the search's
    // inline top-3 missed.
    expect(en.chat.matchTable.showMorePrompt).toMatch(/supporting documents/i)
    expect(ms.chat.matchTable.showMorePrompt).toMatch(/dokumen sokongan/i)
    expect(zh.chat.matchTable.showMorePrompt).toContain('支援文件')
  })
})

// ─── Prop forwarding (the quick-080 lesson) ───────────────────────────────────

describe('onAsk is forwarded the whole way down', () => {
  // quick-080 silently dropped `onLeadRequired` because message-list.tsx hand-lists the
  // props it passes on. Every link in the chain is asserted separately so a failure names
  // the file that broke it.
  it('chat-shell.tsx passes onAsk to MessageList', () => {
    expect(SHELL).toMatch(/<MessageList[\s\S]{0,600}?onAsk=\{/)
    expect(SHELL).toContain("handleSuggestion(prompt, 'finder')")
  })

  it('message-list.tsx accepts onAsk and forwards it to MatchList', () => {
    expect(MESSAGE_LIST).toMatch(/onAsk\?:\s*\(prompt: string\) => void/)
    expect(MESSAGE_LIST).toMatch(/<MatchList[^>]*onAsk=\{onAsk\}/)
  })

  it('match-list.tsx accepts onAsk and forwards it to MatchTable', () => {
    expect(LIST).toMatch(/onAsk\?:\s*\(prompt: string\) => void/)
    expect(LIST).toMatch(/<MatchTable[\s\S]{0,200}?onAsk=\{onAsk\}/)
  })

  it('reuses the existing one-shot suggestion path — no new dispatch mechanism', () => {
    // handleSuggestion -> submittedSuggestion -> chat-input's id-keyed useEffect.
    expect(SHELL).toContain('setSubmittedSuggestion({ id: Date.now()')
  })
})

// ─── Render contract the table depends on ─────────────────────────────────────

describe('the table renders rows, not matches', () => {
  it('MatchList renders MatchTable from output.rows and keeps MatchCard as the fallback', () => {
    // `matches` is the model's shortlist (at most MAX_MATCHES, because that is all it
    // sees); `rows` is the complete tool result. Rendering `matches` would reinstate the
    // reported defect.
    expect(LIST).toContain('if (rows.length > 0)')
    expect(LIST).toMatch(/<MatchTable\s+rows=\{rows\}\s+matches=\{matches\}/)
    expect(LIST).toContain('<MatchCard key={match.projectId}')
  })

  it('leaves the clarifying-question, refusal and answer branches intact', () => {
    expect(LIST).toContain('data-state="clarifying"')
    expect(LIST).toContain('data-state="refusal"')
    expect(LIST).toContain('data-state="answer"')
  })

  it('keeps the projectId on the row — it is the grounding citation (D-04)', () => {
    expect(TABLE).toContain('data-project-id={row.projectId}')
    expect(TABLE).toContain('title={`${row.name} (${row.projectId})`}')
  })

  it('paginates 10 per page with the shared primitive', () => {
    expect(TABLE).toContain('const ROWS_PER_PAGE = 10')
    expect(TABLE).toContain('usePagination(')
    expect(TABLE).toContain('<Paginator')
  })
})

// ─── Mobile guards, each carrying the reason it exists ────────────────────────

describe('match-table at 440px', () => {
  it('the comment stripper removed the prose but kept the JSX', () => {
    // Otherwise the forbidden-class guards below could pass by stripping everything.
    expect(TABLE_CODE).toContain('<TableHead')
    expect(TABLE_CODE).toContain('className=')
    expect(TABLE_CODE).not.toContain('quick-081')
  })

  it('adds NO horizontal-centring utility to the scroll container', () => {
    // quick-081: `justify-center` on an `overflow-x-auto` container clips BOTH ends, so
    // neither the first nor the last column can be scrolled to. The vendored Table already
    // wraps itself in `relative w-full overflow-x-auto`; that IS the affordance.
    expect(TABLE_CODE).not.toContain('justify-center')
    expect(TABLE_CODE).not.toContain('mx-auto')
    expect(TABLE_CODE).not.toContain('items-center justify-center')
  })

  it('does not add a second scroll container around the vendored Table', () => {
    expect(TABLE_CODE).not.toContain('overflow-x-auto')
    expect(TABLE_CODE).not.toContain('overflow-x-scroll')
  })

  it('gates NOTHING on the sm breakpoint', () => {
    // Tailwind `sm` is 640px, and the target device is 440px — quick-082 gated the header
    // wrap on `sm` and the user got a two-row header on a phone that fitted one row
    // comfortably. quick-083 re-gated it at min-[400px]. Same trap, same file family.
    expect(TABLE_CODE).not.toMatch(/\bsm:/)
  })

  it('pins the Name column to the left edge inside the scroll strip', () => {
    // Scrolling right must never lose which project a row is. The opaque background is
    // part of the fix: without it the scrolled cells show through the sticky one.
    expect(TABLE).toContain('sticky left-0 z-10 bg-background whitespace-nowrap')
    expect(TABLE).toContain('sticky left-0 z-10 max-w-[11rem] truncate bg-background')
  })

  it('gives the row action the 44px touch-target floor', () => {
    expect(TABLE).toContain('min-h-11')
  })

  it('truncates the prose columns instead of letting them set the table width', () => {
    expect(TABLE).toMatch(/max-w-\[12rem\] truncate/) // Location
    expect(TABLE).toMatch(/max-w-\[14rem\] truncate/) // Highlight
    expect(TABLE).toContain('title={row.locationText}')
  })
})

// ─── The unpriced row cannot claim a price ────────────────────────────────────

describe('no cell can render a price band', () => {
  it('the table never references priceBand', () => {
    // Defence in depth: FinderRowSchema does not carry it (asserted in
    // src/agents/finder/tools.test.ts), and this file must not reach for it either.
    expect(TABLE_CODE).not.toContain('priceBand')
  })

  it('an unpriced cell shows an em dash with an explanatory label', () => {
    expect(TABLE).toContain("t('priceUnknown')")
    expect(TABLE).toContain('const EM_DASH')
  })

  it('a zero bedroom count renders as unknown, not as "0"', () => {
    // 0 means UNKNOWN on 29 of 82 projects.
    expect(TABLE).toContain('row.bedrooms > 0 ? row.bedrooms : EM_DASH')
  })
})
