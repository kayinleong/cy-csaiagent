# Claim: quick-kayinleong-029

- owner: kayinleong
- session: claude-code
- branch: main
- started: 2026-06-23
- status: done
- summary: Fix the RSC→Client serialization crash on `/[lang]/kb`. The admin KB page passes full `KbDocWithId[]` (each carrying a Firestore `Timestamp` `publishedAt`) straight into the `KbDocList` client component, throwing "Only plain objects, and a few built-ins, can be passed to Client Components". Serialize `publishedAt` to epoch millis (`number | null`) at the page boundary and narrow the client prop type. `KbDocList` never renders `publishedAt`.

## What will change

- `app/[lang]/(admin)/kb/page.tsx` — map `kbDocs` to a client-serializable shape before
  passing to `<KbDocList>`, converting the Firestore `Timestamp` `publishedAt` to epoch
  millis (`number | null`) via a small `toMillis` helper (mirrors the existing pattern in
  `app/[lang]/(admin)/audit-log/actions.ts`).
- `app/[lang]/(admin)/kb/kb-doc-list.tsx` — narrow the `docs` prop type from `KbDocWithId[]`
  to a serialized variant where `publishedAt: number | null` (the only non-serializable field;
  the component never reads it). Export the serialized type so the page imports it.

Scope: the single broken surface (`/[lang]/kb`). `kb/[docId]/page.tsx` renders the version
chain server-side (no client boundary for full docs) and is unaffected. The dashboard
correction picker (`listKbDocsForCorrection`) already strips to a summary (no `publishedAt`)
and is unaffected. `src/kb/crud.ts` return types are NOT changed (minimal blast radius).

## What has changed

**Root cause.** The admin KB list page is an RSC that fetched `listDocs(user)` →
`KbDocWithId[]` and passed it **directly** to the `KbDocList` *client* component. Each
`data.publishedAt` is a Firestore `Timestamp` (a class instance with `_seconds` /
`_nanoseconds`), and React cannot serialize a class instance across the RSC→Client
boundary — hence `Error: Only plain objects, and a few built-ins, can be passed to Client
Components`. The error object the runtime printed (`{title, sourcePath, version, lang,
pillar, status, tenantId, publishedAt: {_seconds, _nanoseconds}}`) is the full `KbDocDoc`
shape, confirming `/[lang]/kb` (not the dashboard) as the surface. `publishedAt` was the
only non-plain field; `KbDocList` never even renders it.

**`app/[lang]/(admin)/kb/page.tsx`** — added a local `toMillis(value): number | null`
helper (mirrors `(admin)/audit-log/actions.ts:99-102`) that converts a Firestore
`Timestamp` (or `Date`) to epoch millis, returning `null` for missing/unknown values
(legacy docs written before `publishedAt` existed). Before rendering, the fetched docs are
mapped to a `SerializedKbDocWithId[]` with `data: { ...data, publishedAt: toMillis(...) }`
and that serialized array is passed to `<KbDocList>`.

**`app/[lang]/(admin)/kb/kb-doc-list.tsx`** — replaced the `KbDocWithId` import with a new
exported `SerializedKbDocWithId` type (`Omit<KbDocDoc,'publishedAt'> & { publishedAt:
number | null }`) and changed the `docs` prop to use it. Pure type/serialization change —
no rendering logic touched (the component reads `id/title/lang/pillar/version/status` only).

**Commit (on `main`):** `e576cdc` fix(quick-kayinleong-029): serialize KB doc publishedAt
before RSC→Client boundary.

## Verification

**Automated gates:**
- `npx tsc --noEmit` → **0 errors** (the serialized shape is a plain, type-checked
  projection of `KbDocDoc`; the spread override makes `publishedAt` `number | null`).
- `npx eslint app/[lang]/(admin)/kb/page.tsx app/[lang]/(admin)/kb/kb-doc-list.tsx` →
  **0 errors, 0 warnings** (no unused `KbDocWithId` import left behind).

**Why this fixes it (definitive):** the runtime named `publishedAt: {_seconds, _nanoseconds}`
as the *single* offending field. Converting it to a primitive `number` (or `null`) leaves
every field on the object plain/primitive, so the object now serializes across the boundary.
All other `KbDocDoc` fields (`title`, `sourcePath`, `tenantId`, `version`, `lang`, `pillar`,
`status`, and the optional `supersedesId`/`supersededBy`/`correctedBy`/`category`) are
already strings/numbers and are preserved verbatim by the spread.

**Regression self-audit ("what existing feature could this break?"):**
- **`/[lang]/kb` list rendering — display-only, no behavior change.** `KbDocList` reads
  `id/title/lang/pillar/version/status` (pillar filter, superseded toggle, pagination,
  publish toggle, delete) — all preserved by the spread. `publishedAt` is the *only* field
  whose type changed, and it is never read by the component.
- **`/[lang]/kb/[docId]` version viewer — untouched.** It renders the version chain
  server-side and only hands `KbDocForm` plain strings (title/lang/pillar). No client
  boundary carries a full doc, so it was never broken and is not modified. It still imports
  `KbDocWithId` from `src/kb/crud` (type unchanged).
- **Dashboard correction picker (`listKbDocsForCorrection`) — untouched.** It already maps
  to a stripped `KbDocSummary` (no `publishedAt`), so it was never affected. The dashboard
  POST log line in the report was merely interleaved with the `/en/kb` GET.
- **`src/kb/crud.ts` / `src/kb/index.ts` — untouched.** `KbDocWithId` and `listDocs` return
  types are unchanged → no blast radius to other consumers (Finder, ingestion, etc.).
- **No new dependency, no secret, no PII** (`publishedAt` is a publication timestamp, not PII).

**NOT verified here (honest gap):** the exact failing path only renders for an
**authenticated admin** loading `/[lang]/kb` with ≥1 doc present. The dev server on :3000 is
healthy this session (`/en/kb` → HTTP 307 auth redirect, route compiles & serves), but I
could not forge an admin `__session` cookie via curl to render the data path. Verification
therefore rests on tsc + eslint + the deterministic Timestamp→millis conversion (a pattern
already in production in `audit-log/actions.ts`). An admin should smoke-test: load
`/en/kb` (or `/ms`, `/zh`) with KB docs present and confirm the list renders with no console
error.

