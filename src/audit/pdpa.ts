/**
 * PDPA boundary pseudonymization + the pdpa_redacted gate.
 *
 * This module is the compliance spine for cross-border data transfer (TSD §5.3,
 * RESEARCH §Pitfall A). It runs on the server BEFORE any prompt leaves the
 * server boundary to Anthropic (US).
 *
 * Two exports:
 *   pseudonymize — replace names and phones with opaque tokens; return a
 *                  server-side-only mapping for client-side reconstitution.
 *   assertRedacted — throw PdpaViolationError if the payload was not
 *                    pseudonymized; called IMMEDIATELY before streamText().
 *
 * Security:
 *   - Phone hashing uses Node crypto sha256 (never hand-rolled).
 *   - The mapping is NEVER logged, never sent to the model, never stored.
 *   - assertRedacted THROWS (does not warn) — a warning would be silently ignored.
 *
 * Usage in 01-11 chat route:
 *   const { redacted, pdpa_redacted, mapping } = pseudonymize(input, knownNames)
 *   assertRedacted({ pdpa_redacted })   // THROWS if gate fails
 *   const stream = await streamText({ messages: redacted.messages, ... })
 */

import { createHash } from 'crypto'

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
 * Hash a phone number with sha256 and return the first 12 hex chars.
 * Short enough to be readable in logs; long enough to be collision-resistant
 * for audit purposes. The full hash is not stored; only the truncated token.
 */
function hashPhone(phone: string): string {
  return createHash('sha256').update(phone).digest('hex').slice(0, 12)
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
 * Apply both name and phone replacement to a single string.
 */
function redactText(
  text: string,
  names: string[],
  nameIndexMap: Map<string, number>,
  mapping: Map<string, string>,
): string {
  let result = replaceNames(text, names, nameIndexMap, mapping)
  result = replacePhones(result, mapping)
  return result
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Pseudonymize PII in a prompt payload before it leaves the server boundary.
 *
 * Names are replaced with `<LEAD_ID:n>` tokens (sequential, stable within a call).
 * Phones are replaced with `<PHONE_HASH:hexchars>` (sha256-derived, deterministic).
 *
 * The returned `mapping` records token → original value for server-side reconstitution.
 * The `redacted` output is safe to send to the model.
 *
 * @param input   The prompt payload (system, messages, context).
 * @param names   Known lead names to replace. Pass [] if no names are known.
 *                Caller is responsible for providing names from the lead record.
 * @returns       { redacted, pdpa_redacted: true, mapping }
 */
export function pseudonymize(input: PseudonymizeInput, names: string[]): PseudonymizeResult {
  const mapping = new Map<string, string>()
  const nameIndexMap = new Map<string, number>()

  const redactedMessages = input.messages.map((msg) => ({
    ...msg,
    content: redactText(msg.content, names, nameIndexMap, mapping),
  }))

  const redactedSystem = input.system
    ? redactText(input.system, names, nameIndexMap, mapping)
    : undefined

  const redactedContext = input.context
    ? redactText(input.context, names, nameIndexMap, mapping)
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
