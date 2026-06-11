/**
 * app/[lang]/(coach)/dashboard/per-coach-pivot.ts — AP-01 per-coach pivot scoping.
 *
 * The PURE scoping decision behind the admin-only per-coach analytics pivot.
 * It extends the existing two-branch role scoping (`adminAll` vs `seniorCoachId == self`,
 * see dashboard/actions.ts Pattern D) with a THIRD branch: an admin may pass a
 * `coachUid` to pivot the read-only aggregations onto a SPECIFIC coach's downline
 * (`seniorCoachId == coachUid`).
 *
 * SECURITY (T-06-25 / Pattern D threat): the `coachUid` is honored ONLY when
 * `role === 'admin'`. A non-admin (senior-coach) caller passing ANY `coachUid` has
 * it DISCARDED and stays locked to their OWN downline (`seniorCoachId == self`). A
 * coach must NEVER read another coach's downline via a coachUid filter.
 *
 * This helper is the single source of truth for the pivot decision — the Server
 * Actions (getReplyQualityMetrics / getFunnelV2Metrics / getKnowledgeGapAggregation)
 * delegate to it so the privilege boundary is enforced in exactly one place. It is a
 * pure function (no Firestore, no network) so it can be unit-pinned offline
 * (per-coach-pivot.test.ts).
 *
 * NOT a Server Action: this is a plain module (no 'use server') so it may export a
 * synchronous function. The role-gated `actions.ts` file (which IS 'use server')
 * imports it.
 *
 * Contract (per-coach-pivot.test.ts):
 *   admin,        coachUid=undefined → org-wide  (adminAll:true,  seniorCoachId:null)
 *   admin,        coachUid='coach-B' → pivot      (adminAll:false, seniorCoachId:'coach-B')
 *   senior-coach, coachUid=undefined → self       (adminAll:false, seniorCoachId:self)
 *   senior-coach, coachUid='coach-B' → IGNORED    (adminAll:false, seniorCoachId:self)
 *
 * Requirements: AP-01, Pattern D, threat "coach reads another coach's downline".
 */

import type { Role } from '@/src/firebase/auth'

/** The resolved scope a read-only aggregation query must apply. */
export interface PivotScope {
  /** true = org-wide (admin, no coachUid) → NO seniorCoachId filter. */
  adminAll: boolean
  /** The seniorCoachId the query must filter on; null when org-wide. */
  seniorCoachId: string | null
}

/**
 * Resolve the effective downline scope for a per-coach analytics pivot.
 *
 * The `coachUid` pivot is admin-only. A coach's `coachUid` is discarded (the
 * privilege-boundary mitigation, T-06-25) so they stay locked to their own
 * downline.
 *
 * @param role      The role from the VERIFIED token (never from client args).
 * @param uid       The caller's own uid (the coach's downline key when not admin).
 * @param coachUid  Optional admin-only pivot target. Ignored for non-admins.
 */
export function resolvePivotScope(args: {
  role: Role
  uid: string
  coachUid?: string
}): PivotScope {
  const { role, uid, coachUid } = args

  // coachUid is honored ONLY when the verified role is 'admin'. A coach's coachUid
  // is discarded → they stay scoped to their own downline (T-06-25 mitigation).
  const pivotUid =
    role === 'admin' && coachUid
      ? coachUid // admin pivot → filter on the chosen coach's downline
      : role === 'admin'
        ? null // admin, no pivot → org-wide (unchanged adminAll behaviour)
        : uid // non-admin → locked to self (coachUid, if any, ignored)

  return {
    adminAll: pivotUid === null,
    seniorCoachId: pivotUid,
  }
}
