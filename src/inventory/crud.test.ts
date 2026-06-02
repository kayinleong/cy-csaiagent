/**
 * src/inventory/crud.test.ts
 *
 * Unit tests for the inventory CRUD and import adapter (03-03).
 *
 * Coverage:
 *   - admin-gate: all mutations reject non-admin; accept admin (T-03-07, ADMIN-04)
 *   - embed-on-create: createProject calls embedProject once and writes embedding (Pitfall 8)
 *   - re-embed-on-relevant-edit: updateProject re-embeds when name/description/locationText/
 *       tenure/bedrooms/priceBand/priceValue changed; skips re-embed on status-only change
 *   - hide: hideProject sets status:'hidden' — soft-hide, no delete (ADMIN-04)
 *   - collateral (FIND-04 / D-09): attachCollateral writes a collateral doc keyed by projectId;
 *       exactly one of storagePath/externalUrl; NO Drive-API symbol (grep gate)
 *   - priceBand sync: createProject derives priceBand from priceValue via priceBandFor
 *   - import (FIND-02): importProjects validates rows; rejects missing-required-field rows;
 *       bulk-creates + embeds valid rows; reports errors per row index
 *
 * All Firestore and embedProject calls are mocked — offline, no live credentials.
 * Core/shell rule: NO import from app/ or next.
 *
 * References:
 *   - 03-03-PLAN.md Task 1 (RED) + Task 2 (GREEN) + Task 3 (GREEN)
 *   - src/kb/kb.test.ts (mock pattern to mirror)
 *   - src/firebase/collections.ts (ProjectDoc, CollateralDoc)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Hoisted mocks ─────────────────────────────────────────────────────────────
// vi.hoisted() runs before vi.mock() factories — variables available in factories below.

const {
  mockProjectsAdd,
  mockProjectsDoc,
  mockProjectsGet,
  mockProjectsUpdate,
  mockCollateralAdd,
  mockEmbedProject,
  mockPriceBandFor,
  mockProjectDocData,
} = vi.hoisted(() => {
  const mockProjectsAdd = vi.fn().mockResolvedValue({ id: 'new-project-id' })
  const mockProjectsUpdate = vi.fn().mockResolvedValue(undefined)
  const mockCollateralAdd = vi.fn().mockResolvedValue({ id: 'new-collateral-id' })

  // Mutable project doc state (simulates Firestore snapshot)
  const mockProjectDocData = {
    tenantId: 'd2',
    name: 'Skyview Residences',
    status: 'active',
    priceBand: '800k_1.2m',
    priceValue: 950_000,
    tenure: 'freehold',
    vpStatus: false,
    vpDate: null,
    bumiQuota: false,
    foreignEligible: true,
    description: 'Luxury serviced apartments in KL city centre.',
    locationText: 'Kuala Lumpur City Centre, near LRT Dang Wangi',
    bedrooms: 3,
    embedding: new Array(1024).fill(0.001),
  }

  const mockProjectsGet = vi.fn().mockImplementation(() =>
    Promise.resolve({
      exists: true,
      data: () => ({ ...mockProjectDocData }),
    }),
  )

  const mockProjectsDoc = vi.fn().mockImplementation((_id?: string) => ({
    id: _id ?? 'new-project-id',
    get: mockProjectsGet,
    update: mockProjectsUpdate,
  }))

  // embedProject stub — returns a deterministic 1024-d vector
  const mockEmbedProject = vi.fn().mockResolvedValue(new Array(1024).fill(0.002))

  // priceBandFor stub — mirrors the real function's bands
  const mockPriceBandFor = vi.fn().mockImplementation((v: number) => {
    if (v < 500_000) return 'under_500k'
    if (v < 800_000) return '500k_800k'
    if (v < 1_200_000) return '800k_1.2m'
    return 'above_1.2m'
  })

  return {
    mockProjectsAdd,
    mockProjectsDoc,
    mockProjectsGet,
    mockProjectsUpdate,
    mockCollateralAdd,
    mockEmbedProject,
    mockPriceBandFor,
    mockProjectDocData,
  }
})

// ─── Module mocks ──────────────────────────────────────────────────────────────

vi.mock('@/src/firebase/collections', () => ({
  projectsRef: vi.fn(() => ({
    add: mockProjectsAdd,
    doc: mockProjectsDoc,
  })),
  collateralRef: vi.fn(() => ({
    add: mockCollateralAdd,
  })),
  priceBandFor: mockPriceBandFor,
  TENANT_ID: 'd2',
}))

vi.mock('@/src/inventory/embedText', () => ({
  embedProject: mockEmbedProject,
}))

// ─── Imports under test ────────────────────────────────────────────────────────

import {
  assertAdmin,
  createProject,
  updateProject,
  hideProject,
  attachCollateral,
} from '@/src/inventory/crud'

import { importProjects, csvProjectSource } from '@/src/inventory/import'

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const adminUser = { uid: 'admin-1', role: 'admin' as const, tenantId: 'd2' }
const agentUser = { uid: 'agent-1', role: 'new-agent' as const, tenantId: 'd2' }
const coachUser = { uid: 'coach-1', role: 'senior-coach' as const, tenantId: 'd2' }

const baseProjectInput = {
  name: 'Skyview Residences',
  status: 'active' as const,
  priceValue: 950_000,
  tenure: 'freehold',
  vpStatus: false,
  vpDate: null,
  bumiQuota: false,
  foreignEligible: true,
  description: 'Luxury serviced apartments in KL city centre.',
  locationText: 'Kuala Lumpur City Centre, near LRT Dang Wangi',
  bedrooms: 3,
  lang: 'en' as const,
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('inventory crud — admin-gate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockEmbedProject.mockResolvedValue(new Array(1024).fill(0.002))
  })

  it('assertAdmin throws for non-admin (new-agent)', () => {
    expect(() => assertAdmin(agentUser)).toThrow()
  })

  it('assertAdmin throws for senior-coach', () => {
    expect(() => assertAdmin(coachUser)).toThrow()
  })

  it('assertAdmin does NOT throw for admin', () => {
    expect(() => assertAdmin(adminUser)).not.toThrow()
  })

  it('createProject rejects non-admin user', async () => {
    await expect(createProject(agentUser, baseProjectInput)).rejects.toThrow()
  })

  it('updateProject rejects non-admin user', async () => {
    await expect(updateProject(agentUser, 'proj-1', { name: 'New Name' })).rejects.toThrow()
  })

  it('hideProject rejects non-admin user', async () => {
    await expect(hideProject(agentUser, 'proj-1')).rejects.toThrow()
  })

  it('attachCollateral rejects non-admin user', async () => {
    await expect(
      attachCollateral(agentUser, 'proj-1', {
        type: 'poster',
        lang: 'en',
        storagePath: 'collateral/proj-1/poster.pdf',
      }),
    ).rejects.toThrow()
  })
})

describe('inventory crud — embed-on-create', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockEmbedProject.mockResolvedValue(new Array(1024).fill(0.002))
  })

  it('createProject calls embedProject exactly once', async () => {
    await createProject(adminUser, baseProjectInput)
    expect(mockEmbedProject).toHaveBeenCalledTimes(1)
  })

  it('createProject writes the returned embedding vector to the project doc', async () => {
    const expectedVector = new Array(1024).fill(0.777)
    mockEmbedProject.mockResolvedValue(expectedVector)

    await createProject(adminUser, baseProjectInput)

    const addCall = mockProjectsAdd.mock.calls[0][0]
    expect(addCall.embedding).toEqual(expectedVector)
  })

  it('createProject derives priceBand via priceBandFor(priceValue)', async () => {
    await createProject(adminUser, { ...baseProjectInput, priceValue: 700_000 })
    expect(mockPriceBandFor).toHaveBeenCalledWith(700_000)
  })

  it('createProject returns a projectId', async () => {
    const result = await createProject(adminUser, baseProjectInput)
    expect(result).toHaveProperty('projectId')
    expect(typeof result.projectId).toBe('string')
  })
})

describe('inventory crud — re-embed-on-relevant-edit (Pitfall 8 delta check)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockEmbedProject.mockResolvedValue(new Array(1024).fill(0.002))
    // Reset the doc data for fresh reads
    mockProjectsGet.mockResolvedValue({
      exists: true,
      data: () => ({ ...mockProjectDocData }),
    })
  })

  it('updateProject re-embeds when description changes (embedding-relevant)', async () => {
    await updateProject(adminUser, 'proj-1', { description: 'New description text.' })
    expect(mockEmbedProject).toHaveBeenCalledTimes(1)
  })

  it('updateProject re-embeds when name changes (embedding-relevant)', async () => {
    await updateProject(adminUser, 'proj-1', { name: 'New Project Name' })
    expect(mockEmbedProject).toHaveBeenCalledTimes(1)
  })

  it('updateProject re-embeds when locationText changes (embedding-relevant)', async () => {
    await updateProject(adminUser, 'proj-1', { locationText: 'New area, near MRT' })
    expect(mockEmbedProject).toHaveBeenCalledTimes(1)
  })

  it('updateProject re-embeds when tenure changes (embedding-relevant)', async () => {
    await updateProject(adminUser, 'proj-1', { tenure: 'leasehold' })
    expect(mockEmbedProject).toHaveBeenCalledTimes(1)
  })

  it('updateProject re-embeds when bedrooms changes (embedding-relevant)', async () => {
    await updateProject(adminUser, 'proj-1', { bedrooms: 4 })
    expect(mockEmbedProject).toHaveBeenCalledTimes(1)
  })

  it('updateProject re-embeds when priceValue changes (embedding-relevant via priceBand)', async () => {
    await updateProject(adminUser, 'proj-1', { priceValue: 600_000 })
    expect(mockEmbedProject).toHaveBeenCalledTimes(1)
  })

  it('updateProject does NOT re-embed when only status changes (non-relevant)', async () => {
    await updateProject(adminUser, 'proj-1', { status: 'hidden' })
    expect(mockEmbedProject).not.toHaveBeenCalled()
  })

  it('updateProject does NOT re-embed when only vpStatus changes (non-relevant)', async () => {
    await updateProject(adminUser, 'proj-1', { vpStatus: true })
    expect(mockEmbedProject).not.toHaveBeenCalled()
  })

  it('updateProject recomputes priceBand when priceValue changes', async () => {
    await updateProject(adminUser, 'proj-1', { priceValue: 400_000 })
    expect(mockPriceBandFor).toHaveBeenCalledWith(400_000)
  })
})

describe('inventory crud — hide (soft-hide)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockProjectsGet.mockResolvedValue({
      exists: true,
      data: () => ({ ...mockProjectDocData }),
    })
  })

  it('hideProject sets status to "hidden" (soft-hide)', async () => {
    await hideProject(adminUser, 'proj-1')
    expect(mockProjectsUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'hidden' }),
    )
  })

  it('hideProject does NOT call delete — soft-hide only', async () => {
    // If crud.ts were to call .delete(), a different mock would be triggered.
    // We simply verify the update was called with status:'hidden' and no delete mock was set up.
    const mockDelete = vi.fn()
    mockProjectsDoc.mockImplementationOnce((_id?: string) => ({
      id: _id ?? 'proj-1',
      get: mockProjectsGet,
      update: mockProjectsUpdate,
      delete: mockDelete,
    }))

    await hideProject(adminUser, 'proj-1')

    expect(mockDelete).not.toHaveBeenCalled()
    expect(mockProjectsUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'hidden' }),
    )
  })
})

describe('inventory crud — collateral (FIND-04 / D-09)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('attachCollateral writes a collateral doc with the projectId', async () => {
    await attachCollateral(adminUser, 'proj-1', {
      type: 'poster',
      lang: 'en',
      storagePath: 'collateral/proj-1/poster.pdf',
    })
    expect(mockCollateralAdd).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: 'proj-1' }),
    )
  })

  it('attachCollateral writes storagePath to the collateral doc', async () => {
    await attachCollateral(adminUser, 'proj-1', {
      type: 'fact-sheet',
      lang: 'en',
      storagePath: 'collateral/proj-1/factsheet.pdf',
    })
    const writeArg = mockCollateralAdd.mock.calls[0][0]
    expect(writeArg.storagePath).toBe('collateral/proj-1/factsheet.pdf')
    expect(writeArg.externalUrl).toBeUndefined()
  })

  it('attachCollateral accepts externalUrl in place of storagePath', async () => {
    await attachCollateral(adminUser, 'proj-1', {
      type: 'video',
      lang: 'en',
      externalUrl: 'https://share.example.com/brochure.mp4',
    })
    const writeArg = mockCollateralAdd.mock.calls[0][0]
    expect(writeArg.externalUrl).toBe('https://share.example.com/brochure.mp4')
  })

  it('attachCollateral stores type and lang in the collateral doc', async () => {
    await attachCollateral(adminUser, 'proj-1', {
      type: 'poster',
      lang: 'zh',
      storagePath: 'collateral/proj-1/poster-zh.pdf',
    })
    const writeArg = mockCollateralAdd.mock.calls[0][0]
    expect(writeArg.type).toBe('poster')
    expect(writeArg.lang).toBe('zh')
  })

  it('attachCollateral throws if both storagePath and externalUrl are missing', async () => {
    await expect(
      attachCollateral(adminUser, 'proj-1', {
        type: 'poster',
        lang: 'en',
        // neither storagePath nor externalUrl
      }),
    ).rejects.toThrow()
  })
})

describe('inventory import — ProjectSource interface + CSV adapter + validation (FIND-02)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockEmbedProject.mockResolvedValue(new Array(1024).fill(0.002))
    mockProjectsAdd.mockResolvedValue({ id: 'imported-project-id' })
  })

  const validCsvRow = [
    'name,status,priceValue,tenure,vpStatus,bumiQuota,foreignEligible,description,locationText,bedrooms,lang',
    'Green Valley,active,680000,freehold,false,false,true,Modern township with park,Puchong Selangor,3,en',
  ].join('\n')

  const validCsvTwoRows = [
    'name,status,priceValue,tenure,vpStatus,bumiQuota,foreignEligible,description,locationText,bedrooms,lang',
    'Green Valley,active,680000,freehold,false,false,true,Modern township,Puchong Selangor,3,en',
    'Sky Tower,active,1100000,leasehold,true,false,true,High-rise condos KL,KL Sentral,2,en',
  ].join('\n')

  const csvMissingRequired = [
    'name,status,priceValue,tenure,vpStatus,bumiQuota,foreignEligible,description,locationText,bedrooms,lang',
    // Missing 'description'
    'Broken Project,active,500000,freehold,false,false,true,,Bangsar KL,2,en',
  ].join('\n')

  it('csvProjectSource.parse() returns an array of partial ProjectDoc rows', () => {
    const rows = csvProjectSource.parse(validCsvRow)
    expect(Array.isArray(rows)).toBe(true)
    expect(rows.length).toBe(1)
  })

  it('csvProjectSource.parse() maps header columns to field names', () => {
    const rows = csvProjectSource.parse(validCsvRow)
    expect(rows[0]).toMatchObject({ name: 'Green Valley', status: 'active' })
  })

  it('importProjects rejects non-admin user', async () => {
    await expect(
      importProjects(validCsvRow, csvProjectSource, agentUser),
    ).rejects.toThrow()
  })

  it('importProjects bulk-creates valid rows and returns {created, errors}', async () => {
    const result = await importProjects(validCsvTwoRows, csvProjectSource, adminUser)
    expect(result.created).toBe(2)
    expect(result.errors.length).toBe(0)
    expect(mockProjectsAdd).toHaveBeenCalledTimes(2)
  })

  it('importProjects calls embedProject for each valid row (embed-on-import)', async () => {
    await importProjects(validCsvTwoRows, csvProjectSource, adminUser)
    expect(mockEmbedProject).toHaveBeenCalledTimes(2)
  })

  it('importProjects rejects a row missing a required field with a per-row error', async () => {
    const result = await importProjects(csvMissingRequired, csvProjectSource, adminUser)
    expect(result.created).toBe(0)
    expect(result.errors.length).toBeGreaterThan(0)
    expect(result.errors[0]).toMatchObject({ row: expect.any(Number), message: expect.any(String) })
  })

  it('importProjects does NOT write an invalid row to Firestore', async () => {
    await importProjects(csvMissingRequired, csvProjectSource, adminUser)
    expect(mockProjectsAdd).not.toHaveBeenCalled()
  })

  it('importProjects continues processing valid rows after an invalid row', async () => {
    const mixedCsv = [
      'name,status,priceValue,tenure,vpStatus,bumiQuota,foreignEligible,description,locationText,bedrooms,lang',
      // row 1: invalid (missing description)
      ',active,500000,freehold,false,false,true,Valid desc,Bangsar,2,en',
      // row 2: valid
      'Valid Project,active,750000,freehold,false,false,true,Good location,Shah Alam,3,en',
    ].join('\n')

    const result = await importProjects(mixedCsv, csvProjectSource, adminUser)
    expect(result.created).toBe(1)
    expect(result.errors.length).toBe(1)
  })
})
