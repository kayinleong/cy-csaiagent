'use server'

/**
 * app/[lang]/(coach)/dashboard/actions.ts — Server Actions for the coach dashboard.
 *
 * Action: resolveStall(eid) — mark an escalation as resolved (CDASH-02).
 * Action: submitCorrection(docId, content) — inline KB correction (CDASH-04).
 *
 * Security:
 *   - Each action reads the __session cookie → requireUser() — uid + role from
 *     the verified token, NEVER from the action arguments (T-02-31).
 *   - resolveStall: requires role ∈ {'senior-coach', 'admin'}.
 *   - submitCorrection: delegates to correctKbDoc which enforces role ∈ {'admin','senior-coach'}.
 *
 * Pattern mirrors app/[lang]/(admin)/kb/actions.ts (getSessionUser + role check).
 *
 * References:
 *   - CDASH-02 (resolve stall escalation)
 *   - CDASH-04 (inline AI correction → versioned KB re-ingest)
 *   - D-12 (correction → versioned KB re-ingest with attribution)
 *   - T-02-30 (inline correction tamper mitigation)
 *   - T-02-31 (role from verified token, not from client)
 */

import { cookies } from 'next/headers'
import { FieldValue } from 'firebase-admin/firestore'
import { requireUser, UnauthorizedError } from '@/src/firebase/auth'
import { escalationsRef, agentProfilesRef, replyEditsRef } from '@/src/firebase/collections'
import { correctKbDoc, listDocsForReview } from '@/src/kb/crud'
import { loadRecent } from '@/src/memory/conversation'
import { auditDrilldown } from '@/src/audit/log'

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Read the __session cookie and verify it with requireUser.
 * Throws UnauthorizedError if the session is missing or invalid.
 * This is the same pattern used in (admin)/kb/actions.ts.
 */
async function getSessionUser(): Promise<Awaited<ReturnType<typeof requireUser>>> {
  const cookieStore = await cookies()
  const sessionCookie = cookieStore.get('__session')

  if (!sessionCookie?.value) {
    throw new UnauthorizedError('No session cookie')
  }

  const syntheticReq = new Request('https://d2.app/coach/dashboard', {
    headers: { Authorization: `Bearer ${sessionCookie.value}` },
  })

  return requireUser(syntheticReq)
}

// ─── resolveStall ─────────────────────────────────────────────────────────────

export interface ResolveStallResult {
  ok: boolean
  error?: string
}

/**
 * Mark an open stall escalation as resolved (CDASH-02 resolve action).
 *
 * Role gate: senior-coach or admin only.
 * The escalation document is looked up by eid — the coach can only resolve
 * escalations visible to them (the dashboard only shows their downline's stalls
 * — server-side downline filter on read). The write updates the status field.
 *
 * @param eid  The escalation document ID to resolve.
 */
export async function resolveStall(eid: string): Promise<ResolveStallResult> {
  let user: Awaited<ReturnType<typeof requireUser>>
  try {
    user = await getSessionUser()
  } catch {
    return { ok: false, error: 'Unauthorized' }
  }

  if (user.role !== 'senior-coach' && user.role !== 'admin') {
    return { ok: false, error: 'Forbidden: senior-coach or admin role required' }
  }

  try {
    // D-05 / 05-04 Task 3: also set resolvedAt so rollupUsage can compute resolution time.
    // resolvedAt was added to EscalationDoc in 05-02. This is the MINIMAL field add
    // (regression surface: the existing resolve flow is otherwise unchanged).
    // FieldValue.serverTimestamp() ensures consistent server-side clock for the delta.
    await escalationsRef().doc(eid).update({
      status: 'resolved',
      resolvedAt: FieldValue.serverTimestamp(),
    })
    return { ok: true }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to resolve stall'
    return { ok: false, error: msg }
  }
}

// ─── submitCorrection ─────────────────────────────────────────────────────────

export interface SubmitCorrectionResult {
  ok: boolean
  docId?: string
  newDocId?: string
  jobId?: string
  total?: number
  remaining?: number
  error?: string
}

