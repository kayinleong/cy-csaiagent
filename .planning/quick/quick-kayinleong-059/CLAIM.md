# Claim: quick-kayinleong-059
- owner: kayinleong
- session: claude-code
- branch: quick-kayinleong-045-whatsapp-ingest
- started: 2026-08-27
- status: done
- summary: the __session cookie holds a raw Firebase ID token that dies after 1 hour while the cookie lives 14 days — nothing refreshes it, so every cookie-authed surface 401s

## What will change

Found while fixing quick-058. `/api/auth/session` stores the ID token VERBATIM as the
`__session` cookie with `maxAge: 60*60*24*14`. A Firebase ID token is valid for ONE HOUR.
Only the sign-in form ever POSTs it; there is no `onIdTokenChanged` anywhere in the repo.

So an hour after sign-in the cookie is still present and still sent, and every surface that
authenticates from it — Server Components, Server Actions, the coach dashboard gate —
fails `verifyIdToken` and 401s or redirects to sign-in, for the next 13 days and 23 hours.

Planned: a client island subscribed to `onIdTokenChanged` that re-POSTs the refreshed token
to `/api/auth/session`. The Firebase SDK refreshes the ID token on its own shortly before
expiry and on re-init; this just keeps the cookie in step with it.

## What has changed

Three files, ~60 lines of logic.

- **`app/[lang]/_components/sync-session-cookie.ts`** — pure `syncSessionCookie(user, state,
  fetch)`. Posts the current ID token to `/api/auth/session` when it differs from the last
  one the server accepted. No React and no Firebase import, so it is testable without
  initialising a Firebase app in the test process.
- **`app/[lang]/_components/session-token-sync.tsx`** — a render-nothing island that wires
  `onIdTokenChanged` to it.
- **`app/[lang]/layout.tsx`** — mounts the island. It covers the sign-in page too, which is
  deliberate: with no user it is a no-op, and a session restored from IndexedDB in a cold
  tab repairs its cookie there.

Design points worth stating, because each is a way this could have gone wrong:
- **Signed-out does NOT clear the cookie.** Sign-out already DELETEs it; clearing here would
  race that on every listener teardown.
- **`state.last` only advances after the server ACCEPTS the write**, so one 500 does not
  dedupe the cookie into staying stale until the tab is reloaded.
- **Failures are swallowed.** Offline is not worth a toast — the token in the cookie is
  still good until its hour is up and the SDK will fire again.
- **The token is never put in a URL** (pinned by a test) — CLAUDE.md forbids credentials in
  query strings.

## Verification

- `npx tsc --noEmit` -> **0 errors**
- `npx vitest run` -> **1033 passed**, 197 skipped, 0 failed (was 1026; **+7**)
- `npx eslint app src` -> **0 errors**; `npm run build` -> exit 0

Tests pin: the POST shape; signed-out does nothing; an unchanged token is skipped but a
REFRESHED one is posted (the actual purpose); a rejected write is retried on the next
emission; a network throw does not escape into the listener; and the token never reaches
the URL.

### Regression surface
- **Nothing reads the cookie differently.** `/api/auth/session` POST is unchanged and was
  already idempotent — it verifies the posted token and re-sets the cookie.
- **Sign-in now posts twice** on success: once from the form, once from the listener. Both
  set the same cookie to the same value.
- **Bundle:** the island imports `clientAuth` only. `getClientDb`/`getClientStorage` are
  async accessors precisely so Firestore and Storage are not pulled in (quick-046); this
  adds app+auth to routes that did not have it, which is the cost of the fix.
- The layout is otherwise untouched; the island renders `null`.

## Honest gaps

1. **Not verified live** — proving it needs a session left open for an hour. The mechanism
   (Firebase refreshes the ID token before expiry and fires `onIdTokenChanged`) is SDK
   behaviour I am relying on, not something I observed here.
2. **The cold-tab case still lands on sign-in.** If a tab is closed for more than an hour
   and reopened, the stale cookie is rejected BEFORE any client code runs, so the user is
   redirected to sign-in; the island then repairs the cookie, but the sign-in page has no
   already-signed-in redirect, so they are left sitting there. One refresh fixes it. Adding
   that redirect changes the auth entry point and belongs in its own claim.
3. **The real fix is a Firebase SESSION COOKIE** (`createSessionCookie` +
   `verifySessionCookie`, valid up to 14 days by design) instead of storing a raw ID token.
   That changes `requireUser`, which every route, page gate and `proxy.ts` depends on — too
   large for a quick task, and this closes the bleeding without touching that surface.
