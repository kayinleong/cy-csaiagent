/**
 * src/inventory/priority.ts — Admin "Priority List" ranking boost
 * (quick-kayinleong-090).
 *
 * An admin writes a free-text ordering prompt in the Priority List console; it is
 * stored at `appConfig/priorityList` and read by src/config/priority-list.ts.
 * This module turns that prose into a deterministic ORDERING over projects the
 * search has ALREADY returned.
 *
 * ## What this is allowed to do
 * Reorder. Nothing else.
 *
 * The boost runs at the very end of searchProjects, after every Stage-A hard gate
 * (status:'active', foreignEligible, bumiQuota), after the location and price hard
 * filters, and after the MIN_RELEVANCE floor. So a boosted project has already
 * proven it is active, in the requested area, within budget, and eligible for this
 * lead. Moving it to the front is a business preference applied to a valid result
 * set — it can never conjure a project the gates rejected.
 *
 * This is the guarantee that keeps the admin surface honest: an admin who writes
 * "always push Royal Suites" does NOT get Royal Suites shown to a lead asking for
 * Cheras under RM500k. The area the user asked for still wins. That is deliberate —
 * showing an agent an out-of-area project is the exact failure documented in
 * src/agents/finder/prompt.ts ("an agent shown a Bangsar project under a Cheras
 * request learns to distrust the tool").
 *
 * ## Why matching is deterministic, not model-driven
 * A model asked "which of these projects did the admin mean?" would be one more
 * place to hallucinate, on the hot path, for a question with a factual answer.
 * Name matching is a string operation, so it is a string operation here — pure,
 * synchronous, and unit-testable without Firestore or a model.
 *
 * Core/shell rule: this file must NOT import from app/ or next.
 */

/**
 * Shortest alias we will match on at all. Below this, a "name" is noise.
 */
const MIN_ALIAS_CHARS = 4

/**
 * A SINGLE-token alias must clear a higher bar than a multi-token one. "Kensho" is a
 * project; "Royal" is half of one. Five characters is not a magic number — it is the
 * point at which a lone token stops being a generic English or Malay modifier, and it
 * is backstopped by the ambiguity guard in applyPriorityBoost, which is what actually
 * prevents a short prefix from hoisting the wrong project.
 */
const MIN_SINGLE_TOKEN_CHARS = 5

/** Strip punctuation and collapse whitespace so "Kensho @ Taman Desa" and "kensho taman desa" compare equal. */
function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

/**
 * The strings an admin might plausibly type to mean this project, longest first.
 *
 * These are token PREFIXES of the stored name, never arbitrary substrings. Corpus
 * names lead with the distinguishing part and trail into qualifiers an admin will not
 * retype — "Royal Suites, Pavilion Damansara Heights (phase 2)" gets written as "Royal
 * Suites", "Conlay KLCC" as "Conlay". Prefixes capture that and nothing else.
 *
 * Prefix-only is also what keeps generic trailing words inert: a project named "The
 * Residence" yields "the residence" and "the" (rejected as too short), so the bare word
 * "residence" in an unrelated sentence can never hoist it.
 */
