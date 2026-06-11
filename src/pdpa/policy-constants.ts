/**
 * src/pdpa/policy-constants.ts — single source of truth for the static PDPA
 * policy display (PDPA-01 / D-18).
 *
 * These are policy-FIXED values, not runtime config — there are NO editable
 * knobs anywhere in this module or the Surface 7 page that renders it. The
 * PDPA-settings page is a read-only display sourced ENTIRELY from this object
 * plus a link to the existing admin erasure flow.
 *
 * Mirrors the labeled-constant idiom of REMOTE_CONFIG_FALLBACKS (provider.ts:39):
 * a single exported constant object the UI maps over. Changing policy means
 * editing this module (a reviewed code change), never a UI toggle.
 *
 * Sources: .planning/PROJECT.md, .planning/TSD.md §5 (security/PDPA),
 * .planning/CLAUDE.md (PDPA / data residency hard constraints).
 *
 * Core/shell rule: this is portable core (src/) — it imports nothing from app/.
 */

/** Stable keys for the five policy rows (used as i18n label keys + React keys). */
export type PdpaPolicyKey =
  | 'dataResidency'
  | 'piiPseudonymization'
  | 'usageEventsTtl'
  | 'auditHashesOnly'
  | 'erasureSla'

/** A single fixed policy fact for the static PDPA display. */
export interface PdpaPolicyItem {
  /** Stable key — also the i18n label key under the `adminPdpa` namespace. */
  key: PdpaPolicyKey
  /**
   * The fixed, human-readable value for this policy fact. Free of PII and of any
   * environment secret. Safe to render verbatim in the admin display.
   */
  value: string
}

/**
 * The five policy-fixed PDPA facts shown on the admin PDPA-settings page (D-18).
 * Read-only by construction — no setter, no editable variant.
 */
export const PDPA_POLICY: readonly PdpaPolicyItem[] = [
  // Data residency — all Firebase resources pinned to the Malaysia-adjacent region.
  { key: 'dataResidency', value: 'asia-southeast1' },
  // PII is pseudonymized at the Claude boundary; a pdpa_redacted gate refuses
  // unredacted production model calls.
  { key: 'piiPseudonymization', value: 'PII pseudonymized at the model boundary (pdpa_redacted gate enforced)' },
  // usageEvents carry a 90-day TTL (rolled up before expiry).
  { key: 'usageEventsTtl', value: '90 days' },
  // Audit rows store one-way sha256 hashes only — never raw PII.
  { key: 'auditHashesOnly', value: 'Audit rows store sha256 hashes only — never raw PII' },
  // Data-subject erasure completes within the 72-hour SLA.
  { key: 'erasureSla', value: 'Under 72 hours' },
] as const

/**
 * Route (path-relative, locale segment prepended by the caller) of the existing
 * admin erasure flow that the PDPA-settings page links to. The actual erasure
 * UI is owned by app/[lang]/(admin)/erasure — this constant just names the link
 * target so the static display stays a single source.
 */
export const PDPA_ERASURE_ROUTE = 'erasure' as const
