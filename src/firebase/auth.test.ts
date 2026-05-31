/**
 * src/firebase/auth.test.ts
 *
 * Unit tests for the server-side auth gate (requireUser) and claim-setting
 * helper (setUserClaims). These tests use a mocked adminAuth so they run
 * offline without live Firebase credentials.
 *
 * Behaviors under test:
 *   1. requireUser — valid token returns { uid, role, tenantId } from claims.
 *   2. requireUser — missing/invalid token throws (fails closed, 401-equivalent).
 *   3. setUserClaims — calls setCustomUserClaims with { role, tenantId:'d2' }
 *                     and rejects an unknown role string.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mock firebase-admin/auth BEFORE importing auth.ts ───────────────────────
// vi.hoisted() ensures mock variables are available when vi.mock() factories run.
const { mockVerifyIdToken, mockSetCustomUserClaims, mockDocSet } = vi.hoisted(() => ({
  mockVerifyIdToken: vi.fn(),
  mockSetCustomUserClaims: vi.fn(),
  mockDocSet: vi.fn(),
}))

// Build a chainable mock: adminDb.collection('x').withConverter(c).doc('id').set(data)
// collections.ts calls withConverter() on the collection ref, then .doc().set()
const mockDocRef = {
  set: () => mockDocSet(),
  update: vi.fn(),
}
const mockCollectionRef = {
  doc: () => mockDocRef,
  withConverter: () => ({
    doc: () => mockDocRef,
    withConverter: () => ({ doc: () => mockDocRef }),
  }),
}

vi.mock('@/src/firebase/admin', () => ({
  adminAuth: {
    verifyIdToken: mockVerifyIdToken,
    setCustomUserClaims: mockSetCustomUserClaims,
  },
  adminDb: {
    collection: () => mockCollectionRef,
  },
}))

// Import AFTER mocks are registered
import { requireUser, setUserClaims, UnauthorizedError } from '@/src/firebase/auth'

// ── Test helpers ─────────────────────────────────────────────────────────────

function makeRequest(authHeader?: string): Request {
  const headers: HeadersInit = {}
  if (authHeader) {
    headers['Authorization'] = authHeader
  }
  return new Request('https://example.com/api/test', { headers })
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('requireUser', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('Behavior 1: returns { uid, role, tenantId } from verified token claims (NOT from request body)', async () => {
    // Arrange — mock a valid verifyIdToken result carrying custom claims
    const decodedToken = {
      uid: 'test-uid-new-agent-001',
      role: 'new-agent' as const,
      tenantId: 'd2',
    }
    mockVerifyIdToken.mockResolvedValueOnce(decodedToken)

    const req = makeRequest('Bearer valid-id-token-string')

    // Act
    const result = await requireUser(req)

    // Assert — role/tenantId come from verifyIdToken output, not the request body
    expect(mockVerifyIdToken).toHaveBeenCalledWith('valid-id-token-string')
    expect(result).toEqual({
      uid: 'test-uid-new-agent-001',
      role: 'new-agent',
      tenantId: 'd2',
    })
  })

  it('Behavior 2a: throws UnauthorizedError when Authorization header is missing', async () => {
    // Arrange — request with no Authorization header
    const req = makeRequest()

    // Act + Assert — gate fails closed
    await expect(requireUser(req)).rejects.toThrow(UnauthorizedError)
    // verifyIdToken should not be called if no token is present
    expect(mockVerifyIdToken).not.toHaveBeenCalled()
  })

  it('Behavior 2b: throws UnauthorizedError when token is invalid / verifyIdToken rejects', async () => {
    // Arrange — adminAuth rejects (expired, forged, revoked token)
    mockVerifyIdToken.mockRejectedValueOnce(new Error('Firebase: invalid token'))

    const req = makeRequest('Bearer invalid-or-expired-token')

    // Act + Assert — gate fails closed on any verify error
    await expect(requireUser(req)).rejects.toThrow(UnauthorizedError)
  })
})

describe('setUserClaims', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSetCustomUserClaims.mockResolvedValue(undefined)
    mockDocSet.mockResolvedValue(undefined)
  })

  it('Behavior 3a: calls setCustomUserClaims with { role, tenantId:"d2" } for all valid roles', async () => {
    const validRoles = ['new-agent', 'senior-coach', 'admin'] as const

    for (const role of validRoles) {
      vi.clearAllMocks()
      mockSetCustomUserClaims.mockResolvedValue(undefined)
      mockDocSet.mockResolvedValue(undefined)

      await setUserClaims('<UID_PLACEHOLDER>', role)

      expect(mockSetCustomUserClaims).toHaveBeenCalledWith('<UID_PLACEHOLDER>', {
        role,
        tenantId: 'd2',
      })
    }
  })

  it('Behavior 3b: rejects an unknown role string (type-narrowed at runtime)', async () => {
    // Cast to bypass TS type check — simulates a runtime call with a bad value
    await expect(
      setUserClaims('<UID_PLACEHOLDER>', 'superadmin' as 'admin')
    ).rejects.toThrow(/invalid role/i)

    // setCustomUserClaims must NOT be called with a bad role
    expect(mockSetCustomUserClaims).not.toHaveBeenCalled()
  })
})