function aliasesFor(projectName: string): string[] {
  const tokens = normalize(projectName).split(' ').filter(Boolean)
  const out: string[] = []

  for (let take = tokens.length; take >= 1; take--) {
    const alias = tokens.slice(0, take).join(' ')
    if (alias.length < MIN_ALIAS_CHARS) continue
    if (take === 1 && alias.length < MIN_SINGLE_TOKEN_CHARS) continue
    out.push(alias)
  }
  return out
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** A resolved match: where the admin named this project, and how specifically. */
interface PriorityMatch {
  /** Character offset of the match in the normalized priority text — the ordering key. */
  offset: number
  /** How many name tokens matched. Higher = more specific; used to break ties. */
  specificity: number
}

function matchOf(projectName: string, priorityText: string): PriorityMatch | null {
  if (!priorityText.trim() || !projectName.trim()) return null
  const haystack = normalize(priorityText)
  if (!haystack) return null

  // Longest alias first: the most specific reading of the admin's text wins.
  for (const alias of aliasesFor(projectName)) {
    const pattern = new RegExp(`(?:^| )${escapeRegExp(alias)}(?: |$)`)
    const found = pattern.exec(haystack)
    if (found) {
      // +1 when the match consumed a leading space, so the offset points at the name.
      const offset = found[0].startsWith(' ') ? found.index + 1 : found.index
      return { offset, specificity: alias.split(' ').length }
    }
  }
  return null
}

/**
 * Where this project is named in the admin's priority text, or null when it is not
 * named at all.
 *
 * The RETURN VALUE IS THE ORDERING KEY: the character offset of the match, so a project
 * the admin mentioned first sorts ahead of one mentioned later. An admin writing
 * "Royal Suites first, then Accent PJ" gets exactly that order without learning a syntax.
 *
 * Matching is on word boundaries over a punctuation-normalized string, so "Accent" does
 * not fire inside "accentuate" and "Kensho" still matches "Kensho @ Taman Desa".
 *
 * @param projectName  The project's stored `name`, verbatim from Firestore.
 * @param priorityText The admin's free text. Empty/whitespace → always null.
 */
export function priorityRankOf(projectName: string, priorityText: string): number | null {
  return matchOf(projectName, priorityText)?.offset ?? null
}

/**
 * Stable-partition an already-ranked candidate list so admin-prioritised projects lead,
 * in the order the admin named them.
 *
 * Everything not named keeps its incoming relative order EXACTLY — this is a partition,
 * not a re-sort, so it cannot disturb the relevance-tier ordering quick-kayinleong-050
 * established for the non-prioritised majority. Empty priority text returns the input
 * array untouched (same reference), which is the common case and costs nothing.
 *
 * ## The ambiguity guard
 * Two projects can answer to the same short prefix — "Royal Suites ..." and "Royal
 * Gardens ..." both match the bare token "royal". Without a guard, an admin writing
 * "Royal Suites" would hoist BOTH, and the second one is simply wrong.
 *
 * So when several candidates match at the SAME offset in the text, only the most
 * specific match survives — the one that consumed the most name tokens. "Royal Suites"
 * (2 tokens) beats "Royal ..." (1 token) at that offset, and the loser drops back into
 * the unprioritised group with its original ranking intact. Nothing is ever dropped from
 * the result set; only its priority claim is.
 *
 * @param ranked       Candidates already through the gates, floor and segment weighting.
 * @param priorityText The admin's free text; empty disables the boost entirely.
 */
export function applyPriorityBoost<T extends { doc: { name: string } }>(
  ranked: T[],
  priorityText: string | null | undefined,
): T[] {
  if (!priorityText || !priorityText.trim()) return ranked

  const matched: Array<{ item: T; match: PriorityMatch }> = []
  for (const item of ranked) {
    const match = matchOf(item.doc.name, priorityText)
    if (match) matched.push({ item, match })
  }
  if (matched.length === 0) return ranked

  // Ambiguity guard: at each offset, keep only the most specific claimant.
  const bestSpecificityAt = new Map<number, number>()
  for (const { match } of matched) {
    const current = bestSpecificityAt.get(match.offset)
    if (current === undefined || match.specificity > current) {
      bestSpecificityAt.set(match.offset, match.specificity)
    }
  }

  const winners = new Set<T>()
  const claimedOffsets = new Set<number>()
  for (const { item, match } of matched) {
    if (match.specificity !== bestSpecificityAt.get(match.offset)) continue
    // A single offset names a single project; if two equally specific names tie, the
    // first in ranked order keeps the slot.
    if (claimedOffsets.has(match.offset)) continue
    claimedOffsets.add(match.offset)
    winners.add(item)
  }

  const prioritised = matched
    .filter(({ item }) => winners.has(item))
    .sort((a, b) => a.match.offset - b.match.offset)
    .map(({ item }) => item)

  if (prioritised.length === 0) return ranked

  const rest = ranked.filter((item) => !winners.has(item))
  return [...prioritised, ...rest]
}
