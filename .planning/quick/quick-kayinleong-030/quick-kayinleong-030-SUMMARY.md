---
id: quick-kayinleong-030
status: complete
date: 2026-06-23
commit: 6b2ce4e
---

# Quick Task quick-kayinleong-030 — Summary

**Fix the RSC→Client serialization crash (500) on `/[lang]/inventory`.**

## Problem

```
GET /en/inventory 500
Error: Only plain objects, and a few built-ins, can be passed to Client Components
from Server Components. Classes or null prototypes are not supported.
  {tenantId: "d2", name, status, priceValue, tenure, bedrooms, locationText,
   description, vpStatus, vpDate: {_seconds, _nanoseconds: 0}, bumiQuota,
   foreignEligible, priceBand, embedding}
```

`app/[lang]/(admin)/inventory/page.tsx` (an RSC) passed full `ProjectWithId[]` from
`listProjects()` straight into the `ProjectList` **client** component. Each `data.vpDate`
is a Firestore `Timestamp` — a class instance React cannot serialize across the RSC→Client
boundary. It was the only field React flagged. Same root cause as quick-kayinleong-029 (KB
list), different surface.

## Fix

- **`page.tsx`** — added a `toDate()` helper (Firestore `Timestamp`/`Date` → `Date`, `null`
  for missing) and serialized each project's `vpDate` before passing a
  `SerializableProjectWithId[]` to `<ProjectList>`.
- **`project-list.tsx`** — narrowed the `projects` prop from `ProjectWithId[]` to a new
  exported `SerializableProjectWithId` type (`Omit<ProjectDoc,'vpDate'> & { vpDate: Date | null }`).

Converting to a real `Date` (not millis) keeps the `vpDate instanceof Date` guards in
`ProjectList`/`ProjectForm` working — which also repairs a latent bug where the inline edit
form silently dropped the VP date.

`embedding` is a plain `number[]` (scored in-memory, not a `FieldValue.vector`) → serializable
→ not the crash cause → left untouched. Stripping it from the client payload is filed as a
follow-up (CLAIM.md Deferred Items). `src/inventory/list.ts` return types are unchanged.

## Verification

- `npx tsc --noEmit` → 0 errors.
- `npx eslint` on both changed files → 0 errors, 1 **pre-existing** warning (`_lang` unused —
  not in my diff).
- Dev server healthy: `GET /en/inventory` → HTTP 307 (auth redirect), route compiles, no 500.
- Honest gap: the failing render path needs an authenticated admin session, which couldn't be
  forged via curl — see CLAIM.md Verification for the admin smoke-test step.

See `CLAIM.md` for the full root-cause analysis, regression report, and deferred items.
