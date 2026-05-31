---
phase: 01-foundations
plan: "05"
subsystem: audit
tags: [pdpa, pseudonymization, audit-log, compliance, crypto, hashes-only, assertRedacted, tia, tdd]

# Dependency graph
requires:
  - "01-03 (firebase): auditLogsRef() from collections.ts (create-only write path)"
  - "01-02 (test-infra): vitest @/* alias, synthetic-users.ts fixture"
provides:
  - "src/audit/pdpa.ts — pseudonymize() (names→<LEAD_ID:n>, phones→<PHONE_HASH:hex>) + assertRedacted() gate (throws PdpaViolationError) + PdpaViolationError class"
  - "src/audit/log.ts — log() append-only audit writer (sha256 hashes every raw value, never stores PII, after()-safe)"
  - "src/audit/index.ts — barrel export: pseudonymize, assertRedacted, PdpaViolationError, log, types"
  - ".planning/phases/01-foundations/PDPA-TIA.md — Transfer Impact Assessment artifact (team-drafted, Derek sign-off PENDING)"
affects:
  - "01-11 (chat route): calls pseudonymize() + assertRedacted() before streamText(); calls log() inside after()"
  - "01-12 (e2e smoke): QUAL-05 asserts an audit row is written per turn"

# Tech tracking
tech-stack:
  added:
    - "Node crypto (built-in) — sha256 via createHash('sha256') for phone hashing (pdpa.ts) and value hashing (log.ts); never hand-rolled"
  patterns:
    - "Pseudonymization: regex replace names→<LEAD_ID:n> (sequential), phones→<PHONE_HASH:hex12> (sha256 prefix); server-side mapping kept for client reconstitution"
    - "PDPA gate: assertRedacted() uses TypeScript asserts clause — throws PdpaViolationError when pdpa_redacted!==true; called immediately before streamText()"
    - "Audit writer: hashAll() maps Record<string,unknown> → Record<string,string> via sha256; auditLogsRef().add() wrapped in try/catch — errors swallowed for after()-safety"
    - "TDD: RED commit (test-only) → GREEN commit (implementation); 4+3=7 tests, all offline"

key-files:
  created:
    - "src/audit/pdpa.ts — 209 lines; exports pseudonymize, assertRedacted, PdpaViolationError, PseudonymizeInput, PseudonymizeResult"
    - "src/audit/pdpa.test.ts — 132 lines; 4 behaviors tested (name/phone replacement, pdpa_redacted:true+mapping, gate throws, multi-PII+no-PII edge cases)"
    - "src/audit/log.ts — ~95 lines; exports log, AuditEntry; sha256-hashes every raw value; never rethrows"
    - "src/audit/log.test.ts — 139 lines; 3 behaviors tested (hashes-only, required fields, fire-and-forget safety)"
    - "src/audit/index.ts — 20 lines; barrel re-export for all 4 public symbols + types"
    - ".planning/phases/01-foundations/PDPA-TIA.md — Transfer Impact Assessment; data categories, risk register (T-01-14–T-01-17), Bedrock-SG fallback documented, Derek sign-off line PENDING"

key-decisions:
  - "pseudonymize() signature takes explicit names[] parameter — callers pass known lead names from the lead record; regex covers all MY phone forms (+60 8–10 digit), plus generic international fallback"
  - "Phone tokens include a 12-char hex prefix of the sha256 hash (<PHONE_HASH:abc123456789>) — uniquely identifies the phone without being reversible from the token alone"
  - "assertRedacted uses TypeScript asserts clause for type narrowing — downstream code sees pdpa_redacted:true in the type after the call"
  - "log() swallows errors silently — no PII-bearing error strings are logged; monitoring of auditLogs write failure rates is handled by Cloud Logging alert (not in-band)"
  - "auditRow.ts field is epoch ms (Date.now()) rather than FieldValue.serverTimestamp() — allows offline unit testing without a Firestore emulator"
  - "TIA gates the PILOT (real PII); pseudonymize gate gates the BUILD (Phase 1 runs on synthetic data only)"

