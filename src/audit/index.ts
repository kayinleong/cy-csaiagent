/**
 * src/audit — PDPA compliance module.
 *
 * Re-exports from the two constituent modules:
 *   pdpa.ts — boundary pseudonymization + the pdpa_redacted gate
 *   log.ts  — append-only, hashes-only audit writer
 *
 * Callers import from '@/src/audit':
 *   import { pseudonymize, assertRedacted, PdpaViolationError, log } from '@/src/audit'
 *
 * Usage pattern in the chat route (01-11):
 *   1. const { redacted, pdpa_redacted, mapping } = pseudonymize(input, knownNames)
 *   2. assertRedacted({ pdpa_redacted })   // throws PdpaViolationError if gate fails
 *   3. const stream = await streamText({ messages: redacted.messages, ... })
 *   4. after(() => log({ actorUid: uid, action: 'chat', raw: { ... } }))
 */

// PDPA boundary pseudonymization + gate
export { pseudonymize, assertRedacted, PdpaViolationError } from './pdpa'
export type { PseudonymizeInput, PseudonymizeResult } from './pdpa'

// Append-only audit writer
export { log } from './log'
export type { AuditEntry } from './log'
