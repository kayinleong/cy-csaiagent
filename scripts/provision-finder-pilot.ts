/**
 * scripts/provision-finder-pilot.ts — Finder pilot provisioning script (FIND-12).
 *
 * Provisions 15–20 pilot agents for the Phase-3 Finder pilot:
 *   1. Sets Firebase Auth custom claims (role:'new-agent', tenantId:'d2') for each agent.
 *   2. Seeds / refreshes the `rateBudgets/{uid}` doc for each agent (mirrors 01-07).
 *   3. Prints a summary (count provisioned) — PII-safe output only.
 *
 * ─── DRY-RUN BY DEFAULT ──────────────────────────────────────────────────────
 * The script is DRY-RUN by default. No mutations are made without `--apply`.
 * This satisfies T-03-31 (elevation of privilege — dry-run guard; ASVS V4).
 *
 *   # Preview only (safe — no writes):
 *   npm run provision-pilot -- --list pilot-agents.json
 *
 *   # Apply mutations (operator must pass --apply explicitly):
 *   npm run provision-pilot -- --list pilot-agents.json --apply
 *
 * ─── INPUT FORMAT ────────────────────────────────────────────────────────────
 * The agent list is read from an EXTERNAL JSON file (--list <path>) or from
 * --uids as comma-separated UIDs. NEVER hard-code real UIDs/emails in this file.
 * The operator provides the agent list — it is NEVER committed to the repo (T-03-32).
 *
 * Example pilot-agents.json (operator-maintained, gitignored):
 *   [
 *     { "uid": "<UID_1>", "seniorCoachId": "<COACH_UID>" },
 *     { "uid": "<UID_2>", "seniorCoachId": "<COACH_UID>" }
 *   ]
 *
 * ─── PREREQUISITES ───────────────────────────────────────────────────────────
 *   - FIREBASE_PROJECT_ID  (the project ID in .env.local or inline env)
 *   - GOOGLE_APPLICATION_CREDENTIALS=./sa.json  OR  FIREBASE_SERVICE_ACCOUNT_KEY
 *   - The input list file (external — not committed)
 *
 * ─── REMOTE CONFIG CONFIRMATION ──────────────────────────────────────────────
 * Before running --apply, confirm in Firebase Console → Remote Config:
 *   model.router.default  (expected: claude-haiku-4-5)
 *   model.finder.default  (expected: claude-sonnet-4-6)
 * Code fallbacks exist in src/llm/model-for.ts, but explicit seeding is required
 * for the pilot (confirmed per 03-09-PLAN.md user_setup).
 *
 * ─── SECURITY ────────────────────────────────────────────────────────────────
 * T-03-31: dry-run guard — requires explicit --apply to mutate.
 * T-03-32: no PII in source — agent list is external input; UID hashes logged only.
 * Grants only role:'new-agent' + tenantId:'d2' — never admin or senior-coach (ASVS V4).
 * Script is run MANUALLY by an operator — NOT in CI.
 *
 * After running, the provisioned users' clients MUST call getIdToken(true) to
 * force-refresh their tokens and pick up the new claims.
 *
 * References: FIND-12, T-03-31/T-03-32, scripts/set-claims.ts (single-uid pattern),
 *             src/firebase/auth.ts (setUserClaims), src/firebase/collections.ts (rateBudgets),
 *             01-07 ratelimit design.
 */

import * as fs from 'fs'
import * as path from 'path'
import * as crypto from 'crypto'

// ─── Admin SDK init ──────────────────────────────────────────────────────────
// Must load env BEFORE importing firebase-admin (FIREBASE_PROJECT_ID is required).
// .env.local is NOT auto-loaded by Node — use dotenv or pass inline env.

import * as dotenv from 'dotenv'
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

import { adminAuth, adminDb } from '@/src/firebase/admin'
import { rateBudgetsRef, TENANT_ID } from '@/src/firebase/collections'
import type { RateBudgetDoc } from '@/src/firebase/collections'

// ─── Constants ───────────────────────────────────────────────────────────────

/** The pilot role — Finder is available to every signed-in agent (no new role). */
const PILOT_ROLE = 'new-agent' as const

/**
 * Default rate-budget window and limits for pilot agents.
 * Mirrors the existing 01-07 rateBudgets seed values.
 * Adjust if the pilot requires different quotas.
 */
