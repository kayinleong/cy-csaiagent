/**
 * src/router/index.ts — Intent router public API.
 *
 * Phase 3: exports the full three-tier routing decision:
 *   routeAsync: override → heuristic → LLM classifier → low-confidence default
 *   route:      sync fast-path only (override → heuristic → 'coach' default)
 *
 * Consumers import from '@/src/router' — never from sub-modules directly.
 *
 * Phase 1: route() → always coach (heuristic-only, D-03).
 * Phase 3: routeAsync() adds the LLM classifier fallback for ambiguous conversations;
 *          sync route() preserved for callers that cannot await (T-03-18, Pitfall 7).
 *
 * Design: D-01 (classifier activation), D-02 (routeDecision observability),
 * 03-RESEARCH.md Pattern 1 + Pitfall 2/7.
 *
 * NEVER import from app/ or next — core module (CLAUDE.md core/shell rule).
 */

import { classifyIntent } from './classifier'
import { route as routeSync, heuristicPillar } from './heuristic'
import type { MessageTurn, RouteOptions, RouteDecision } from './heuristic'

// ─── Re-export sync fast-path + types ────────────────────────────────────────

export { routeSync as route }
export type { Pillar, MessageTurn, RouteOptions, RouteDecision } from './heuristic'
export { classifyIntent } from './classifier'

// ─── Confidence threshold (A6 — tunable) ─────────────────────────────────────

/**
 * Minimum classifier confidence to use the classifier's pillar.
 * Below this threshold → default to 'coach' (safe pillar; Pitfall 2).
 *
 * Exported so tests can assert boundary conditions; can be tuned via Remote Config
 * in a future iteration. Default of 0.5 balances precision vs mis-route risk (A6).
 */
export const ROUTER_CONFIDENCE_THRESHOLD = 0.5

// ─── routeAsync ──────────────────────────────────────────────────────────────

/**
 * Route a conversation through the full three-tier decision chain.
 *
 * Decision order (D-01):
 *   1. Manual-override chip (opts.override) → {pillar, reason:'manual-override'}, no classifier.
 *   2. heuristicPillar(messages) clear → return heuristic decision, no classifier.
 *   3. classifyIntent(messages) → LLM classifier via generateObject (modelFor('router')).
 *      a. confidence >= ROUTER_CONFIDENCE_THRESHOLD → use classifier's pillar.
 *         reason: `classifier:${c.reason}` (encodes tier for routeDecision D-02).
 *      b. confidence < threshold → default to 'coach' (safe pillar; Pitfall 2).
 *         reason: `low_confidence:${c.reason}` (observable; eval-able).
 *
 * The returned reason string encodes the deciding tier for routeDecision (D-02):
 *   - 'manual-override'            → override chip
 *   - 'heuristic-finder:…'         → keyword heuristic (finder)
 *   - 'heuristic-coach:…'          → keyword heuristic (coach)
 *   - 'heuristic-ambiguous-default-coach' → sync default (should not appear here — routeSync used)
 *   - 'classifier:…'               → LLM classifier above threshold
 *   - 'low_confidence:…'           → LLM classifier below threshold → defaulted to coach
 *
 * @param messages  The conversation history (PDPA-redacted; most-recent last).
 * @param opts      Optional routing options (override chip value from the UI).
 * @returns         RouteDecision { pillar, reason }
 */
export async function routeAsync(
  messages: MessageTurn[],
  opts?: RouteOptions
): Promise<RouteDecision> {
  // 1. Manual-override chip — wins over all heuristics (T-03-19).
  if (opts?.override !== undefined) {
    return { pillar: opts.override, reason: 'manual-override' }
  }

  // 2. Content heuristic — clear keyword fast-path (no LLM call; T-03-17).
  const heuristic = heuristicPillar(messages)
  if (heuristic !== null) {
    return { pillar: heuristic.pillar, reason: heuristic.reason }
  }

  // 3. Ambiguous — call the LLM classifier.
  const classification = await classifyIntent(messages)

  if (classification.confidence < ROUTER_CONFIDENCE_THRESHOLD) {
    // Below threshold → default to 'coach' (safe pillar; Pitfall 2 / D-01).
    // reason encodes 'low_confidence' so eval and the dashboard can observe it (D-02).
    return {
      pillar: 'coach',
      reason: `low_confidence:${classification.reason}`,
    }
  }

  // Above threshold → use the classifier's pillar.
  // reason encodes 'classifier:' tier prefix for routeDecision observability (D-02).
  return {
    pillar: classification.pillar,
    reason: `classifier:${classification.reason}`,
  }
}
