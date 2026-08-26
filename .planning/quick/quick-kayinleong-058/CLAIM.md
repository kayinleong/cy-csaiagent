# Claim: quick-kayinleong-058
- owner: kayinleong
- session: claude-code
- branch: quick-kayinleong-045-whatsapp-ingest
- started: 2026-08-27
- status: claimed
- summary: KB ingestion polling 401s — the pollers send an empty or wrong-type Bearer token instead of a live Firebase ID token

## What will change

User: uploading a KB file 401s on
`GET /api/kb/ingest/process?jobId=job-…&limit=5`.

`requireUser()` requires `Authorization: Bearer <Firebase ID token>`. Three call sites do
not supply one:

1. `kb-doc-form.tsx` uses `idToken ?? ''` and BOTH pages render `<KbDocForm />` with no
   `idToken` prop at all -> the header is literally `Bearer ` -> 401. The doc itself is
   created by a Server Action (cookie-authed), which is why a jobId comes back and only the
   poll fails. This is the reported bug.
2. `dashboard/page.tsx` passes `sessionCookie.value` as `idToken`. A session cookie is not
   an ID token — `verifyIdToken` rejects it — so inline correction 401s too, and an
   httpOnly credential is being handed to client JS.
3. `whatsapp-import-form.tsx` reads a real token but only once, so a long import can cross
   the 1-hour expiry mid-loop.

Planned: one `getFreshIdToken()` helper, called per request by every poller, and delete the
`idToken` props.

## Verification

_(pending)_
