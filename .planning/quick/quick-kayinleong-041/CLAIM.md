# Claim: quick-kayinleong-041
- owner: kayinleong
- session: claude-code
- branch: quick-kayinleong-041-router-finder-keywords
- started: 2026-07-24
- status: in-progress
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

_(filled during execution)_

## Verification

_(filled before done)_
