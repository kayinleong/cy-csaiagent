# Claim: quick-kayinleong-042
- owner: kayinleong
- session: claude-code
- branch: quick-kayinleong-042-kb-ingested-preview
- started: 2026-07-24
- status: in-progress
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

_(filled during execution)_

## Verification

_(filled before done)_
