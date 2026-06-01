/**
 * scripts/set-claims.ts — Thin role-provisioning script (D-11).
 *
 * Sets Firebase Auth custom claims (role + tenantId) for a given user UID.
 * This is the sanctioned provisioning path for senior-coach and admin roles
 * in Phase 1 — they do NOT have a sign-in UI yet (TSD §5.1 D-11).
 *
 * Usage — run via the npm script, which loads .env.local (a bare `npx tsx` does NOT,
 * because .env.local is only auto-loaded by Next.js — that causes "Unable to detect a
 * Project Id"). Pass script flags after `--`:
 *
 *   # Provision an admin:
 *   npm run set-claims -- --uid <USER_UID> --role admin
 *
 *   # Provision a senior coach:
 *   npm run set-claims -- --uid <USER_UID> --role senior-coach
 *
 *   # Provision a new-agent with an upline coach:
 *   npm run set-claims -- --uid <USER_UID> --role new-agent --upline <COACH_UID>
 *
 * Equivalent without the npm script (inline env):
 *   FIREBASE_PROJECT_ID=<id> GOOGLE_APPLICATION_CREDENTIALS=./sa.json \
 *     npx tsx scripts/set-claims.ts --uid <USER_UID> --role admin
 *
 * Prerequisites — these MUST be present in .env.local (or the inline env above):
 *   - FIREBASE_PROJECT_ID  (the project id)
 *   - GOOGLE_APPLICATION_CREDENTIALS=./sa.json  (path to the service-account key)
 *     OR  FIREBASE_SERVICE_ACCOUNT_KEY  (the key JSON as a single-line string)
 *
 * Security (T-01-13):
 *   - Runs only with service-account credentials — local dev tool for the 2-engineer team.
 *   - Role union validated at runtime (rejects unknown role strings).
 *   - NEVER commit a populated .env or real UIDs in example comments.
 *   - Use placeholders like <USER_UID>, <COACH_UID> in all documentation.
 *
 * After running this script, the user's client MUST call
 * `await user.getIdToken(true)` (force-refresh) to pick up the new claims.
 */

import { setUserClaims } from '@/src/firebase/auth'

type Role = 'new-agent' | 'senior-coach' | 'admin'

// ─── CLI arg parsing ─────────────────────────────────────────────────────────

function parseArgs(argv: string[]): {
  uid: string
  role: Role
  uplineCoachId?: string
  seniorCoachId?: string
} {
  const args = argv.slice(2) // strip 'node' + script path
  const get = (flag: string): string | undefined => {
    const i = args.indexOf(flag)
    return i !== -1 ? args[i + 1] : undefined
  }

  const uid = get('--uid')
  const roleRaw = get('--role')
  const uplineCoachId = get('--upline')
  const seniorCoachId = get('--senior')

  if (!uid) {
    console.error('Error: --uid is required')
    process.exit(1)
  }
  if (!roleRaw) {
    console.error('Error: --role is required (new-agent | senior-coach | admin)')
    process.exit(1)
  }

  const validRoles: Role[] = ['new-agent', 'senior-coach', 'admin']
  if (!validRoles.includes(roleRaw as Role)) {
    console.error(
      `Error: Unknown role "${roleRaw}". Must be one of: ${validRoles.join(', ')}`
    )
    process.exit(1)
  }

  return { uid, role: roleRaw as Role, uplineCoachId, seniorCoachId }
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const { uid, role, uplineCoachId, seniorCoachId } = parseArgs(process.argv)

  console.log(`Setting claims: uid=${uid}, role=${role}`)
  if (uplineCoachId) console.log(`  uplineCoachId=${uplineCoachId}`)
  if (seniorCoachId) console.log(`  seniorCoachId=${seniorCoachId}`)

  try {
    // setUserClaims → adminAuth.setCustomUserClaims(uid, { role, tenantId:'d2' })
    await setUserClaims(uid, role, { uplineCoachId, seniorCoachId })
    console.log(
      `Done. User ${uid} has been provisioned as ${role}.` +
      `\nIMPORTANT: The user's client must call getIdToken(true) to force-refresh the token.`
    )
  } catch (err) {
    console.error('Failed to set claims:', err instanceof Error ? err.message : err)
    process.exit(1)
  }
}

main()
