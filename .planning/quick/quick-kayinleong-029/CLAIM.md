# Claim: quick-kayinleong-029

- owner: kayinleong
- session: claude-code
- branch: main
- started: 2026-06-23
- status: claimed
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

(pending)

## Verification

(pending)
