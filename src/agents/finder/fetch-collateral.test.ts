/**
 * fetchCollateral URL guard — quick-kayinleong-050.
 *
 * The bug: `collateral` docs written by the WhatsApp importer carry a Storage bucket
 * key (`storagePath`) and no `externalUrl`. `makeFetchCollateralTool` used to return
 * `externalUrl ?? storagePath`, handing the model a bare bucket key as a `url`. The
 * model copied it into its narration as dead text and the Finder card turned it into
 * a relative href that 404s.
 *
 * These tests pin the contract: **every `url` this tool emits is a complete http(s)
 * link, or the item is omitted entirely.** Grounding is a hard constraint — the model
 * must never be handed something that looks like a link but is not one.
 *
 * Kept in its own file (rather than extending finder.test.ts) so the collateral
 * contract has a single obvious home.
 *
 * Run: npx vitest run src/agents/finder/fetch-collateral.test.ts
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => {
  const mockCollateralGet = vi.fn()
  const mockCollateralWhere = vi.fn()
  const mockCollateralRef = vi.fn(() => ({ where: mockCollateralWhere }))
  mockCollateralWhere.mockReturnValue({ get: mockCollateralGet })
  return { mockCollateralRef, mockCollateralWhere, mockCollateralGet }
})

vi.mock('@/src/firebase/admin', () => ({ adminDb: {}, adminAuth: {}, remoteConfig: vi.fn() }))
vi.mock('@/src/inventory/search', () => ({ searchProjects: vi.fn(), queryInventory: vi.fn() }))
vi.mock('@/src/firebase/collections', () => ({
  collateralRef: mocks.mockCollateralRef,
  projectsRef: vi.fn(),
  TENANT_ID: 'd2',
}))

import {
  makeFetchCollateralTool,
  makeSearchProjectsTool,
  INLINE_COLLATERAL_MATCHES,
} from './tools'

const PID = 'project-kl-001'

/** Build a Firestore-shaped snapshot from plain collateral field maps. */
function snapshotOf(docs: Array<Record<string, unknown>>) {
  return { empty: docs.length === 0, docs: docs.map((d) => ({ data: () => d })) }
}

async function fetchCollateral(docs: Array<Record<string, unknown>>) {
  mocks.mockCollateralGet.mockResolvedValue(snapshotOf(docs))
  const tool = makeFetchCollateralTool('en')
  const execute = tool.execute as NonNullable<typeof tool.execute>
  return execute({ projectId: PID }, {} as never)
}

