/**
 * src/router/heuristic.ts — Phase 3 intent router (heuristic + sync fast-path).
 *
 * Phase 3 changes from Phase 1:
 *   - Added `heuristicPillar()`: content keyword analysis that maps clear finder/coach
 *     keywords to a pillar without calling the LLM (cost + latency saving — T-03-17).
 *   - `route()` now uses heuristicPillar() for the sync fast-path:
 *       override → heuristicPillar (clear) → 'coach' (safe sync default).
 *   - The LLM fallback for ambiguous cases lives in `routeAsync()` (index.ts) — NOT here.
 *     This keeps the sync `route()` callers (coach.test.ts) unchanged (T-03-18, Pitfall 7).
 *
 * Design decisions:
 *   - Pure logic — no Firebase, no Next.js, no async. Framework-free + unit-testable.
 *   - The LLM classifier (`classifier.ts`) is imported ONLY by `routeAsync` in index.ts,
 *     NOT by route() here. This preserves the sync fast-path and prevents async ripple.
 *   - The manual-override chip wins over all heuristics (T-03-19).
 *
 * Consumed by: src/router/index.ts → chat route (03-07), stall-detect job (01-10).
 *
 * References: TSD §3.2 router row, D-01, D-03, 03-RESEARCH.md Pattern 1 + Pitfall 2/7.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

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
   */
  override?: Pillar
}

/** The routing decision returned to the caller. */
export interface RouteDecision {
  pillar: Pillar
  reason: string
}

// ─── Keyword sets ─────────────────────────────────────────────────────────────

/**
 * Finder keywords: clear signals that the conversation is about property matching,
 * lead criteria, or inventory queries.
 *
 * Patterns use word-boundary / case-insensitive matching via regex.
 * Only strong, unambiguous keywords are included — ambiguity stays for the classifier.
 */
const FINDER_PATTERNS: RegExp[] = [
  /\bRM\b/,                          // Malaysian ringgit amount
  /\bbudget\b/i,                     // "client budget", "budget of"
  /\bbedroom\b/i,                    // "3 bedroom", "bedroom unit"
  /\b(?:my|paste|the)\s+lead\b/i,   // "my lead", "paste lead", "the lead" (not "register my first lead")
  /\blead\s+(?:criteria|details|info|contact|budget)\b/i, // "lead criteria", "lead details"
  /\bpaste\b/i,                      // "paste lead details", "paste criteria"
  /\bpropert(?:y|ies)\b/i,          // "property", "properties" — not "project" alone (too broad)
  /\bshow\s+me\s+projects?\b/i,     // "show me projects", "show me project"
  /\bmatching\s+projects?\b/i,      // "matching projects"
  /\bprojects?\s+(?:under|near|in|around|above|below|with|for)\b/i, // "projects under 500k"
  /\bown[- ]stay\b/i,               // "own stay", "own-stay"
  /\binvestment\s+propert/i,        // "investment property"
  /\bunder\s+\d+k\b/i,             // "under 500k", "under 800k"
  /\bproperty\s+match/i,            // "property match", "property matching"
  /\bfinancing\b/i,                 // "financing options", "bank financing"
  /\beligib/i,                      // "eligible", "eligibility", "ineligible"
  /\bcollateral\b/i,                // "collateral attached", "project collateral"
  /\bpriceBand\b/i,                 // schema field name (tool/API context)
]

/**
 * Coach keywords: clear signals that the conversation is about onboarding, training,
 * D2 journey, playbooks, or mentorship.
 */
const COACH_PATTERNS: RegExp[] = [
  /\bonboarding\b/i,             // "my onboarding journey", "onboarding checkpoint"
  /\bcheckpoint\b/i,             // "I completed my checkpoint", "next checkpoint"
  /\btraining\b/i,               // "training starts", "training module"
  /\bplaybook\b/i,               // "find the playbook", "channel playbook"
  /\bmeta\s+ad/i,                // "meta ad", "Meta ads", "run a meta ad"
  /\bjourney\b/i,                // "onboarding journey", "agent journey"
  /\bcoach\b/i,                  // "my coach", "senior coach"
  /\bescalat/i,                  // "escalate", "escalation"
  /\bcomprehension\b/i,          // "comprehension check", "comprehension gate"
]

/**
 * Reply keywords (Phase 4, REPLY-10): clear STRUCTURAL signals that the agent has
 * pasted an INCOMING WhatsApp message from a lead/client and wants a drafted reply
 * (cold-prospect qualifying / objection-handling / financing).
 *
 * ⚠️ Precedence (04-RESEARCH §Q8 / Pitfall C): these are checked BEFORE the generic
 * FINDER_PATTERNS keyword scan in `heuristicPillar`. A pasted inbound that mentions
 * "RM" or "financing" (both Finder keywords) is a Reply-draft request, NOT a Finder
 * query — so the Reply structural signal must win. The override chip + LLM classifier
 * remain the safety net for ambiguity (A6).
 *
 * Only strong, unambiguous structural signals are included — ambiguity stays for the
 * classifier (the inbound-block heuristic below adds a multi-line-paste signal).
 */
