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

  // ── quick-kayinleong-041: property vocabulary that previously missed the fast-path
  //    and fell through to the coach-biased LLM classifier (Auto-mode misroute → coach).
  //    Every pattern below is chosen NOT to overlap the COACH vocabulary
  //    (onboarding / training / playbook / checkpoint / journey / meta-ad / escalation);
  //    Reply STRUCTURAL signals still run FIRST in heuristicPillar, so a pasted inbound
  //    that mentions "unit"/"condo" stays a Reply-draft (precedence preserved).
  // Property-type nouns:
  /\bcondo(?:minium)?\b/i,          // "condo", "condominium"
  /\bapartment\b/i,                 // "apartment", "serviced apartment"
  /\bpenthouse\b/i,                 // "penthouse"
  /\bstudio\b/i,                    // "studio unit"
  /\blanded\b/i,                    // "landed property"
  /\bterrace(?:d)?\b/i,             // "terrace", "terraced house"
  /\bsemi[- ]?d\b/i,                // "semi-d", "semi d", "semid"
  /\bbungalow\b/i,                  // "bungalow"
  /\bduplex\b/i,                    // "duplex"
  /\btownhouse\b/i,                 // "townhouse"
  /\bso[fh]o\b/i,                   // "soho", "sofo" (small/home-office units)
  /\bunits?\b/i,                    // "unit", "units" — property inventory noun
  // Tenure (strong Finder signal):
  /\bfreehold\b/i,                  // "freehold"
  /\bleasehold\b/i,                 // "leasehold"
  // Standalone price shapes (affordability signal without the word "budget"):
  /\bRM\s?\d/i,                     // "RM800000", "RM 800k" (no-space case \bRM\b misses)
  /\b\d{2,4}k\b/i,                  // "800k", "500k" standalone (not only "under 800k")
  /\b\d+(?:\.\d+)?\s?(?:m|mil|million)\b/i, // "1.2m", "1.2 million", "1m"
  // Size units:
  /\bsq\s?ft\b/i,                   // "sqft", "sq ft"
  /\bsquare\s+feet\b/i,             // "square feet"
  /\bpsf\b/i,                       // "psf" (price per square foot)
  // Bedroom shorthand:
  /\b\d+\s?br\b/i,                  // "2BR", "3 BR"
  /\b\d+\s?bhk\b/i,                 // "2BHK"
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

  // ── quick-kayinleong-046: widened coach vocabulary (a LATENCY fix, not a routing
  //    redesign).
  //    WHY: with only the 9 regexes above (vs 51 finder patterns), an ordinary coach
  //    question matched NOTHING, heuristicPillar() returned null, and routeAsync()
  //    fell through to `await classifyIntent()` — a blocking generateObject round-trip
  //    (~400–1200 ms of dead air) BEFORE streamText() emits its first token.
  //    Coach is already the safe default on BOTH the sync path (`route()` step 3) and
  //    the low-confidence classifier branch (index.ts), so catching these
  //    deterministically changes the LATENCY, not the destination — and it upgrades
  //    `reason` from `classifier:*` to `heuristic-coach:*`, which keeps routeDecision
  //    observability (D-02) intact.
  //
  //    SAFETY RULES every pattern below obeys:
  //      1. Zero overlap with FINDER vocabulary (condo / apartment / unit / landed /
  //         sqft / psf / freehold / leasehold / RM + price shapes / BR-BHK shorthand /
  //         budget / bedroom / property / lead-criteria / financing / eligib /
  //         collateral / own-stay). FINDER_PATTERNS are scanned BEFORE these, so an
  //         inventory query keeps winning even when it also says "commission".
  //      2. REPLY structural signals are scanned FIRST (Pitfall C) — unchanged. A
  //         pasted inbound stays a Reply draft even if it mentions "objection" or
  //         "script".
  //      3. No catch-all shapes (no bare /how do i/, no bare /\bclient\b/, no bare
  //         /\bbuyer\b/) — those would steal genuinely finder-intent traffic that
  //         carries no finder keyword, which must stay with the LLM classifier.

  // Onboarding / training / mentorship lifecycle:
  /\bonboard/i,                  // "onboard", "onboarded" (broadens \bonboarding\b)
  /\bmentor/i,                   // "mentor", "mentorship", "mentoring"
  /\bupline\b/i,                 // D2 hierarchy vocabulary
  /\bdownline\b/i,
  /\bnew\s+agent\b/i,            // "as a new agent", "new agent guide"
  /\bprobation\b/i,
  /\bramp[- ]?up\b/i,            // "ramp up", "ramp-up plan"
  /\bget(?:ting)?\s+started\b/i, // "how do I get started"
  /\bfirst\s+(?:day|week|month|deal|sale|closing|listing)\b/i,
  /\bmodules?\b/i,               // "training module"
  /\bquiz(?:zes)?\b/i,
  /\bassessment\b/i,
  /\bcertific/i,                 // "certificate", "certification", "certified"
  /\bworkshop\b/i,
  /\bwebinar\b/i,
  /\bbootcamp\b/i,
  /\bkpi\b/i,
  /\bcpd\b/i,                    // continuing professional development (REN upkeep)

  // Process / SOP / policy questions — the "how does D2 do X" shape:
  /\bsop\b/i,
  /\bstandard\s+operating\s+procedure/i,
  /\bcheck\s?list\b/i,           // "checklist", "check list"
  /\bguideline/i,
  /\bpolic(?:y|ies)\b/i,
  /\bcompliance\b/i,
  /\bpdpa\b/i,
  /\bbest\s+practice/i,
  /\bstep[- ]by[- ]step\b/i,
  /\bthe\s+(?:process|procedure|steps?)\b/i,
  /\b(?:process|procedure)\s+(?:for|of|to)\b/i,
  /\b(?:what|which)\s+documents?\b/i,
  /\bdocuments?\s+(?:needed|required|checklist|to\s+prepare)\b/i,
  /\bhow\s+do\s+i\s+(?:handle|deal\s+with|start|begin|prepare)\b/i,
  /\btips?\b/i,
  /\btemplates?\b/i,

  // Malaysian real-estate regulatory / transaction SOP (agent-facing, never inventory).
  //    REN / REA / SPA are matched CASE-SENSITIVELY so they cannot fire on the
  //    substrings "ren" / "rea" / "spa" inside ordinary lowercase prose.
  /\bREN\b/,                     // Real Estate Negotiator tag
  /\bREA\b/,                     // Real Estate Agent licence
  /\b(?:BOVAEA|BOVEA|LPPEH)\b/i, // the regulator
  /\bSPA\b/,                     // sale & purchase agreement
  /\bstamp\s+duty\b/i,
  /\bRPGT\b/i,                   // real property gains tax
  /\bMM2H\b/i,                   // Malaysia My Second Home
  /\bbumi(?:putera)?\b/i,        // bumiputera quota / discount rules
  /\bforeign\s+(?:buyer|purchaser|ownership|owner)\b/i,
  /\bforeigner/i,                // "can foreigners buy…"
  /\bloan\s+(?:application|approval|reject|document)/i,
  /\bco[- ]?brok/i,              // "co-broke", "co-broking", "cobroking"
  /\bcommission\b/i,

  // Sales-skills training (REPLY structural signals still win — they run first):
  /\bobjection/i,                // "objection handling", "price objections"
  /\bcold\s+(?:call|calling|message|dm)/i,
  /\bprospecting\b/i,
  /\bscripts?\b/i,
  /\blisting\s+(?:presentation|agreement)\b/i,
  /\b(?:facebook|fb|google|tiktok|instagram|ig)\s+ads?\b/i,
  /\blead\s+gen(?:eration)?\b/i,
  /\bviewing\b/i,                // "how do I arrange a viewing"
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
