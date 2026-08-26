# Claim: quick-kayinleong-060
- owner: kayinleong
- session: claude-code
- branch: quick-kayinleong-045-whatsapp-ingest
- started: 2026-08-27
- status: claimed
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

## Verification

_(pending)_