# Metrics
duration: 5min
completed: "2026-05-31"
---

# Phase 01 Plan 05: PDPA Boundary Pseudonymization + Audit Writer Summary

**PDPA compliance spine: boundary pseudonymization (names→<LEAD_ID:n>, phones→<PHONE_HASH:hex>) + the pdpa_redacted:true gate that throws before any model call + append-only sha256-hashes-only audit writer (after()-safe) + Transfer Impact Assessment on file**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-05-31T11:17:35Z
- **Completed:** 2026-05-31T11:22:16Z
- **Tasks:** 2 (Task 1: PDPA pseudonymize + gate; Task 2: audit log writer + TIA artifact)
- **Files created:** 6 files

## Accomplishments

- `pseudonymize(input, names)` replaces all detected Malaysian phone numbers (`+60` 8–10 digit forms) with `<PHONE_HASH:hex12>` tokens and all known lead names with `<LEAD_ID:n>` tokens via `createHash('sha256')` from Node crypto. Returns `{ redacted, pdpa_redacted: true, mapping }`.
- `assertRedacted({ pdpa_redacted })` — TypeScript asserts clause; throws `PdpaViolationError` when `pdpa_redacted !== true`. Does NOT warn. The chat route must call this immediately before `streamText()`.
- `log({ actorUid, action, raw })` — hashes every value in `raw` with sha256 into a `hashes` record; writes via `auditLogsRef()` (which stamps `tenantId:'d2'` via the typed converter); wraps the write in try/catch so failures never propagate into the caller (after()-safe).
- `src/audit/index.ts` barrel re-exports all four public symbols + types — callers `import { pseudonymize, assertRedacted, PdpaViolationError, log } from '@/src/audit'`.
- `PDPA-TIA.md` filed: data categories (pseudonymized only), cross-border path (Anthropic US, ~30-day retention), v1 mitigation (boundary pseudonymization + gate + hashes-only audit), Bedrock-Singapore documented fallback, Derek sign-off line `[ ] PENDING`.
- All 7 unit tests pass offline (no Firebase dependency): 4 in `pdpa.test.ts`, 3 in `log.test.ts`.
- TypeScript clean — zero errors in `src/audit/` (`npx tsc --noEmit --skipLibCheck`).

## Task Commits

TDD gates satisfied for both tasks:

1. **Task 1 RED — failing tests for PDPA gate** - `e5775d4`
2. **Task 1 GREEN — PDPA pseudonymize + assertRedacted implementation** - `0031bef`
3. **Task 2 RED — failing tests for audit log writer** - `1638f63`
4. **Task 2 GREEN — audit log.ts + index.ts + PDPA-TIA.md** - `0b591e4`

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] TypeScript type mismatch on auditLogsRef().add() cast**

