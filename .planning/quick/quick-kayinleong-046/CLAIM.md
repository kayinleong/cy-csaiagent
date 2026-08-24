# Claim: quick-kayinleong-046
- owner: kayinleong
- session: claude-code
- branch: quick-kayinleong-045-whatsapp-ingest
- started: 2026-08-24
- status: done
- summary: UX motion/perf overhaul + chat history loss on refresh + onboarding router/JSON-leak bugs + admin lead management

## What will change

Four bundled defects reported by the user. Research: `RESEARCH-motion.md`,
`RESEARCH-chat-persistence.md`, `RESEARCH-agents.md`, `RESEARCH-leads.md`,
`RESEARCH-perf.md`. Plan + track ownership: `PLAN.md`.

## User decisions (2026-08-24)

1. **KB content** — code fixes + fix the scrape scripts' `pillar` tagging. Running
   ingestion is a **human action** (needs the user's Gemini key, writes live Firestore).
2. **Coach envelope** — originally "enforce the schema server-side via
   `experimental_output`". **Revised by the user after I surfaced a blocker:**
   `@ai-sdk/anthropic@2.0.80` defaults to `structuredOutputMode:'jsonTool'`, which
   REPLACES the tool list with a synthetic `json` tool and forces `tool_choice`
   (`index.mjs:2484-2486`) — that would have silently killed `retrieveKnowledge`,
   reintroducing the class of bug quick-043 just fixed, and made grounding impossible
   (`extractCitationChunkIds` walks `final.steps[*].toolResults`). The `'outputFormat'`
   escape hatch works only on newer models, and model IDs resolve from Firestore
   `appConfig/modelConfig` at runtime, so an admin could break retrieval from a dropdown.
   **Chosen instead:** drop the envelope; derive citations server-side from real tool
   results.

## What has changed

Seven commits. Executed as four parallel tracks with disjoint file ownership (parallel
agents share one working tree), then two follow-ups once ownership was released.

### Task 1a — UX motion (`225163e`)
Applied the design/motion skills from github.com/emilkowalski/skills (12 skills
catalogued; `animate-expo`/`write-swift` N/A).
- `@theme` easings (`--ease-out-strong` .23,1,.32,1 / `--ease-in-out-strong` / `--ease-drawer`)
  + a `:root` duration scale.
- **Retuned `tw-animate-css`**: `--animate-in`/`--animate-out` defaulted to bare `ease`,
  so all 13 vendored overlay components entered on the wrong curve. Highest
  leverage-to-effort item in the task.
- First `prefers-reduced-motion` guard in the codebase (there was **zero** handling).
- `hover:` additionally gated on `(pointer: fine)`.
- **Live bug found incidentally:** `<Toaster />` was mounted twice (`app/layout.tsx:50`
  + `app/[lang]/chat/page.tsx:65`) → every toast fired twice. Now one.
- First `loading.tsx` / `error.tsx` boundaries in the app (there were **zero**, so every
  navigation blocked on `verifyIdToken` + Firestore with no feedback).

Two RESEARCH-motion.md claims were **wrong and corrected against tailwindcss@4.3.0**:
there is no Tailwind 4 `--duration-*` theme namespace (durations live in `:root`), and
Tailwind 4 *already* wraps `hover:` in `@media (hover: hover)`.
React `<ViewTransition>` deliberately NOT used — it needs Next's vendored React canary;
bare `react@19.2.4` lacks it and it breaks Vitest.

### Task 1b — Performance (`a7754d6`, `4211045`)
- **461 KB of unused Firebase on every console page.** `src/firebase/client.ts` imported
  app+auth+firestore+storage at module scope and `sign-out-button → app-sidebar →
  console-shell` dragged it onto every route-group page. `(admin)/pdpa-settings` imported
  zero Firebase yet shipped 461 KB of it.
- **recharts had no `next/dynamic` boundary anywhere** (375 KB; dashboard 1477 KB).
- **`usageRollups` scans had no `limit()`** (~2100 docs at 100 agents). Bounded;
  `orderBy` unchanged so results are byte-identical below the cap, and both sites
  `console.warn` (counts only) if the cap ever binds rather than silently under-reporting.
- **`COACH_PATTERNS` 9 → 58 regexes**, so ordinary coach questions stop falling through
  to `classifyIntent` — a blocking `generateObject` round-trip worth ~400–1200 ms of dead
  air before the first token.
- **Follow-up (`4211045`):** firestore+storage compile into ONE ~353 KB chunk (probed the
  built chunk directly). `clientDb`/`clientStorage` became async accessors and all three
  call sites migrated. `clientAuth` stays eager — LOCAL/IndexedDB rehydration timing is
  load-bearing (AUTH-05).

### Task 2 + 3 — Chat correctness (`f6350bc`)
- **Raw JSON in the bubble.** Coach prompt now asks for prose. `route.ts` emits the
  authoritative pillar on the stream `start` chunk and citations+`kbMiss` on `finish`,
  derived from real tool results. `chat-input` gates decoding on the **server's** pillar
  — it was gated on `pillarOverride`, which is `undefined` in Auto mode, so no decoder
  ran and Finder/Reply leaked raw JSON too. The `---` trapped in a code block was a
  fence-pairing off-by-one (model opened the fence mid-line).
- **History lost on refresh.** `chat-shell` minted a fresh `chat-<uuid>` every mount and
  `loadConversationMessages` had exactly one call site (the history drawer). Now persists
  the cid and hydrates at mount, after `authStateReady()`. The stored id is read during
  first render, not in an effect, so the persist effect cannot clobber it.
- **Turn lost mid-stream.** Both writes lived in `onFinish`, which the SDK runs from a
  TransformStream `flush` that is skipped on cancel. User message now written before the
  model call; `consumeStream()` forces completion server-side. Deliberately NOT paired
  with `abortSignal`+`onAbort` — only one may own the assistant write.
- **"Didn't respond."** Stream errors arrive as HTTP 200 + an `error` chunk the decoder
  dropped by design → empty bubble, no toast, `isStreaming` latched. Now surfaced.
- **Router stickiness.** NOT quick-041's keyword widening — running the real regexes puts
  that query on `heuristic-coach` with zero finder matches. Hero cards called
  `setPillarOverride` and nothing ever cleared it. The pillar now rides on the suggestion
  for one dispatch; `handleNewConversation` clears the override.
- `authStateReady()` before the first `currentUser` read; 429 copy said "hourly" for a
  24-hour window.
- **kb_miss is a DATA gap, not retrieval.** `to-kb.ts`/`to-kb-ocr.ts` hard-coded
  `pillar:'finder'` for everything, so no coach chunk was ever ingested. Both now take
  `--pillar`. Also added `MIN_SIMILARITY` (`distanceThreshold`) — without it, once the KB
  is populated `limit:8` always returns 8 rows and today's honest `kb_miss` becomes
  confidently-wrong citations — plus `distanceResultField`, which was unset, so `score`
  was silently always the `1` fallback.
- `MarkdownMessage` memo'd (every token re-ran the full remark pipeline for EVERY
  message: cost per token was O(conversation length)); the 2 s `animate-pulse` "Thinking…"
  loop replaced by three 60 ms-staggered dots with a blur-masked asymmetric handoff,
  scoped via `data-latest`.

