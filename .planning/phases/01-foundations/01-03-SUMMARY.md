---
phase: 01-foundations
plan: "03"
subsystem: firebase
tags: [firebase-admin, firebase-client, firestore-rules, typed-converters, security-rules, rate-budgets, deny-by-default, rules-unit-testing]

# Dependency graph
requires:
  - "01-02 (test infra, vitest @/* alias, synthetic fixtures)"
provides:
  - "src/firebase/admin.ts — adminDb/adminAuth/remoteConfig() exports for every server-side src/ module"
  - "src/firebase/client.ts — clientAuth/clientDb for browser/Client Component use"
  - "src/firebase/collections.ts — 15 typed collection refs (TSD's 14 + rateBudgets), toFirestore stamps tenantId:'d2' on every write"
  - "firestore.rules — deny-by-default for all 15 collections; auditLogs immutable; rateBudgets owner-scoped"
  - "firestore.indexes.json — composite + vector indexes (kbChunks/projects 1024-d flat)"
  - "src/firebase/__tests__/rules.test.ts — 55+ assertions across 15 collections x 3 roles (authored; requires Java+Firebase emulator)"
affects:
  - "01-05 (audit): imports auditLogsRef from collections.ts, writes via adminDb"
  - "01-07 (ratelimit): imports rateBudgetsRef from collections.ts — rateBudgets is declared/ruled here as single source of truth"
  - "01-08 (SPIKE-AI-SDK): imports remoteConfig() from admin.ts for model ID resolution"
  - "01-09 (kb): imports kbDocsRef, kbChunksRef, kbIngestionJobsRef"
  - "01-10 (jobs): imports escalationsRef, adminDb for heartbeat writes"
  - "01-11 (chat): imports conversationsRef, messagesRef, leadContextRef"
  - "All subsequent src/ modules that need Firestore access"

# Tech tracking
tech-stack:
  added:
    - "firebase@12.14.0 — Firebase web SDK (client Auth, client Firestore)"
    - "firebase-admin@13.10.0 — Admin SDK (server-side Auth, Firestore, Remote Config)"
  patterns:
    - "Admin SDK init: lazy getApps().length guard, ADC credential resolution (FIREBASE_SERVICE_ACCOUNT_KEY → GOOGLE_APPLICATION_CREDENTIALS → metadata server)"
    - "Typed Firestore converters: makeConverter<T>() factory — toFirestore stamps tenantId:TENANT_ID unconditionally"
    - "Admin SDK collection refs: adminDb.collection('name').withConverter(converter) — instance method pattern, NOT standalone collection()"
    - "Subcollection ref: adminDb.collection('conversations').doc(cid).collection('messages') — chained instance methods"
    - "Deny-by-default Firestore rules: isSignedIn()/isSelf()/hasRole()/sameTenant() helpers; no blanket auth!=null"
    - "auditLogs immutability: allow create/update/delete: if false — Admin SDK writes bypass rules"
    - "rateBudgets owner-scope: isSelf(uid) && sameTenant() — cross-agent read/write denied at rules level"

key-files:
  created:
    - "src/firebase/admin.ts — lazy Admin SDK init, exports adminDb/adminAuth/remoteConfig()"
    - "src/firebase/client.ts — web SDK init from NEXT_PUBLIC_* env vars, exports clientAuth/clientDb"
    - "src/firebase/collections.ts — TENANT_ID='d2', 15 typed FirestoreDataConverter refs, all ref factories exported"
    - "src/firebase/collections.test.ts — 26 tests (offline/mocked): toFirestore stamps, subcollection path, all 15 factories callable"
    - "firestore.rules — deny-by-default security rules for all 15 collections"
    - "firestore.indexes.json — composite + vector indexes (kbChunks/projects 1024-d)"
    - "src/firebase/__tests__/rules-helpers.ts — @firebase/rules-unit-testing bootstrap, 3-role context factories"
    - "src/firebase/__tests__/rules.test.ts — 55+ denial assertions across all 15 collections x 3 roles"
  modified:
    - "package.json — added firebase@12.14.0 + firebase-admin@13.10.0"

key-decisions:
  - "Admin SDK uses instance method adminDb.collection() (not a standalone collection() function like web SDK) — discovered via TypeScript check"
  - "fromFirestore in Admin SDK takes only QueryDocumentSnapshot (no SnapshotOptions — that is a web SDK type); makeConverter updated accordingly"
  - "Rules tests authored-but-not-run: Java not installed in dev environment; tests are correctly authored per plan spec and will run in CI via 'firebase emulators:exec'"
  - "firestore.rules contains no 'if request.auth != null' in any position (grep returns 0); isSignedIn() helper uses 'return request.auth != null' which does not match the grep pattern"
  - "rateBudgets declared in collections.ts as the single source of truth so 01-07 (ratelimit) builds against a real, already-ruled collection — not a new unruled one"

