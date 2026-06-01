/**
 * app/api/kb/ingest/upload/route.test.ts
 *
 * Unit tests for the /api/kb/ingest/upload Route Handler.
 *
 * Strategy:
 *   - requireUser and createDocFromFile are mocked via vi.mock().
 *   - A real Request is built with FormData to simulate browser upload behaviour.
 *   - No live Firebase, no real file parsing.
 *
 * Covered cases:
 *   - Non-admin user → 403
 *   - Unauthenticated (UnauthorizedError) → 401
 *   - Unsupported file extension → 415
 *   - File over 20 MB → 413
 *   - Missing file → 400
 *   - Missing title → 400
 *   - Invalid lang → 400
 *   - Invalid pillar → 400
 *   - Happy path → 200 { ok, docId, jobId, total }
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Hoisted mocks ────────────────────────────────────────────────────────────

const { mockRequireUser, mockCreateDocFromFile } = vi.hoisted(() => {
  const mockRequireUser = vi.fn()
  const mockCreateDocFromFile = vi.fn()
  return { mockRequireUser, mockCreateDocFromFile }
})

// ─── Module mocks ─────────────────────────────────────────────────────────────

vi.mock('@/src/firebase/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/src/firebase/auth')>()
  return {
    ...actual,
    requireUser: mockRequireUser,
  }
})

vi.mock('@/src/kb/crud', () => ({
  createDocFromFile: mockCreateDocFromFile,
}))

// ─── Import after mocks ───────────────────────────────────────────────────────

import { UnauthorizedError } from '@/src/firebase/auth'
import { POST } from '@/app/api/kb/ingest/upload/route'

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Build a Request with a FormData body containing the given fields. */
function makeRequest(
  fields: {
    file?: File | null
    title?: string
    lang?: string
    pillar?: string
  },
  authHeader = 'Bearer valid-token',
): Request {
  const form = new FormData()
  if (fields.file !== undefined && fields.file !== null) {
    form.set('file', fields.file)
  }
  if (fields.title !== undefined) form.set('title', fields.title)
  if (fields.lang !== undefined) form.set('lang', fields.lang)
  if (fields.pillar !== undefined) form.set('pillar', fields.pillar)

  return new Request('http://localhost/api/kb/ingest/upload', {
    method: 'POST',
    headers: { Authorization: authHeader },
    body: form,
  })
}

/** Create a synthetic File with a given name and size. */
function makeFile(name: string, sizeBytes: number, type = 'application/pdf'): File {
  // Fill with zeros to the requested size
  const content = new Uint8Array(sizeBytes)
  return new File([content], name, { type })
}

// ─── Admin user fixture ───────────────────────────────────────────────────────

