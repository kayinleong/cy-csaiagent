# RESEARCH-perf — quick-kayinleong-046

Performance audit of the D2 CS AI Agent platform (Next.js 16.2.6 / React 19.2.4 /
Turbopack). Read-only investigation — no source files were modified.

Bug report (verbatim): *"The web interface now also quite laggy, please fix both the
frontend using the provided skills also fix the backend code if backend is the one
causing the lagginess."*

**Headline:** the lag is real and has three independent root causes, not one.
1. Every page ships **461 KB of Firebase SDK** it does not use (a sign-out button drags in Firestore + Storage).
2. Chat re-parses **every** markdown message from scratch on **every SSE token**, twice per token.
3. There is **zero** `Suspense`/`loading.tsx` in the app, so every navigation blocks on server auth + Firestore with no visual feedback.

Backend request handling is mostly well built (audit deferred via `after()`, bounded
`findNearest`, memoized Admin SDK). The one genuine backend TTFB killer is a
**blocking LLM classifier call before the answer stream starts**.

---

## Findings

Sizes below are **uncompressed** bytes measured from `.next/static/chunks` after a
clean `npm run build` (see [How to measure](#how-to-measure)). Divide by ~3.5 for a
gzip/brotli estimate.

| # | Sev | Area | `file:line` | What's slow | Impact (measured / reasoned) |
|---|-----|------|-------------|-------------|------------------------------|
| 1 | **high** | frontend | `src/firebase/client.ts:16-19` | Module scope eagerly imports `firebase/app` + `firebase/auth` + `firebase/firestore` + `firebase/storage`. Firestore and Storage are needed by 2 files; Auth by 6. All four collapse into **one 461 KB chunk**. | **Measured.** All 22 client routes ship the 461 KB chunk. Lightest console page `/[lang]/(admin)/pdpa-settings` = **762 KB**, of which 461 KB (60%) is Firebase — and that page's `page.tsx` imports **zero** Firebase (see #2). ~130 KB gzip of parse+eval on every first load. |
| 2 | **high** | frontend | `app/[lang]/_components/sign-out-button.tsx:23` → `app-sidebar.tsx:41` → `console-shell.tsx:19` | `ConsoleShell` (a `'use client'` component) is rendered by `(admin)/layout.tsx:74`, `(coach)/layout.tsx:56` and `[lang]/page.tsx:230` — i.e. **every console page**. Its sidebar contains a sign-out button whose only Firebase need is `signOut`, but that import pulls in all of #1. | **Measured.** This is the transitive edge that puts Firestore+Storage on 21 routes that never query Firestore. `pdpa-settings` is the proof case: no Firebase in the page, 461 KB of Firebase in the bundle. |
| 3 | **high** | frontend | `app/[lang]/chat/chat-input.tsx:276-282` + `:141-143` | Per-token `setMessages` (line 276) is followed by `useEffect(() => onMessagesChange(messages), [messages, …])` (line 141) which calls chat-shell's `setMessages`. **Two full renders of the whole ChatShell tree per token** — ChatHeader, ConversationList, LeadSelector, HeroEmptyState and ChatInput all re-render on every token even though none of them display token text. | Reasoned, high confidence. Anthropic SSE deltas arrive at tens per second. 2 renders × N tokens × entire subtree. Compounds multiplicatively with #4. |
| 4 | **high** | frontend | `app/[lang]/chat/markdown-message.tsx:85` (via `message-list.tsx:152`) | `<ReactMarkdown>` re-runs the full remark/micromark pipeline (parse → mdast → hast → React elements) on **every** render. `MessageList` maps over **all** messages with no `memo`, so every completed assistant message is re-parsed on every token of the *new* one. | Reasoned, high confidence. Classic quadratic streaming blowup: cost per token ≈ O(total chars in conversation). A 10-message thread streaming a 500-token reply ≈ hundreds of thousands of redundant markdown parses. **`grep` confirms 0 occurrences of `memo(` and only 2 `useMemo` in all of `app/`.** |
| 5 | **high** | backend | `src/router/index.ts:83` (`await classifyIntent(messages)`) | When `heuristicPillar` finds no keyword, `routeAsync` makes a **blocking `generateObject` LLM call** (`src/router/classifier.ts:87-89`) *before* `streamText` is reached at `app/api/chat/route.ts:494`. `COACH_PATTERNS` is only **9 narrow regexes** (`onboarding`, `checkpoint`, `training`, `playbook`, `meta ad`, `journey`, `coach`, `escalat`, `comprehension`) vs 51 finder patterns — so an ordinary question like *"what documents does a foreign buyer need?"* matches nothing and takes the classifier path. | Reasoned, high confidence. Adds a full Haiku round-trip (~400–1200 ms) of dead air before the first visible token, on the majority of coach messages. **This is the single biggest contributor to "chat feels laggy".** |
| 6 | **high** | frontend | *absence* — 0 `Suspense`, 0 `loading.tsx`, 0 `error.tsx` in `app/` | Every console page is `ƒ` (dynamic) and blocks the **entire** HTML/RSC response on `cookies()` + `verifyIdToken` + all Firestore reads. With no `loading.tsx`, client-side navigation renders **nothing** until the full payload resolves. | Reasoned, high confidence. Makes every nav feel frozen for the full server latency. Cheapest high-impact fix in this list. |
| 7 | med | backend | `src/llm/provider.ts:77` | `modelFor()` does an **uncached** `appConfig/modelConfig` Firestore read on every call. Called at `app/api/chat/route.ts:485` and again inside `classifier.ts:87` — so **2 reads per request** when the classifier fires (#5), for a doc that changes ~monthly. | ~20–60 ms of serial Firestore latency per chat request, ×2. Pure waste. |
| 8 | med | frontend | `app/[lang]/layout.tsx:34,37` | `getMessages()` returns the **whole** catalog and hands it to `NextIntlClientProvider` untouched. | **Measured:** 708 leaf keys / 35.6 KB (en), 37.6 KB (ms), 35.3 KB (zh) serialized into the RSC payload of every route. The chat surface uses one namespace (`chat`); 26 of 27 namespaces are dead weight. |
| 9 | med | frontend | `app/[lang]/(admin)/usage/usage-dashboard.tsx:50`, `app/[lang]/(coach)/_components/metrics-panel.tsx` | recharts imported eagerly in client islands; **no `next/dynamic` anywhere in the repo** (0 hits for `next/dynamic`, `React.lazy`). | **Measured:** recharts = **375 KB** chunk. `/[lang]/(coach)/dashboard` = **1477 KB** total, `/[lang]/(admin)/usage` = **1174 KB** — the two heaviest routes. |
| 10 | med | backend | `app/[lang]/page.tsx:114-117` and `app/[lang]/(admin)/usage/page.tsx:118-121` | `usageRollupsRef().where('day','>=',windowStart).orderBy('day','asc').get()` — **no `limit()`**. Fetches every rollup doc in the window and sums in JS. Rollups are keyed `${day}__${uid}__${pillar}`. | Grows as days × agents × pillars. 7-day window × 100 agents × 3 pillars ≈ 2100 docs read and summed on **every** home-page and usage-page load. Unbounded by design. |
| 11 | med | backend | `app/[lang]/chat/lead-actions.ts:71-88` | **N+1**: `leadsRef().where('ownerUid','==',uid).get()` (no `limit`) then one `leadContextRef().doc(id).get()` **per lead** inside `Promise.all`. | 1 + N Firestore round-trips where `adminDb.getAll(...)` would be 1 + 1. Parallel, so not latency-serial, but it fans out N concurrent reads and is unbounded. Fires whenever the Reply lead-selector opens. |
| 12 | med | frontend | `app/[lang]/chat/load-conversation-messages.ts:40-43` | Loads up to **200** messages with **no `orderBy`** (relies on `mapConversationMessages` to sort client-side), then hands all 200 to `MessageList`. | Selecting a long thread from history triggers 200 simultaneous first-time `ReactMarkdown` parses (#4) in one commit — a visible multi-second freeze on mobile. |
| 13 | low | backend | `src/jobs/runDueJobs.ts:348-362` ← `app/[lang]/chat/page.tsx:51` | `runDueJobs` runs **5 jobs strictly sequentially**, each in its own `adminDb.runTransaction` (line 295) — so ≥5 serial Firestore transactions minimum even when everything is skipped. `usage-rollup` and `erasure-sweep` have 1-hour windows, so they genuinely execute often. | **Not the app-wide blocker it looks like:** `page.tsx:51` calls it as `void triggerDueJobs()` (floating, not awaited), so it does **not** block render. But it does burn the same single-threaded Node event loop as the RSC render + the SSE stream on a 1-vCPU App Hosting instance, and only the chat page triggers it. Real but second-order. |
| 14 | low | backend | `src/rag/search.ts:141-148` | `findNearest(...).get()` with no `.select()` — returns full documents **including the 1024-float `embedding` field** for all 8 hits. | ~8 KB of float64 per doc × 8 docs ≈ 64 KB of payload per retrieval that is immediately discarded (`search.ts:155-168` never reads `embedding`). Adds measurable wire + deserialize time inside the pre-first-token path. |
| 15 | low | backend | `(admin)/layout.tsx:56` + `_lib/require-role.ts:86` | Console pages verify the session token **twice** — once in the route-group layout, once in the page's `requireRole`. | `verifyIdToken` without `checkRevoked` is local crypto against cached JWKS (~1–5 ms), so this is cheap. Noted for completeness; not worth fixing alone. |
| 16 | low | frontend | `app/[lang]/chat/chat-input.tsx:335` | `sendMessage`'s `useCallback` lists `messages` as a dependency, so the callback identity churns on every token, re-firing the suggestion-dispatch `useEffect` below it. | Guarded by `lastSuggestionId` so it's harmless today, but it's a latent footgun and part of the #3 churn. |

---

## Top 5 fixes

### Fix 1 — Split the Firebase client SDK so `signOut` stops shipping Firestore + Storage
**Findings 1 + 2. Highest impact-to-effort ratio in this audit.**

- In `src/firebase/client.ts`, stop initializing all four products at module scope.
  Keep `clientApp` + `clientAuth` eager (they're genuinely shared), and convert
  `clientDb` / `clientStorage` into lazy accessor functions that `await import('firebase/firestore')`
  / `await import('firebase/storage')` on first use.
- Update the only two Firestore consumers (`app/[lang]/chat/conversation-list.tsx:32-33`,
  `app/[lang]/chat/load-conversation-messages.ts:22-23`) and the one Storage consumer
  (`app/[lang]/(admin)/whatsapp-import/whatsapp-import-form.tsx:40`) to `await` the accessor.
- Better still for the sidebar: make `sign-out-button.tsx` call the existing
  `/api/auth/session` route to clear the cookie instead of importing `clientAuth` at all —
  that removes Firebase from the shared console shell entirely.

**Expected win:** removes up to 461 KB uncompressed (~130 KB gzip) from 19–21 routes.
`pdpa-settings` 762 KB → ~300 KB. Large improvement to first load and Time-to-Interactive
on mobile, which is where the "laggy" complaint originates.
**Risk:** low–medium. Auth persistence must stay LOCAL/IndexedDB (`client.ts:58` comment,
AUTH-05) — verify sign-in survives a refresh. Touches the auth path, so it needs the
sign-in / sign-out / chat-send regression pass.

### Fix 2 — Memoize the markdown render and stop the double-render-per-token
**Findings 3 + 4. The fix for "chat itself feels laggy while answering."**

- Wrap `MarkdownMessage` in `React.memo` (`markdown-message.tsx:82`) — it is a pure
  function of `content`. This alone stops every *completed* message being re-parsed on
  every token of the new one.
- Extract the message row into a `memo`'d `MessageRow` component in `message-list.tsx`
  so unchanged rows skip reconciliation entirely.
- Remove the state mirror: `chat-shell.tsx` keeps its own `messages` copy fed by
  `chat-input.tsx:141-143`. Lift the streaming state into a single owner (or a small
  context/store) so a token causes **one** render, not two. Minimum viable version:
  drop `messages` from the `sendMessage` `useCallback` deps (use a ref) and wrap the
  `onMessagesChange` bridge in `startTransition` so token updates are interruptible.
- Optional polish: batch deltas on a ~50 ms `requestAnimationFrame` tick instead of
  calling `setMessages` per delta (`chat-input.tsx:276`).

**Expected win:** turns per-token cost from O(conversation length) into O(1). Should
eliminate the progressive slowdown as a conversation grows, and fix the freeze when a
200-message thread is opened (finding 12).
**Risk:** medium. This is the streaming state machine. Must re-verify: token append
order, the Reply/Finder structured-output decode at `chat-input.tsx:293-319`, history
re-seed on thread select (`:135`), and the suggestion-card dispatch (`:344`).

### Fix 3 — Add `Suspense` + `loading.tsx`, and stop blocking the shell on data
**Finding 6. Cheapest perceived-latency win; near-zero risk.**

- Add `loading.tsx` to `app/[lang]/`, `app/[lang]/(admin)/` and `app/[lang]/(coach)/`
  with a skeleton matching the console shell.
- In `app/[lang]/page.tsx` and `app/[lang]/(admin)/usage/page.tsx`, render
  `ConsoleShell` immediately and wrap the KPI/rollup blocks in `<Suspense>` so the
  sidebar and chrome paint before the Firestore aggregation resolves.
- Add `error.tsx` so a failed Firestore read degrades instead of blanking the route.

**Expected win:** navigation feels instant instead of frozen. Does not reduce actual
server work, but directly addresses the reported symptom on every route.
**Risk:** very low. Purely additive; no behavior change. Note the existing `try/catch`
blocks that swallow read failures (`page.tsx:131`) already keep these non-fatal.

### Fix 4 — Kill the blocking pre-stream LLM classifier call
**Finding 5. The backend half of "chat is slow to respond."**

Pick one (in preference order):
1. **Broaden the heuristic.** `COACH_PATTERNS` (`src/router/heuristic.ts`) has 9 regexes
   against 51 for finder. Since `coach` is already the safe default
   (`heuristic.ts` sync `route()` and `index.ts:85-91` low-confidence branch both
   default to coach), invert the logic: route to `coach` **immediately** unless a
   finder/reply signal matched. The classifier then only runs where it changes the
   outcome — i.e. almost never.
2. **Overlap it.** Start `streamText` on the heuristic guess and only consult the
   classifier for telemetry, accepting the rare mis-route.
3. **Downgrade the model** for `router` in `appConfig/modelConfig` if it isn't already
   the cheapest/fastest available.

Also memoize `modelFor` (finding 7): module-level `Map` + 60 s TTL in
`src/llm/provider.ts:73-88`, keeping the existing `MODEL_FALLBACKS` catch. Keep it a
Firestore read — just not on every request. **Do not hard-code a model ID** (CLAUDE.md
hard constraint).

**Expected win:** removes ~400–1200 ms of dead air before the first token on most coach
messages, plus 2 Firestore reads per request.
**Risk:** medium — it changes routing behavior, which is eval-covered. Must re-run the
router eval / gold sets before shipping, and preserve `routeDecision` observability (D-02).

### Fix 5 — Bound the rollup scans, batch the N+1, and project the vector query
**Findings 10, 11, 14. Straightforward backend cost reduction.**

- `app/[lang]/page.tsx:114` and `app/[lang]/(admin)/usage/page.tsx:118`: add a
  `.limit()` guard, or better, pre-aggregate an org-level daily doc during the existing
  `usage-rollup` job (`src/jobs/runDueJobs.ts:238-247`) so the page reads O(days)
  instead of O(days × agents × pillars).
- `app/[lang]/chat/lead-actions.ts:71-88`: add `.limit()` to the leads query and
  replace the per-lead `leadContextRef().doc(id).get()` with a single
  `adminDb.getAll(...refs)`.
- `src/rag/search.ts:141`: add `.select('text','docId','lang','pillar','category')`
  before `.findNearest(...)` so the 1024-float `embedding` isn't shipped back. Verify
  the `_distance` field still surfaces (`search.ts:164`) — if `select()` strips it,
  use the `distanceResultField` option instead.

**Expected win:** home/usage pages stop degrading as the agent roster grows; ~64 KB
less payload per retrieval inside the pre-first-token path.
**Risk:** low. `getAll` and `.limit()` are mechanical. The `.select()` change needs a
check that `_distance` and citations (`src/rag/citations.ts`) still resolve.

---

## Not a problem

Ruled out with evidence — don't spend time here.

| Suspect | Verdict |
|---|---|
| **Firestore listener leaks / unbounded `onSnapshot`** | **Zero `onSnapshot` calls in the entire repo.** All client reads are one-shot `getDocs` with explicit bounds: `conversation-list.tsx` `limit(50)`, `load-conversation-messages.ts` `limit(200)`. No listeners to leak, no missing cleanup. |
| **Admin SDK re-init per request** | Correctly memoized. `src/firebase/admin.ts:41-42` guards on `getApps().length`, and `initAdmin()` runs once at module scope (`:72`). |
| **Audit logging on the request path** | Correctly deferred. `app/api/chat/route.ts:635` and `:655` both use `after()`, so audit + usage writes land after the response. `src/audit/log.ts:90` is a single `add()`. |
| **Rate limiting read-modify-write per request** | Fine. `src/ratelimit/index.ts:52` is one doc read on the path; `decrement` uses `FieldValue.increment()` (no transaction) and runs in `onFinish` **after** the stream, not before it. |
| **Missing streaming headers / wrong runtime** | All correct. `app/api/chat/route.ts:70` `runtime='nodejs'`, `:71` `maxDuration=90`, `:689` `'X-Accel-Buffering': 'no'`. Uses `toUIMessageStreamResponse()` (the correct method for `ai@5.0.193`) — response is streamed, not buffered. Same for `api/spike/stream/route.ts:30,36,83`. |
| **`proxy.ts` doing work on every request** | Clean. `proxy.ts:38-40` is pure `next-intl` locale routing — no Firestore, no `fetch`, no token verification. The matcher (`:45`) correctly excludes `_next`, `api` and dotted files. |
| **Missing Firestore composite indexes** | `firestore.indexes.json` covers the actual query shapes: `kbChunks (lang,status,embedding@1024)` and `(pillar,lang,status,embedding@1024)` back `src/rag/search.ts:132-148` exactly. The `usageRollups` and `escalations` count queries are single-field (auto-indexed). |
| **`findNearest` unbounded / wrong dimension** | Bounded and correct. `FIND_NEAREST_LIMIT = 8` (`src/rag/search.ts:80`), 1024-d matching the index, equality-only pre-filters. Only the missing projection is an issue (finding 14). |
| **Server-side heavy libs in the client bundle** | Not present. Fingerprint scan of all client chunks found **no** `pdfjs-dist`, `xlsx`, `mammoth`, `jszip`, `word-extractor`, `date-fns`, `franc-min` or `gpt-tokenizer`. They stay server-side. Only Firebase (461 KB), recharts (375 KB) and react-markdown/micromark (179 KB) reach the browser. |
| **Icon barrel imports** | Fine. All 10 `lucide-react` imports are named (`import { LogOut } from 'lucide-react'`) and tree-shake correctly. |
| **CSS / layout thrash** | Clean. `app/globals.css` is 5 KB with only 3 `@apply`. Zero animations on `width`/`height`/`top`/`left`. 12 `transition-all` usages — cosmetic, not a bottleneck. |
| **`components/ui/chart.tsx` namespace import** | Dead code, harmless. It does `import * as RechartsPrimitive from "recharts"` (which would defeat tree-shaking) but **nothing imports it** — the two chart consumers import recharts directly. Not in the graph; not costing anything. Still worth deleting for hygiene. |
| **Lazy-cron blocking first render** | Investigated as a prime suspect; **it does not block.** `app/[lang]/chat/page.tsx:51` is `void triggerDueJobs()` — floating, never awaited — and it's wired into the chat page only, not a layout. Real cost is event-loop contention (finding 13), not render blocking. |
| **Route segment config** | Correct as-is. All console routes are legitimately `ƒ` (dynamic) because they read `cookies()`. Adding `revalidate` would be wrong here. Next 16 removing implicit fetch caching is not a factor — this app reads Firestore via the Admin SDK, not `fetch`. |

---

## How to measure

### Build + per-route bundle sizes

```bash
cd "/Users/ka.yin.leong/Documents/Personal Development/cy-csaiagent"
npm run build 2>&1 | tail -80
```

**Result: build PASSES (exit 0).** Verbatim output:

```
> cy-csaiagent@0.1.0 build
> next build

▲ Next.js 16.2.6 (Turbopack)
- Environments: .env.local

  Creating an optimized production build ...
✓ Compiled successfully in 23.0s
  Running TypeScript ...
  Finished TypeScript in 16.8s ...
  Collecting page data using 10 workers ...
  Generating static pages using 10 workers (0/69) ...
✓ Generating static pages using 10 workers (69/69) in 341ms
  Finalizing page optimization ...

Route (app)
┌ ○ /
├ ○ /_not-found
├ ƒ /[lang]
├ ƒ /[lang]/agents
├ ƒ /[lang]/agents/[uid]
├ ƒ /[lang]/audit-log
├ ƒ /[lang]/chat
├ ƒ /[lang]/coach-assignment
├ ƒ /[lang]/cohorts
├ ƒ /[lang]/conversations
├ ƒ /[lang]/dashboard
├ ƒ /[lang]/erasure
├ ƒ /[lang]/flags
├ ƒ /[lang]/integrations
├ ƒ /[lang]/inventory
├ ƒ /[lang]/kb
├ ƒ /[lang]/kb/[docId]
├ ƒ /[lang]/model-config
├ ƒ /[lang]/pdpa-settings
├ ƒ /[lang]/roles
├ ƒ /[lang]/sign-in
├ ƒ /[lang]/usage
├ ƒ /[lang]/users
├ ƒ /[lang]/whatsapp-import
├ ƒ /api/auth/session
├ ƒ /api/chat
├ ƒ /api/kb/ingest/process
├ ƒ /api/kb/ingest/upload
└ ƒ /api/spike/stream


ƒ Proxy (Middleware)

○  (Static)   prerendered as static content
ƒ  (Dynamic)  server-rendered on demand
```

> **Note — this is itself a finding for tooling, not for runtime.** The Next 16 +
> Turbopack build prints **no `Size` / `First Load JS` columns**. There is no bundle
> budget visible in CI. Sizes below had to be reconstructed from the build output on
> disk. Consider adding a bundle-size check to CI so regressions like #1 are caught.

### Reconstruct per-route client JS (what the build won't tell you)

```bash
node -e '
const fs=require("fs"),path=require("path");
function size(f){try{return fs.statSync(path.join(".next",f)).size}catch(e){return 0}}
const manifests=[];
(function walk(d){for(const e of fs.readdirSync(d,{withFileTypes:true})){
 const p=path.join(d,e.name);
 if(e.isDirectory())walk(p);
 else if(e.name.endsWith("_client-reference-manifest.js"))manifests.push(p);}})(".next/server/app");
const rows=[];
for(const m of manifests){
  const chunks=[...new Set((fs.readFileSync(m,"utf8").match(/static\/chunks\/[^"\\]+\.js/g)||[]))];
  let t=0; for(const c of chunks) t+=size(c);
  rows.push({route:m.replace(".next/server/app","").replace("_client-reference-manifest.js","").replace(/\/page$/,"")||"/",kb:Math.round(t/1024)});
}
rows.sort((a,b)=>b.kb-a.kb);
for(const r of rows) if(!r.route.includes("/api/")) console.log(String(r.kb).padStart(6),r.route);
'
```

Baseline captured for this audit (KB, uncompressed):

```
  1477  /[lang]/(coach)/dashboard        <- + recharts 375 KB
  1174  /[lang]/(admin)/usage            <- + recharts 375 KB
  1162  /[lang]/chat                     <- + markdown 179 KB
  1072  /[lang]/(admin)/kb
  1055  /[lang]/(admin)/kb/[docId]
   945  /[lang]/(admin)/whatsapp-import
   802  /[lang]/(admin)/cohorts
   796  /[lang]/(admin)/erasure
   795  /[lang]/(admin)/users
   793  /[lang]/(admin)/audit-log
   793  /[lang]/(admin)/roles
   791  /[lang]/(admin)/conversations
   790  /[lang]/(admin)/coach-assignment
   790  /[lang]/(admin)/inventory
   772  /[lang]/(coach)/flags
   769  /[lang]/(coach)/agents
   768  /[lang]
   767  /[lang]/(admin)/model-config
   764  /[lang]/(coach)/agents/[uid]
   762  /[lang]/(admin)/integrations
   762  /[lang]/(admin)/pdpa-settings    <- imports ZERO firebase, ships 461 KB of it
   635  /[lang]/(auth)/sign-in
    95  /_not-found
    95  /
```

**What to look for after Fix 1:** every `/[lang]/(admin)/*` and `/[lang]/(coach)/*`
route should drop by ~461 KB. If `pdpa-settings` is not near ~300 KB, the Firebase
import is still reachable from the shared shell.

### Confirm which library owns which chunk

```bash
# Slow (~2 min) — greps every client chunk. Narrow the glob if impatient.
for f in .next/static/chunks/*.js; do
  grep -qm1 "@firebase/firestore" "$f" && echo "FIREBASE $(( $(stat -f%z "$f")/1024 ))K $f"
  grep -qm1 "micromark"           "$f" && echo "MARKDOWN $(( $(stat -f%z "$f")/1024 ))K $f"
  grep -qm1 "recharts"            "$f" && echo "RECHARTS $(( $(stat -f%z "$f")/1024 ))K $f"
done
```

Baseline: Firebase = one 461 KB chunk (`0ncfa5e~k2ixj.js`, duplicated as
`0qprzdtdlab8x.js`); recharts = 375 KB (`0n.z.~1y4p6_t.js`); react-markdown/micromark
= 179 KB (`14~2ebl-apvh5.js`). Total `.next/static` = 3.9 MB.

### Verify the re-render storm (Findings 3 + 4)

React DevTools → Profiler → **Highlight updates when components render**, then send a
chat message.

- **Before:** every component in the ChatShell tree flashes on every token; commit
  count ≈ 2 × token count; each commit's flamegraph shows `MarkdownMessage` for *all*
  messages, not just the streaming one.
- **After Fix 2:** only the streaming message's `MarkdownMessage` should re-render;
  commit count ≈ token count (or far fewer if delta batching is added).

Quantify the markdown cost directly:

```js
// paste in DevTools console during a stream
performance.getEntriesByType('measure').filter(m => m.name.includes('Markdown'))
```

Or wrap `markdown-message.tsx:85` in a temporary `console.count('md-parse')` and watch
it climb super-linearly with conversation length.

### Verify the classifier stall (Finding 5)

```bash
# Network tab: POST /api/chat -> compare TTFB across two messages.
# A: "what is my onboarding checkpoint"   -> matches COACH_PATTERNS, no classifier
# B: "what documents does a foreign buyer need"  -> no keyword match, classifier fires
```

The delta between A and B is the blocking `classifyIntent` cost. Cross-check by
inspecting the `routeDecision` written to the audit log
(`app/api/chat/route.ts:642`) — a `classifier:` or `low_confidence:` prefix means the
LLM round-trip happened; `heuristic-*` means it didn't. Sample the distribution over
real traffic to size the win.

### Verify Firestore read volume

Firebase console → Firestore → Usage, or add temporary counters. Watch:
- Reads per home-page load (Finding 10) — should be O(days), not O(days × agents × pillars).
- Reads per chat request — expect a drop of 2 after memoizing `modelFor` (Finding 7).
- Reads when the lead-selector opens (Finding 11) — should be 2, not 1 + N.

### Confirm the negative results

```bash
grep -rn "onSnapshot" app src components   # expect: only a doc comment in client.ts
grep -rn "next/dynamic\|React.lazy" app    # expect: no matches (that's the problem)
grep -rn "memo(" app --include="*.tsx"     # expect: 0 (that's the problem)
grep -rn "Suspense" app --include="*.tsx"  # expect: 0 (that's the problem)
find app -name "loading.tsx" -o -name "error.tsx"  # expect: empty
```

---

## Suggested sequencing

1. **Fix 3** (Suspense/loading) — additive, near-zero risk, immediately changes the felt experience.
2. **Fix 1** (Firebase split) — biggest measured win, mechanical, well-bounded regression surface.
3. **Fix 2** (memo + single render owner) — biggest win for the chat surface; needs the most care.
4. **Fix 4** (router) — needs eval re-run, so gate it behind the router gold sets.
5. **Fix 5** (query hygiene) — do alongside any of the above; independent.

Per the global Claim-Before-Start protocol, `.planning/quick/quick-kayinleong-046/CLAIM.md`
should be created and committed before any of these fixes are implemented, and each fix
above is large enough to warrant its own atomic commit with a Regression Report. Fixes 1,
2 and 4 each touch a different critical path (auth, streaming state, routing) and should
**not** be bundled into one commit.
