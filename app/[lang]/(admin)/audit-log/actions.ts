'use server'

/**
 * app/[lang]/(admin)/audit-log/actions.ts — Audit-log viewer bounded read
 * (AUDIT-01 / D-12 / D-13 / D-14).
 *
 * Admin-only, read-only surface over the existing auditLogs collection. Mirrors
 * the bounded searchConversations pattern (never fetch-all).
 *
 * Three-layer admin gate:
 *   Layer 1: (admin)/layout.tsx admits admin + read-only into the group.
 *   Layer 2: audit-log/page.tsx (RSC) requireRole({ allowed: ['admin'] }) — read-only DENIED (D-13/D-24).
 *   Layer 3: this Server Action asserts role === 'admin' from the VERIFIED token.
 *
 * Invariants:
 *   - BOUNDED (D-13): orderBy('ts','desc').limit(50) — never fetch-all. Cursor
 *     pagination via startAfter(cursorTs). Optional action / actorUid / date-range
 *     filters use the 07-02 (action,ts)/(actorUid,ts) composite indexes.
 *   - METADATA-ONLY (D-12): returns { id, actorUid, action, targetRef, ts } only —
 *     the stored sha256 `hashes` map is one-way and is NEVER decoded or surfaced.
 *   - NO SELF-AUDIT (D-14): this action does NOT import or call auditDrilldown —
 *     viewing hashes-only metadata touches no PII, so auditing the audit-viewer
 *     would be useless recursion. The server-side gate is the control.
 *
 * References:
 *   - AUDIT-01, D-12, D-13, D-14
 *   - conversations/actions.ts:160-198 (searchConversations bounded cursor analog)
 *   - 07-PATTERNS.md §audit-log/actions.ts
 */

import { cookies } from 'next/headers'
import { requireUser, UnauthorizedError } from '@/src/firebase/auth'

// ─── Session helper (verbatim copy of roles/actions.ts:43-56) ─────────────────

async function getSessionUser(): Promise<Awaited<ReturnType<typeof requireUser>>> {
  const cookieStore = await cookies()
  const sessionCookie = cookieStore.get('__session')

  if (!sessionCookie?.value) {
    throw new UnauthorizedError('No session cookie')
  }

  const syntheticReq = new Request('https://d2.app/admin/audit-log', {
    headers: { Authorization: `Bearer ${sessionCookie.value}` },
  })

  return requireUser(syntheticReq)
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AuditLogFilter {
  /** Optional exact action filter (uses the (action,ts) composite index). */
  action?: string
  /** Optional exact actorUid filter (uses the (actorUid,ts) composite index). */
  actorUid?: string
  /** Optional lower bound (epoch ms or Date) on ts. */
  fromTs?: number
  /** Optional upper bound (epoch ms or Date) on ts. */
  toTs?: number
  /** Cursor for pagination — the ts of the last row from the previous page. */
  cursorTs?: number
}

/**
 * A single metadata-only audit row. NEVER carries decoded hashes (D-12).
 *
 * Carries an index signature so a row is assignable to `Record<string, unknown>`
 * — the audit-log viewer renders rows generically and the Wave-0 contract test
 * inspects them as a property bag.
 */
export interface AuditLogRow {
  id: string
  actorUid: string
  action: string
  targetRef: string | null
  ts: unknown
  [key: string]: unknown
}

export interface ListAuditLogsResult {
  ok: true
  rows: AuditLogRow[]
}

export type ListAuditLogsError = {
  ok: false
  error: string
}

// ─── listAuditLogs ──────────────────────────────────────────────────────────────

/**
 * Admin-only bounded cursor read of auditLogs (AUDIT-01).
 *
 * Returns at most 50 metadata-only rows, newest first. Hashes are NEVER decoded
 * (D-12). This action does NOT self-audit (D-14).
 */
export async function listAuditLogs(
  opts: AuditLogFilter = {},
): Promise<ListAuditLogsResult | ListAuditLogsError> {
  let user: Awaited<ReturnType<typeof requireUser>>
  try {
    user = await getSessionUser()
  } catch {
    return { ok: false, error: 'Unauthorized' }
  }

  // Admin-only gate (D-13) — role from the verified token. read-only DENIED (D-24).
  if (user.role !== 'admin') {
    return { ok: false, error: 'Forbidden' }
  }

  try {
    // Inline import — avoids the Admin SDK at module load time in test environments
    // (same idiom as conversations/actions.ts:184).
    const { adminDb } = await import('@/src/firebase/admin')

    // Bounded query: orderBy('ts','desc').limit(50) — never fetch-all (D-13).
    let q: FirebaseFirestore.Query<FirebaseFirestore.DocumentData> = adminDb
      .collection('auditLogs')
      .orderBy('ts', 'desc')
      .limit(50)

    // Optional equality filters (need the 07-02 composite indexes when combined
    // with orderBy('ts')).
    if (opts.action) {
      q = q.where('action', '==', opts.action)
    }
    if (opts.actorUid) {
      q = q.where('actorUid', '==', opts.actorUid)
    }
    // Optional date-range filter on ts.
    if (opts.fromTs !== undefined) {
      q = q.where('ts', '>=', opts.fromTs)
    }
    if (opts.toTs !== undefined) {
      q = q.where('ts', '<=', opts.toTs)
    }

    // Cursor pagination.
    if (opts.cursorTs !== undefined) {
      q = q.startAfter(opts.cursorTs)
    }

    const snapshot = await q.get()

    // METADATA-ONLY (D-12): project to { id, actorUid, action, targetRef, ts }.
    // The stored sha256 `hashes` map is one-way and is NEVER surfaced/decoded.
    const rows: AuditLogRow[] = snapshot.docs.map((doc) => {
      const data = doc.data() as {
        actorUid?: string
        action?: string
        targetRef?: string
        ts?: unknown
      }
      return {
        id: doc.id,
        actorUid: data.actorUid ?? '',
        action: data.action ?? '',
        targetRef: data.targetRef ?? null,
        ts: data.ts ?? null,
      }
    })

    return { ok: true, rows }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to list audit logs'
    return { ok: false, error: msg }
  }
}
