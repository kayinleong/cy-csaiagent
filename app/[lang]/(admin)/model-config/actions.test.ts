/**
 * app/[lang]/(admin)/model-config/actions.test.ts — MODEL-02 Firestore publish contract.
 *
 * The model-config store is the singleton Firestore doc `appConfig/modelConfig`
 * (quick-kayinleong-017 — replaced Firebase Remote Config). Pins the secure
 * behavior of publishModelConfig (D-15 / D-16 / D-17):
 *   1. TRANSACTIONAL WRITE: reads the current models map and writes the merged map
 *      (the edited pillar updated, the other four preserved — no blind overwrite of
 *      sibling pillars).
 *   2. CONFLICT (D-16): if the stored value for the pillar differs from the
 *      `expectedCurrent` the admin saw, returns {ok:false,error:'conflict'} and does
 *      NOT write — never blind-overwrites a concurrent publish.
 *   3. ANTI-MASKING: any Firestore failure returns {ok:false,error:'publish-failed'},
 *      never silently mislabeled as a conflict.
 *   4. PILLAR ALLOW-LIST (D-16): a pillar not in {coach,finder,reply,router,grader}
 *      is rejected before any transaction.
 *   5. ADMIN-ONLY (D-17): non-admin → Forbidden (role from VERIFIED token).
 *   6. AUDITED (D-17): a successful publish writes action:'model_config_publish';
 *      a conflict or failure writes NO audit row.
 *   (D-15: model IDs stay free-form strings — no hard-coded allow-list of model names.)
 *
 * No emulator needed — Firestore (adminDb.runTransaction + appConfigRef) is mocked.
 *
 * Requirements: MODEL-01, MODEL-02, D-15, D-16, D-17.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { AuthenticatedUser } from '@/src/firebase/auth'
import en from '@/src/i18n/messages/en.json'

// ─── Mock dependencies BEFORE importing the action module ─────────────────────

vi.mock('@/src/firebase/auth', () => ({
  requireUser: vi.fn(),
  UnauthorizedError: class UnauthorizedError extends Error {
    constructor(msg: string) { super(msg); this.name = 'UnauthorizedError' }
  },
}))

vi.mock('@/src/audit', () => ({
  log: vi.fn().mockResolvedValue(undefined),
}))

// Firestore transaction mocks (vi.hoisted so the vi.mock factories below can
// reference them — vi.mock is hoisted above plain const declarations).
// adminDb.runTransaction invokes the callback with a transaction object
// exposing get()/set(). mockDocGet backs the readModelConfig non-transactional read.
const { mockTxGet, mockTxSet, mockDocGet, mockRunTransaction } = vi.hoisted(() => {
  const mockTxGet = vi.fn()
  const mockTxSet = vi.fn()
  const mockDocGet = vi.fn()
  const mockRunTransaction = vi.fn(
    async (fn: (tx: { get: typeof mockTxGet; set: typeof mockTxSet }) => Promise<void>) =>
      fn({ get: mockTxGet, set: mockTxSet }),
  )
  return { mockTxGet, mockTxSet, mockDocGet, mockRunTransaction }
})

vi.mock('@/src/firebase/admin', () => ({
  adminDb: { runTransaction: mockRunTransaction },
}))

// appConfigRef().doc(MODEL_CONFIG_DOC_ID) — the doc ref is opaque (tx.get/tx.set
// are themselves mocks).
vi.mock('@/src/firebase/collections', () => ({
  appConfigRef: vi.fn(() => ({ doc: vi.fn(() => ({ get: mockDocGet })) })),
  MODEL_CONFIG_DOC_ID: 'modelConfig',
}))

// FieldValue.serverTimestamp() — deterministic sentinel for assertions.
vi.mock('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: vi.fn(() => '__serverTimestamp__') },
}))

vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({
    get: vi.fn().mockReturnValue({ value: 'mock-session-token' }),
  }),
}))

import { publishModelConfig, readModelConfig } from './actions'

const adminUser = { uid: 'admin-uid', role: 'admin', tenantId: 'd2' } as AuthenticatedUser

/** The published models map a freshly-read doc exposes by default. */
function defaultModels() {
  return {
    coach: 'claude-sonnet-4-6',
    finder: 'claude-sonnet-4-6',
    reply: 'claude-sonnet-4-6',
    router: 'claude-haiku-4-5',
    grader: 'claude-opus-4-7',
  }
}

