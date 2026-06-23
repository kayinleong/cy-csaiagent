# Claim: quick-kayinleong-030

- owner: kayinleong
- session: claude-code
- branch: main
- started: 2026-06-23
- status: claimed
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

(pending)

## Verification

(pending)
