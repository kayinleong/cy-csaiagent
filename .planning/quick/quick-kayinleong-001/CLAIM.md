# Claim: quick-kayinleong-001

- owner: kayinleong
- session: claude-code
- branch: phase-kayinleong-01
- started: 2026-06-03
- status: done
- summary: Fix coach dashboard "Invalid time value" RangeError — Firestore Timestamps reach the page as non-Date values; normalize at the dashboard query boundary.

## What will change

`src/dashboard/queries.ts` — Firestore Admin SDK returns `Timestamp` objects, but the query result types declare `Date`. The shared `makeConverter` does a raw `snapshot.data() as T` cast (no Timestamp→Date conversion), so `openedAt`/`lastSeenAt`/`lastActiveAt` are `Timestamp` at runtime. `app/[lang]/(coach)/dashboard/page.tsx:164` does `new Date(<Timestamp>).toISOString()` → Invalid Date → `RangeError: Invalid time value`.

Fix: add a `toDate()` normalizer in `queries.ts` (matching the codebase's existing defensive idiom in `src/escalation/detect.ts` and `src/ratelimit/window.ts`) and apply it to `lastActiveAt` (getDownline), `openedAt` (getOpenStalls), and `lastSeenAt` (getKnowledgeGaps) so the returned objects genuinely match their declared `Date` types.

Scope rationale: NOT fixing the shared 15-collection converter, because `src/jobs/heartbeat.ts` (`.toDate()`) and `src/jobs/runDueJobs.ts` (`.toMillis()`) depend on receiving Firestore `Timestamp` objects — a global converter change would break them. Boundary normalization is the minimal, regression-safe root-cause fix.

## What has changed

- `src/dashboard/queries.ts` — added a `toDate(value)` normalizer (`instanceof Date` → as-is; `{toDate()}` Timestamp → `.toDate()`; else `new Date(value)`) and applied it when mapping `doc.data()`: `lastActiveAt` in `getDownline`, `openedAt` in `getOpenStalls`, `lastSeenAt` in `getKnowledgeGaps`. The three query helpers now genuinely return the `Date`-typed shapes they declare.
- `src/dashboard/dashboard.test.ts` — added 3 regression tests under "Firestore Timestamp normalization": each feeds a Timestamp-shaped value (`{toDate, seconds, nanoseconds}`) and asserts the mapped field `instanceof Date`, that `.toISOString()` doesn't throw, and that `daysInJourney(.getTime())` works on the normalized `lastActiveAt`. (The pre-existing tests all used `new Date(...)`, which masked the real Admin SDK Timestamp shape — same masking pattern as the prior embed.ts bug.)
- No change to the shared `makeConverter` / per-collection converters.

## Verification

**Root cause:** Firestore Admin SDK returns `Timestamp` objects; the shared converter casts raw (`snapshot.data() as T`), so `Date`-typed fields are `Timestamp` at runtime. `page.tsx:164` did `new Date(<Timestamp>).toISOString()` → Invalid Date → `RangeError: Invalid time value`. (Crash surfaced on `openedAt` because the downline was empty so `daysInJourney`'s latent `.getTime()` crash wasn't reached first.)

**Tested:**
- `npx vitest run src/dashboard` → 24/24 pass (incl. 3 new regression tests). The new tests fail without the fix (assert `instanceof Date` on a Timestamp-shaped input).
- `npx tsc --noEmit` → exit 0 (clean).
- `npx vitest run` (full suite) → 455 passed / 97 skipped / 0 failed (was 452; +3 new).

**Regression surface — ruled out:**
- Blast radius fully contained: `getDownline`/`getOpenStalls`/`getKnowledgeGaps` have exactly ONE caller — `app/[lang]/(coach)/dashboard/page.tsx` (grep-confirmed). The page's `instanceof Date` branches now take the true path; `metrics.daysInJourney`/`checkpointVelocity`/`trainingFunnel` are unaffected (velocity/funnel don't read timestamps).
- Deliberately did NOT touch the shared `makeConverter`: `src/jobs/heartbeat.ts` (`.toDate()`) and `src/jobs/runDueJobs.ts` (`.toMillis()`) depend on receiving raw `Timestamp` objects; a global converter change would break them. `src/ratelimit/window.ts` and `src/inventory/search.ts` already defensively handle both shapes — unchanged.
- No PII logged; no secrets touched; change is read-path-only normalization.

**Fix confirmed correct; ready for human UI re-check of /dashboard.** (Live dashboard render against real Firebase data not exercised by me — requires a deployed/seeded stack + a senior-coach/admin session; the unit-level Timestamp shape is now covered by tests.)
