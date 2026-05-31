/**
 * src/router/index.ts — Intent router public API.
 *
 * Exports the active routing function (`route`) and the dormant LLM classifier
 * seam (`classifyIntent`, `NotActivatedError`) for Phase 3 readiness.
 *
 * Consumers import from '@/src/router' — never from the sub-modules directly.
 * This lets Phase 3 swap in the LLM classifier by updating this file only.
 *
 * Phase 1: route() always → coach (heuristic-only, D-03).
 * Phase 3: route() will call classifyIntent() for ambiguous conversations (D-06).
 */

export { route } from './heuristic'
export type { Pillar, MessageTurn, RouteOptions, RouteDecision } from './heuristic'

// Dormant seam — exported so consumers can reference the type/error class,
// but NOT called by route() in Phase 1.
export { classifyIntent, NotActivatedError } from './classifier'
