---
phase: 04-reply-assistant
plan: 02
subsystem: security
tags: [pdpa, pseudonymization, pii-redaction, regex, sha256, cross-border-boundary, reply-assistant]

# Dependency graph
requires:
  - phase: 04-reply-assistant
    provides: "Plan 01 Wave-0 RED coverage suite — the it.fails() IC/email/RM-financial token contracts in src/audit/pdpa.test.ts that this plan turns GREEN"
provides:
  - "Free-text IC / email / RM-financial redaction in pdpa.ts: pseudonymize now tokenizes <IC_HASH:>/<EMAIL_HASH:>/<FIN_HASH:> before any cross-border model call"
  - "replaceIC / replaceEmail / replaceFinancial helpers (mirror replacePhones; sha256-truncated tokens; skip-already-tokenized guard)"
  - "Closed threat T-04-PDPA: a WhatsApp paste's name/IC/email/RM-financial no longer reaches Claude unredacted (the security blocker for any Reply model-call path)"
affects: [04-06-route-dispatch]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "PII-class redactor template: a regex constant + a replace* helper mirroring replacePhones exactly (sha256-via-hashValue, mapping.set(token, match), skip strings already starting with a '<' token), all wired into redactText in a fixed order (names -> phones -> IC -> email -> financial; financial last)"
    - "Shared hashValue(sha256, slice(0,12)) for every regex-redacted PII class; hashPhone retained as a thin back-compat delegate"

key-files:
  created: []
  modified:
    - "src/audit/pdpa.ts"
    - "src/audit/pdpa.test.ts"

key-decisions:
  - "Kept the presence-gate semantics of pdpa_redacted (hard-coded true) per the plan's explicit instruction + 04-RESEARCH A5/§Q3 — making the gate reflect real coverage is a Derek/legal decision (Open Question 1), NOT a unilateral executor change. Coverage is proven by the regexes + Plan-01 tests, exactly as the v1 posture prescribes."
  - "Flipped only the 3 in-scope PII-class guards (IC, email, 2x RM-financial) from it.fails() to it(); left the 'free-text name' it.fails() RED — that is Plan 06's route-level known-name injection concern, not this core-redactor plan."
  - "Introduced a generic hashValue() and made hashPhone delegate to it, so all five PII classes share one sha256-truncated tokenizer (do-not-hand-roll-crypto honored; no new dependency)."

patterns-established:
  - "PII-class redactor: regex const + replace* helper (mirror replacePhones) + ordered wiring into redactText, financial last, each guarding against re-processing emitted tokens"

requirements-completed: [QUAL-02]

# Metrics
duration: ~10min
completed: 2026-06-05
---

# Phase 4 Plan 02: Close the PDPA False-Positive Gate Summary

**Extended `src/audit/pdpa.ts` with Malaysian-IC / email / RM-financial regex redaction (sha256-tokenized `<IC_HASH:>`/`<EMAIL_HASH:>`/`<FIN_HASH:>`) wired into `redactText`, closing the security-critical gap where a WhatsApp paste's PII reached Claude unredacted — the Wave-0 coverage suite is now GREEN.**

## Performance

- **Duration:** ~10 min
- **Started:** 2026-06-05T18:38:00Z
- **Completed:** 2026-06-05T18:42:00Z
- **Tasks:** 1
- **Files modified:** 2

## Accomplishments
- Closed threat **T-04-PDPA** (Information Disclosure at the server→Anthropic cross-border boundary): `pseudonymize` now tokenizes free-text Malaysian IC (`\d{6}-\d{2}-\d{4}`), email, and RM-prefixed financial figures in addition to the existing names + MY/intl phone coverage — before any prompt leaves the server.
- The Wave-0 (Plan 01) PDPA coverage suite turned **RED → GREEN**: the IC / email / two RM-financial `it.fails()` guards were flipped to real passing `it()` assertions. `npx vitest run src/audit/pdpa.test.ts` now reports **11 passed | 1 expected-fail** (was 7 passed | 5 expected-fail); the single remaining `it.fails` is the free-text-name case, correctly deferred to Plan 06's route-level known-name injection.
- The gate's **throw-don't-warn contract is intact**: `assertRedacted` is unchanged (still throws `PdpaViolationError` on `pdpa_redacted !== true`), and the v1 presence-gate semantics are preserved per the plan's explicit guard (the coverage-vs-presence posture is a documented Derek/legal decision, not an executor call).
- Pure `src/` core change — no `app/` or `next` import (core/shell split honored); no new dependency (reused `crypto.createHash('sha256')`); no PII or mapping logging added.

## Task Commits

Each task was committed atomically:

