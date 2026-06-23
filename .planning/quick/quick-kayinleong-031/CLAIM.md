# Claim: quick-kayinleong-031

- owner: kayinleong
- session: claude-code
- branch: main
- started: 2026-06-23
- status: done
- summary: Fix the RSC→Client serialization crash on `/[lang]/dashboard`. The senior-coach dashboard passes each open stall's `contextBundle` straight into the `StallInbox` client component, but `getOpenStalls` normalizes only `openedAt` — leaving `contextBundle.lastActiveAt` (written by the stall-detect/escalate jobs) as a raw Firestore `Timestamp`, throwing "Only plain objects, and a few built-ins, can be passed to Client Components" with the caret on `{lastActiveAt: {_seconds, _nanoseconds}}`. Normalize Timestamp values inside `contextBundle` to plain `Date` at the `getOpenStalls` query boundary, symmetric with the existing `openedAt: toDate(...)`. Same root-cause class as quick-kayinleong-029 (KB list) / quick-kayinleong-030 (inventory).

## What will change

- `src/dashboard/queries.ts` — in `getOpenStalls`, normalize the Firestore `Timestamp`
  values nested inside each escalation's `contextBundle` to plain `Date`, alongside the
  existing `openedAt: toDate(data.openedAt)`. A small `serializeContextBundle` helper walks
  the bundle's top-level values: any value carrying a `.toDate()` method (a Firestore
  `Timestamp`) is converted via the existing `toDate` helper; every other value
  (strings/numbers/booleans like `topic`, `lang`, `conversationId`) is preserved verbatim.
  `Date` is a supported RSC-serializable built-in, so this makes the whole `contextBundle`
  cross the RSC→Client boundary cleanly. The `StallEscalation.data.contextBundle` type stays
  `Record<string, unknown>` (no rendering/type change downstream).

- `src/dashboard/dashboard.test.ts` — add a regression test under the existing
  "Firestore Timestamp normalization" describe block, mirroring the
  `getOpenStalls.openedAt` test: assert a stall whose `contextBundle.lastActiveAt` is a fake
  Timestamp comes back as a real `Date` with a valid `toISOString()` (and that a non-date
  field in the bundle is left untouched).