- **Found during:** Task 2 GREEN, TypeScript check
- **Issue:** The initial cast `auditRow as Parameters<ReturnType<typeof auditLogsRef>['add']>[0]` failed with TS2352 — the intermediate type does not overlap with `WithFieldValue<AuditLogDoc>` sufficiently for TypeScript's overlap check.
- **Fix:** Changed the cast to `auditRow as any` (with eslint-disable comment) — the runtime type is correct (the converter's `toFirestore` stamps `tenantId`); the cast is a TypeScript-only boundary required because the typed converter merges the tenant field at write time, not at call-site type level.
- **Files modified:** `src/audit/log.ts` (line 89)
- **Commit:** `0b591e4`

**Total deviations:** 1 auto-fixed (Rule 1 — TypeScript type error). No architectural changes required.

## TDD Gate Compliance

Both tasks followed the RED → GREEN sequence:

- Task 1: `e5775d4` (test — RED: 4 failing tests) → `0031bef` (feat — GREEN: 4 passing tests)
- Task 2: `1638f63` (test — RED: 3 failing tests) → `0b591e4` (feat — GREEN: 3 passing tests)

No REFACTOR phase needed — implementations were clean on first pass.

## Known Stubs

None. All four artifacts are fully implemented:
- `pseudonymize` — real regex + crypto hashing; not a pass-through stub
- `assertRedacted` — real throw on violation; not a console.warn stub
- `log` — real sha256 hash of every raw value; not a no-op stub
- `PDPA-TIA.md` — real risk assessment; Derek sign-off line is intentionally PENDING (team cannot fabricate Derek's approval)

## Threat Flags

No new security surfaces beyond those in the plan's threat model. All four threat mitigations implemented:

| Threat ID | Status |
|-----------|--------|
| T-01-14 | Mitigated: pseudonymize replaces names/phones; assertRedacted throws; test proves no `\+?60\d{9,10}` survives; TIA on file |
| T-01-15 | Mitigated: log.ts hashes every raw value; test asserts no raw value in written row; create-only rule (01-03) keeps it immutable |
| T-01-16 | Accepted: audit stores pseudonyms/hashes only; erasure pipeline scoped to Phase 5 |
| T-01-17 | Mitigated (partial): log() called via after() in 01-11 on every turn (seam defined here; wired in 01-11) |

---

*Phase: 01-foundations*
*Completed: 2026-05-31*

## Self-Check: PASSED

**Files exist:**

- [x] `src/audit/pdpa.ts` — exists, 209 lines, exports pseudonymize + assertRedacted + PdpaViolationError
- [x] `src/audit/pdpa.test.ts` — exists, 4/4 tests pass
- [x] `src/audit/log.ts` — exists, exports log, sha256 hashes, after()-safe
- [x] `src/audit/log.test.ts` — exists, 3/3 tests pass
- [x] `src/audit/index.ts` — exists, barrel re-export of all 4 public symbols
- [x] `.planning/phases/01-foundations/PDPA-TIA.md` — exists, contains "Transfer Impact Assessment", Derek sign-off line PENDING, no real phone (grep verified)

**Acceptance criteria:**

- [x] `pseudonymize` and `assertRedacted` exported from `src/audit/pdpa.ts` (grep-verified)
- [x] `assertRedacted` THROWS PdpaViolationError (test Behavior 3 asserts the throw) — does NOT merely log/warn
- [x] `pseudonymize` uses Node `crypto` (`grep -n "crypto" src/audit/pdpa.ts` → line 25: `import { createHash } from 'crypto'`)
- [x] Test asserts redacted output contains no `\+?60\d{9,10}` substring and no original name
- [x] `npx vitest run src/audit/pdpa.test.ts src/audit/log.test.ts` exits 0 — 7 behaviors green
- [x] `log` uses Node `crypto` sha256 (`grep -n "crypto" src/audit/log.ts` → line 22)
- [x] Test asserts written row serialized form contains no raw input value (only hashes)
- [x] `log` does not rethrow on write failure (Behavior 3 test asserts resolves.toBeUndefined())
- [x] `PDPA-TIA.md` contains "Transfer Impact Assessment" (count: 2 occurrences)
- [x] `PDPA-TIA.md` contains "Derek sign-off" line (verified by grep)
- [x] No real phone in `PDPA-TIA.md` (`grep -rIE "\+?60[0-9]{9}" PDPA-TIA.md` → 0 matches)
- [x] TypeScript: `npx tsc --noEmit --skipLibCheck` — zero errors in `src/audit/`

**Commits:**

- [x] `e5775d4` — test(phase-kayinleong-01): 01-05 — RED failing tests for PDPA gate
- [x] `0031bef` — feat(phase-kayinleong-01): 01-05 — PDPA boundary pseudonymization + assertRedacted gate
- [x] `1638f63` — test(phase-kayinleong-01): 01-05 — RED failing tests for audit log writer
- [x] `0b591e4` — feat(phase-kayinleong-01): 01-05 — append-only audit writer + PDPA-TIA artifact
