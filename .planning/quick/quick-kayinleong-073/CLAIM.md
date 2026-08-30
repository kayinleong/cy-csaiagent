# Claim: quick-kayinleong-073
- owner: kayinleong
- session: claude-code
- branch: quick-kayinleong-045-whatsapp-ingest
- started: 2026-08-28
- status: claimed
- summary: an unauthenticated visitor can load /chat and only finds out when their message errors — gate the page and return them to it after sign-in

## What will change

User: "if user is not sign in and go chat page and ask anything, the website will throw error
instead of redirecting user to go login page. i need to redirect to login, once sign in and
redirect back to chat using a param".

Confirmed in the code:
- `proxy.ts` does locale redirects ONLY and never looks at the session cookie. There is no
  auth gating anywhere in it.
- `app/[lang]/chat/page.tsx` has no gate either, and says so: *"If the session cookie is
  absent, users land here unauthenticated — the ChatInput island will detect no Firebase
  currentUser and toast an error. Phase 2 will add a redirect-to-sign-in redirect from
  proxy.ts."* That was never added.
- `sign-in-form.tsx` routes purely by role and ignores where the visitor came from.

So the page renders, the agent types a question, and the only feedback is an error toast.

Planned:
1. Gate the chat page server-side, matching the pattern the coach dashboard already uses.
2. Redirect to `/{lang}/sign-in?next=…` and honour it after sign-in.
3. Validate `next` strictly — an unvalidated redirect param is an open-redirect hole, and
   this one is reachable pre-auth.
4. Handle a session that expires mid-visit, so the agent is sent to sign-in rather than
   shown an error.

## Verification

_(pending)_
