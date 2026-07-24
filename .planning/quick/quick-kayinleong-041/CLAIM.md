# Claim: quick-kayinleong-041
- owner: kayinleong
- session: claude-code
- branch: quick-kayinleong-041-router-finder-keywords
- started: 2026-07-24
- status: done
- summary: Widen the Finder keyword fast-path so common property phrasings (condo/apartment/unit, standalone price shapes like 800k/1.2m, sqft/psf, freehold/leasehold, NBR shorthand) route deterministically to Finder in Auto mode instead of falling through to the coach-biased LLM classifier and misrouting to Coach.

## Context / Symptom

In Auto mode, some property queries misroute to Coach. Root cause is two-fold:

1. `src/router/classifier.ts` is **coach-biased by design** — its system prompt says
   "When in doubt, prefer coach" and `routeAsync` defaults sub-threshold confidence to
   coach (`src/router/index.ts:85`). So any property query that reaches the LLM
   classifier tends to land on Coach.
2. `FINDER_PATTERNS` in `src/router/heuristic.ts` has vocabulary gaps — it catches
   `budget`/`bedroom`/`RM`/`own-stay` but NOT property-type nouns (condo, apartment,
   unit, landed, penthouse…), standalone price shapes (`800k`, `1.2m`, `RM800000` with
   no space), size units (sqft/psf), tenure (freehold/leasehold), or bedroom shorthand
   (`2BR`). Those phrasings miss the deterministic Finder fast-path and fall to the
   coach-biased classifier.

Decision (user): fix by **improving routing accuracy**, not a fallback cascade. Scope
this claim to the deterministic keyword fast-path only. The classifier coach-bias is
left intentionally as the safe default for genuinely ambiguous queries (out of scope).

## What will change

- `src/router/heuristic.ts`: extend `FINDER_PATTERNS` with property-type nouns, tenure,
  standalone price/size shapes, and bedroom shorthand — chosen to NOT overlap the COACH
  vocabulary (onboarding/training/playbook/checkpoint/meta-ad/journey/escalation) or the
  Reply structural signals (which are still checked FIRST — precedence preserved).
- `src/router/heuristic.test.ts`: add cases for the previously-misrouting phrasings and a
  coach-regression guard ("in-house training" must still route to coach).

## What has changed

- `src/router/heuristic.ts`: extended `FINDER_PATTERNS` with 22 property-vocabulary
  regexes grouped as: property-type nouns (condo/condominium, apartment, penthouse,
  studio, landed, terrace(d), semi-d, bungalow, duplex, townhouse, soho/sofo, unit(s)),
  tenure (freehold, leasehold), standalone price shapes (`RM\s?\d` no-space case,
  `\d{2,4}k`, `\d+(.\d+)?\s?(m|mil|million)`), size units (sqft/sq ft, square feet, psf),
  and bedroom shorthand (`\d+\s?BR`, `\d+\s?BHK`). All chosen NOT to overlap COACH
  vocabulary; Reply structural signals still run first in `heuristicPillar` (precedence
  preserved). No change to classifier, thresholds, or the coach safe-default.
- `src/router/heuristic.test.ts`: added a `quick-041` describe block — 19 parametrized
  finder-phrasing cases (previously null → coach-biased classifier), 2 coach-regression
  guards ("in-house training", "onboarding checkpoint"), and 1 reply-precedence guard
  ("draft a reply … the unit?" stays reply despite the new `unit` finder keyword).

## Verification

**Regression surface:** `heuristicPillar`/`route`/`routeAsync` (router), the chat route's
GATE-4 dispatch (`app/api/chat/route.ts`), the coach sync-route callers, and the Reply
precedence ordering (REPLY patterns checked before FINDER).

**What was tested / ruled out:**
- `npx vitest run src/router` → 66 passed (44 existing + 22 new). Coach keyword routes
  (onboarding/training/playbook/checkpoint/meta-ad) and the ambiguous→null case unchanged.
- `npx vitest run app/api/chat/route.test.ts tests/chat-route.test.ts src/agents/coach`
  → 76 passed. Dispatch + coach behavior unaffected.
- `npx tsc --noEmit` → 0. `npx eslint src/router/heuristic.ts(+test)` → 0.
- Reply-precedence ruled out as a regression: `heuristicPillar` checks REPLY_PATTERNS +
  looksLikeInboundPaste BEFORE the FINDER scan, so adding `unit`/`condo` as finder
  keywords cannot steal a pasted inbound (explicit guard test added + green).
- Coach-collision ruled out: none of the 22 new regexes match any COACH test string
  (verified by the 2 coach-regression guards + the existing coach suite staying green).
- SCOPE (intentional non-change): the LLM classifier's coach bias
  (`src/router/classifier.ts` "when in doubt, prefer coach") and the 0.5 confidence
  default remain — they stay the SAFE fallback for genuinely ambiguous queries. This
  claim only widens the deterministic fast-path, per the user's "improve routing
  accuracy" decision (not a fallback cascade).

**Not verifiable here:** live Auto-mode routing on the deployed app (needs an auth'd chat
session). The keyword paths are fully covered by the unit tests above.

- status: done
