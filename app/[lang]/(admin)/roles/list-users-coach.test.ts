/**
 * app/[lang]/(admin)/roles/list-users-coach.test.ts — regression for quick-037.
 *
 * The Users page "Senior coach" column reads UserWithRole.seniorCoachId. That value
 * MUST come from the users doc's `uplineCoachId` field (the only coach pointer on
 * UserDoc — there is no `users.seniorCoachId`). Provisioning (auth.ts) and coach
 * reassignment (coach-assignment/actions.ts) both write `uplineCoachId`; a prior bug
 * read a non-existent `data.seniorCoachId`, so /users never reflected a reassignment.
 *
 * This pins the mapping so a future write/read field drift is caught.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { AuthenticatedUser } from '@/src/firebase/auth'

// ─── Mocks (scoped to this file) ──────────────────────────────────────────────

vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({
    get: vi.fn().mockReturnValue({ value: 'mock-session-token' }),
  }),
}))

vi.mock('@/src/firebase/auth', () => ({
  requireUser: vi.fn(),
  setUserClaims: vi.fn().mockResolvedValue(undefined),
  UnauthorizedError: class UnauthorizedError extends Error {},
  InvalidRoleError: class InvalidRoleError extends Error {},
}))

const { mockGetUsers } = vi.hoisted(() => ({ mockGetUsers: vi.fn() }))
vi.mock('@/src/firebase/admin', () => ({
  adminAuth: { getUsers: mockGetUsers },
}))

vi.mock('@/src/audit', () => ({ log: vi.fn().mockResolvedValue(undefined) }))

const { mockUsersGet } = vi.hoisted(() => ({ mockUsersGet: vi.fn() }))
vi.mock('@/src/firebase/collections', () => ({
  usersRef: vi.fn(() => ({
    limit: vi.fn(() => ({ get: mockUsersGet })),
  })),
}))

import { listUsersWithRoles } from './actions'

// ─── Test ─────────────────────────────────────────────────────────────────────

describe('listUsersWithRoles — coach reflects users.uplineCoachId (quick-037)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('maps users.uplineCoachId → seniorCoachId (the field a reassignment writes)', async () => {
    const { requireUser } = await import('@/src/firebase/auth')
    vi.mocked(requireUser).mockResolvedValueOnce({
      uid: 'admin-uid',
      role: 'admin',
      tenantId: 'd2',
    } as AuthenticatedUser)

    mockUsersGet.mockResolvedValueOnce({
      docs: [
        { id: 'agent-1', data: () => ({ role: 'new-agent', uplineCoachId: 'coach-NEW' }) },
        { id: 'agent-2', data: () => ({ role: 'new-agent' }) },
      ],
    })
    // Email resolution returns nothing — the mapping under test is coach, not email.
    mockGetUsers.mockResolvedValue({ users: [] })

    const result = await listUsersWithRoles()

    expect(result.ok).toBe(true)
    if (!result.ok) return

    const byId = Object.fromEntries(result.users.map((u) => [u.id, u]))
    // The reassigned/provisioned coach pointer surfaces on the roster.
    expect(byId['agent-1'].seniorCoachId).toBe('coach-NEW')
    // An agent with no coach → null (never a phantom users.seniorCoachId).
    expect(byId['agent-2'].seniorCoachId).toBeNull()
  })
})
