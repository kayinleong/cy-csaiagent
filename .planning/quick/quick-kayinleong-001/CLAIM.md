# Claim: quick-kayinleong-001

- owner: kayinleong
- session: claude-code
- branch: phase-kayinleong-01
- started: 2026-06-03
- status: in-progress
- summary: Fix coach dashboard "Invalid time value" RangeError — Firestore Timestamps reach the page as non-Date values; normalize at the dashboard query boundary.

## What will change

`src/dashboard/queries.ts` — Firestore Admin SDK returns `Timestamp` objects, but the query result types declare `Date`. The shared `makeConverter` does a raw `snapshot.data() as T` cast (no Timestamp→Date conversion), so `openedAt`/`lastSeenAt`/`lastActiveAt` are `Timestamp` at runtime. `app/[lang]/(coach)/dashboard/page.tsx:164` does `new Date(<Timestamp>).toISOString()` → Invalid Date → `RangeError: Invalid time value`.

Fix: add a `toDate()` normalizer in `queries.ts` (matching the codebase's existing defensive idiom in `src/escalation/detect.ts` and `src/ratelimit/window.ts`) and apply it to `lastActiveAt` (getDownline), `openedAt` (getOpenStalls), and `lastSeenAt` (getKnowledgeGaps) so the returned objects genuinely match their declared `Date` types.

Scope rationale: NOT fixing the shared 15-collection converter, because `src/jobs/heartbeat.ts` (`.toDate()`) and `src/jobs/runDueJobs.ts` (`.toMillis()`) depend on receiving Firestore `Timestamp` objects — a global converter change would break them. Boundary normalization is the minimal, regression-safe root-cause fix.

## What has changed

- [pending]

## Verification

- [pending]