describe('MODEL-02 publishModelConfig — Firestore transaction / conflict / pillar-gate / admin / audit', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRunTransaction.mockImplementation(async (fn) => fn({ get: mockTxGet, set: mockTxSet }))
    mockTxGet.mockResolvedValue({ data: () => ({ models: defaultModels() }) })
  })

  it('returns Forbidden for a non-admin (senior-coach) caller (D-17)', async () => {
    const { requireUser } = await import('@/src/firebase/auth')
    vi.mocked(requireUser).mockResolvedValueOnce({
      uid: 'coach-uid', role: 'senior-coach', tenantId: 'd2',
    } as AuthenticatedUser)

    const result = await publishModelConfig('coach', 'claude-opus-4-7', 'claude-sonnet-4-6')
    expect(result).toMatchObject({ ok: false, error: 'Forbidden' })
    expect(mockRunTransaction).not.toHaveBeenCalled()
  })

  it('writes the merged models map (edited pillar updated, the other four preserved)', async () => {
    const { requireUser } = await import('@/src/firebase/auth')
    vi.mocked(requireUser).mockResolvedValueOnce(adminUser)

    const result = await publishModelConfig('coach', 'claude-opus-4-7', 'claude-sonnet-4-6')

    expect(result).toMatchObject({ ok: true })
    expect(mockRunTransaction).toHaveBeenCalledTimes(1)
    expect(mockTxSet).toHaveBeenCalledTimes(1)

    const setData = mockTxSet.mock.calls[0][1]
    expect(setData.models.coach).toBe('claude-opus-4-7')   // edited
    expect(setData.models.finder).toBe('claude-sonnet-4-6') // preserved
    expect(setData.models.router).toBe('claude-haiku-4-5')  // preserved
    expect(setData.tenantId).toBe('d2')                     // converter stamp echoed
    expect(setData.updatedBy).toBe('admin-uid')
  })

  it("returns {ok:false, error:'conflict'} when the stored value changed since load (D-16 — never blind-overwrite)", async () => {
    const { requireUser } = await import('@/src/firebase/auth')
    vi.mocked(requireUser).mockResolvedValueOnce(adminUser)
    const audit = await import('@/src/audit')
    // Another admin already published 'claude-opus-4-7' to coach since this admin loaded.
    mockTxGet.mockResolvedValueOnce({ data: () => ({ models: { ...defaultModels(), coach: 'claude-opus-4-7' } }) })

    // This admin still believes coach is the (now stale) sonnet value.
    const result = await publishModelConfig('coach', 'claude-haiku-4-5', 'claude-sonnet-4-6')

    expect(result).toMatchObject({ ok: false, error: 'conflict' })
    expect(mockTxSet).not.toHaveBeenCalled()                 // never writes on conflict
    expect(vi.mocked(audit.log)).not.toHaveBeenCalled()      // no audit row on conflict
  })

  it("returns {ok:false, error:'publish-failed'} (NOT conflict) when the transaction throws, and writes NO audit row (anti-masking)", async () => {
    const { requireUser } = await import('@/src/firebase/auth')
    vi.mocked(requireUser).mockResolvedValueOnce(adminUser)
    const audit = await import('@/src/audit')
    mockTxGet.mockRejectedValueOnce(new Error('network'))

    const result = await publishModelConfig('coach', 'claude-opus-4-7', 'claude-sonnet-4-6')

    expect(result).toMatchObject({ ok: false, error: 'publish-failed' })
    expect(result).not.toMatchObject({ error: 'conflict' })
    expect(vi.mocked(audit.log)).not.toHaveBeenCalled()
  })

  it('publishes to a previously-unpublished pillar (expectedCurrent = null)', async () => {
    const { requireUser } = await import('@/src/firebase/auth')
    vi.mocked(requireUser).mockResolvedValueOnce(adminUser)
    mockTxGet.mockResolvedValueOnce({ data: () => ({ models: {} }) }) // nothing published yet

    const result = await publishModelConfig('coach', 'claude-opus-4-7', null)

    expect(result).toMatchObject({ ok: true })
    const setData = mockTxSet.mock.calls[0][1]
    expect(setData.models.coach).toBe('claude-opus-4-7')
  })

  it("BUG-1 guard: en adminModelConfig.confirmBody uses {pillar} + {model} (NOT {modelId}) — matches the form's { pillar, model } args", () => {
    const confirmBody = (en.adminModelConfig as { confirmBody: string }).confirmBody
    expect(confirmBody).toContain('{pillar}')
    expect(confirmBody).toContain('{model}')
    expect(confirmBody).not.toContain('{modelId}')
  })

  it('rejects a pillar not in {coach,finder,reply,router,grader} (D-16)', async () => {
    const { requireUser } = await import('@/src/firebase/auth')
    vi.mocked(requireUser).mockResolvedValueOnce(adminUser)

    const result = await publishModelConfig('not-a-pillar', 'claude-opus-4-7', null)
    expect(result).toMatchObject({ ok: false })
    expect(mockRunTransaction).not.toHaveBeenCalled()
  })

  it("writes an action:'model_config_publish' audit row (targetRef appConfig/modelConfig) on success (D-17)", async () => {
    const { requireUser } = await import('@/src/firebase/auth')
    vi.mocked(requireUser).mockResolvedValueOnce(adminUser)
    const audit = await import('@/src/audit')

    await publishModelConfig('coach', 'claude-opus-4-7', 'claude-sonnet-4-6')

    expect(vi.mocked(audit.log)).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'model_config_publish',
        targetRef: 'appConfig/modelConfig',
        raw: expect.objectContaining({ pillar: 'coach', modelId: 'claude-opus-4-7' }),
      }),
    )
  })
})

describe('MODEL-01 readModelConfig — admin-only read of appConfig/modelConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns Forbidden for a non-admin caller', async () => {
    const { requireUser } = await import('@/src/firebase/auth')
    vi.mocked(requireUser).mockResolvedValueOnce({
      uid: 'coach-uid', role: 'senior-coach', tenantId: 'd2',
    } as AuthenticatedUser)

    const result = await readModelConfig()
    expect(result).toMatchObject({ ok: false, error: 'Forbidden' })
  })

  it('maps the 5 pillars, returning null for an unpublished pillar', async () => {
    const { requireUser } = await import('@/src/firebase/auth')
    vi.mocked(requireUser).mockResolvedValueOnce(adminUser)
    // grader unpublished (absent from the map)
    mockDocGet.mockResolvedValueOnce({
      data: () => ({ models: { coach: 'claude-opus-4-7', finder: 'claude-sonnet-4-6', reply: 'claude-sonnet-4-6', router: 'claude-haiku-4-5' } }),
    })

    const result = await readModelConfig()
    expect(result).toMatchObject({ ok: true })
    if (result.ok) {
      const byPillar = Object.fromEntries(result.rows.map((r) => [r.pillar, r.modelId]))
      expect(byPillar.coach).toBe('claude-opus-4-7')
      expect(byPillar.grader).toBeNull()
    }
  })
})
