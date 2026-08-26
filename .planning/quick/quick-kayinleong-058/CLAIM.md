# Claim: quick-kayinleong-058
- owner: kayinleong
- session: claude-code
- branch: quick-kayinleong-045-whatsapp-ingest
- started: 2026-08-27
- status: done
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

## What has changed

One accessor, four call sites, and three deleted props.

**`src/firebase/client.ts` — `getFreshIdToken()`**
Returns a current ID token from the client SDK. `getIdToken()` serves the cached token and
transparently refreshes it near expiry, so calling it per request is both cheap and the
only thing that stays correct across a long poll loop.

**The token is no longer a prop anywhere.** That was the whole bug class:
- `kb-doc-form.tsx` — `idToken ?? ''`, and NEITHER `kb/page.tsx` nor `kb/[docId]/page.tsx`
  passed one, so both the upload POST and every poll GET sent `Authorization: Bearer ` with
  no token. The doc is created by a Server Action (cookie-authed), which is why a jobId came
  back and only the poll 401'd — exactly the reported request.
- `inline-correction-dialog.tsx` — the dashboard passed `sessionCookie.value`. That cookie
  holds an ID token today, so it happened to work, but the dialog had no way to know that
  and it put an httpOnly credential into client props. Both are gone.
- `whatsapp-import-form.tsx` — read a real token, but once, before a loop that can run for
  many minutes on a large export.

`KbDocExplorerProps` became empty and was deleted with it.

## Verification

- `npx tsc --noEmit` -> **0 errors**
- `npx vitest run` -> **1026 passed**, 197 skipped, 0 failed
- `npx eslint app src` -> **0 errors**; `npm run build` -> exit 0

### How the diagnosis was made
Traced from the reported request backwards: 401 (not 403) means `requireUser` threw, so it
is authentication, not the admin role. `requireUser` accepts only
`Authorization: Bearer <ID token>`. Reading the poller showed the token arriving as a prop;
grepping the two `<KbDocForm>` call sites showed neither passes it. `idToken ?? ''` then
turns a missing prop into a syntactically valid, always-invalid header.

### Regression surface
- **Auth is strictly stronger, never weaker.** A real token replaces an empty string; the
  server-side gate is untouched.
- `getFreshIdToken()` THROWS `not-signed-in` rather than returning `''`, so a signed-out
  caller fails loudly at the fetch site instead of getting a 401 from the server.
- The upload POST and the poll GET now use the same accessor, so they cannot drift.
- Nothing else read those props; `KbDocExplorer` and `InlineCorrectionDialog` take one
  fewer argument each and tsc confirms every call site was updated.

## Honest gaps

1. **Not clicked through live** — no admin session to run a real ingestion against. The
   reasoning is traced end to end and typechecked, but the proof is static.
2. **No test covers this.** These are client islands doing `fetch` in an event handler with
   no existing harness; adding one means standing up a jsdom + Firebase-auth mock for a
   file that has none. The typecheck catches the specific defect (a missing prop is now a
   compile error rather than an empty string) but a wrong-token regression would not be
   caught automatically.
3. **A SEPARATE 401 source is still open and is worse.** `/api/auth/session` stores the raw
   ID token as the `__session` cookie with a 14-day maxAge, but a Firebase ID token expires
   after ONE HOUR and nothing refreshes it. Every cookie-authed Server Component and Server
   Action therefore fails an hour after sign-in. Out of scope here; taken up as
   quick-kayinleong-059.
