# Claim: quick-kayinleong-073
- owner: kayinleong
- session: claude-code
- branch: quick-kayinleong-045-whatsapp-ingest
- started: 2026-08-28
- status: done
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

## What has changed

**`src/auth/next-path.ts`** — `safeNextPath()` and `signInUrlFor()`, pure and shared by all
three consumers so they cannot disagree about what is safe.

**`app/[lang]/chat/page.tsx`** — a server-side gate in the same shape the coach dashboard
already uses: read `__session`, verify through `requireUser`, and redirect to
`/{lang}/sign-in?next=…` on absence OR expiry. The stale comment promising this for "Phase 2"
is replaced with what actually happens.

**`app/[lang]/(auth)/sign-in/sign-in-form.tsx`** — honours a validated `next`, falling
through to the existing role-based routing when there is none or it fails validation.

**`app/[lang]/chat/chat-input.tsx`** — `bounceToSignIn()` on a missing client session and on
a `401`. A session can lapse while the tab is open — the cookie holds a raw ID token good
for one hour (quick-059) — and a toast on a surface that can no longer answer left the agent
stuck.

### The open-redirect part, which is the reason this is more than three lines
`?next=` is read BEFORE the visitor is authenticated. Unvalidated, a link like
`…/sign-in?next=https://evil.example/login` sends an agent off-origin the instant a REAL
sign-in succeeds — far more convincing than a fake login page, because the sign-in they just
completed was genuine. `safeNextPath` allows one shape only: a same-origin absolute path
under a known locale, never `/{lang}/sign-in` itself.

It decodes first, because the naive checks run on a value that starts with `/` and
`%2F%2Fevil.test` would otherwise pass. It rejects control characters as escapes rather than
stripping them, because a tab can smuggle a scheme past a browser's URL parser.

## Verification

- `npx tsc --noEmit` -> **0 errors**
- `npx vitest run` -> **1118 passed**, 197 skipped, 0 failed (was 1092; **+26**)
- `npx eslint app src` -> **0 errors**; `npm run build` -> exit 0

### Exercised against the running dev server
| request | result |
|---|---|
| `GET /en/chat`, no cookie | **307** -> `/en/sign-in?next=%2Fen%2Fchat` |
| `GET /en/chat`, invalid cookie (the expiry case) | **307** -> `/en/sign-in?next=%2Fen%2Fchat` |
| `GET /ms/chat`, no cookie | **307** -> `/ms/sign-in?next=%2Fms%2Fchat` |
| `GET /en/chat` with a REAL minted session | **200** — renders, no regression |
| `GET /en/sign-in?next=%2Fen%2Fchat` | 200 |

### The 26 tests
Accepts each locale, a path with a query string, and a percent-encoded path. Refuses
absolute URLs, protocol-relative (`//` and `/\`), backslashes anywhere, `javascript:` and
`data:`, relative paths, `../` traversal, a bare `/`, unknown locales, a loop back to
sign-in, over-long values, a malformed escape sequence, and control characters both raw and
percent-encoded. Plus a round-trip: what `signInUrlFor` builds, `safeNextPath` accepts.

### Regression surface
- **Authenticated access is unchanged** — verified with a real minted session returning 200.
- The gate is UX; `/api/chat` still independently requires a valid Bearer token, so this
  changes where an unauthenticated visitor LANDS, not what they can reach.
- Sign-in's role-based routing is untouched and is still the fallback.
- `next-path.ts` imports nothing from `app/` or `next`, per the core/shell rule.

## Honest gaps

1. **Only /chat is gated.** Other authenticated pages have their own gates (the dashboard)
   or none. Gating centrally in `proxy.ts` would cover everything at once, but it runs on
   every request including static assets and would need the token verified at the edge —
   a bigger change than this report warrants, and worth its own claim.
2. **The full browser round trip is not clicked through** — the redirect, the param and the
   authenticated 200 are verified over HTTP, but not the actual sign-in-then-land flow,
   which needs real credentials I do not have.
3. **A `next` pointing at a page the agent's role cannot reach** (say a new-agent sent to
   `/en/dashboard`) will redirect them again from that page's own gate. Correct, but the
   second bounce may read as a glitch.
