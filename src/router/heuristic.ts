/**
 * src/router/heuristic.ts — Phase 1 intent router (heuristic-only).
 *
 * In Phase 1 the platform has a single active pillar: Coach (D-03).
 * The heuristic always routes to 'coach' unless a manual-override chip is present.
 *
 * Design decisions:
 *   - Pure logic — no Firebase, no Next.js, no async. Framework-free + unit-testable.
 *   - The LLM classifier (`classifier.ts`) is a dormant seam that activates in Phase 3
 *     when a second pillar joins the chat surface (D-06). It is NOT imported here.
 *   - The manual-override chip lets the UI (or a coach) force a specific pillar.
 *     This is the escape-hatch seam documented in TSD §3.2 router row.
 *
 * Consumed by: src/router/index.ts → chat route (01-11), stall-detect job (01-10).
 *
 * References: TSD §3.2 router row, D-03, D-06, FND-06, RESEARCH §Arch-Map intent-routing row.
 */

// CRITICAL: classifyIntent MUST NOT be imported here in Phase 1.
// The seam is the import boundary — adding `import { classifyIntent } from './classifier'`
// here is the Phase 3 activation trigger. Do not do it until Phase 3.

/** Supported pillar names. */
export type Pillar = 'coach' | 'finder' | 'reply'

/** A single message turn in the conversation. */
export interface MessageTurn {
  role: string
  content: string
}

/** Options passed to `route()`. */
export interface RouteOptions {
  /**
   * Manual-override chip. When set, the router ignores the heuristic and returns
   * this pillar directly. Used by the UI pillar-selector chip + senior-coach override.
   * This seam is present from Phase 1 even though only one chip is active.
   */
  override?: Pillar
}

/** The routing decision returned to the caller. */
export interface RouteDecision {
  pillar: Pillar
  reason: string
}

/**
 * Route a conversation to the appropriate pillar.
 *
 * Phase 1 behavior:
 *   - If `opts.override` is set, return that pillar with reason `'manual-override'`.
 *   - Otherwise always return `{ pillar: 'coach', reason: 'phase-1-single-pillar' }`.
 *
 * Phase 3 will add: if heuristic is ambiguous, defer to `classifyIntent()` (LLM fallback).
 *
 * @param messages  The conversation history (most-recent last).
 * @param opts      Optional routing options (override chip).
 * @returns         A routing decision `{ pillar, reason }`.
 */
export function route(messages: MessageTurn[], opts?: RouteOptions): RouteDecision {
  // Manual-override chip — wins over all heuristics.
  // Seam is present in Phase 1; the UI only shows the Coach chip until Phase 3.
  if (opts?.override !== undefined) {
    return { pillar: opts.override, reason: 'manual-override' }
  }

  // Phase 1 heuristic: single-pillar — always Coach (D-03).
  //
  // The `messages` parameter is intentionally not inspected in Phase 1.
  // Phase 3 activation: add heuristic content analysis here before the
  // LLM classifier fallback (classifyIntent) is invoked for ambiguous cases.
  //
  // Suppress the unused-variable lint warning — the parameter is intentionally
  // present for the Phase 3 extension seam (consistent interface from day 1).
  void messages

  return { pillar: 'coach', reason: 'phase-1-single-pillar' }
}
