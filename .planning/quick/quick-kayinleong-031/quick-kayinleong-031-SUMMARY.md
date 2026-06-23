---
id: quick-kayinleong-031
status: complete
date: 2026-06-23
commit: 2bf2544
---

# Quick Task quick-kayinleong-031 — Summary

**Fix the RSC→Client serialization crash on `/[lang]/dashboard`.**

## Problem

```
GET /en/dashboard 200
Error: Only plain objects, and a few built-ins, can be passed to Client Components
from Server Components. Classes or null prototypes are not supported.
  {lastActiveAt: {_seconds: ..., _nanoseconds: 821000000}}
```

The `stall-detect`/`escalate` lazy-cron jobs persist `contextBundle: { lastActiveAt }` into
each escalation doc (`src/jobs/runDueJobs.ts:113,188`). On read, `getOpenStalls`
(`src/dashboard/queries.ts`) normalized **only** `openedAt` via `toDate` — `contextBundle`
flowed through the `...data` spread with `lastActiveAt` still a raw Firestore `Timestamp` (a
class instance). `app/[lang]/(coach)/dashboard/page.tsx:208` then passed that bundle straight
into the `StallInbox` **client** component, and React cannot serialize a class instance across
the RSC→Client boundary. Same root-cause class as quick-kayinleong-029 (KB list `publishedAt`)
and quick-kayinleong-030 (inventory `vpDate`), different surface.

## Fix

- **`src/dashboard/queries.ts`** — added a `serializeContextBundle(bundle)` helper (next to the
  existing `toDate`) that converts any value carrying a `.toDate()` method (a Firestore
  `Timestamp`) to a plain `Date`, while preserving every non-date field (`topic`, `lang`,
  `conversationId`, …) verbatim. Applied it in `getOpenStalls` alongside the existing
  `openedAt: toDate(...)`. The fix lives at the query boundary, so all consumers get a
  serializable bundle. `Date` is a supported RSC built-in (deliberate, as in 029/030).
- **`src/dashboard/dashboard.test.ts`** — added a regression test mirroring the
  `getOpenStalls.openedAt` Timestamp test: asserts `contextBundle.lastActiveAt` comes back a
  real `Date` with a valid `toISOString()` and that a sibling non-date field survives.

`StallInbox` never reads `contextBundle`'s contents (renders `reason`/`agentUid`/`openedAt`
only), so the conversion changes no rendered output — it only removes the crash. The
`contextBundle` type stays `Record<string, unknown>`; the write side and `page.tsx` are
unchanged.

## Verification

- `npx tsc --noEmit` → 0 errors.
- `npx vitest run src/dashboard src/escalation src/jobs` → 62 passed (incl. the new test).
- `npx eslint` on both changed files → 0 errors, 1 **pre-existing** warning (`fakeAgentsB`
  unused — not in my diff).
- Honest gap: the failing render path needs an authenticated senior-coach/admin session with
  ≥1 open stall, which couldn't be forged via curl — see CLAIM.md Verification for the
  smoke-test step.

See `CLAIM.md` for the full root-cause analysis and regression report.
