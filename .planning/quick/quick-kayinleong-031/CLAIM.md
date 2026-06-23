# Claim: quick-kayinleong-031

- owner: kayinleong
- session: claude-code
- branch: main
- started: 2026-06-23
- status: claimed
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

_(filled on completion)_

## Verification

_(filled on completion)_
