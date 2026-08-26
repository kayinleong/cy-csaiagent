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

import { makeFetchCollateralTool } from './tools'

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
