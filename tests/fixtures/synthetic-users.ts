/**
 * Synthetic test users — NO real PII.
 *
 * All phone numbers, email addresses, and IC numbers are SYNTHETIC.
 * They use placeholder formats that will FAIL the CI PII scan if real data
 * is accidentally substituted (see .github/workflows/ci.yml).
 *
 * Three roles as required by D-11 (all three roles needed in Phase 1):
 *   - new-agent    : the primary proof-slice user (sign-in flow)
 *   - senior-coach : receives handoff/escalation signals (D-10 seam)
 *   - admin        : uses the minimal KB CRUD form (D-10 seam)
 *
 * Every record includes tenantId: 'd2' per the CLAUDE.md / TSD §4 mandate.
 */

export interface SyntheticUser {
  uid: string
  email: string
  displayName: string
  tenantId: 'd2'
  role: 'new-agent' | 'senior-coach' | 'admin'
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

/** All three synthetic users as an array (convenient for table-driven tests). */
export const allSyntheticUsers: SyntheticUser[] = [
  syntheticNewAgent,
  syntheticSeniorCoach,
  syntheticAdmin,
]
