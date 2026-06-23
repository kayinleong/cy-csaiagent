---
id: quick-kayinleong-029
status: complete
date: 2026-06-23
commit: e576cdc
---

# Quick Task quick-kayinleong-029 — Summary

**Fix the RSC→Client serialization crash on `/[lang]/kb`.**

## Problem

Loading the admin KB page threw at render:

```
Error: Only plain objects, and a few built-ins, can be passed to Client Components
from Server Components. Classes or null prototypes are not supported.
  {title, sourcePath, version, lang, pillar, status, tenantId,
   publishedAt: {_seconds, _nanoseconds}}
```

`app/[lang]/(admin)/kb/page.tsx` (an RSC) passed full `KbDocWithId[]` from `listDocs()`
straight into the `KbDocList` **client** component. Each `data.publishedAt` is a Firestore
`Timestamp` — a class instance, not a plain object — which React cannot serialize across
the RSC→Client boundary. `publishedAt` was the only non-plain field, and `KbDocList` never
renders it.

## Fix

- **`page.tsx`** — added a `toMillis()` helper (Firestore `Timestamp`/`Date` → epoch millis,
  `null` for missing) mirroring `(admin)/audit-log/actions.ts`, and serialized each doc's
  `publishedAt` before passing a `SerializedKbDocWithId[]` to `<KbDocList>`.
- **`kb-doc-list.tsx`** — narrowed the `docs` prop from `KbDocWithId[]` to a new exported
  `SerializedKbDocWithId` type (`Omit<KbDocDoc,'publishedAt'> & { publishedAt: number | null }`).

Minimal scope — `src/kb/crud.ts` return types, the `kb/[docId]` viewer, and the dashboard
correction picker are all unchanged (and were never the broken surface).

## Verification

- `npx tsc --noEmit` → 0 errors.
- `npx eslint` on both changed files → 0 errors, 0 warnings.
- Dev server healthy (`/en/kb` → HTTP 307 auth redirect, route compiles & serves).
- Honest gap: the failing render path needs an authenticated admin session, which couldn't
  be forged via curl — see CLAIM.md Verification for the admin smoke-test step.

See `CLAIM.md` for the full root-cause analysis and regression report.