const ADMIN_USER = { uid: 'admin-uid', role: 'admin' as const, tenantId: 'd2' }
const NON_ADMIN_USER = { uid: 'agent-uid', role: 'new-agent' as const, tenantId: 'd2' }

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('POST /api/kb/ingest/upload', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRequireUser.mockResolvedValue(ADMIN_USER)
    mockCreateDocFromFile.mockResolvedValue({
      docId: 'doc-abc',
      jobId: 'job-xyz',
      total: 5,
      remaining: 5,
    })
  })

  // ── Auth guards ─────────────────────────────────────────────────────────────

  it('returns 401 when requireUser throws UnauthorizedError', async () => {
    mockRequireUser.mockRejectedValue(new UnauthorizedError('Token missing'))

    const req = makeRequest({ file: makeFile('a.pdf', 100), title: 'T', lang: 'en', pillar: 'coach' })
    const res = await POST(req)

    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.ok).toBe(false)
  })

  it('returns 403 when user is not admin', async () => {
    mockRequireUser.mockResolvedValue(NON_ADMIN_USER)

    const req = makeRequest({ file: makeFile('a.pdf', 100), title: 'T', lang: 'en', pillar: 'coach' })
    const res = await POST(req)

    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.ok).toBe(false)
    expect(body.error).toMatch(/admin/i)
  })

  // ── File validation ──────────────────────────────────────────────────────────

  it('returns 400 when no file field is present', async () => {
    const req = makeRequest({ title: 'T', lang: 'en', pillar: 'coach' })
    const res = await POST(req)

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.ok).toBe(false)
  })

  it('returns 415 for an unsupported file extension (.exe)', async () => {
    const req = makeRequest({
      file: makeFile('malware.exe', 100, 'application/octet-stream'),
      title: 'T',
      lang: 'en',
      pillar: 'coach',
    })
    const res = await POST(req)

    expect(res.status).toBe(415)
    const body = await res.json()
    expect(body.ok).toBe(false)
    expect(body.error).toMatch(/unsupported/i)
  })

  it('returns 415 for a file with no extension', async () => {
    const req = makeRequest({
      file: makeFile('noextension', 100, 'application/octet-stream'),
      title: 'T',
      lang: 'en',
      pillar: 'coach',
    })
    const res = await POST(req)

    expect(res.status).toBe(415)
  })

  it('returns 413 when file exceeds 20 MB', async () => {
    const TWENTY_ONE_MB = 21 * 1024 * 1024
    const req = makeRequest({
      file: makeFile('big.pdf', TWENTY_ONE_MB),
      title: 'T',
      lang: 'en',
      pillar: 'coach',
    })
    const res = await POST(req)

    expect(res.status).toBe(413)
    const body = await res.json()
    expect(body.ok).toBe(false)
    expect(body.error).toMatch(/20 MB/i)
  })

  it('accepts exactly 20 MB (boundary — should NOT return 413)', async () => {
    const EXACTLY_TWENTY_MB = 20 * 1024 * 1024
    const req = makeRequest({
      file: makeFile('exact.pdf', EXACTLY_TWENTY_MB),
      title: 'Exact size doc',
      lang: 'en',
      pillar: 'coach',
    })
    const res = await POST(req)

    // Should NOT be a 413 — we only reject > 20 MB
    expect(res.status).not.toBe(413)
  })

  // ── Text field validation ────────────────────────────────────────────────────

  it('returns 400 when title is missing', async () => {
    const req = makeRequest({ file: makeFile('a.pdf', 100), lang: 'en', pillar: 'coach' })
    const res = await POST(req)

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.ok).toBe(false)
  })

  it('returns 400 when title is empty', async () => {
    const req = makeRequest({ file: makeFile('a.pdf', 100), title: '', lang: 'en', pillar: 'coach' })
    const res = await POST(req)

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.ok).toBe(false)
  })

  it('returns 400 when lang is invalid', async () => {
    const req = makeRequest({ file: makeFile('a.pdf', 100), title: 'T', lang: 'fr', pillar: 'coach' })
    const res = await POST(req)

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.ok).toBe(false)
    expect(body.error).toMatch(/lang/i)
  })

  it('returns 400 when pillar is invalid', async () => {
    const req = makeRequest({ file: makeFile('a.pdf', 100), title: 'T', lang: 'en', pillar: 'unknown' })
    const res = await POST(req)

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.ok).toBe(false)
    expect(body.error).toMatch(/pillar/i)
  })

  // ── Allowed extensions ───────────────────────────────────────────────────────

  it.each([
    ['a.pdf', 'application/pdf'],
    ['a.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
    ['a.doc', 'application/msword'],
    ['a.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
    ['a.pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'],
    ['a.txt', 'text/plain'],
  ])('accepts %s extension → 200', async (name, mime) => {
    const req = makeRequest({
      file: makeFile(name, 100, mime),
      title: 'Valid doc',
      lang: 'en',
      pillar: 'coach',
    })
    const res = await POST(req)

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
  })

  // ── Happy path ───────────────────────────────────────────────────────────────

  it('returns 200 with { ok, docId, jobId, total } on happy path', async () => {
    const req = makeRequest({
      file: makeFile('report.pdf', 1024),
      title: 'Sales Report Q1',
      lang: 'en',
      pillar: 'finder',
    })
    const res = await POST(req)

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.docId).toBe('doc-abc')
    expect(body.jobId).toBe('job-xyz')
    expect(body.total).toBe(5)
  })

  it('passes the correct arguments to createDocFromFile', async () => {
    const req = makeRequest({
      file: makeFile('onboarding.docx', 500, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'),
      title: 'Onboarding Guide',
      lang: 'ms',
      pillar: 'coach',
    })
    await POST(req)

    expect(mockCreateDocFromFile).toHaveBeenCalledOnce()
    const [user, input] = mockCreateDocFromFile.mock.calls[0]
    expect(user).toEqual(ADMIN_USER)
    expect(input.title).toBe('Onboarding Guide')
    expect(input.lang).toBe('ms')
    expect(input.pillar).toBe('coach')
    expect(input.file.name).toBe('onboarding.docx')
    expect(Buffer.isBuffer(input.file.buffer)).toBe(true)
  })
})