Scope: the single broken read path. The fix lives at the query boundary (the same place
`openedAt`/`lastSeenAt`/`lastActiveAt` are already normalized) so ALL consumers of
`getOpenStalls` get a serializable bundle, not just the dashboard page. No change to the
write side (`src/jobs/runDueJobs.ts` / `src/escalation/handoff.ts`), to `page.tsx`, or to
the `StallInbox` client component (which does not even read `contextBundle`'s contents).

## What has changed

**Root cause.** `app/[lang]/(coach)/dashboard/page.tsx` (an RSC) fetches open stalls via
`getOpenStalls` and passes each stall's `contextBundle` **directly** into the `StallInbox`
*client* component (`page.tsx:208` → `contextBundle: s.data.contextBundle`). The
`stall-detect` and `escalate` lazy-cron jobs persist `contextBundle: { lastActiveAt }` into
the escalation doc (`src/jobs/runDueJobs.ts:113,188`). On read, `getOpenStalls`
(`src/dashboard/queries.ts`) normalized **only** `openedAt` via `toDate` — `contextBundle`
flowed through the `...data` spread with its `lastActiveAt` still a raw Firestore `Timestamp`
(a class instance with `_seconds`/`_nanoseconds`). React cannot serialize a class instance
across the RSC→Client boundary → repeated `GET /en/dashboard` errors:
`Error: Only plain objects, and a few built-ins, can be passed to Client Components`, caret on
`{lastActiveAt: {_seconds, _nanoseconds}}`. Identical root-cause class to quick-kayinleong-029
(KB list `publishedAt`) and quick-kayinleong-030 (inventory `vpDate`), different surface.

**`src/dashboard/queries.ts`** — added a `serializeContextBundle(bundle)` helper next to the
existing `toDate`. It walks the bundle's top-level entries: any value carrying a `.toDate()`
method (a Firestore `Timestamp`) is converted to a plain `Date` via that method; every other
value (strings/numbers/booleans — e.g. `topic`, `lang`, `conversationId` for `kb_miss`
bundles) is preserved verbatim. Returns `{}` for an absent bundle. In `getOpenStalls`, the
mapped doc now sets `contextBundle: serializeContextBundle(data.contextBundle)` alongside the
existing `openedAt: toDate(data.openedAt)`. `Date` is a supported RSC-serializable built-in
(the deliberate choice — same as quick-029/030 — over epoch millis), so the whole bundle now
crosses the boundary cleanly. The `StallEscalation.data.contextBundle` type stays
`Record<string, unknown>`; no downstream type or rendering change.

**`src/dashboard/dashboard.test.ts`** — added a regression test under the existing
"Firestore Timestamp normalization" describe block, mirroring the `getOpenStalls.openedAt`
test: a stall whose `contextBundle.lastActiveAt` is a fake Timestamp comes back as a real
`Date` with a valid `toISOString()`, and a sibling non-date field (`conversationId`) survives
untouched.

**Commit (on `main`):** `2bf2544` fix(quick-kayinleong-031): serialize contextBundle.lastActiveAt
before RSC→Client boundary.

## Verification

**Automated gates:**
- `npx tsc --noEmit` → **0 errors** (exit 0). The serialized bundle stays `Record<string,
  unknown>`; `Date` is assignable and serializable.
- `npx vitest run src/dashboard src/escalation src/jobs` → **62 passed (4 files)**, including
  the new `getOpenStalls.contextBundle.lastActiveAt` regression test. Run in isolation,
  `src/dashboard/dashboard.test.ts` → **25 passed**.
- `npx eslint src/dashboard/queries.ts src/dashboard/dashboard.test.ts` → **0 errors,
  1 warning**. The single warning (`'fakeAgentsB' is assigned a value but never used`,
  dashboard.test.ts:89) is **pre-existing** — `git diff` confirms my change does not touch
  that fixture (my edits are the new helper ~line 51 and the new test ~line 299).

**Why this fixes it (definitive):** `contextBundle.lastActiveAt` was the single
non-serializable value React flagged on the dashboard payload (the caret named it). The other
serialized props on this page were already handled — `openedAt`/`lastSeenAt` are converted to
ISO strings at the page boundary, and `agentRows` carries only primitives (`daysInJourney` is
a computed number, not the raw `lastActiveAt`). Converting every Timestamp inside the bundle
to a `Date` makes the full object plain/serializable.

**Regression self-audit ("what existing feature could this break?"):**
- **Dashboard stall inbox (CDASH-02) — display-only, improved.** `StallInbox`
  (`_components/stall-inbox.tsx`) accepts `contextBundle: Record<string, unknown>` but **never
  reads its contents** — it renders `reason`, `agentUid`, and `openedAt` only. So converting
  the bundle's Timestamp→Date cannot change any rendered output; it only removes the crash.
- **Other `getOpenStalls` consumers — none beyond the dashboard page.** `grep` confirms
  `getOpenStalls` is referenced only in `dashboard/page.tsx` (import + call). The fix at the
  query boundary therefore has no blast radius beyond this one surface, yet protects any future
  consumer too.
- **`kb_miss` bundles preserved.** `emitHandoffSignal` reads `contextBundle.topic`/`.lang` on
  the **write** path (`src/escalation/handoff.ts`), not via `getOpenStalls`. Those fields are
  strings and pass through `serializeContextBundle` verbatim (confirmed by the test's
  `conversationId` assertion). Escalation + jobs test suites (where the bundle is written)
  stay green.
- **Write side untouched.** `src/jobs/runDueJobs.ts` still writes `lastActiveAt` as a Date into
  the bundle; `jobs.test.ts` `contextBundle: expect.objectContaining({ lastActiveAt:
  expect.any(Date) })` is unaffected (read-side-only change).
- **No new dependency, no secret, no PII.** `contextBundle` is technical metadata only
  (`lastActiveAt` is an activity timestamp, not PII — by design, T-01-36 / PDPA).

**NOT verified here (honest gap):** the failing render only occurs for an **authenticated
senior-coach/admin** loading `/[lang]/dashboard` with ≥1 open stall whose `contextBundle`
carries a `lastActiveAt`. I could not forge such a session via curl to exercise the live
render path. Verification rests on tsc + the full dashboard/escalation/jobs test suites + the
deterministic Timestamp→Date conversion (the same pattern shipped twice in quick-029/030). A
senior-coach should smoke-test: load `/en/dashboard` with ≥1 open stall present and confirm
the stall inbox renders with no 500 and no `react-server-dom` serialization error in the
console.