### Task 4 — Admin Leads (`5e29d7e`)
Reply was unreachable end to end: every piece existed **except a producer** — nothing in
the product ever created a `leads/{id}` doc (the only writer was
`scripts/pdpa-erasure-drill.ts`), so `listLeadsForReply()` always returned `[]`.
- `(admin)/leads` list + create + edit + delete, mirroring `(admin)/cohorts`.
- Create/delete write `leads/{id}` **and** `leadContext/{id}` in one batch — load-bearing,
  because `writeLeadSlot` uses `.update()` (throws NOT_FOUND) and the Reply call site in
  `onFinish` was uncaught. Both slot writes are now also try/caught, so a legacy lead
  can't take the ratelimit decrement, audit row and usage event down with it.
- PDPA: `name` is the pseudonym **label**, phone sha256-hashed inside the Server Action
  (raw never persisted/audited/logged), blank `ownerUid` rejected (would create
  un-erasable orphan PII). Owner picker surfaced explicitly, because `lead-actions.ts:71`
  scopes the chat picker by `ownerUid == verified uid`.
- Nav entry + `adminLeads` namespace at EN/BM/中文 parity + firestore.rules delta + 8 rules specs.

### Follow-up (`ff3b550`)
`error.tsx` shipped copy-free (the ownership split forbade i18n edits). Now has real
`errors.routeError*` copy at trilingual parity.

## Verification

### Automated (all green)
- `npx tsc --noEmit` → **0 errors**
- `npx vitest run` → **851 passed, 197 skipped, 0 failed** (63 files). Baseline was 650
  passed; +201, including 8 new route-metadata/durability specs, 13 new stream-decoder
  specs, 65 new router specs, 32 leads-action specs, 8 leads rules specs.
- `npx eslint app src` → **0 errors** (66 pre-existing warnings, none in changed files).
  The 51 `no-explicit-any` errors under `scripts/` are pre-existing in untracked WIP.
- `npx vitest run src/router` → **131 passed** (was 66). All 22 quick-041 finder cases and
  both coach-regression guards pass **unmodified**.
- Firestore rules against the emulator → **182 passed**.
- `npm run build` → OK, 72 static pages, `/[lang]/leads` compiles.

