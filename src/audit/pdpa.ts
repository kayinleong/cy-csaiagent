/**
 * PDPA boundary pseudonymization + the pdpa_redacted gate.
 *
 * This module is the compliance spine for cross-border data transfer (TSD §5.3,
 * RESEARCH §Pitfall A). It runs on the server BEFORE any prompt leaves the
 * server boundary to Anthropic (US).
 *
 * Two exports:
 *   pseudonymize — replace names, phones, Malaysian IC numbers, emails, and
 *                  RM-financial figures with opaque tokens; return a
 *                  server-side-only mapping for client-side reconstitution.
 *   assertRedacted — throw PdpaViolationError if the payload was not
 *                    pseudonymized; called IMMEDIATELY before streamText().
 *
 * Security:
 *   - All PII hashing uses Node crypto sha256 (never hand-rolled).
 *   - The mapping is NEVER logged, never sent to the model, never stored.
 *   - assertRedacted THROWS (does not warn) — a warning would be silently ignored.
 *   - Free-text IC/email/RM-financial coverage (RESEARCH §Q3 / Pitfall A) closes
 *     the false-positive gap where a WhatsApp paste reached the model unredacted.
 *
 * Usage in 01-11 chat route:
 *   const { redacted, pdpa_redacted, mapping } = pseudonymize(input, knownNames)
 *   assertRedacted({ pdpa_redacted })   // THROWS if gate fails
 *   const stream = await streamText({ messages: redacted.messages, ... })
 */

import { createHash } from 'crypto'

// scrubPdpaTokens lives in its own crypto-free module so client components can import it
// without pulling node:crypto into the browser bundle. Re-exported here for callers.
export { scrubPdpaTokens } from './scrub'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PseudonymizeInput {
  /** Optional system prompt — will have PII replaced */
  system?: string
  /** Conversation messages */
  messages: Array<{ role: string; content: string }>
  /** Optional freeform context (e.g. lead summary, retrieved KB text) */
  context?: string
}

export interface PseudonymizeResult {
  /** The redacted input ready to send to the model (no raw PII) */
  redacted: PseudonymizeInput
  /** Gate flag — assertRedacted requires this to be true */
  pdpa_redacted: true
  /**
   * Server-side-only mapping from replacement token → original value.
   * Used to reconstitute display names in the UI AFTER the response.
   * NEVER log this, NEVER send it to the model.
   */
  mapping: Map<string, string>
}

// ─── Errors ───────────────────────────────────────────────────────────────────

/**
 * Thrown by assertRedacted when a payload has not been through pseudonymize.
 * This is a hard failure — the gate refuses an unredacted production model call.
 */