/**
 * Inline KB correction — a coach submits corrected content for a KB doc (CDASH-04).
 *
 * Delegates to correctKbDoc (src/kb/crud.ts) which:
 *   - Enforces role ∈ {'admin', 'senior-coach'} (assertAdminOrCoach).
 *   - Stamps correctedBy: user.uid on the new version (D-12 attribution).
 *   - Creates a new versioned kbDoc that supersedes the old one.
 *   - Shards the corrected content into a re-ingest job.
 *
 * Returns job metadata so the client dialog can poll /api/kb/ingest/process
 * until remaining === 0 (reusing the kb-doc-form poll pattern from 02-08).
 *
 * @param docId    The kbDocs document ID to correct.
 * @param content  The corrected plain-text content.
 */
export async function submitCorrection(
  docId: string,
  content: string,
): Promise<SubmitCorrectionResult> {
  let user: Awaited<ReturnType<typeof requireUser>>
  try {
    user = await getSessionUser()
  } catch {
    return { ok: false, error: 'Unauthorized' }
  }

  // correctKbDoc internally enforces admin|senior-coach — but we check here too
  // for a fast fail before hitting Firestore (T-02-31: role from verified token).
  if (user.role !== 'senior-coach' && user.role !== 'admin') {
    return { ok: false, error: 'Forbidden: senior-coach or admin role required' }
  }

  try {
    const result = await correctKbDoc(user, docId, content)
    return {
      ok: true,
      docId: result.docId,
      newDocId: result.newDocId,
      jobId: result.jobId,
      total: result.total,
      remaining: result.remaining,
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Correction failed'
    return { ok: false, error: msg }
  }
}

// ─── listKbDocsForCorrection ────────────────────────────────────────────────────

export interface KbDocSummary {
  id: string
  title: string
  lang: string
  pillar: string
  version: number
  status: string
}

export interface ListKbDocsResult {
  ok: boolean
  docs?: KbDocSummary[]
  error?: string
}

/**
 * List KB documents for the correction picker (CDASH-04) — replaces the raw
 * "enter a Firestore doc ID" step that business users could not use.
 *
 * Role gate: senior-coach or admin (same as the correction path). Read-only;
 * returns lightweight metadata only (no content), serializable to the client.
 */
export async function listKbDocsForCorrection(): Promise<ListKbDocsResult> {
  let user: Awaited<ReturnType<typeof requireUser>>
  try {
    user = await getSessionUser()
  } catch {
    return { ok: false, error: 'Unauthorized' }
  }

  if (user.role !== 'senior-coach' && user.role !== 'admin') {
    return { ok: false, error: 'Forbidden: senior-coach or admin role required' }
  }

  try {
    const docs = await listDocsForReview(user)
    return {
      ok: true,
      docs: docs.map((d) => ({
        id: d.id,
        title: d.data.title,
        lang: d.data.lang,
        pillar: d.data.pillar,
        version: d.data.version,
        status: d.data.status ?? 'published',
      })),
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to list documents'
    return { ok: false, error: msg }
  }
}

// ─── getAgentChatHistory ────────────────────────────────────────────────────────

export interface ChatHistoryMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  redacted: boolean
}

export interface ChatHistoryResult {
  ok: boolean
  messages?: ChatHistoryMessage[]
  error?: string
}

/**
 * Fetch an agent's recent AI-Coach training thread for the stall-alert drill-down
 * (CDASH-02). When a coach clicks an alert, they see what the agent was actually
 * asking — the context behind the escalation.
 *
 * Security / PDPA:
 *   - Role gate: senior-coach or admin (T-02-31 — role from verified token).
 *   - Downline scope (AUTH-06): a non-admin coach may only read an agent whose
 *     agentProfiles.seniorCoachId === their own uid. Admin may read any agent.
 *   - The read is audited (auditDrilldown, TSD §5.1).
 *   - Scoped to the COACH-pillar training thread (`coach-${agentUid}`) — the
 *     agent↔AI Q&A, NOT client (Finder/Reply) conversations that carry lead PII.
 *
 * @param agentUid  The agent (downline member) whose coach thread to read.
 */
export async function getAgentChatHistory(agentUid: string): Promise<ChatHistoryResult> {
  let user: Awaited<ReturnType<typeof requireUser>>
  try {
    user = await getSessionUser()
  } catch {
    return { ok: false, error: 'Unauthorized' }
  }

  if (user.role !== 'senior-coach' && user.role !== 'admin') {
    return { ok: false, error: 'Forbidden: senior-coach or admin role required' }
  }

  // AUTH-06: a non-admin coach may only read their own downline.
  if (user.role !== 'admin') {
    const profileSnap = await agentProfilesRef().doc(agentUid).get()
    const profile = profileSnap.data()
    if (!profile || profile.seniorCoachId !== user.uid) {
      return { ok: false, error: 'Forbidden: agent is not in your downline' }
    }
  }

  try {
    // PDPA: audit the drill-down before returning any conversation data.
    await auditDrilldown(user.uid, 'conversations')

    const records = await loadRecent(`coach-${agentUid}`, 30)
    return {
      ok: true,
      messages: records.map((r) => ({
        id: r.id,
        role: r.data.role,
        content: r.data.content,
        redacted: r.data.redacted ?? false,
      })),
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to load chat history'
    return { ok: false, error: msg }
  }
}

// ─── getReplyQualityMetrics ─────────────────────────────────────────────────────

/** A single point on the per-SOP edit-rate chart (REPLY-11 / D-21). */
export interface SopEditRate {
  /** The cited SOP doc ID (group key). */
  sopDocId: string
  /** edits / total copies citing this SOP, in [0,1]. 0 = nobody edited (good). */
  editRate: number
  /** Total copies citing this SOP — the Pitfall-E row-on-every-copy denominator. */
  total: number
}

export interface ReplyQualityMetrics {
  /** Per-SOP edit-rate, ordered by editRate DESC (top-edited first). */
  perSop: SopEditRate[]
  /** count(thumbsDown==true) / count(all) in [0,1] (ADMIN-06 KPI). */
  thumbsDownRate: number
  /** The single most-edited SOP doc ID, or null when there is no data. */
  topEditedSop: string | null
  /** open escalations / total escalations in [0,1] (downline-scoped). */
  escalationRate: number
  /** total drafts / distinct drafting agents (drafts-per-agent KPI). */
  draftsPerAgent: number
  /** total replyEdits rows in scope (the universal denominator). */
  totalDrafts: number
  /** 'downline' (coach) or 'org' (admin) — drives the panel subtitle scope copy. */
  scope: 'downline' | 'org'
}

export interface ReplyQualityResult {
  ok: boolean
  metrics?: ReplyQualityMetrics
  error?: string
}

/**
 * Read-time Reply Quality aggregation for the senior-coach dashboard panel
 * (REPLY-11 / ADMIN-06, D-20/D-21/D-22).
 *
 * Computed entirely with Firestore `count()` aggregation — NEVER fetch-all-then-count
 * (Pitfall 9 / threat T-04-DASH-COST). The only non-aggregate read is a projection
 * over `sopDocIds` (a counts/ids-only field — NO draft content, no PII) to discover
 * which SOPs appear, so the per-SOP edit-rate can be aggregated group-by-group.
 *
 * Scope (D-22, single component / role-conditional query):
 *   - senior-coach → every query is filtered by `seniorCoachId == user.uid` (AUTH-06
 *     gate 1; firestore.rules is gate 2). Only their downline's rows are counted.
 *   - admin → unfiltered within the tenant (org-wide).
 *
 * Edit-rate denominator (Pitfall E / A2): a `replyEdits` row is written on EVERY Copy,
 * including unchanged copies (editRatio:0), so per-SOP editRate =
 *   count(sopDocIds array-contains X AND editRatio > 0) / count(sopDocIds array-contains X).
 *
 * PDPA / no-PII-in-logs: this function reads + returns COUNTS ONLY. originalDraft /
 * editedFinal are never read here and never logged (CLAUDE.md).
 */
export async function getReplyQualityMetrics(): Promise<ReplyQualityResult> {
  let user: Awaited<ReturnType<typeof requireUser>>
  try {
    user = await getSessionUser()
  } catch {
    return { ok: false, error: 'Unauthorized' }
  }

  // Same role gate as the rest of the dashboard (T-02-31 — role from verified token).
  if (user.role !== 'senior-coach' && user.role !== 'admin') {
    return { ok: false, error: 'Forbidden: senior-coach or admin role required' }
  }

  const adminAll = user.role === 'admin'
  const scope: 'downline' | 'org' = adminAll ? 'org' : 'downline'

  // The base scope predicate — coach is downline-locked (AUTH-06), admin is org-wide.
  // replyEditsRef() / escalationsRef() return Admin-SDK queries with .where()/.count().
  type CountableQuery = {
    where: (field: string, op: string, value: unknown) => CountableQuery
    count: () => { get: () => Promise<{ data: () => { count: number } }> }
    select: (field: string) => {
      get: () => Promise<{ docs: Array<{ data: () => { sopDocIds?: string[]; agentUid?: string } }> }>
    }
  }

  const scopedReplyEdits = (): CountableQuery => {
    const base = replyEditsRef() as unknown as CountableQuery
    return adminAll ? base : base.where('seniorCoachId', '==', user.uid)
  }

  const countOf = async (q: CountableQuery): Promise<number> => {
    const snap = await q.count().get()
    return snap.data().count
  }

  try {
    // PDPA: audit the aggregation read (counts-only, but it is a downline drilldown).
    await auditDrilldown(user.uid, 'replyEdits')

    // ── Universal denominator: total in-scope rows ──────────────────────────────
    const totalDrafts = await countOf(scopedReplyEdits())

    if (totalDrafts === 0) {
      // Empty state — every chart renders replyQuality.noData. Still return escalation
      // rate (it has its own collection) but short-circuit the replyEdits-derived KPIs.
      const escalationRate = await computeEscalationRate(user.uid, adminAll)
      return {
        ok: true,
        metrics: {
          perSop: [],
          thumbsDownRate: 0,
          topEditedSop: null,
          escalationRate,
          draftsPerAgent: 0,
          totalDrafts: 0,
          scope,
        },
      }
    }

    // ── Thumbs-down rate (ADMIN-06): count(thumbsDown==true) / count(all) ────────
    const thumbsDownCount = await countOf(scopedReplyEdits().where('thumbsDown', '==', true))
    const thumbsDownRate = thumbsDownCount / totalDrafts

    // ── Discover the SOP id set + distinct agents (projection only — no draft text)
    // sopDocIds + agentUid are counts/ids fields, never PII. This is the one
    // non-aggregate read; it pulls a tiny projection so per-SOP counts can be grouped.
    const projSnap = await scopedReplyEdits().select('sopDocIds').get()
    const sopIds = new Set<string>()
    for (const doc of projSnap.docs) {
      const ids = doc.data().sopDocIds ?? []
      for (const id of ids) sopIds.add(id)
    }

    // distinct drafting agents — projection over agentUid (an id, not PII content).
    const agentProjSnap = await scopedReplyEdits().select('agentUid').get()
    const agentSet = new Set<string>()
    for (const doc of agentProjSnap.docs) {
      const a = doc.data().agentUid
      if (a) agentSet.add(a)
    }
    const draftsPerAgent = agentSet.size > 0 ? totalDrafts / agentSet.size : 0

    // ── Per-SOP edit-rate via count() aggregation (no fetch-all-then-count) ───────
    const perSop: SopEditRate[] = []
    for (const sopDocId of sopIds) {
      const citing = await countOf(
        scopedReplyEdits().where('sopDocIds', 'array-contains', sopDocId),
      )
      if (citing === 0) continue
      const edited = await countOf(
        scopedReplyEdits()
          .where('sopDocIds', 'array-contains', sopDocId)
          .where('editRatio', '>', 0),
      )
      perSop.push({ sopDocId, editRate: edited / citing, total: citing })
    }
    perSop.sort((a, b) => b.editRate - a.editRate)
    const topEditedSop = perSop.length > 0 ? perSop[0]!.sopDocId : null

    const escalationRate = await computeEscalationRate(user.uid, adminAll)

    return {
      ok: true,
      metrics: {
        perSop,
        thumbsDownRate,
        topEditedSop,
        escalationRate,
        draftsPerAgent,
        totalDrafts,
        scope,
      },
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to load reply quality'
    return { ok: false, error: msg }
  }
}

/**
 * Escalation rate = open escalations / total escalations, scoped the same way as
 * the reply-edit aggregation (downline for a coach, org-wide for admin). Uses
 * Firestore count() aggregation (no fetch-all). Returns 0 when there are none.
 */
async function computeEscalationRate(coachUid: string, adminAll: boolean): Promise<number> {
  type CountableQuery = {
    where: (field: string, op: string, value: unknown) => CountableQuery
    count: () => { get: () => Promise<{ data: () => { count: number } }> }
  }
  const scoped = (): CountableQuery => {
    const base = escalationsRef() as unknown as CountableQuery
    return adminAll ? base : base.where('seniorCoachId', '==', coachUid)
  }
  const total = (await scoped().count().get()).data().count
  if (total === 0) return 0
  const open = (await scoped().where('status', '==', 'open').count().get()).data().count
  return open / total
}
