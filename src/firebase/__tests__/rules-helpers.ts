/**
 * rules-helpers.ts — @firebase/rules-unit-testing bootstrap.
 *
 * Boots an in-memory Firestore emulator environment from the project's
 * firestore.rules file and exposes:
 *  - `authedContext(uid, claims)` — returns a Firestore client pre-authorized
 *    with the given UID and custom claims (role, tenantId, etc.)
 *  - `unauthContext()` — returns an unauthenticated Firestore client
 *  - `adminContext()` — admin client that bypasses rules (for seeding test data)
 *  - `cleanup()` — call in afterAll() to tear down the emulator environment
 *
 * Three roles from tests/fixtures/synthetic-users.ts:
 *  - new-agent  : syntheticNewAgent.uid, role:'new-agent', tenantId:'d2'
 *  - senior-coach : syntheticSeniorCoach.uid, role:'senior-coach', tenantId:'d2'
 *  - admin : syntheticAdmin.uid, role:'admin', tenantId:'d2'
 */

import {
  initializeTestEnvironment,
  type RulesTestEnvironment,
  type RulesTestContext,
} from '@firebase/rules-unit-testing'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import {
  syntheticNewAgent,
  syntheticSeniorCoach,
  syntheticAdmin,
  syntheticReadOnly,
  type SyntheticUser,
} from '@/tests/fixtures/synthetic-users'

// ─── Emulator config (must match firebase.json) ──────────────────────────────
const EMULATOR_HOST = '127.0.0.1'
const EMULATOR_PORT = 8080
const PROJECT_ID = 'demo-cy-csaiagent' // demo- prefix required for emulator

// ─── Load rules file ─────────────────────────────────────────────────────────
const RULES_PATH = resolve(process.cwd(), 'firestore.rules')

// ─── Environment singleton ───────────────────────────────────────────────────
let _env: RulesTestEnvironment | null = null

/**
 * Initialize the @firebase/rules-unit-testing environment.
 * Safe to call multiple times — returns the same instance.
 */
export async function getTestEnv(): Promise<RulesTestEnvironment> {
  if (_env) return _env

  const rules = readFileSync(RULES_PATH, 'utf8')

  _env = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      host: EMULATOR_HOST,
      port: EMULATOR_PORT,
      rules,
    },
  })

  return _env
}

/**
 * Return a Firestore context authenticated as the given user.
 *
 * @param uid   The user's Firebase UID.
 * @param claims Custom token claims (role, tenantId, etc.)
 */
export async function authedContext(
  uid: string,
  claims: Record<string, string>
): Promise<RulesTestContext> {
  const env = await getTestEnv()
  return env.authenticatedContext(uid, claims)
}

/**
 * Return an unauthenticated Firestore context.
 * Used to assert that public reads are denied by default.
 */
export async function unauthContext(): Promise<RulesTestContext> {
  const env = await getTestEnv()
  return env.unauthenticatedContext()
}

/**
 * Return an admin Firestore context that bypasses Security Rules.
 * Used to seed test data before running deny assertions.
 */
export async function adminContext(): Promise<RulesTestContext> {
  const env = await getTestEnv()
  // withSecurityRulesDisabled gives an admin-equivalent context
  let ctx!: RulesTestContext
  await env.withSecurityRulesDisabled(async (adminCtx) => {
    ctx = adminCtx
  })
  return ctx
}

// ─── Pre-built context factories for each role ───────────────────────────────

/** Returns a context for the synthetic new-agent (role:'new-agent', tenantId:'d2'). */
export async function newAgentCtx(): Promise<RulesTestContext> {
  return authedContext(syntheticNewAgent.uid, {
    role: syntheticNewAgent.role,
    tenantId: syntheticNewAgent.tenantId,
  })
}

/** Returns a context for the synthetic senior-coach (role:'senior-coach', tenantId:'d2'). */
export async function seniorCoachCtx(): Promise<RulesTestContext> {
  return authedContext(syntheticSeniorCoach.uid, {
    role: syntheticSeniorCoach.role,
    tenantId: syntheticSeniorCoach.tenantId,
  })
}

/** Returns a context for the synthetic admin (role:'admin', tenantId:'d2'). */
export async function adminRoleCtx(): Promise<RulesTestContext> {
  return authedContext(syntheticAdmin.uid, {
    role: syntheticAdmin.role,
    tenantId: syntheticAdmin.tenantId,
  })
}

/**
 * Returns a context for the synthetic read-only stakeholder
 * (role:'read-only', tenantId:'d2') — Phase 6, RO-01.
 *
 * Used to assert the read-only rules matrix: CAN read analytics aggregates
 * (usageRollups/usageEvents/evals) + KB read collections; DENIED every PII
 * collection and DENIED write everywhere.
 */
export async function readOnlyCtx(): Promise<RulesTestContext> {
  return authedContext(syntheticReadOnly.uid, {
    role: syntheticReadOnly.role,
    tenantId: syntheticReadOnly.tenantId,
  })
}

/**
 * Tear down the emulator environment.
 * Call in afterAll() to prevent resource leaks.
 */
export async function cleanup(): Promise<void> {
  if (_env) {
    await _env.cleanup()
    _env = null
  }
}

/** Re-export synthetic user fixtures for convenience in test files. */
export { syntheticNewAgent, syntheticSeniorCoach, syntheticAdmin, syntheticReadOnly }
export type { SyntheticUser }