const REPLY_PATTERNS: RegExp[] = [
  /\bdraft (a )?repl/i,                      // "draft a reply", "draft reply to this"
  /\breply to (this|him|her|them|the lead|the client)\b/i, // "reply to this", "reply to her"
  /\bwhat (should|do) i (say|reply)\b/i,     // "what should I say", "what do I reply"
  /\bhow (should|do) i (reply|respond)\b/i,  // "how should I reply", "how do I respond"
  /\b(lead|client|prospect) (said|wrote|sent|asked|replied)\b/i, // "lead said", "client wrote"
  /\bhelp me (reply|respond)\b/i,            // "help me reply to this message"
]

/**
 * Inbound-block heuristic (Phase 4): flags a pasted/quoted incoming message even when
 * no single REPLY_PATTERNS regex matches the whole text. A pasted WhatsApp inbound is
 * typically multi-line OR carries a quote marker, AND co-occurs with a reply trigger
 * word. This is the STRUCTURAL "this is a paste, draft a reply" signal (Pitfall C).
 *
 * Returns true when the recent text contains BOTH:
 *   - a paste shape: 2+ newlines OR a quote marker (a `"…"` quoted segment, or a
 *     leading `>` quote line), AND
 *   - a reply trigger word: reply / respond / draft / said / wrote / sent.
 *
 * Kept conservative so a multi-line Finder criteria paste (no reply trigger) does NOT
 * trip it — those still fall through to the FINDER_PATTERNS scan.
 */
const REPLY_TRIGGER_WORD = /\b(repl(y|ies|ied)|respond|draft|said|wrote|sent)\b/i
const QUOTE_MARKER = /"[^"]+"|(^|\n)\s*>/

function looksLikeInboundPaste(text: string): boolean {
  const newlineCount = (text.match(/\n/g) ?? []).length
  const hasPasteShape = newlineCount >= 2 || QUOTE_MARKER.test(text)
  return hasPasteShape && REPLY_TRIGGER_WORD.test(text)
}

// ─── heuristicPillar ─────────────────────────────────────────────────────────

/**
 * Inspect message content for clear keyword signals and return the pillar
 * if a strong match is found, or `null` if the conversation is ambiguous.
 *
 * Only returns non-null for messages where the pillar is clear — ambiguous
 * cases return null and should be deferred to the LLM classifier (routeAsync).
 *
 * @param messages  The conversation history.
 * @returns         { pillar, reason } if clear; null if ambiguous.
 */
export function heuristicPillar(
  messages: MessageTurn[]
): { pillar: 'coach' | 'finder' | 'reply'; reason: string } | null {
  // Inspect the last few turns for keyword signals
  const recentText = messages
    .slice(-4)
    .map((m) => m.content)
    .join(' ')

  // ⚠️ Check Reply STRUCTURAL signals FIRST (REPLY-10, Pitfall C). A pasted inbound
  // that mentions "RM"/"financing" (Finder keywords) is a Reply-draft request — the
  // structural Reply signal must win over the generic Finder keyword scan below.
  for (const pattern of REPLY_PATTERNS) {
    if (pattern.test(recentText)) {
      return { pillar: 'reply', reason: `heuristic-reply:${pattern.source}` }
    }
  }
  // Inbound-block heuristic: a multi-line / quoted paste + a reply trigger word.
  if (looksLikeInboundPaste(recentText)) {
    return { pillar: 'reply', reason: 'heuristic-reply:inbound-block' }
  }

  // Check finder patterns (finder keywords are more specific)
  for (const pattern of FINDER_PATTERNS) {
    if (pattern.test(recentText)) {
      return { pillar: 'finder', reason: `heuristic-finder:${pattern.source}` }
    }
  }

  // Check coach patterns
  for (const pattern of COACH_PATTERNS) {
    if (pattern.test(recentText)) {
      return { pillar: 'coach', reason: `heuristic-coach:${pattern.source}` }
    }
  }

  // No clear keyword signal — caller should use the LLM classifier
  return null
}

// ─── route (sync fast-path) ───────────────────────────────────────────────────

/**
 * Route a conversation to the appropriate pillar — SYNC fast-path only.
 *
 * Decision order:
 *   1. Manual-override chip (opts.override) → return immediately.
 *   2. heuristicPillar() has a clear keyword signal → return heuristic decision.
 *   3. Ambiguous → return 'coach' as the safe sync default.
 *      (The LLM classifier fallback lives in routeAsync — not here.)
 *
 * This function is intentionally synchronous so that existing callers
 * (coach.test.ts, stall-detect job) are unaffected by the Phase-3 activation
 * of the async classifier (T-03-18, Pitfall 7).
 *
 * For the full heuristic→classifier→low-confidence-default flow, use routeAsync().
 *
 * @param messages  The conversation history (most-recent last).
 * @param opts      Optional routing options (override chip).
 * @returns         A routing decision `{ pillar, reason }`.
 */
export function route(messages: MessageTurn[], opts?: RouteOptions): RouteDecision {
  // 1. Manual-override chip — wins over all heuristics (T-03-19).
  if (opts?.override !== undefined) {
    return { pillar: opts.override, reason: 'manual-override' }
  }

  // 2. Content heuristic — clear keyword fast-path (no LLM call; T-03-17).
  const heuristic = heuristicPillar(messages)
  if (heuristic !== null) {
    return { pillar: heuristic.pillar, reason: heuristic.reason }
  }

  // 3. Ambiguous — safe sync default is 'coach' (the established pillar).
  //    For LLM classifier disambiguation, call routeAsync() instead.
  return { pillar: 'coach', reason: 'heuristic-ambiguous-default-coach' }
}