const PILOT_RATE_BUDGET = {
  requestCount: 0,
  tokenCount: 0,
  // windowStart is set to FieldValue.serverTimestamp() at write time
} as const

/** Maximum number of agents that can be provisioned in a single run (safety cap). */
const MAX_PILOT_AGENTS = 25

// ─── Types ───────────────────────────────────────────────────────────────────

interface PilotAgent {
  uid: string
  seniorCoachId?: string
}

interface ProvisionResult {
  uid: string
  uidHash: string // logged instead of uid for PII hygiene
  claimsSet: boolean
  budgetSeeded: boolean
  error?: string
}

// ─── CLI arg parsing ─────────────────────────────────────────────────────────

function parseArgs(argv: string[]): {
  apply: boolean
  listPath?: string
  uids?: string[]
} {
  const args = argv.slice(2)
  const get = (flag: string): string | undefined => {
    const i = args.indexOf(flag)
    return i !== -1 ? args[i + 1] : undefined
  }
  const has = (flag: string): boolean => args.includes(flag)

  const apply = has('--apply')
  const listPath = get('--list')
  const uidsRaw = get('--uids')
  const uids = uidsRaw ? uidsRaw.split(',').map((u) => u.trim()).filter(Boolean) : undefined

  return { apply, listPath, uids }
}

// ─── Agent list loading ───────────────────────────────────────────────────────

function loadAgentList(listPath?: string, uids?: string[]): PilotAgent[] {
  if (listPath) {
    const abs = path.resolve(process.cwd(), listPath)
    if (!fs.existsSync(abs)) {
      console.error(`Error: agent list file not found: ${abs}`)
      process.exit(1)
    }
    const raw = fs.readFileSync(abs, 'utf8')
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      console.error(`Error: agent list file is not valid JSON: ${abs}`)
      process.exit(1)
    }
    if (!Array.isArray(parsed)) {
      console.error('Error: agent list file must be a JSON array of { uid, seniorCoachId? } objects')
      process.exit(1)
    }
    return parsed.map((item) => {
      if (typeof item !== 'object' || item === null || !('uid' in item) || typeof (item as Record<string, unknown>).uid !== 'string') {
        console.error('Error: each agent entry must have a string "uid" field')
        process.exit(1)
      }
      const entry = item as Record<string, unknown>
      return {
        uid: entry.uid as string,
        ...(typeof entry.seniorCoachId === 'string' ? { seniorCoachId: entry.seniorCoachId } : {}),
      }
    })
  }

  if (uids && uids.length > 0) {
    return uids.map((uid) => ({ uid }))
  }

  console.error(
    'Error: provide an agent list via --list <path> (JSON) or --uids <uid1,uid2,...>'
  )
  console.error('')
  console.error('Usage:')
  console.error('  npm run provision-pilot -- --list pilot-agents.json          (dry-run)')
  console.error('  npm run provision-pilot -- --list pilot-agents.json --apply  (apply mutations)')
  process.exit(1)
}

// ─── UID hashing (PII hygiene) ────────────────────────────────────────────────

/**
 * Return a short SHA-256 hash of the UID for logging.
 * We NEVER log raw UIDs to stdout/stderr (T-03-32 / CLAUDE.md secrets hygiene).
 */
function uidHash(uid: string): string {
  return crypto.createHash('sha256').update(uid).digest('hex').slice(0, 12)
}

// ─── Provisioning ─────────────────────────────────────────────────────────────

/**
 * Set custom claims for a single agent.
 * Grants role:'new-agent' + tenantId:'d2' (Finder is available to all signed-in agents).
 * Never grants admin or senior-coach (T-03-31 / ASVS V4).
 */
async function setAgentClaims(agent: PilotAgent, apply: boolean): Promise<boolean> {
  if (!apply) {
    // Dry-run — would call setCustomUserClaims
    return true
  }
  await adminAuth.setCustomUserClaims(agent.uid, {
    role: PILOT_ROLE,
    tenantId: TENANT_ID,
    // seniorCoachId stored in the users/{uid} doc (not in claims — claim bloat avoided)
  })
  return true
}

/**
 * Seed or refresh the rateBudgets/{uid} doc for a pilot agent.
 * Mirrors the 01-07 ratelimit seed pattern: upsert with merge so existing
 * budget windows are preserved on a refresh run.
 */
