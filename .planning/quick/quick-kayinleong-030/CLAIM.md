# Claim: quick-kayinleong-030

- owner: kayinleong
- session: claude-code
- branch: main
- started: 2026-06-23
- status: done
- summary: Fix the RSC→Client serialization crash on `/[lang]/inventory` (500). The admin inventory page passes full `ProjectWithId[]` (each carrying a Firestore `Timestamp` `vpDate`) straight into the `ProjectList` client component, throwing "Only plain objects, and a few built-ins, can be passed to Client Components". Convert `vpDate` → a plain `Date` (or null) at the page boundary and narrow `ProjectList`'s prop type to a serialized variant. Same root cause as quick-kayinleong-029 (the KB list), different surface.

## What will change

- `app/[lang]/(admin)/inventory/page.tsx` — add a `toDate(value): Date | null` helper
  (Firestore `Timestamp`/`Date` → `Date`, null for missing) and map the fetched projects to
  a client-serializable shape (`vpDate` converted) before passing them to `<ProjectList>`.
  `Date` is a supported serializable built-in; converting to a real `Date` (not millis) also
  keeps the existing `vpDate instanceof Date` checks in `project-list.tsx` and `project-form.tsx`
  working — which incidentally repairs a latent bug where the inline edit form silently
  dropped the VP date (the raw value was a `Timestamp`, never a `Date`, so the guard always
  fell through to `null`).
- `app/[lang]/(admin)/inventory/project-list.tsx` — narrow the `projects` prop type from
  `ProjectWithId[]` to a new exported `SerializableProjectWithId` (`Omit<ProjectDoc,'vpDate'>
  & { vpDate: Date | null }`). No rendering logic changes.

Scope: the single broken surface. `vpDate` is the only Firestore `Timestamp` on `ProjectDoc`
and the only field React flagged. `embedding` (a 1024-d vector also present in the object) is
stored/read as a **plain `number[]`** — not a `FieldValue.vector` (the inventory search path
scores it in-memory) — so it is serializable and NOT the crash cause; it is left untouched
here (a separate cleanup claim could stop shipping the unused vector to the client — noted in
Deferred Items). `src/inventory/list.ts` (`listProjects`/`ProjectWithId`) return types are NOT
changed (minimal blast radius; this page is their only consumer).

## What has changed

**Root cause.** `app/[lang]/(admin)/inventory/page.tsx` (an RSC) fetched `listProjects(user)`
→ `ProjectWithId[]` and passed it **directly** into the `ProjectList` *client* component. Each
`data.vpDate` is a Firestore `Timestamp` (a class instance with `_seconds`/`_nanoseconds`),
which React cannot serialize across the RSC→Client boundary → `GET /en/inventory 500` with
`Error: Only plain objects, and a few built-ins, can be passed to Client Components`. The
runtime caret pointed at `vpDate: {_seconds, _nanoseconds}` — the only Firestore `Timestamp`
on `ProjectDoc`. Identical root cause to quick-kayinleong-029 (the KB list), different surface.

**`app/[lang]/(admin)/inventory/page.tsx`** — added a local `toDate(value): Date | null`
helper (Firestore `Timestamp`/`Date` → `Date`, `null` for missing — `vpDate` is null when VP
is not yet completed). Before rendering, the fetched projects are mapped to a
`SerializableProjectWithId[]` with `data: { ...data, vpDate: toDate(data.vpDate) }` and that
array is passed to `<ProjectList>`.

**`app/[lang]/(admin)/inventory/project-list.tsx`** — replaced the `ProjectWithId` import with
a new exported `SerializableProjectWithId` type (`Omit<ProjectDoc,'vpDate'> & { vpDate: Date |
null }`) and changed the `projects` prop to use it. No rendering logic touched.

**Latent bug fixed as a side effect.** `project-list.tsx` and `project-form.tsx` both guard
`vpDate instanceof Date`. The raw value was a `Timestamp` (never a `Date`), so the inline edit
form's date input always fell through to `null` — silently dropping a project's VP date on
edit. Converting to a real `Date` at the boundary makes the guard pass, so the edit form now
pre-fills the VP date correctly. (Using `Date` rather than epoch millis — as quick-029 did for
the KB list — is the deliberate choice here precisely to keep these `instanceof Date` consumers
working without a client-side change.)