1. **Task 1: Add IC / email / RM-financial redaction to pdpa.ts** — `aad4f40` (fix)

**Plan metadata:** committed separately by the orchestrator (this SUMMARY + STATE/ROADMAP).

_TDD note: the RED tests pre-existed (Plan 01 Wave-0 `it.fails()`), so the cycle here was GREEN (implement) + flip-guards in a single atomic task commit, rather than a separate test→feat split._

## Files Created/Modified
- `src/audit/pdpa.ts` — Added `IC_REGEX`, `EMAIL_REGEX`, `FINANCIAL_REGEX` alongside the phone regexes; added `replaceIC` / `replaceEmail` / `replaceFinancial` helpers (mirror `replacePhones`, sha256 via a new shared `hashValue`, each skipping already-tokenized strings); wired all three into `redactText` (order: names → phones → IC → email → financial, financial last); updated module + `pseudonymize` doc comments. `assertRedacted` untouched.
- `src/audit/pdpa.test.ts` — Flipped the IC, email, and two RM-financial `it.fails()` guards to passing `it()` (the Wave-0 contract is now satisfied); left the free-text-name `it.fails()` RED for Plan 06.

## Decisions Made
- **Preserved presence-gate semantics of `pdpa_redacted`** (hard-coded `true`): the plan's `<action>` explicitly forbids changing this unilaterally — per 04-RESEARCH A5/§Q3, whether the gate should reflect *real coverage* vs *presence* is a Derek/legal compliance decision (Open Question 1). Coverage is delivered by the regexes + Plan-01 tests, which is the prescribed v1 posture.
- **Scope-bounded the guard flips** to the three PII classes this plan owns (IC, email, RM-financial). The `free-text name` test stays RED because its mitigation is route-level known-name injection (Plan 06 reads `leads/{leadId}.name` and passes a non-empty `names[]`), not a core-redactor change.
- **Shared `hashValue()` tokenizer:** rather than hand-roll crypto per class, all five PII classes now use one `createHash('sha256').slice(0,12)` helper; `hashPhone` delegates to it (back-compat, marked `@deprecated`).

## Deviations from Plan

None — plan executed exactly as written. (The plan's `<action>` anticipated the presence-gate question and instructed *not* to change `pdpa_redacted`; that instruction was followed, so it is not a deviation.)

## Issues Encountered
None. The `RM 6,000/month` fixture matches `RM 6,000` (the `/month` suffix is intentionally outside the financial regex), which still satisfies the test's `not.toContain('RM 6,000/month')` assertion because the `RM 6,000` substring is tokenized — verified GREEN.

## User Setup Required
None — no external service configuration required. This is an offline core-module change.

## Threat Flags
None — no new security surface introduced. This plan is the mitigation for the registered threat T-04-PDPA (and supports T-04-PDPA-b: mapping still never logged, audit still hashes-only). The accepted-disposition T-04-PDPA-c (presence-gate kept) is preserved exactly as the threat register specifies.

## Next Phase Readiness
- **Plan 06 (route dispatch) unblocked on the PDPA axis:** the core redactor now covers free-text IC/email/RM-financial. Plan 06 still must close the *complementary* hook — injecting known lead names into the GATE-3 `pseudonymize({messages}, names)` call (today `names:[]`) — to cover the free-text-name class (the remaining RED test in `pdpa.test.ts`).
- **No regressions:** full offline `npm run test` exits 0 (461 passed | 33 expected-fail | 107 skipped | 0 failed); `tsc --noEmit` clean; `eslint` 0 errors (only pre-existing test-file warnings, out of scope).
- **Compliance flag (carried, not blocking):** the v1 PDPA posture (presence-gate + regex coverage, NOT NER) and the FND-09 TIA covering WhatsApp paste content remain a Derek/legal manual sign-off gate per 04-RESEARCH Open Question 1 / A5.

## Self-Check: PASSED

- `src/audit/pdpa.ts` and `src/audit/pdpa.test.ts` verified present and modified on disk.
- Task commit `aad4f40` verified in git log; commit contains no file deletions.
- Acceptance criteria verified by grep: `IC_REGEX`/`EMAIL_REGEX`/`FINANCIAL_REGEX`/`replaceIC`/`replaceEmail`/`replaceFinancial` present; `redactText` calls all three; `assertRedacted` unchanged (`pdpa_redacted !== true`); no `console.*` added.
- `npx vitest run src/audit/pdpa.test.ts` → 11 passed | 1 expected-fail; `npm run test` exits 0; `npm run typecheck` exits 0; `npm run lint` 0 errors.

---
*Phase: 04-reply-assistant*
*Completed: 2026-06-05*