### Measured, not estimated (manifest script in RESEARCH-perf.md; uncompressed KB)
| Route | Before | After | Δ |
|---|---|---|---|
| `(coach)/dashboard` | 1477 | **637** | −57% |
| `(admin)/usage` | 1174 | **343** | −71% |
| `/[lang]/chat` | 1239 | **889** | −28% |
| `(auth)/sign-in` | 709 | **359** | −49% |
| `(admin)/whatsapp-import` | 987 | **660** | −33% |
| `(admin)/pdpa-settings` | 762 | **303** | −60% |
| ~17 other console routes | 762–802 | **303–346** | ~−60% |

### Browser (dev server on :3100 — port 3000 held by a stale unresponsive process I did
### not touch)
- `/en/sign-in` 200, `/en/chat` 200, `/en` 307 → sign-in. Server log shows a single
  cold-start 500 on the very first request (Turbopack racing the `.next` artifacts my
  `next build` had just written); every request after is 200/307.
- Chat surface renders; **exactly one** `Notifications` region → double-`Toaster` fix
  confirmed live.
- Motion CSS verified in the loaded stylesheets: `--animate-in` resolves to
  `cubic-bezier(.23, 1, .32, 1)` (was bare `ease`), all three easing tokens resolve,
  `@keyframes thinking-dot` present, `[data-slot='thinking']` + `data-latest` rules
  present, `prefers-reduced-motion` block present, **44** rules gated on `pointer: fine`.

### Regression surface audited
- **`onFinish` write ordering.** Moving the user write earlier means a turn whose model
  call then fails leaves a user message with no assistant reply. Accepted and documented:
  it is honest, the PDPA erasure sweep already walks that subcollection, and
  stall-detect tolerates it. `src/memory/conversation.ts:237` `loadRecent` orders by
  `__name__` (auto-ids are not time-ordered) so its "last N" was already arbitrary —
  unchanged in kind. Consumers re-checked: admin conversation viewer, coach dashboard,
  `runDueJobs`.
- **`consumeStream()` changes accounting.** Aborted turns were previously free; they now
  decrement ratelimit and emit audit + usage rows. PDPA-positive, but budget burns
  sooner — which interacts with the deferred `TOKEN_CAP` item below.
- **Decode gating (the risky hunk).** Reply/Finder cards now render in Auto mode where
  they never did. The chain is deliberately exclusive `if/else if` on the server pillar,
  never "try every decoder", because `ReplyOutput`/`FinderOutput` share an all-optional
  `clarifyingQuestion` that would otherwise cross-render one pillar as the other's card.
- **`isHandoffChunk` deprecated, not deleted.** It could only ever fire because the JSON
  envelope was leaking as literal text, and it false-positived on innocent prose. A test
  now documents that flaw. The D-10 toast is re-sourced from server metadata.
- **`experimental_output` NOT added** — see decision 2. `stopWhen: stepCountIs(5)` left
  untouched (quick-043).
- **Firebase lazification** keeps `clientAuth` eager and the singleton identical
  (`initClient()` guards on `getApps().length`), so auth-readiness timing is unchanged.
- **`COACH_PATTERNS` widening**: no catch-alls, zero finder-vocabulary overlap,
  REPLY-first precedence preserved, one test per new pattern.

### Honest gaps — NOT verified
1. **No authenticated click-through.** The chat surface and `(admin)/leads` both require
   a signed-in Firebase session; I will not enter credentials. Needs a human to verify:
   history surviving refresh, no raw JSON in a real turn, the router not sticking after a
   hero-card tap, and creating a lead then drafting a Reply against it without a
   NOT_FOUND in `onFinish`.
2. **Onboarding still cannot answer.** `kb_miss` is a data gap — no `pillar:'coach'`
   chunk exists. Ingestion is the user's to run (`--pillar coach`), and
   `src/coach/journey/config.ts:9` `kbDocIds` are still placeholders.
3. **`MIN_SIMILARITY = 0.35` is unvalidated** — it cannot be tuned against an empty KB.
   `score` now carries the real similarity so the distribution is observable; re-tune
   after ingestion.
4. **BM/中文 copy is machine-assisted** (`adminLeads`, `errors.routeError*`) — needs
   Derek's native sign-off.
5. **The `--pillar` fix in `scripts/scrape-skool/to-kb.ts` and `to-kb-ocr.ts` is
   UNCOMMITTED.** Those files are untracked WIP and not mine to commit.

### Deliberately deferred to their own claims (behavioural changes)
- `TOKEN_CAP = 50_000` per 24 h is too low against `stepCountIs(5)` + RAG
  (`src/ratelimit/window.ts:22-28`). Only the misleading toast copy was fixed here.
- `__session` stores a raw 1-hour ID token under a 14-day `maxAge` with no refresh
  (`app/api/auth/session/route.ts:69-75`), so every Server Action on the chat surface
  fails closed after an hour. This is why the surface can look signed in and do nothing.
- `clientDb`/`clientStorage` are lazy but `src/rag/search.ts` still has **no `tenantId`
  filter** — adding it needs a new composite index deployed FIRST or all retrieval throws
  FAILED_PRECONDITION.
- A bundle-size budget in CI; nothing catches a 461 KB regression today.