export class PdpaViolationError extends Error {
  constructor(message = 'PDPA violation: payload has not been pseudonymized (pdpa_redacted !== true)') {
    super(message)
    this.name = 'PdpaViolationError'
  }
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * MY phone pattern — matches +60xxxxxxxx and 60xxxxxxxx forms (8–10 digits after 60).
 * Uses the broader range to catch both 9-digit and 10-digit numbers.
 */
const MY_PHONE_REGEX = /(\+?60\d{8,10})/g

/** Generic international phone — any + prefix with 7–15 digits */
const INTL_PHONE_REGEX = /(\+[1-9]\d{6,14})/g

/**
 * Malaysian NRIC (IC) — \d{6}-\d{2}-\d{4} (e.g. 880101-14-5678).
 * Word-bounded so it does not chew into longer digit runs.
 * RESEARCH §Q3 / Pitfall A: free-text IC in a WhatsApp paste must be tokenized
 * before the cross-border model call.
 */
const IC_REGEX = /\b\d{6}-\d{2}-\d{4}\b/g

/**
 * Email address — RFC-pragmatic (local@domain.tld). Word-bounded.
 * Covers the free-text email a lead pastes inline.
 */
const EMAIL_REGEX = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g

/**
 * RM-prefixed financial figure, case-insensitive: RM6000, RM 6,000, RM650,000.00,
 * RM1.5mil, RM1.5MIL, rm1.5mil, RM1.5 juta, RM2million, RM800k, RM 800 k, RM1.2M, RM1.5bil,
 * RM3.5k psf. The WHOLE figure is consumed including its suffix: letters glued to the number
 * are always swallowed (fails closed), and a spaced suffix is only taken from a known list.
 * No digit of an RM figure may be left outside the token (the old case-sensitive suffix
 * backtracked and leaked "<FIN_HASH>.5MIL").
 */
const FINANCIAL_REGEX =
  /\bRM\s?\d[\d,]*(?:\.\d+)?(?:[a-z]+|\s(?:k|m|mil|mill|million|b|bil|billion|juta|ribu|psf)\b)?/gi

/** How RM figures are treated. 'all' = mask every one; 'non-budget' = mask only income-like ones. */
export type FinancialMode = 'all' | 'non-budget'

export interface PseudonymizeOptions {
  /** Default 'all'. 'non-budget' is for the Property Finder only (see pseudonymize). */
  financial?: FinancialMode
}

/** Income / loan / bank cues (EN, BM, ZH). */
const INCOME_CUE =
  /\b(?:income|salary|earn(?:s|ing|ed)?|pay|gaji|pendapatan|commitments?|loan|pinjaman|instal+ments?|ansuran|savings?|simpanan|epf|kwsp|bank)\b|收入|月薪|工资|薪水|贷款|存款|银行/gi
/** Budget / price cues (EN, BM, ZH). */
const BUDGET_CUE =
  /\b(?:budget|bajet|price|harga|under|below|max|maximum|up to|around|between|range|afford|cap)\b|预算|价格|以下|以内|左右/gi
/** A per-month marker directly after a figure means a salary/instalment, not a property price. */
const PER_MONTH_AFTER =
  /^\s*(?:\/\s?(?:month|mo|bulan|mth)\b|\/月|(?:a|per|each|every)\s+month\b|monthly\b|bulanan|sebulan|setiap\s+bulan|每月|每个月|一个月)/i
/** How far back (chars) to look for a cue. */
const CUE_WINDOW = 40

/** Position of the last match of a (global) cue regex inside `text`, or -1. */
function lastCueIndex(cue: RegExp, text: string): number {
  let last = -1
  for (const m of text.matchAll(cue)) last = m.index ?? -1
  return last
}

/**
 * Does the RM figure at `offset` read as income / loan / bank money?
 * Rules (kept deliberately simple, fail-closed on ties):
 *   1. Followed by a per-month marker ("/month", "a month", "monthly", "sebulan", 每月…) -> income.
 *   2. Otherwise look at the CUE_WINDOW chars before it. Whichever of the income cues or the
 *      budget cues is NEAREST wins; an income cue with no budget cue at all -> income.
 *   3. No cue at all -> not income (a bare "RM1.5mil-RM2.5mil" is a budget).
 */
function looksLikeIncome(text: string, offset: number, matchLen: number): boolean {
  if (PER_MONTH_AFTER.test(text.slice(offset + matchLen))) return true
  const before = text.slice(Math.max(0, offset - CUE_WINDOW), offset)
  const inc = lastCueIndex(INCOME_CUE, before)
  if (inc < 0) return false
  const bud = lastCueIndex(BUDGET_CUE, before)
  return inc > bud
}

/**
 * Hash a string value with sha256 and return the first 12 hex chars.
 * Short enough to be readable in logs; long enough to be collision-resistant
 * for audit purposes. The full hash is not stored; only the truncated token.
 * Used for every regex-redacted PII class (phone, IC, email, financial).
 */
function hashValue(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 12)
}

/**
 * @deprecated Retained for backward-compat call shape; delegates to hashValue.
 * All PII-class redactors share the same sha256-truncated tokenization.
 */
function hashPhone(phone: string): string {
  return hashValue(phone)
}

/**
 * Replace all phone numbers in a string and record substitutions in mapping.
 */
function replacePhones(text: string, mapping: Map<string, string>): string {
  // Process MY phones first (higher specificity), then generic international
  let result = text.replace(MY_PHONE_REGEX, (match) => {
    const hash = hashPhone(match)
    const token = `<PHONE_HASH:${hash}>`
    mapping.set(token, match)
    return token
  })
  result = result.replace(INTL_PHONE_REGEX, (match) => {
    // Skip already-replaced tokens
    if (match.startsWith('<PHONE_HASH')) return match
    const hash = hashPhone(match)
    const token = `<PHONE_HASH:${hash}>`
    mapping.set(token, match)
    return token
  })
  return result
}

/**
 * Replace all Malaysian IC numbers in a string and record substitutions in mapping.
 * Token: <IC_HASH:hexchars> (sha256-derived, deterministic). Mirrors replacePhones.
 */
function replaceIC(text: string, mapping: Map<string, string>): string {
  return text.replace(IC_REGEX, (match) => {
    // Skip strings that are already a replacement token
    if (match.startsWith('<')) return match
    const token = `<IC_HASH:${hashValue(match)}>`
    mapping.set(token, match)
    return token
  })
}

/**
 * Replace all email addresses in a string and record substitutions in mapping.
 * Token: <EMAIL_HASH:hexchars>. Mirrors replacePhones.
 */
function replaceEmail(text: string, mapping: Map<string, string>): string {
  return text.replace(EMAIL_REGEX, (match) => {
    // Skip strings that are already a replacement token
    if (match.startsWith('<')) return match
    const token = `<EMAIL_HASH:${hashValue(match)}>`
    mapping.set(token, match)
    return token
  })
}

/**
 * Replace all RM-prefixed financial figures in a string and record them in mapping.
 * Token: <FIN_HASH:hexchars>. Runs LAST in redactText so RM-amounts embedded inside
 * an already-emitted token are not re-processed. Mirrors replacePhones.
 */
function replaceFinancial(
  text: string,
  mapping: Map<string, string>,
  mode: FinancialMode = 'all',
): string {
  return text.replace(FINANCIAL_REGEX, (match, offset: number) => {
    // Skip strings that are already a replacement token
    if (match.startsWith('<')) return match
    // Finder only: a property budget/price passes verbatim; income-like figures stay masked.
    if (mode === 'non-budget' && !looksLikeIncome(text, offset, match.length)) return match
    const token = `<FIN_HASH:${hashValue(match)}>`
    mapping.set(token, match)
    return token
  })
}

