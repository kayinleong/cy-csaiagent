# Claim: quick-kayinleong-059
- owner: kayinleong
- session: claude-code
- branch: quick-kayinleong-045-whatsapp-ingest
- started: 2026-08-27
- status: claimed
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

## Verification

_(pending)_