**Commit (on `main`):** `6b2ce4e` fix(quick-kayinleong-030): serialize project vpDate before
RSC→Client boundary.

## Verification

**Automated gates:**
- `npx tsc --noEmit` → **0 errors** (the serialized shape is a plain, type-checked projection
  of `ProjectDoc`; `Date` is assignable and serializable).
- `npx eslint app/[lang]/(admin)/inventory/page.tsx app/[lang]/(admin)/inventory/project-list.tsx`
  → **0 errors, 1 warning**. The single warning (`'_lang' is defined but never used`,
  project-list.tsx:67) is **pre-existing** — it is `ProjectList`'s own destructured `lang: _lang`
  prop (line shifted down by my added type block); `git diff` confirms my change does not touch
  it. (It also confirms this config does NOT ignore `^_`-prefixed vars — which is why I did not
  strip `embedding` via a rest-destructure: that would have added a second unused-var warning.)
- Dev server (running on :3000) → `GET /en/inventory` returns **HTTP 307** (auth redirect): the
  route compiles and serves with no 500.

**Why this fixes it (definitive):** `vpDate` was the single non-serializable field React
flagged. Converting it to a `Date` (a supported RSC built-in) makes every field on the object
plain/serializable. All other `ProjectDoc` fields are primitives/booleans (`name`, `status`,
`priceBand`, `priceValue`, `tenure`, `vpStatus`, `bumiQuota`, `foreignEligible`, `description`,
`locationText`, `bedrooms`) or a plain `number[]` (`embedding`) and are preserved verbatim by
the spread.

**Regression self-audit ("what existing feature could this break?"):**
- **`/[lang]/inventory` list rendering — display-only, no behavior change.** `ProjectList`
  reads `name/status/priceValue/tenure/bedrooms/locationText` (table) plus the edit-form
  fields; all preserved by the spread. The only field whose type changed is `vpDate`, and the
  change (Timestamp→Date) makes its sole consumer (`instanceof Date`) behave **more** correctly,
  not less.
- **Inline edit (`ProjectForm`) — improved, not broken.** It already expected `vpDate: Date |
  null` and rendered `initialValues.vpDate.toISOString()`; it now actually receives the Date.
- **`embedding` left untouched and serializable.** Verified written as a plain JS array
  (`src/inventory/crud.ts:152-155` — `projectsRef().add({ ...tempDoc, embedding })` where
  `embedding: number[]` from `embedProject`), and the inventory search path scores it
  **in-memory** (`src/inventory/search.ts:336` `dotProduct(queryVector, doc.embedding)`), NOT
  via Firestore `findNearest`/`FieldValue.vector`. So it is a plain array → serializable → not
  the crash cause. Per the project's "minimal fix, cleanup in a separate claim" rule it is not
  modified here (see Deferred Items).
- **`src/inventory/list.ts` (`listProjects`/`ProjectWithId`) — untouched.** This page is their
  only consumer; return types unchanged → no blast radius to inventory crud, search, import, or
  the Finder agent.
- **No new dependency, no secret, no PII** (`vpDate` is a vacant-possession date, not PII).

**NOT verified here (honest gap):** the failing path only renders for an **authenticated admin**
loading `/[lang]/inventory` with ≥1 project present. The dev server is healthy (`/en/inventory`
→ 307), but I could not forge an admin `__session` cookie via curl to exercise the data-render
path. Verification rests on tsc + eslint + the deterministic Timestamp→Date conversion (the same
pattern shipped in quick-029). An admin should smoke-test: load `/en/inventory` with projects
present, confirm the list renders with no console error, then click **Edit** on a project that
has a VP date and confirm the VP-date field is pre-filled.

## Deferred Items

- **Stop shipping `embedding` to the inventory client (perf/cleanup).** `ProjectList` never
  reads the 1024-d `embedding`, yet it is serialized into the client payload (~8 KB/project).
  A follow-up claim should strip it from `SerializableProjectWithId` (the projection already
  exists, so this is a one-line `Omit` + a destructure in `page.tsx`). Out of scope here:
  it is an optimization, not part of the crash fix, and the repo's eslint config does not
  ignore `^_` vars (a rest-destructure strip would add an unused-var warning to resolve).