# Metrics
duration: 14min
completed: "2026-05-31"
---

# Phase 01 Plan 03: Firebase Foundation + Deny-By-Default Security Rules Summary

**Firebase Admin/client SDK init + typed collection refs (all 15 collections with tenantId:'d2' stamped on every write) + deny-by-default Firestore rules (auditLogs immutable, rateBudgets owner-scoped) + rules-unit-testing coverage for all 3 roles x every collection**

## Performance

- **Duration:** 14 min
- **Started:** 2026-05-31T10:38:28Z
- **Completed:** 2026-05-31T10:52:38Z
- **Tasks:** 2 (Task 1: Admin/client init + collections; Task 2: rules + rules-unit-testing)
- **Files created:** 8 files, 2 modified

## Accomplishments

- Firebase Admin SDK initialized with lazy ADC credential resolution (FIREBASE_SERVICE_ACCOUNT_KEY → GOOGLE_APPLICATION_CREDENTIALS → GCP metadata server); exports `adminDb`, `adminAuth`, `remoteConfig()` consumed by every downstream src/ module.
- Firebase web SDK initialized from NEXT_PUBLIC_* env vars; exports `clientAuth`, `clientDb` for browser/Client Components.
- Single source of truth: `collections.ts` declares all 15 Firestore collections (TSD's 14 + rateBudgets) with typed `FirestoreDataConverter`; `toFirestore` stamps `tenantId:'d2'` unconditionally on every write.
- `messagesRef(cid)` correctly chains `adminDb.collection('conversations').doc(cid).collection('messages')` — subcollection, not an inline array (1 MB doc-size trap avoided).
- `rateBudgetsRef()` declared in `collections.ts` as single source of truth — 01-07 ratelimit will import from here, ensuring it builds against a real, already-ruled collection.
- `firestore.indexes.json` declares composite and vector indexes including kbChunks/projects 1024-d flat vector indexes.
- `firestore.rules` deny-by-default: `grep -c "if request.auth != null" firestore.rules` == 0; auditLogs has `allow create: if false; allow update, delete: if false`; rateBudgets has `isSelf(uid) && sameTenant()` owner-scoped rule.
- 26 unit tests pass offline (mocked `adminDb`): toFirestore stamps, subcollection path structure, all 15 factories callable, rateBudgets source-of-truth.
- Rules test files authored: 55+ assertions covering all 15 collections x 3 roles, deny-by-default, cross-owner denial, non-downline coach denial, cross-tenant admin denial, auditLogs immutability, rateBudgets cross-agent isolation.

## Task Commits

Each task was committed atomically:

1. **Task 1 — Firebase Admin/client init + typed collection refs** - `bef1057`
2. **Task 2 — deny-by-default rules + rules-unit-testing** - `1f56661`

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Admin SDK uses instance method, not standalone collection() function**
- **Found during:** Task 1, TypeScript check
- **Issue:** Initial `collections.ts` imported `collection` as a standalone function from `firebase-admin/firestore` (mirroring the web SDK pattern). The Admin SDK does NOT export a standalone `collection()` — it's an instance method on the `Firestore` class: `adminDb.collection('name')`. TypeScript reported `Module '"firebase-admin/firestore"' has no exported member 'collection'`.
- **Fix:** Rewrote all ref factories to use `adminDb.collection(...)` instance methods. Subcollection refs chain `.doc(cid).collection('messages')` instead of the web SDK's `collection(db, 'conversations', cid, 'messages')`.
- **Files modified:** `src/firebase/collections.ts`, `src/firebase/collections.test.ts` (mock updated)
- **Verification:** `npx tsc --noEmit` clean for new files; 26 unit tests pass.
- **Committed in:** `bef1057`

**2. [Rule 1 - Bug] Admin SDK fromFirestore takes no SnapshotOptions parameter**
- **Found during:** Task 1, TypeScript check
- **Issue:** `makeConverter` initially used `fromFirestore(snapshot, options?: SnapshotOptions)` — `SnapshotOptions` is a web SDK concept not present in `firebase-admin/firestore`. The Admin SDK's `FirestoreDataConverter.fromFirestore` signature is `fromFirestore(snapshot: QueryDocumentSnapshot): T`.
- **Fix:** Removed `SnapshotOptions` import and parameter from `makeConverter`; updated `fromFirestore` to use `snapshot.data()` (no options arg).
- **Files modified:** `src/firebase/collections.ts`
- **Verification:** `npx tsc --noEmit` clean.
- **Committed in:** `bef1057`

**3. [Rule 1 - Bug] Comment in firestore.rules contained 'if request.auth != null' literal string**
- **Found during:** Task 2, acceptance criteria grep check
- **Issue:** Two comments in `firestore.rules` mentioned the forbidden pattern by name (to explain what was being avoided). The plan's acceptance criteria grep-checks for zero occurrences of `if request.auth != null` anywhere in the file, including comments.
- **Fix:** Rewrote the two comment lines to not include the literal pattern string.
- **Files modified:** `firestore.rules`
- **Verification:** `grep -c "if request.auth != null" firestore.rules` == 0.
- **Committed in:** `1f56661`

**4. [Rule 3 - Blocking] vi.mock() factory referenced outer variable — hoisting error**
- **Found during:** Task 1, first vitest run
- **Issue:** The test's `vi.mock('firebase-admin/firestore', ...)` factory referenced `mockCollection` which was declared as a `const` at module scope. Vitest hoists `vi.mock()` calls above variable declarations, causing `ReferenceError: Cannot access 'mockCollection' before initialization`.
- **Fix:** Wrapped all mock factory variables in `vi.hoisted()` which is hoisted along with `vi.mock()` and available at the correct time.
- **Files modified:** `src/firebase/collections.test.ts`
- **Verification:** `npx vitest run src/firebase/collections.test.ts` exits 0, 26 tests pass.
- **Committed in:** `bef1057`

**Total deviations:** 4 auto-fixed (3 Rule 1 bugs, 1 Rule 3 blocking). All necessary for correctness.

## Rules Tests — Emulator Status

**Authored-but-not-run.** The rules test files (`src/firebase/__tests__/rules.test.ts` + `rules-helpers.ts`) are fully authored, TypeScript-clean, and correctly structured for `@firebase/rules-unit-testing`. They require:

1. **Java runtime** — the Firebase Firestore emulator is a Java process. `java -version` fails in this dev environment with "Unable to locate a Java Runtime."
2. **Run command:** `firebase emulators:exec --project demo-cy-csaiagent --only firestore "npm run test:rules"`

The `npm run test:rules` script (`vitest run src/firebase/__tests__/rules`) is correctly configured and will execute the 55+ assertions when Java is available (CI, a developer machine with JDK, or any environment where `firebase emulators:start` succeeds).

**CI note:** Add `setup-java@v3` (e.g., Temurin distribution) to `.github/workflows/ci.yml` before the `test:rules` step to enable emulator-based rules tests in CI.

## Known Stubs

None. All implementations are complete and functional:
- Admin/client SDK init: correct credential resolution, no hardcoded values
- All 15 collection ref factories: correctly implemented with typed converters
- `firestore.rules`: complete deny-by-default coverage for all 15 collections
- Rules tests: fully authored (not stubs), blocked only by Java runtime availability

## Threat Flags

No new security surfaces beyond those in the plan's threat model. The plan's entire threat register was implemented:

| Threat ID | Status |
|-----------|--------|
| T-01-06 | Mitigated: deny-by-default + sameTenant() + role checks; grep gate: 0 blanket auth==null |
| T-01-07 | Mitigated: auditLogs allow create/update/delete: if false; rules test asserts denial |
| T-01-08 | Mitigated: admin.ts server-only, ADC credentials, no app/ imports (grep-verified) |
| T-01-09 | Mitigated: rateBudgets declared+ruled in collections.ts before any consumer; rules test enumerates all 15 |
| T-01-10 | Mitigated: rateBudgets isSelf(uid)+sameTenant() only; cross-agent denial asserted in rules test |

---
*Phase: 01-foundations*
*Completed: 2026-05-31*

## Self-Check: PASSED

All claimed artifacts verified:

- [x] `src/firebase/admin.ts` — exists, exports adminDb/adminAuth/remoteConfig()
- [x] `src/firebase/client.ts` — exists, exports clientAuth/clientDb
- [x] `src/firebase/collections.ts` — exists, 379 lines, all 15 ref factories, tenantId stamp
- [x] `src/firebase/collections.test.ts` — exists, 26 tests pass (offline/mocked)
- [x] `firestore.rules` — exists, grep-c "if request.auth != null" == 0
- [x] `firestore.indexes.json` — exists, "dimension": "1024" present
- [x] `src/firebase/__tests__/rules-helpers.ts` — exists, TypeScript clean
- [x] `src/firebase/__tests__/rules.test.ts` — exists, 702 lines, 55+ assertions, TypeScript clean

All commits verified:
- [x] `bef1057` — feat(phase-kayinleong-01): 01-03 — Firebase Admin/client init + typed collection refs
- [x] `1f56661` — feat(phase-kayinleong-01): 01-03 — deny-by-default firestore.rules + rules-unit-testing

**TypeScript:** `npx tsc --noEmit` — only pre-existing `components/ui/calendar.tsx` error (out of scope, documented in 01-02). Zero errors in new `src/firebase/*.ts` files.

**Rules tests:** Authored-but-not-run — Java runtime not available in dev environment. See "Rules Tests — Emulator Status" section above.
