/**
 * src/escalation/index.ts — Public re-export for the escalation seam.
 *
 * Consumers import from '@/src/escalation' (not sub-modules directly).
 * The stall-detect job uses: findStalled + emitHandoffSignal
 * The coach agent KB-miss path uses: emitHandoffSignal (reason:'kb_miss')
 *
 * References: TSD §3.2, 01-11 PLAN.md, D-10
 */

export { findStalled } from './detect'
export type { StalledAgent, FindStalledOptions } from './detect'

export { emitHandoffSignal } from './handoff'
export type { HandoffSignalInput, EscalationReason } from './handoff'