/**
 * Replace all known lead names in a string and record substitutions in mapping.
 * Names are assigned sequential numeric IDs (<LEAD_ID:1>, <LEAD_ID:2>, …).
 */
function replaceNames(
  text: string,
  names: string[],
  nameIndexMap: Map<string, number>,
  mapping: Map<string, string>,
): string {
  let result = text
  for (const name of names) {
    if (!name || !result.includes(name)) continue
    let idx = nameIndexMap.get(name)
    if (idx === undefined) {
      idx = nameIndexMap.size + 1
      nameIndexMap.set(name, idx)
    }
    const token = `<LEAD_ID:${idx}>`
    mapping.set(token, name)
    // Replace all occurrences (global replace)
    result = result.split(name).join(token)
  }
  return result
}

/**
 * Apply every PII-class redaction to a single string.
 *
 * Order is significant: names → phones → IC → email → financial.
 * Financial runs LAST because an RM-amount can appear inside other PII contexts;
 * each helper also skips strings already starting with a replacement token, so
 * earlier-emitted tokens (e.g. <PHONE_HASH:…>) are never double-processed.
 */
function redactText(
  text: string,
  names: string[],
  nameIndexMap: Map<string, number>,
  mapping: Map<string, string>,
  financial: FinancialMode = 'all',
): string {
  let result = replaceNames(text, names, nameIndexMap, mapping)
  result = replacePhones(result, mapping)
  result = replaceIC(result, mapping)
  result = replaceEmail(result, mapping)
  result = replaceFinancial(result, mapping, financial)
  return result
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Pseudonymize PII in a prompt payload before it leaves the server boundary.
 *
 * Names are replaced with `<LEAD_ID:n>` tokens (sequential, stable within a call).
 * Phones → `<PHONE_HASH:hexchars>`, Malaysian IC → `<IC_HASH:hexchars>`,
 * emails → `<EMAIL_HASH:hexchars>`, RM-financial → `<FIN_HASH:hexchars>`
 * (all sha256-derived, deterministic).
 *
 * The returned `mapping` records token → original value for server-side reconstitution.
 * The `redacted` output is safe to send to the model.
 *
 * @param input   The prompt payload (system, messages, context).
 * @param names   Known lead names to replace. Pass [] if no names are known.
 *                Caller is responsible for providing names from the lead record.
 * @param opts    `financial`: 'all' (default, every existing caller) masks every RM figure.
 *                'non-budget' (Property Finder only) leaves an RM figure verbatim unless it
 *                reads as income/salary/loan/bank: the nearest cue in the 40 chars before it
 *                is an income cue (income, salary, earn, pay, gaji, pendapatan, loan,
 *                pinjaman, bank, 收入, 月薪, 工资, 薪水, 贷款…) rather than a budget cue
 *                (budget, bajet, under, up to, 预算…), or it is followed by a per-month
 *                marker (/month, a month, monthly, sebulan, 每月, 一个月…). Names, phones, IC
 *                and emails are ALWAYS masked in both modes.
 * @returns       { redacted, pdpa_redacted: true, mapping }
 */
export function pseudonymize(
  input: PseudonymizeInput,
  names: string[],
  opts: PseudonymizeOptions = {},
): PseudonymizeResult {
  const financial: FinancialMode = opts.financial ?? 'all'
  const mapping = new Map<string, string>()
  const nameIndexMap = new Map<string, number>()

  const redactedMessages = input.messages.map((msg) => ({
    ...msg,
    content: redactText(msg.content, names, nameIndexMap, mapping, financial),
  }))

  const redactedSystem = input.system
    ? redactText(input.system, names, nameIndexMap, mapping, financial)
    : undefined

  const redactedContext = input.context
    ? redactText(input.context, names, nameIndexMap, mapping, financial)
    : undefined

  const redacted: PseudonymizeInput = {
    messages: redactedMessages,
    ...(redactedSystem !== undefined && { system: redactedSystem }),
    ...(redactedContext !== undefined && { context: redactedContext }),
  }

  return {
    redacted,
    pdpa_redacted: true,
    mapping,
  }
}

/**
 * Assert that a payload has been through pseudonymize before any model call.
 *
 * THROWS PdpaViolationError if `payload.pdpa_redacted !== true`.
 * Does NOT warn, log, or silently continue — the gate refuses the call.
 *
 * Call IMMEDIATELY before `streamText()` in the chat route:
 *   assertRedacted({ pdpa_redacted })   // throws if gate fails
 *   const stream = await streamText(...)
 *
 * @param payload  Object that must carry pdpa_redacted: true.
 * @throws {PdpaViolationError} If pdpa_redacted is not exactly true.
 */
export function assertRedacted(payload: { pdpa_redacted?: boolean }): asserts payload is { pdpa_redacted: true } {
  if (payload.pdpa_redacted !== true) {
    throw new PdpaViolationError()
  }
}
