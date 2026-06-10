# Phase 6 — Deferred / Out-of-Scope Items (logged during execution)

Items discovered during plan execution that are OUT OF SCOPE for the executing
plan. Logged, not fixed (per executor SCOPE BOUNDARY rule).

## During 06-02 (Wave 1 — read-only role + requireRole helper)

These three Wave-0 RED test stubs (created in commit `02d3438`, the 06-01 scaffold)
remain RED. **Verified pre-existing**: they failed identically at commit `8c3aed5`
(before any 06-02 change) — 17 failures, same files. They test features owned by
LATER 06-xx plans, not 06-02:

| RED stub | Failing because | Owning requirement / plan |
|----------|-----------------|---------------------------|
| `app/[lang]/_components/app-sidebar-nav.test.ts` | 6-section `SECTIONS` nav structure not built yet | IA-01 (later wave) |
| `app/[lang]/(coach)/dashboard/per-coach-pivot.test.ts` | `resolvePivotScope` not implemented yet | AP-01 (later wave) |
| `app/[lang]/(admin)/integrations/integrations-shell.test.ts` | Integrations shell page not built yet | SC-01 (later wave) |

Action: none in 06-02. These turn GREEN in their owning plans. 06-02 only made the
role-union + requireRole RED stubs GREEN (per its objective).

## During 06-03 (Wave 2 — read-only Firestore rules / RO-03)

Same three Wave-0 RED scaffolds remain RED (still owned by IA-01 / AP-01 / SC-01 —
later 06-xx plans). **Verified unchanged by 06-03:** 06-03 modified only
`firestore.rules` + `src/firebase/__tests__/rules.test.ts` (the seed-harness fix);
none of the three scaffold files are in the 06-03 diff. They turn GREEN in their
owning plans. 06-03 only turned the read-only **rules** matrix GREEN (per its objective).

Note (not deferred — fixed in 06-03 as a Rule-3 blocker): the `seed()` helper in
`rules.test.ts` was returning an invalidated `RulesTestContext` under
`@firebase/rules-unit-testing@5.0.1` (it called `.firestore()` outside the
`withSecurityRulesDisabled` callback), which made EVERY seeded rules suite throw
in `beforeAll`. Fixed in 06-03 so the rules suite can actually execute on the
emulator. This unblocked all 19 collection suites, not just read-only.
