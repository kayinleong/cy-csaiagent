'use server'

/**
 * app/[lang]/(admin)/leads/actions.ts — Admin-only lead registry CRUD Server Actions
 * (quick-kayinleong-046 / D-03 / D-07).
 *
 * WHY THIS EXISTS: every consumer of the `leads` collection shipped (the Reply
 * lead-selector, the `leadId`-required server gate at app/api/chat/route.ts, the
 * PDPA erasure manifest, the Firestore rules + their test matrix) but NOTHING in
 * the product ever CREATED a `leads/{leadId}` document. `listLeadsForReply()`
 * therefore always returned `[]` and the Reply pillar was 100% unreachable. This
 * module is the missing producer.
 *
 * Three-layer admin gate (mirrors cohorts/actions.ts):
 *   Layer 1: (admin)/layout.tsx admits admin + read-only into the route group.
 *   Layer 2: leads/page.tsx (RSC) requireRole({ allowed: ['admin'] }) — read-only DENIED (D-24).
 *   Layer 3: these Server Actions assert role === 'admin' from the VERIFIED token
 *            (never from args — T-02-31 / T-07-10).
 *
 * ── TWO-DOC INVARIANT (load-bearing — do not "simplify" this) ────────────────
 * createLead writes BOTH `leads/{id}` AND `leadContext/{id}` under the SAME id in
 * one atomic batch. `writeLeadSlot` uses `.update()` (src/memory/leadContext.ts:121),
 * which throws NOT_FOUND on a missing document, and the Reply call site in
 * `onFinish` (app/api/chat/route.ts:578-586) is NOT try/caught — so a lead created
 * without its context doc streams a draft and then blows up the turn. The three
 * agent slots MUST be seeded as `{}` (not omitted): readFinderSlot/readReplySlot
 * treat `{}` as "never written" (leadContext.ts:149,184) and the leadContext read
 * rule predicates on `resource.data.coachSlot != null` (firestore.rules:167).
 * deleteLead deletes both docs, mirroring src/pdpa/erasure.ts semantics.
 *
 * ── PDPA POSTURE (the sharp edge) ───────────────────────────────────────────
 *   - `name` is the PSEUDONYM LABEL, never a legal name. It is injected as a
 *     `knownNames` redaction NEEDLE at app/api/chat/route.ts:355-371, so whatever
 *     lands here is what gets scrubbed out of pasted WhatsApp text. A real name
 *     stored here would be PII at rest readable by any admin (contradicting
 *     TSD.md:146), and a 1-2 char label would over-redact benign text — hence
 *     MIN_LABEL_LENGTH below.
 *   - There is NO raw-phone field on LeadDoc. The phone is a TRANSIENT action
 *     argument: it is hashed here and the raw value is never persisted, never
 *     audited (beyond audit's own hashing), never logged, never put in a URL.
 *   - A blank `ownerUid` is REJECTED. PDPA erasure sweeps by `ownerUid`
 *     (src/pdpa/erasure.ts:68-72), so an owner-less lead would be un-erasable
 *     orphan PII. The owner is also verified to exist (no dangling pointer).
 *
 * ── INTEGRATION DETAIL THAT DECIDES WHETHER THIS WORKS ──────────────────────
 * The chat picker is scoped by `where('ownerUid','==',uid)` against the VERIFIED
 * signed-in uid (app/[lang]/chat/lead-actions.ts:71). The `ownerUid` chosen here
 * is therefore the single thing that determines WHOSE Reply selector the lead
 * appears in. An admin creating a lead for themselves must pick their own account.
 *
 * References:
 *   - cohorts/actions.ts (pattern mirrored verbatim: getSessionUser, result union, audit)
 *   - RESEARCH-leads.md §B (two-doc write), §C (PII handling)
 *   - D-03 (admin-only audited writes), D-07 (Reply requires a lead), D-24 (read-only denied)
 */

import { createHash } from 'node:crypto'
import { cookies } from 'next/headers'
import { FieldValue } from 'firebase-admin/firestore'
import { requireUser, UnauthorizedError } from '@/src/firebase/auth'
import { adminDb } from '@/src/firebase/admin'
import { leadsRef, leadContextRef, usersRef, TENANT_ID } from '@/src/firebase/collections'
import * as audit from '@/src/audit'

// ─── Session helper ───────────────────────────────────────────────────────────

/**
 * Read the __session cookie and verify it with requireUser.
 * Verbatim copy of cohorts/actions.ts:34-47 (getSessionUser pattern).
 * Next.js 16: cookies() is async — awaited.
 */
async function getSessionUser(): Promise<Awaited<ReturnType<typeof requireUser>>> {
  const cookieStore = await cookies()
  const sessionCookie = cookieStore.get('__session')

  if (!sessionCookie?.value) {
    throw new UnauthorizedError('No session cookie')
  }

  const syntheticReq = new Request('https://d2.app/admin/leads', {
    headers: { Authorization: `Bearer ${sessionCookie.value}` },
  })

  return requireUser(syntheticReq)
}

