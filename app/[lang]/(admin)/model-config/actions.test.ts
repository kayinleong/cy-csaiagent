// Phase-7 Wave-0 RED stub — implementation lands in 07-05-PLAN.md

/**
 * app/[lang]/(admin)/model-config/actions.test.ts — MODEL-02 Remote Config publish contract.
 *
 * Pins the secure behavior of publishModelConfig (D-15 / D-16 / D-17) — the ONE
 * net-new mechanism of Phase 7 (the Remote Config WRITE round-trip):
 *   1. ETag round-trip (D-16): reads the writable template via getTemplate() (NOT
 *      getServerTemplate — the server template has no writable ETag), mutates ONLY
 *      the one `model.{pillar}.default` key, then publishTemplate(template) WITHOUT
 *      { force:true } so the ETag provides optimistic concurrency.
 *   2. CONFLICT (D-16): a publishTemplate rejection (stale ETag) → {ok:false,
 *      error:'conflict'} — never a blind overwrite.
 *   3. PILLAR ALLOW-LIST (D-16): a pillar not in {coach,finder,reply,router,grader}
 *      is rejected — the UI exposes ONLY the 5 model.{pillar}.default keys.
 *   4. ADMIN-ONLY (D-17): non-admin → Forbidden (role from VERIFIED token).
 *   5. AUDITED (D-17): writes action:'model_config_publish'.
 *   (D-15: model IDs stay free-form strings — no hard-coded allow-list of model names.)
 *
 * RED-BY-DESIGN: ./actions does not exist until 07-05 → the import rejects.
 * No emulator needed — Remote Config is mocked.
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

// Fake Remote Config template carrying an ETag + the 5 pillar keys.
function makeFakeTemplate() {
  return {
    etag: 'etag-current-001',
    parameters: {
      'model.coach.default': { defaultValue: { value: 'claude-sonnet-4-6' } },
      'model.finder.default': { defaultValue: { value: 'claude-sonnet-4-6' } },
      'model.reply.default': { defaultValue: { value: 'claude-sonnet-4-6' } },
      'model.router.default': { defaultValue: { value: 'claude-haiku-4-5' } },
      'model.grader.default': { defaultValue: { value: 'claude-opus-4-7' } },
    } as Record<string, { defaultValue: { value: string } }>,
  }
}

const mockGetTemplate = vi.fn()
const mockGetServerTemplate = vi.fn()
const mockPublishTemplate = vi.fn()

vi.mock('@/src/firebase/admin', () => ({
  remoteConfig: vi.fn(() => ({
    getTemplate: mockGetTemplate,
    getServerTemplate: mockGetServerTemplate,
    publishTemplate: mockPublishTemplate,
  })),
}))

vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({
    get: vi.fn().mockReturnValue({ value: 'mock-session-token' }),
  }),
}))

// This import FAILS until 07-05 creates the action module (Wave-0 red-bar intent):
import { publishModelConfig } from './actions'

const adminUser = { uid: 'admin-uid', role: 'admin', tenantId: 'd2' } as AuthenticatedUser

describe('MODEL-02 publishModelConfig — ETag/no-force/conflict/pillar-gate/admin/audit', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetTemplate.mockResolvedValue(makeFakeTemplate())
    mockPublishTemplate.mockResolvedValue(undefined)
  })

  it("returns Forbidden for a non-admin (senior-coach) caller (D-17)", async () => {
    const { requireUser } = await import('@/src/firebase/auth')
    vi.mocked(requireUser).mockResolvedValueOnce({
      uid: 'coach-uid', role: 'senior-coach', tenantId: 'd2',
    } as AuthenticatedUser)

    const result = await publishModelConfig('coach', 'claude-opus-4-7')
    expect(result).toMatchObject({ ok: false, error: 'Forbidden' })
    expect(mockPublishTemplate).not.toHaveBeenCalled()
  })

  it('reads the writable template via getTemplate() (NOT getServerTemplate) and mutates ONLY the one model.{pillar}.default key', async () => {
    const { requireUser } = await import('@/src/firebase/auth')
    vi.mocked(requireUser).mockResolvedValueOnce(adminUser)

    await publishModelConfig('coach', 'claude-opus-4-7')

    expect(mockGetTemplate).toHaveBeenCalledTimes(1)
    expect(mockGetServerTemplate).not.toHaveBeenCalled()

    // The published template must carry the NEW coach value and leave the other 4 keys untouched.
    const published = mockPublishTemplate.mock.calls[0][0]
    expect(published.parameters['model.coach.default'].defaultValue.value).toBe('claude-opus-4-7')
    expect(published.parameters['model.finder.default'].defaultValue.value).toBe('claude-sonnet-4-6')
    expect(published.parameters['model.router.default'].defaultValue.value).toBe('claude-haiku-4-5')
  })

  it('calls publishTemplate WITHOUT { force:true } (ETag optimistic concurrency, D-16)', async () => {
    const { requireUser } = await import('@/src/firebase/auth')
    vi.mocked(requireUser).mockResolvedValueOnce(adminUser)

    await publishModelConfig('finder', 'claude-sonnet-4-6')

    expect(mockPublishTemplate).toHaveBeenCalledTimes(1)
    const opts = mockPublishTemplate.mock.calls[0][1]
    // Either no second arg at all, or a second arg WITHOUT force:true.
    if (opts !== undefined) {
      expect(opts.force).not.toBe(true)
    }
  })

  it("returns {ok:false, error:'conflict'} when publishTemplate rejects with a stale-ETag code (failed-precondition — never blind-overwrite, D-16)", async () => {
    const { requireUser } = await import('@/src/firebase/auth')
    vi.mocked(requireUser).mockResolvedValueOnce(adminUser)
    // Real stale-ETag shape: a FirebaseRemoteConfigError carries a prefixed `.code`.
    mockPublishTemplate.mockRejectedValueOnce(
      Object.assign(new Error('VERSION_MISMATCH'), { code: 'remote-config/failed-precondition' }),
    )

    const result = await publishModelConfig('coach', 'claude-opus-4-7')
    expect(result).toMatchObject({ ok: false, error: 'conflict' })
  })

  it("returns {ok:false, error:'permission-denied'} when publishTemplate rejects with permission-denied, and writes NO audit row (D-17)", async () => {
    const { requireUser } = await import('@/src/firebase/auth')
    vi.mocked(requireUser).mockResolvedValueOnce(adminUser)
    const audit = await import('@/src/audit')
    mockPublishTemplate.mockRejectedValueOnce(
      Object.assign(new Error('insufficient permission'), { code: 'remote-config/permission-denied' }),
    )

    const result = await publishModelConfig('coach', 'claude-opus-4-7')
    expect(result).toMatchObject({ ok: false, error: 'permission-denied' })
    expect(mockPublishTemplate).toHaveBeenCalledTimes(1)
    // Failed publish writes no audit row (D-17 — audit is success-only).
    expect(vi.mocked(audit.log)).not.toHaveBeenCalled()
  })

  it("returns {ok:false, error:'publish-failed'} (NOT masked as conflict) when publishTemplate rejects with a plain Error, and writes NO audit row (anti-masking, D-17)", async () => {
    const { requireUser } = await import('@/src/firebase/auth')
    vi.mocked(requireUser).mockResolvedValueOnce(adminUser)
    const audit = await import('@/src/audit')
    // A plain Error with no `.code` must fall through to publish-failed, not conflict.
    mockPublishTemplate.mockRejectedValueOnce(new Error('network'))

    const result = await publishModelConfig('coach', 'claude-opus-4-7')
    expect(result).toMatchObject({ ok: false, error: 'publish-failed' })
    expect(result).not.toMatchObject({ error: 'conflict' })
    expect(vi.mocked(audit.log)).not.toHaveBeenCalled()
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

    const result = await publishModelConfig('not-a-pillar', 'claude-opus-4-7')
    expect(result).toMatchObject({ ok: false })
    expect(mockPublishTemplate).not.toHaveBeenCalled()
  })

  it("writes an action:'model_config_publish' audit row on success (D-17)", async () => {
    const { requireUser } = await import('@/src/firebase/auth')
    vi.mocked(requireUser).mockResolvedValueOnce(adminUser)
    const audit = await import('@/src/audit')

    await publishModelConfig('coach', 'claude-opus-4-7')

    expect(vi.mocked(audit.log)).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'model_config_publish' }),
    )
  })
})
