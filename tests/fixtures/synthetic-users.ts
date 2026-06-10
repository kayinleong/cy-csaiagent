/**
 * Synthetic test users — NO real PII.
 *
 * All phone numbers, email addresses, and IC numbers are SYNTHETIC.
 * They use placeholder formats that will FAIL the CI PII scan if real data
 * is accidentally substituted (see .github/workflows/ci.yml).
 *
 * Roles:
 *   - new-agent    : the primary proof-slice user (sign-in flow)
 *   - senior-coach : receives handoff/escalation signals (D-10 seam)
 *   - admin        : uses the minimal KB CRUD form (D-10 seam)
 *   - read-only    : Phase-6 reporting/analytics stakeholder (RO-01) — read-only
 *                    access to analytics aggregates; DENIED every write/admin
 *                    surface and every PII collection. NOT an agent, NOT a coach.
 *
 * Every record includes tenantId: 'd2' per the CLAUDE.md / TSD §4 mandate.
 */

export interface SyntheticUser {
  uid: string
  email: string
  displayName: string
  tenantId: 'd2'
  role: 'new-agent' | 'senior-coach' | 'admin' | 'read-only'
  /** Placeholder phone — NOT a real Malaysian number (+60 prefix omitted intentionally) */
  phone: string
  /** Only set for new-agent: which senior coach manages this agent */
  uplineCoachId?: string
  /** Only set for senior-coach: alias for their own uid for clarity */
  seniorCoachId?: string
}

/**
 * Synthetic new-agent user.
 * Represents a freshly onboarded D2 property agent in week 1 of training.
 */
export const syntheticNewAgent: SyntheticUser = {
  uid: 'test-uid-new-agent-001',
  email: 'alice.lim.test@example.com',
  displayName: 'Alice Lim (Test)',
  tenantId: 'd2',
  role: 'new-agent',
  phone: '+00-PLACEHOLDER-001',        // synthetic — real MY format would be +601x-xxxxxxx
  uplineCoachId: 'test-uid-coach-001', // references the senior-coach below
}

/**
 * Synthetic senior-coach user.
 * Manages a downline of new agents, receives handoff/escalation signals.
 */
export const syntheticSeniorCoach: SyntheticUser = {
  uid: 'test-uid-coach-001',
  email: 'bob.tan.coach.test@example.com',
  displayName: 'Bob Tan Coach (Test)',
  tenantId: 'd2',
  role: 'senior-coach',
  phone: '+00-PLACEHOLDER-002',
  seniorCoachId: 'test-uid-coach-001',  // self-reference for clarity
}

/**
 * Synthetic admin user.
 * Has access to the minimal KB CRUD form to manage knowledge base documents.
 */
export const syntheticAdmin: SyntheticUser = {
  uid: 'test-uid-admin-001',
  email: 'carol.admin.test@example.com',
  displayName: 'Carol Admin (Test)',
  tenantId: 'd2',
  role: 'admin',
  phone: '+00-PLACEHOLDER-003',
}

/**
 * Synthetic read-only stakeholder user (Phase 6, RO-01).
 *
 * A 4th role tier for a reporting/analytics stakeholder. Has READ access to
 * analytics aggregates only (usageRollups, usageEvents, evals) plus the KB read
 * collections it already shares as a signed-in tenant user. DENIED read on every
 * PII/owner-scoped collection and DENIED write everywhere. It is NOT an agent
 * (no uplineCoachId) and NOT a coach (no seniorCoachId) — least-privilege by
 * construction.
 */
export const syntheticReadOnly: SyntheticUser = {
  uid: 'test-uid-readonly-001',
  email: 'dave.stakeholder.test@example.com',
  displayName: 'Dave Stakeholder (Test)',
  tenantId: 'd2',
  role: 'read-only',
  phone: '+00-PLACEHOLDER-004',
}

/** All four synthetic users as an array (convenient for table-driven tests). */
export const allSyntheticUsers: SyntheticUser[] = [
  syntheticNewAgent,
  syntheticSeniorCoach,
  syntheticAdmin,
  syntheticReadOnly,
]
