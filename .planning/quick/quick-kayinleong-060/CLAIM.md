# Claim: quick-kayinleong-060
- owner: kayinleong
- session: claude-code
- branch: quick-kayinleong-045-whatsapp-ingest
- started: 2026-08-27
- status: done
- summary: re-uploading a file after deleting its KB doc reuses the OLD job, which still points at the deleted doc — ingestion embeds into a dangling docId then dies with NOT_FOUND

## What will change

User: `5 NOT_FOUND: No document to update: .../kbDocs/aWXEQ4oqOdRXonDcI9SX`.

Confirmed against live Firestore: that kbDoc does not exist; `job-325550e8fbfb0f8a`
(remaining 0, status complete) still references it; and it is the ONLY one of 200 jobs
pointing at a missing doc — so this is a specific sequence, not systemic rot.

The sequence: `shardJob` is idempotent on the file's sha256 and returns the EXISTING job
verbatim — including the `docId` it was created with. Delete the KB doc, re-upload the same
file, and `createDocFromFile` makes a NEW kbDoc, then gets handed back the OLD job still
bound to the DELETED one. Chunks are embedded against a dangling docId, the new doc stays
empty, and the completion `update()` throws NOT_FOUND.

Planned:
1. Re-point a hash-matching job when the requested docId differs; keep true idempotency
   (same docId, double submit) short-circuiting as before.
2. Fail cleanly if the doc really is gone mid-flight — mark the job `error`, do not throw a
   raw Firestore string.
3. Stop echoing raw error text (it leaked the internal `projects/…/databases/…` path to the
   browser).

## What has changed

**`src/kb/ingest/pipeline.ts`**
- `shardJob` now compares the existing job's `docId` with the requested one. Different ->
  re-point it (`docId`, `lang`, `pillar`, `supersedesId`) and reset `remaining = total`,
  `status = 'pending'`. Same -> short-circuit exactly as before, which is the real
  idempotency case (a double submit must not restart an in-flight ingestion).
  The reset matters as much as the re-point: without it the job is already at
  `remaining: 0` and the new doc would sit empty forever.
  A stale `supersedesId` is cleared with `FieldValue.delete()` — carrying one over would
  retire a document this upload was never asked to replace.
- Completion CHECKS the kbDoc exists before publishing it, and raises a typed
  `IngestionError` with a sentence written for a human instead of letting Firestore's
  NOT_FOUND escape.

**`app/api/kb/ingest/process/route.ts`** — only an `IngestionError` message is echoed (409).
Anything else is logged server-side and returns a generic failure. The reported error text
included `projects/cy-csaiagent/databases/(default)/documents/…`; internal paths should not
reach a browser.

## Verification

- `npx tsc --noEmit` -> **0 errors**
- `npx vitest run` -> **1038 passed**, 197 skipped, 0 failed (was 1033; **+5**)
- `npx eslint app src` -> **0 errors**; `npm run build` -> exit 0

### Measured on live Firestore before touching anything
- `kbDocs/aWXEQ4oqOdRXonDcI9SX` -> **does not exist**
- `job-325550e8fbfb0f8a` -> `remaining 0, status complete`, still pointing at it
- **1 of 200** jobs points at a missing kbDoc, and it is that one — a specific sequence,
  not systemic rot
- 1069 kbDocs total

### Regression surface
- **The same-docId path is byte-identical**, pinned by a test asserting `update` is never
  called and the in-flight `remaining`/`status` are returned untouched.
- **Text extraction and chunking are NOT redone** on a re-point (pinned) — `chunkTexts`
  already lives on the job, so the idempotency win is kept.
- The existence check adds ONE document read per completed job, once, at `remaining <= 0`.
- `kb.test.ts`'s `kbDocsRef().doc()` mock needed a `get()`; that was a gap in the MOCK, not
  a behaviour change — the production path is the one that gained the check.

## Honest gaps

1. **The existing damage is not cleaned up.** `job-325550e8fbfb0f8a` still points at a
   deleted doc, and the 5 chunks it embedded carry that dangling `docId`. The fix is
   self-healing for the user — re-uploading the same file now re-points the job and re-runs
   it — but the orphaned chunks stay until someone sweeps them. I did not mutate live data
   without being asked.
2. **Not reproduced end to end** — no admin session to run a real delete-then-re-upload.
   The sequence is confirmed from the stored job/doc state and the code path.
3. `createDocFromFile` still creates the kbDoc BEFORE sharding, so a shardJob failure leaves
   an empty doc behind. Pre-existing, untouched here.
