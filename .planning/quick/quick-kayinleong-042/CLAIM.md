# Claim: quick-kayinleong-042
- owner: kayinleong
- session: claude-code
- branch: quick-kayinleong-042-kb-ingested-preview
- started: 2026-07-24
- status: done
- summary: Make ingested KB content human-visible on the admin KB edit page — a read-only reconstructed-content preview + chunk count + ingestion job status — so an admin can verify a document ingested properly.

## Context / Symptom

On `/[lang]/kb/[docId]` the "Edit document" Content textarea is always empty even for a
fully-ingested document. Root cause: `KbDocDoc` stores only metadata — the ingested text
lives in the `kbChunks` subcollection (`text` field, ordered by `chunkIndex`, linked by
`docId`). The edit page passes only `title/lang/pillar` to `<KbDocForm>` and never reads
the chunks back. So an admin cannot see what was ingested or tell whether ingestion
produced 0 chunks / N chunks / errored. Not business-friendly (Derek can't self-verify).

Decision (user):
- Show a **read-only preview** of the reconstructed content + a **chunk count** (NOT
  pre-filling the editable textarea — avoids accidental re-index on submit and preserves
  the "upload/paste to replace" flow).
- Also surface **ingestion job status** (pending/processing/complete/error) so a 0-chunk
  doc reads as "in progress" or "failed", not just "empty".

## What will change

- `src/kb/crud.ts`: add `readIngestedContent(user, docId)` — admin|read-only authz
  (mirrors `listDocsForViewer`), reads `kbChunks where docId==docId` (equality-only, no
  composite index), orders by `chunkIndex` in-memory, joins `text`, and reads the latest
  `kbIngestionJobs` doc for status/remaining/total. Returns a plain, RSC-serializable view
  object (strings/numbers/null only).
- `app/[lang]/(admin)/kb/[docId]/page.tsx`: in the admin section, above `<KbDocForm>`,
  render an "Ingested content" panel: status line (chunk count + tokens), a
  processing/error/empty state, and a read-only scrollable text preview.
- `src/i18n/messages/{en,ms,zh}.json`: add parallel `kb.*` keys for the panel copy.

## What has changed

- `src/kb/crud.ts`:
  - Added `IngestedContentView` interface (plain, RSC-serializable: text, chunkCount,
    totalTokens, jobStatus, jobRemaining, jobTotal).
  - Added `readIngestedContent(user, docId)` — admin|read-only authz (mirrors
    `listDocsForViewer`); reads `kbChunks where docId==docId` (equality-only, no composite
    index), orders by `chunkIndex` in-memory, joins `text` with blank lines, sums tokens;
    reads latest `kbIngestionJobs` for status/remaining/total. Added `createdAtMillis`
    helper (Timestamp→millis via unknown-cast, since the declared union includes the
    write-only FieldValue).
  - Extended the `@/src/firebase/collections` import with `kbIngestionJobsRef` +
    `KbIngestionJobDoc`.
- `app/[lang]/(admin)/kb/[docId]/page.tsx`: admin-only fetch of `readIngestedContent`
  (try/catch → null so a read failure never breaks the page); renders an "Ingested
  content" panel above `<KbDocForm>` — chunk/token summary pill, processing banner
  (remaining/total), read-only scrollable `<pre>` preview, plus error / empty states.
- `src/i18n/messages/{en,ms,zh}.json`: added 6 parallel `kb.*` keys (ingestedContent,
  ingestedSummary, ingestedPreviewNote, ingestProcessing, ingestFailed, ingestEmpty).

## Verification

**Regression surface:** the KB detail/edit page (`/[lang]/kb/[docId]`), `src/kb/crud.ts`
consumers (list/create/update/publish/etc. — untouched), and the i18n `kb` namespace
(parity across locales).

**What was tested / ruled out:**
- `npx tsc --noEmit` → exit 0 (after fixing the FieldValue→toMillis cast via `unknown`).
- `npx vitest run src/kb src/i18n` → 52 passed, incl. `i18n-parity` (all three locales
  gained the same 6 keys — verified diff is additions-only, no reformat).
- `npx eslint` on both changed source files → 0.
- No new Firestore write paths (pure read); `readIngestedContent` never logs content
  (no PII/secret logging introduced).
- Query shape ruled index-safe: `where('docId','==',…)` equality-only on both kbChunks
  and kbIngestionJobs; ordering is in-memory (chunkIndex, job createdAt) — no composite
  index required, matching the module's existing pattern.
- Additive-only change: no existing crud signature or page behavior altered; the edit
  form and read-only viewer paths are unchanged.

**Smoke-test pending (not verifiable here):** the panel is admin-gated and needs a real
ingested doc + an authenticated admin session to render. `next dev` on this route only
307→sign-in without a session cookie, so the visual render (preview text, chunk pill,
processing/error/empty states) needs an auth'd admin smoke-test — consistent with prior
admin-surface quick tasks in STATE.md.

- status: done