describe('fetchCollateral — never emits a non-URL (quick-kayinleong-050)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.mockCollateralWhere.mockReturnValue({ get: mocks.mockCollateralGet })
    // The guard logs a count when it drops items — keep the test output clean.
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  it('returns the externalUrl when it is a real https link (Drive/Skool collateral keeps working)', async () => {
    const result = await fetchCollateral([
      {
        projectId: PID,
        type: 'brochure',
        storagePath: '',
        externalUrl: 'https://drive.google.com/file/d/abc123/view',
        lang: 'en',
        tenantId: 'd2',
      },
    ])

    expect(result).toEqual([
      { type: 'brochure', url: 'https://drive.google.com/file/d/abc123/view' },
    ])
  })

  it('returns a Firebase Storage download URL captured at upload time', async () => {
    const result = await fetchCollateral([
      {
        projectId: PID,
        type: 'whatsapp-media',
        storagePath: `collateral/${PID}/whatsapp/kensho-brochure.pdf`,
        externalUrl:
          'https://firebasestorage.googleapis.com/v0/b/example.appspot.com/o/collateral%2Fp%2Fx.pdf?alt=media&token=t',
        lang: 'en',
        tenantId: 'd2',
      },
    ])

    expect(Array.isArray(result)).toBe(true)
    expect(result).toHaveLength(1)
    expect((result as Array<{ url: string }>)[0].url).toMatch(/^https:\/\//)
  })

  it('OMITS a storagePath-only doc — a bucket key is never emitted as a url', async () => {
    const result = await fetchCollateral([
      {
        projectId: PID,
        type: 'whatsapp-media',
        storagePath: `collateral/${PID}/whatsapp/kensho-brochure.pdf`,
        externalUrl: undefined,
        lang: 'en',
        tenantId: 'd2',
      },
    ])

    expect(result).toEqual([])
  })

  it('drops only the unresolvable items — resolvable siblings still come through', async () => {
    const result = (await fetchCollateral([
      {
        projectId: PID,
        type: 'whatsapp-media',
        storagePath: `collateral/${PID}/whatsapp/dead.pdf`,
        lang: 'en',
        tenantId: 'd2',
      },
      {
        projectId: PID,
        type: 'factsheet',
        storagePath: '',
        externalUrl: 'https://drive.google.com/file/d/live/view',
        lang: 'en',
        tenantId: 'd2',
      },
    ])) as Array<{ type: string; url: string }>

    expect(result.map((r) => r.type)).toEqual(['factsheet'])
    expect(result.every((r) => /^https?:\/\//.test(r.url))).toBe(true)
  })

  it.each([
    ['empty string', ''],
    ['whitespace', '   '],
    ['bare bucket key', 'collateral/p/whatsapp/x.pdf'],
    ['protocol-relative', '//evil.example.com/x.pdf'],
    ['javascript: scheme', 'javascript:alert(1)'],
    ['data: scheme', 'data:text/html,<script>alert(1)</script>'],
    ['non-string', 12345],
  ])('rejects a %s externalUrl', async (_label, value) => {
    const result = await fetchCollateral([
      {
        projectId: PID,
        type: 'whatsapp-media',
        storagePath: `collateral/${PID}/whatsapp/x.pdf`,
        externalUrl: value,
        lang: 'en',
        tenantId: 'd2',
      },
    ])

    expect(result).toEqual([])
  })

  it('returns an empty array when the project has no collateral at all', async () => {
    const result = await fetchCollateral([])
    expect(result).toEqual([])
  })

  it('the tool description tells the model an empty array means "nothing to attach"', () => {
    const tool = makeFetchCollateralTool('en')
    const desc = (tool.description ?? '').toLowerCase()
    // Must not invite the model to invent a link when the array comes back empty.
    expect(desc).toContain('omitted')
    expect(desc).toContain('never invent')
  })
})

// ─── quick-kayinleong-054: bound and rank collateral ──────────────────────────
//
// A raw SSE capture showed fetchCollateral returning ~200 items for one project, called
// three times in a turn, re-sent on every subsequent step of the stepCountIs(5) loop.

describe('quick-054: collateralRank ordering', () => {
  // Exercised through the exported ranking used by fetchCollateral. Firebase download
  // URLs always carry ?alt=media&token=…, so extension matching must ignore the query.
  const fbUrl = (name: string) =>
    `https://firebasestorage.googleapis.com/v0/b/x/o/collateral%2Fp%2Fwhatsapp%2F${name}?alt=media&token=abc123`

  it('ranks documents above media, and media above voice notes', async () => {
    const { rankAndCapCollateral } = await import('./tools')
    const ranked = rankAndCapCollateral([
      { type: 'whatsapp-media', url: fbUrl('PTT-voice.opus') },
      { type: 'whatsapp-media', url: fbUrl('photo.jpg') },
      { type: 'whatsapp-media', url: fbUrl('Sales%20Kit.pdf') },
      { type: 'whatsapp-media', url: fbUrl('walkthrough.mp4') },
      { type: 'drive', url: 'https://drive.google.com/drive/folders/abc' },
    ])
    expect(ranked.map((r: { type: string; url: string }) => r.url.includes('.pdf') ? 'pdf'
      : r.type === 'drive' ? 'drive'
      : r.url.includes('.mp4') ? 'video'
      : r.url.includes('.jpg') ? 'photo' : 'other'))
      .toEqual(['pdf', 'drive', 'video', 'photo', 'other'])
  })

  it('matches the extension despite the ?alt=media&token= query string', async () => {
    // A naive endsWith('.pdf') would never match a Firebase download URL.
    const { rankAndCapCollateral } = await import('./tools')
    const ranked = rankAndCapCollateral([
      { type: 'whatsapp-media', url: fbUrl('a.jpg') },
      { type: 'whatsapp-media', url: fbUrl('Brochure.pdf') },
    ])
    expect(ranked[0].url).toContain('Brochure.pdf')
  })

  it('is stable within a rank — original order preserved', async () => {
    const { rankAndCapCollateral } = await import('./tools')
    const ranked = rankAndCapCollateral([
      { type: 'whatsapp-media', url: fbUrl('first.pdf') },
      { type: 'whatsapp-media', url: fbUrl('second.pdf') },
      { type: 'whatsapp-media', url: fbUrl('third.pdf') },
    ])
    expect(ranked.map((r: { url: string }) => r.url)).toEqual([
      fbUrl('first.pdf'), fbUrl('second.pdf'), fbUrl('third.pdf'),
    ])
  })

  it('caps the result so one project cannot flood the model context', async () => {
    const { rankAndCapCollateral, MAX_COLLATERAL_ITEMS } = await import('./tools')
    const many = Array.from({ length: 200 }, (_, i) => ({
      type: 'whatsapp-media', url: fbUrl(`photo-${i}.jpg`),
    }))
    expect(rankAndCapCollateral(many)).toHaveLength(MAX_COLLATERAL_ITEMS)
  })
})

// ─── quick-kayinleong-067: collateral rides along with the search ─────────────
//
// POST /api/chat was returning 500 with an EMPTY body — not one of ours, every 500 our
// route returns carries a JSON body. The platform was killing the function. Measured:
// searchProjects is 4519ms cold and a Finder turn also makes 3-5 sequential model round
// trips; successful turns reached 21.0s while Coach topped out at 11.6s. Making the model
// spend a whole step on fetchCollateral was a round trip the turn could not afford.

describe('quick-067: searchProjects attaches collateral inline', () => {
  const SEARCH_INPUT = {
    segment: 'unknown' as const,
    priceMin: null,
    priceMax: null,
    monthlyIncome: null,
    financingNote: null,
    nationality: 'unknown' as const,
    bumiputera: null,
    locationPref: 'KLCC',
    tenurePref: null,
    bedrooms: 2,
    freeText: 'two bed in klcc',
  }

  async function runSearch(matchCount: number, collateralDocs: Array<Record<string, unknown>>) {
    const { searchProjects } = await import('@/src/inventory/search')
    vi.mocked(searchProjects).mockResolvedValue({
      found: true,
      matches: Array.from({ length: matchCount }, (_, i) => ({
        projectId: `p${i}`,
        name: `Project ${i}`,
      })),
    } as never)
    mocks.mockCollateralGet.mockResolvedValue(snapshotOf(collateralDocs))
    const tool = makeSearchProjectsTool('en')
    const execute = tool.execute as NonNullable<typeof tool.execute>
    return (await execute(SEARCH_INPUT, {} as never)) as {
      found: boolean
      matches: Array<{ projectId: string; collateral?: Array<{ type: string; url: string }> }>
    }
  }

  it('attaches collateral to the top matches so no extra round trip is needed', async () => {
    const result = await runSearch(5, [
      { type: 'brochure', externalUrl: 'https://x.test/a.pdf', projectId: 'p0' },
    ])
    expect(result.matches[0].collateral).toEqual([
      { type: 'brochure', url: 'https://x.test/a.pdf' },
    ])
  })

  it('only attaches to the top N — the tail is rarely what gets forwarded', async () => {
    const result = await runSearch(8, [
      { type: 'brochure', externalUrl: 'https://x.test/a.pdf', projectId: 'p0' },
    ])
    const withCollateral = result.matches.filter((m) => (m.collateral?.length ?? 0) > 0)
    expect(withCollateral).toHaveLength(INLINE_COLLATERAL_MATCHES)
    expect(result.matches).toHaveLength(8)
    // Every attached item is re-sent on every subsequent step of the tool loop — the
    // token blowup quick-054 fixed. Attaching to all eight would reintroduce it.
    expect(result.matches[INLINE_COLLATERAL_MATCHES].collateral).toBeUndefined()
  })

  it('omits the key entirely when a project has no shareable collateral', async () => {
    const result = await runSearch(3, [])
    expect(result.matches[0].collateral).toBeUndefined()
  })

  it('a collateral read failure never fails the search — the match is still ground truth', async () => {
    const { searchProjects } = await import('@/src/inventory/search')
    vi.mocked(searchProjects).mockResolvedValue({
      found: true,
      matches: [{ projectId: 'p0', name: 'Project 0' }],
    } as never)
    mocks.mockCollateralGet.mockRejectedValue(new Error('firestore unavailable'))

    const tool = makeSearchProjectsTool('en')
    const execute = tool.execute as NonNullable<typeof tool.execute>
    const result = (await execute(SEARCH_INPUT, {} as never)) as {
      found: boolean
      matches: Array<{ projectId: string; collateral?: unknown }>
    }
    expect(result.found).toBe(true)
    expect(result.matches).toHaveLength(1)
    expect(result.matches[0].collateral).toBeUndefined()
  })

  it('leaves a no_match result untouched', async () => {
    const { searchProjects } = await import('@/src/inventory/search')
    vi.mocked(searchProjects).mockResolvedValue({ found: false, reason: 'no_match' } as never)
    // Cleared here rather than asserting on a running total — earlier tests in this file
    // share the same mock instance.
    mocks.mockCollateralGet.mockClear()
    const tool = makeSearchProjectsTool('en')
    const execute = tool.execute as NonNullable<typeof tool.execute>
    const result = await execute(SEARCH_INPUT, {} as never)
    expect(result).toEqual({ found: false, reason: 'no_match' })
    expect(mocks.mockCollateralGet).not.toHaveBeenCalled()
  })
})