// ─── PII helpers ──────────────────────────────────────────────────────────────

/**
 * Minimum pseudonym-label length. `name` becomes a PDPA redaction needle
 * (app/api/chat/route.ts:355-371); a 1-2 character needle would shred benign
 * text out of every draft for this lead.
 */
const MIN_LABEL_LENGTH = 3

/**
 * Hash a lead's phone number into the stored `phoneHash`.
 *
 * Same convention as the (module-private) `hashValue` in src/audit/pdpa.ts:105-107
 * — sha256, first 12 hex chars: short enough to eyeball, long enough to be
 * collision-resistant at pilot scale. `hashValue` is not exported and lives in a
 * file this claim does not own, so the convention is reproduced rather than imported.
 *
 * Formatting is normalized first (spaces, dashes, dots, parens stripped) so that
 * `012-345 6789` and `0123456789` hash identically. No consumer compares this
 * value against a pseudonymize() token, so normalization is safe.
 *
 * The RAW phone never leaves this function: it is not returned, not stored, not
 * logged, not audited.
 */
function hashLeadPhone(phone: string): string {
  const normalized = phone.replace(/[\s\-.()]/g, '')
  return createHash('sha256').update(normalized).digest('hex').slice(0, 12)
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface LeadInput {
  /** Pseudonym label (e.g. `<LEAD_ID:ab12cd34ef56>`) — NEVER a legal name. */
  label: string
  /** The agent who owns this lead. Determines whose Reply selector shows it. */
  ownerUid: string
  /**
   * TRANSIENT raw phone. Hashed into `phoneHash` here and discarded. Empty string
   * means "no phone yet" (create) / "leave the existing hash untouched" (update).
   */
  phone: string
  consentFlag: boolean
  nationality: string
  segment: string
}

export interface LeadActionResult {
  ok: true
  id?: string
}

export type LeadActionError = {
  ok: false
  error: string
}

export type LeadResult = LeadActionResult | LeadActionError

/** A plain, serializable row for the management table (no PII beyond the pseudonym). */
export interface LeadSummary {
  id: string
  /** The pseudonym label (leads/{id}.name). */
  label: string
  ownerUid: string
  /** Whether a phone hash is on file — the hash itself never crosses to the client. */
  hasPhone: boolean
  consentFlag: boolean
  nationality: string
  segment: string
}

export interface ListLeadsResult {
  ok: true
  leads: LeadSummary[]
}

export type ListLeadsError = { ok: false; error: string }

// ─── Shared validation ────────────────────────────────────────────────────────

/**
 * Validate the shared create/update field set. Returns an error string or null.
 * `requirePhone` is always false — a lead may be registered before its phone is
 * known; the phone is optional in both directions.
 */
function validateInput(input: LeadInput): string | null {
  if (!input.ownerUid || !input.ownerUid.trim()) {
    // PDPA: erasure sweeps by ownerUid — an owner-less lead is un-erasable orphan PII.
    return 'Missing owner'
  }
  if (!input.label || input.label.trim().length < MIN_LABEL_LENGTH) {
    return 'Label too short'
  }
  return null
}

// ─── createLead ───────────────────────────────────────────────────────────────

/**
 * Create a lead + its lead-context doc (the two-doc invariant above). Admin-only; audited.
 */
export async function createLead(input: LeadInput): Promise<LeadResult> {
  let user: Awaited<ReturnType<typeof requireUser>>
  try {
    user = await getSessionUser()
  } catch {
    return { ok: false, error: 'Unauthorized' }
  }

  // D-03 / T-07-10: lead writes are admin-only — role from the VERIFIED token.
  if (user.role !== 'admin') {
    return { ok: false, error: 'Forbidden' }
  }

  const invalid = validateInput(input)
  if (invalid) {
    return { ok: false, error: invalid }
  }

  const ownerUid = input.ownerUid.trim()

  try {
    // No dangling owner pointer — and no un-erasable lead behind a typo'd uid.
    const ownerSnap = await usersRef().doc(ownerUid).get()
    if (!ownerSnap.exists) {
      return { ok: false, error: 'Owner not found' }
    }

    // Generate the id UP FRONT so leadContext can share it (leadContext/{leadId}).
    const ref = leadsRef().doc()

    const batch = adminDb.batch()
    // The converter stamps tenantId on every write; set it explicitly too to
    // satisfy WithFieldValue<LeadDoc> (mirrors cohorts/actions.ts).
    batch.set(ref, {
      tenantId: TENANT_ID,
      ownerUid,
      // Pseudonym label — never a raw legal name (PDPA; becomes a redaction needle).
      name: input.label.trim(),
      // Hashed here; the raw phone is never persisted.
      phoneHash: input.phone.trim() ? hashLeadPhone(input.phone.trim()) : '',
      consentFlag: input.consentFlag,
      nationality: input.nationality.trim(),
      segment: input.segment.trim(),
    })
    batch.set(leadContextRef().doc(ref.id), {
      tenantId: TENANT_ID,
      // MUST be {} — readFinderSlot/readReplySlot treat {} as "never written"
      // (leadContext.ts:149,184) and the read rule tests coachSlot != null (rules:167).
      coachSlot: {},
      finderSlot: {},
      replySlot: {},
      rollingSummary: '',
      updatedAt: FieldValue.serverTimestamp(),
    })
    await batch.commit()

    await audit.log({
      actorUid: user.uid,
      action: 'lead-create',
      targetRef: `leads/${ref.id}`,
      // leadId + ownerUid only. audit.log sha256-hashes every raw value anyway
      // (src/audit/log.ts:76-96), but the raw phone is never passed here regardless.
      raw: { leadId: ref.id, ownerUid },
    })

    return { ok: true, id: ref.id }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to create lead'
    return { ok: false, error: msg }
  }
}

// ─── updateLead ───────────────────────────────────────────────────────────────

/**
 * Update a lead's metadata. Admin-only; audited.
 *
 * An empty `input.phone` leaves the stored `phoneHash` UNTOUCHED (the raw phone is
 * never readable back into the form, so a blank field means "unchanged", not "clear").
 * The paired leadContext doc is left alone — its slots belong to the agents.
 */
export async function updateLead(leadId: string, input: LeadInput): Promise<LeadResult> {
  let user: Awaited<ReturnType<typeof requireUser>>
  try {
    user = await getSessionUser()
  } catch {
    return { ok: false, error: 'Unauthorized' }
  }

  if (user.role !== 'admin') {
    return { ok: false, error: 'Forbidden' }
  }

  if (!leadId) {
    return { ok: false, error: 'Missing lead' }
  }

  const invalid = validateInput(input)
  if (invalid) {
    return { ok: false, error: invalid }
  }

  const ownerUid = input.ownerUid.trim()

  try {
    const ownerSnap = await usersRef().doc(ownerUid).get()
    if (!ownerSnap.exists) {
      return { ok: false, error: 'Owner not found' }
    }

    const update: Record<string, unknown> = {
      ownerUid,
      name: input.label.trim(),
      consentFlag: input.consentFlag,
      nationality: input.nationality.trim(),
      segment: input.segment.trim(),
    }
    if (input.phone.trim()) {
      update.phoneHash = hashLeadPhone(input.phone.trim())
    }

    await leadsRef().doc(leadId).update(update)

    await audit.log({
      actorUid: user.uid,
      action: 'lead-update',
      targetRef: `leads/${leadId}`,
      raw: { leadId, ownerUid },
    })

    return { ok: true, id: leadId }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to update lead'
    return { ok: false, error: msg }
  }
}

// ─── deleteLead ───────────────────────────────────────────────────────────────

/**
 * Delete a lead AND its lead-context doc, atomically. Admin-only; audited.
 *
 * Both docs go together — mirrors src/pdpa/erasure.ts:68-72, and leaving an orphan
 * leadContext behind would keep cross-pillar lead context (including a redacted
 * draft in `replySlot.latestDraft`) at rest after the lead was "deleted".
 */
export async function deleteLead(leadId: string): Promise<LeadResult> {
  let user: Awaited<ReturnType<typeof requireUser>>
  try {
    user = await getSessionUser()
  } catch {
    return { ok: false, error: 'Unauthorized' }
  }

  if (user.role !== 'admin') {
    return { ok: false, error: 'Forbidden' }
  }

  if (!leadId) {
    return { ok: false, error: 'Missing lead' }
  }

  try {
    const batch = adminDb.batch()
    batch.delete(leadsRef().doc(leadId))
    batch.delete(leadContextRef().doc(leadId))
    await batch.commit()

    await audit.log({
      actorUid: user.uid,
      action: 'lead-delete',
      targetRef: `leads/${leadId}`,
      raw: { leadId },
    })

    return { ok: true, id: leadId }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to delete lead'
    return { ok: false, error: msg }
  }
}

// ─── listLeads ────────────────────────────────────────────────────────────────

/**
 * Bounded read of the lead registry for the management table. Admin-only.
 *
 * Only the pseudonym label crosses to the client — `phoneHash` is projected down
 * to a boolean so no hash lands in the RSC payload.
 */
export async function listLeads(): Promise<ListLeadsResult | ListLeadsError> {
  let user: Awaited<ReturnType<typeof requireUser>>
  try {
    user = await getSessionUser()
  } catch {
    return { ok: false, error: 'Unauthorized' }
  }

  if (user.role !== 'admin') {
    return { ok: false, error: 'Forbidden' }
  }

  try {
    // Bounded read — never fetch-all (pilot org; mirrors cohorts/inventory).
    const snap = await leadsRef().limit(200).get()
    const leads: LeadSummary[] = snap.docs.map((doc) => {
      const data = doc.data()
      return {
        id: doc.id,
        label: data.name,
        ownerUid: data.ownerUid,
        hasPhone: Boolean(data.phoneHash),
        consentFlag: Boolean(data.consentFlag),
        nationality: data.nationality ?? '',
        segment: data.segment ?? '',
      }
    })
    return { ok: true, leads }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to list leads'
    return { ok: false, error: msg }
  }
}