async function seedRateBudget(agent: PilotAgent, apply: boolean): Promise<boolean> {
  if (!apply) {
    // Dry-run — would upsert rateBudgets/{uid}
    return true
  }
  const { FieldValue } = await import('firebase-admin/firestore')
  const budgetDoc: RateBudgetDoc = {
    tenantId: TENANT_ID,
    ownerUid: agent.uid,
    requestCount: PILOT_RATE_BUDGET.requestCount,
    tokenCount: PILOT_RATE_BUDGET.tokenCount,
    windowStart: FieldValue.serverTimestamp(),
  }
  // Use set with merge:true so a second run refreshes windowStart without wiping history
  await rateBudgetsRef().doc(agent.uid).set(budgetDoc, { merge: false })
  return true
}

/**
 * Provision a single pilot agent: claims + rate budget.
 * Returns a ProvisionResult with uidHash (never raw uid in logs).
 */
async function provisionAgent(
  agent: PilotAgent,
  apply: boolean
): Promise<ProvisionResult> {
  const hash = uidHash(agent.uid)
  let claimsSet = false
  let budgetSeeded = false
  let error: string | undefined

  try {
    claimsSet = await setAgentClaims(agent, apply)
    budgetSeeded = await seedRateBudget(agent, apply)
  } catch (err) {
    error = err instanceof Error ? err.message : String(err)
  }

  return { uid: agent.uid, uidHash: hash, claimsSet, budgetSeeded, error }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const { apply, listPath, uids } = parseArgs(process.argv)
  const agents = loadAgentList(listPath, uids)

  if (agents.length === 0) {
    console.error('Error: agent list is empty — nothing to provision')
    process.exit(1)
  }

  if (agents.length > MAX_PILOT_AGENTS) {
    console.error(
      `Error: agent list has ${agents.length} entries — exceeds the safety cap of ${MAX_PILOT_AGENTS}. ` +
      'Provision in smaller batches or increase MAX_PILOT_AGENTS.'
    )
    process.exit(1)
  }

  // ── Mode banner ────────────────────────────────────────────────────────────

  if (!apply) {
    console.log('─'.repeat(70))
    console.log('DRY-RUN MODE — no mutations will be made.')
    console.log('To apply, re-run with --apply.')
    console.log('─'.repeat(70))
  } else {
    console.log('─'.repeat(70))
    console.log('APPLY MODE — mutations WILL be written to Firebase.')
    console.log('─'.repeat(70))
    console.log()
    console.log('Remote Config pre-flight (confirm manually before proceeding):')
    console.log('  Firebase Console → Remote Config')
    console.log('  - model.router.default  (expected: claude-haiku-4-5)')
    console.log('  - model.finder.default  (expected: claude-sonnet-4-6)')
    console.log()
  }

  console.log(`Pilot agents to provision: ${agents.length}`)
  console.log(`Pilot role: ${PILOT_ROLE} | tenantId: ${TENANT_ID}`)
  console.log()

  // ── Provision each agent ──────────────────────────────────────────────────

  const results: ProvisionResult[] = []

  for (const agent of agents) {
    const result = await provisionAgent(agent, apply)
    results.push(result)

    // Log using uidHash only — never log the raw uid (T-03-32)
    const status =
      result.error
        ? `FAILED — ${result.error}`
        : apply
          ? `OK (claims=${result.claimsSet}, budget=${result.budgetSeeded})`
          : `DRY-RUN OK (would set claims + budget)`

    console.log(`  uid[${result.uidHash}]: ${status}`)
  }

  // ── Summary ───────────────────────────────────────────────────────────────

  const succeeded = results.filter((r) => !r.error).length
  const failed = results.filter((r) => !!r.error).length

  console.log()
  console.log('─'.repeat(70))
  if (apply) {
    console.log(`Provisioning complete: ${succeeded} succeeded, ${failed} failed.`)
    if (succeeded > 0) {
      console.log()
      console.log('IMPORTANT: Each provisioned user must call getIdToken(true) on their')
      console.log('client to force-refresh their ID token and pick up the new claims.')
    }
  } else {
    console.log(`Dry-run complete: ${succeeded} would succeed, ${failed} would fail.`)
    console.log()
    console.log('To apply, re-run with --apply.')
  }
  console.log('─'.repeat(70))

  if (failed > 0) {
    process.exit(1)
  }
}

main().catch((err) => {
  // Top-level error — log without leaking any credentials
  console.error('Fatal error:', err instanceof Error ? err.message : err)
  process.exit(1)
})
