---
status: complete
claim: quick-kayinleong-095
topic: what the app actually outputs today, per user-facing surface (input to the client UAT plan)
researched: 2026-10-19
method: read-only code + planning-artifact read. NOTHING was run against live Firestore / Anthropic / Gemini / the deployed host. Every behaviour below is what the code says should happen. Treat it as the expected result to test against, not as observed behaviour.
---

# RESEARCH: Surfaces and AI Output Contract (for client UAT)

## 0. Headline findings (the ones that change test design)

1. **The "Reply in: EN/BM/中文" chip does not control the reply language.** `langOverride` only feeds `userLang` (`app/api/chat/route.ts:493`), which goes to the RAG language filter and tools (`route.ts:840,865,869`). It never reaches any system prompt. The answer language comes from the prompt rule "Respond in the same language the agent used" (`src/agents/coach/prompt.ts:91`, `src/agents/finder/prompt.ts:160`, `src/agents/reply/prompt.ts:95`). Expected result: if you type in English with BM pinned, you get an English answer.
2. **Budgets written with "RM" are hidden from the AI.** The PDPA pseudonymizer swaps every `RM<number>` figure for an opaque `<FIN_HASH:…>` token before any model call, for every pillar (`src/audit/pdpa.ts:97`, `:226`, called at `route.ts:533`). "budget RM900k" reaches the Finder as a token it cannot read. "budget 900k" or "1.5mil" passes through. Test the same lead both ways.
3. **When the Coach can't find an answer, it tells the agent their senior coach was notified. Nothing is sent.** The client shows "I couldn't find a D2 knowledge base article for this. Your senior coach has been notified." (`app/[lang]/chat/chat-input.tsx:620-625`). In the live route, though, only the Reply pillar records a knowledge gap (`route.ts:1193-1214`). The Coach path that writes an escalation plus a gap (`src/agents/coach/index.ts:180-191`) is the offline `run()` method, and the route never calls it. So the coach dashboard's knowledge-gap feed will only show Reply gaps.
4. **The onboarding journey never moves and stall alerts don't reflect chat activity.** No code outside definitions and tests calls `touchLastActive` (`src/memory/agentProfile.ts:80`), `commitAdvance` (`src/coach/journey/transition.ts:118`) or `gradeParaphrase` (`src/coach/journey/comprehension.ts:124`). Live Coach is also built with no journey context and no agent uid (`route.ts:868-869`), so `getCurrentCheckpoint` / `getCheckpointContent` are not offered to the model (`src/agents/coach/index.ts:102-115`). Expected results:
   - every agent stays at `onboarding / start`;
   - every agent counts as "stalled" 2 days after provisioning, even if they chat daily (`src/escalation/detect.ts:49-53`);
   - "Where am I in my onboarding?" cannot be answered from real data.
5. **Lead memory doesn't carry across sessions.** The Finder prompt only says a stored profile exists (`src/agents/finder/prompt.ts:75-78`) and never injects the criteria. The slot written back is the stored or baseline criteria, never the turn's parsed criteria (`route.ts:831`, `:1124-1134`). The Reply slot section is equally generic (`src/agents/reply/prompt.ts:51-55`). Re-ranking *within one conversation* still works because the whole transcript is resent each turn (`chat-input.tsx:282`).
6. **Coach and Reply content is engineer-written placeholder material.** These pillars are grounded in 9 `[Example]` seed docs (5 Coach, 4 Reply) written by engineering "pending Derek's review" (`.planning/quick/quick-kayinleong-078/CLAIM.md:30-50`, `docs/kb-seed/`). Testers judging Coach and Reply output quality are judging that placeholder content. (See sibling `RESEARCH-data.md` for corpus state.)
7. **Each tester gets 100 messages per 24h.** The limit is `REQUEST_CAP = 100` and `TOKEN_CAP = 300_000` per user per rolling window (`src/ratelimit/window.ts:22,25,50`). A UAT day can hit it. An admin can reset it on `/users` (quick-049, STATE.md row quick-kayinleong-049).
8. **Long Finder answers may get cut off on the deployed site.** Per the code comment, the current host is Netlify with a hard 30s function ceiling, and a full `projectDetail` answer measured 39.9s on Sonnet 4.6 (`route.ts:1284-1314`). The UI flags this with an amber "cut off" notice (`app/[lang]/chat/message-list.tsx:174-181`).

---

## 1. Surfaces and access

Roles: `'new-agent' | 'senior-coach' | 'admin' | 'read-only'` (`src/firebase/auth.ts:36`). Locales: `/en`, `/ms`, `/zh`, default `en` (`src/i18n/routing.ts:7-8`).

| Surface (URL) | Who can access | What it outputs |
|---|---|---|
| `/[lang]/sign-in` | anyone | Email + password form (`app/[lang]/(auth)/sign-in/sign-in-form.tsx:63`). The copy says "Sign in with your D2 Google account" (`src/i18n/messages/en.json:10`), which is wrong: there is no Google button. |
| `/[lang]` (Home) | new-agent goes straight to `/chat` (`app/[lang]/page.tsx:114-115`). read-only, senior-coach and admin see the console Home (`:118-124`). | KPI tiles and quick actions per role |
| `/[lang]/chat` | **any** signed-in user, regardless of role (`app/[lang]/chat/page.tsx:58-74`; `/api/chat` only does `requireUser`, `route.ts:409`) | The three-pillar AI chat (sections 2 and 4). The console sidebar has no link to it, so coaches and admins must type the URL. |
| `/[lang]/dashboard` | senior-coach, admin (`app/[lang]/(coach)/dashboard/page.tsx:88`) | Downline table, stall inbox, knowledge-gap feed, inline AI correction (`app/[lang]/(coach)/_components/inline-correction-dialog.tsx:5-15`), reply-quality panel, funnel |
| `/[lang]/agents`, `/agents/[uid]` | senior-coach, admin (`(coach)/agents/page.tsx:65`; `[uid]/page.tsx:54-56`) | Agent list and profile (journey stage and checkpoint labels) |
| `/[lang]/flags` | senior-coach, admin (`(coach)/flags/page.tsx:42-44`) | Flagged-conversation queue (review / dismiss) |
| `/[lang]/kb`, `/kb/[docId]` | admin; read-only gets view access (`(admin)/kb/page.tsx:81`; `kb/[docId]/page.tsx:104`) | KB CRUD, versioning, ingest progress, pillar tabs |
| `/[lang]/usage` | admin, read-only (read-only sees no per-agent rows) (`(admin)/usage/page.tsx:115,330`) | Usage analytics, days-to-first-close |
| `/[lang]/conversations` | admin (`(admin)/conversations/page.tsx:58`) | Conversation log, search by agent email, flag a conversation |
| `/[lang]/inventory`, `/leads`, `/users`, `/roles`, `/cohorts`, `/coach-assignment`, `/model-config`, `/audit-log`, `/pdpa-settings`, `/erasure`, `/integrations`, `/whatsapp-import` | admin only (`requireRole` / role checks in each `page.tsx`, e.g. `leads/page.tsx:38`, `model-config/page.tsx:37`) | Admin tooling. `/model-config` publishes a model id per pillar, effective from the next turn (`src/llm/provider.ts:64-69`). |

Nav visibility per role: `app/[lang]/_components/app-sidebar-nav.ts:116-191`.

---

## 2. Per-pillar output contract

### 2.1 Intent router (Auto mode)

| Aspect | Contract | Evidence |
|---|---|---|
| Order | Manual chip wins, then the regex heuristic, then the LLM classifier. If classifier confidence is below 0.5, it goes to Coach. If the classifier throws, it goes to Coach (`classifier_unavailable`). | `src/router/index.ts:39,72-74,77-80,94-111` |
| Precedence | Reply patterns are checked first, then Finder, then Coach | `src/router/heuristic.ts:290-311` |
| Window | Heuristic scans the **last 4 turns, assistant text included** | `heuristic.ts:280-284` |
| Bias | Classifier: "When in doubt, prefer coach" | `src/router/classifier.ts:56` |
| Language | All heuristic keywords are English (e.g. `\bunits?\b`, `\bbudget\b`), so BM and 中文 messages usually fall to the LLM classifier | `heuristic.ts:58-110,117-226` |

Test-worthy consequences, predicted from code:
- **Sticky routing.** Once a Finder answer is in the last 4 turns, a following coaching question can still match Finder words like "unit" or "RM".
- **Coaching questions can land in Finder.** Words like "unit", "property", "condo" or "financing" win over Coach words, e.g. "SOP for bumi units" goes to Finder (`heuristic.ts:96,65,73`).
- **The "lead said …" pattern routes to Reply** (`heuristic.ts:233-240`).

### 2.2 Onboarding Coach

| | Contract | Evidence |
|---|---|---|
| Format | Plain markdown prose with inline `[KB:<chunkId>]` tags. A "Sources:" badge row shows raw chunk IDs, not document titles. "Sources:" is hard-coded English. | `src/agents/coach/prompt.ts:93-97`; `message-list.tsx:185-203` |
| Always | Retrieve before answering D2-knowledge questions, and cite chunk IDs | `prompt.ts:65-69` |
| Never | Generic Malaysian real-estate or financial advice. Decline and redirect when out of scope. | `prompt.ts:83-86` |
| Greetings / "what can you do" | No retrieval and no miss. A short explanation of Coach / Finder / Reply and the Auto chip. | `prompt.ts:56-63` |
| KB miss | One or two sentences: "not in the D2 knowledge base yet", then stop. The client shows the "senior coach notified" toast (see finding 3: nothing is actually sent). | `prompt.ts:98-100`; `route.ts:1363-1366`; `chat-input.tsx:620-625` |
| Paid ads | Says plainly that Meta/Google ads are not part of the D2 playbook. This contradicts COACH-07 ("first Meta ad walkthrough", `REQUIREMENTS.md:52`). | `prompt.ts:75` |
| Journey / comprehension | The prompt mentions checkpoint tools and paraphrase checks, but live Coach has neither the tools nor a journey position (finding 4) | `route.ts:868-869`; `coach/index.ts:102-115` |
| Language | Answers in the user's language. Retrieval always includes English chunks (`lang in [userLang,'en']`), so expect BM/中文 answers translated from English sources. | `prompt.ts:91`; `src/rag/search.ts:6` |

### 2.3 Property Finder

The Finder returns a JSON envelope with **exactly one** of `matches`, `refusal`, `clarifyingQuestion` or `answer` (`src/agents/finder/prompt.ts:183-193`). The client renders each one differently:

| Envelope | What the tester sees | Evidence |
|---|---|---|
| `matches` + server `rows` | A **table** of up to 100 rows with Name, Price, Size, Beds, Tenure, Location, Highlight and a per-row **Details** button. The table shows **no rationale and no collateral**. Price 0 shows "Price not on record"; bedrooms 0 shows "—". | `match-list.tsx:145-154`; `match-table.tsx:140-224`; `search.ts:255`; `en.json:94-99` |
| `matches`, no rows (truncated or older turn) | Cards with rationale, matched-criteria badges and collateral chips | `match-list.tsx:157-167` |
| Details button | Sends "Full details for {name} — projectId: {id}…", which the model answers with `projectDetail` as markdown (layouts verbatim from `unitTypes`; psf shown only as a rate; KB facts cited `[KB:]`) | `en.json:96`; `finder/prompt.ts:170-181` |
| `refusal` | Card headed "No match found" or "Eligibility issue" (hard-coded English), with an explanation that names the area or budget | `match-list.tsx:96-115`; `prompt.ts:188` |
| `clarifyingQuestion` | Plain grey text | `match-list.tsx:81-93` |
| `answer` | Markdown, for questions *about* a project | `match-list.tsx:120-130`; `prompt.ts:163-168` |

What the Finder must always or never do:

| Rule | Evidence |
|---|---|
| **Active projects only.** This is a code gate, not a prompt instruction. | `search.ts:677` |
| Foreign buyers see only `foreignEligible` projects; non-bumi buyers have `bumiQuota` projects excluded | `search.ts:680-687` |
| Affordability ceiling is income × 12 × 4.5, applied only when income is given | `search.ts:177,544-547` |
| Location and maximum price are **hard filters**. It never offers "nothing in X, but here's Y" and never claims "near / close to". | `prompt.ts:120-126` |
| "Klang Valley" / "Greater KL" / 巴生谷 apply **no** location filter | `search.ts:306-312` |
| If buyer segment is unknown, it asks "own stay or invest?" before searching, unless the agent says "just show me" / "no questions". In that case it searches and adds a "Not confirmed: …" line. | `prompt.ts:137,145-150` |
| No generic foreign-buyer price thresholds; MM2H and legal-threshold questions are deferred to D2 sales admin | `prompt.ts:152-155` |
| Never outputs bank-in or account details. "Panel bankers / contractor / reasons to invest" come back as "not on record". | `prompt.ts:178-179` |
| A project that isn't active, asked about by name, leads with "NOT AVAILABLE" | `finder/tools.ts:795-799` |
| If inventory is down, it says the system is "temporarily unavailable" and does not refuse | `finder/tools.ts:117-119`; `prompt.ts:91-95` |
| Answers in the user's language | `prompt.ts:160` |

### 2.4 Reply Assistant

| | Contract | Evidence |
|---|---|---|
| Gate | A lead is **required**. Without one, the lead picker opens and the message is re-sent once a lead is picked. In Auto mode, the server's 400 response opens the picker. | `route.ts:570-575`; `chat-input.tsx:311-323`; `chat-shell.tsx:226-262` |
| Lead source | Leads are created **only by an admin** on `/leads`. The picker lists the signed-in user's own leads, shown as pseudonym labels like `<LEAD_ID:…>`. With no leads it shows "No leads yet — add one before drafting a reply." | `(admin)/leads/actions.ts:188-206`; `chat/lead-actions.ts:71`; `lead-management.tsx:103-111`; `en.json:59` |
| Lead stickiness | Once picked, the lead stays for the whole page session. It is never cleared on New chat and is not shown in the header. | `chat-shell.tsx:99,252` (only setter) |
| Draft card | Shows a category badge, an "Incoming message" quote, an **editable textarea**, SOP-id badges, **Copy draft** (the only egress; there is no send button) and a thumbs-down | `reply-draft-card.tsx:280-340`; `prompt.ts:69` |
| Category badge | Guessed client-side from **English keywords**, so BM/中文 inbounds always show "Cold prospect" | `reply-draft-card.tsx:405-414` |
| Not a client inbound ("hi", or a question to the AI) | `clarifyingQuestion` asking the agent to paste the client's message. No gap is recorded. | `prompt.ts:71-76`; `route.ts:328-361` |
| No SOP | Card "No reply SOP found" saying to draft manually or check with the senior coach. A gap row is written. | `prompt.ts:81`; `en.json:44-45`; `route.ts:1193-1214` |
| Cold prospect | Asks qualifying questions (budget, timeline, area) and **never** pitches a project or price | `prompt.ts:84-86` |
| Objection / financing | Acknowledge, then reframe. Rates and approvals are deferred to the bank. | `prompt.ts:88-90` |
| Language | Follows the language of the pasted message (the "agent's" language) | `prompt.ts:95` |
| History reload | `replyIncoming` is set only on the live turn, so after a reload the "Incoming message" quote is empty | `chat-input.tsx:513`; `conversation-messages-map.ts:88-94` |

### 2.5 Other AI / system output

| Output | Behaviour | Evidence |
|---|---|---|
| Stall nudge | Runs on page visit (lazy-cron) once per 24h for agents inactive 2+ days. Posts a hard-coded **English** assistant message into the `coach-{uid}` thread and opens a `stall` escalation. | `src/jobs/runDueJobs.ts:102-142`; `chat/page.tsx:78` |
| Auto-escalation | Raised after 48h stalled, Mon–Fri 09:00–18:00 Asia/Kuala_Lumpur only | `runDueJobs.ts:162-194`; `src/jobs/workingHours.ts:62-63` |
| "Talk to my coach" | Opens a **`stall`** escalation, deduplicated per agent and reason. The success toast shows even when it was deduplicated. | `app/_actions/chat.ts:101-145`; `src/escalation/handoff.ts:60-69` |
| Inline correction | A coach submits corrected text, which creates a new attributed KB version and re-ingests it. The next Coach answer should reflect it. | `inline-correction-dialog.tsx:5-15` |
| AI disclosure | A modal on first use (localStorage key `d2-disclosure-ack`) plus a persistent footer line | `disclosure-modal.tsx:7-11`; `en.json:25,62-68` |
| PII | Phone, IC, email, `RM` figures and the lead's name are tokenized before the model call. **Tokens are never reversed**, so a draft that echoes them shows `<LEAD_ID:1>` or `<PHONE_HASH:…>` to the agent. | `pdpa.ts:73-97,216-227`; no reverse mapping consumer (grep of `app/`, `src/`) |

---

## 3. Live vs blocked

| Feature | Status | Evidence |
|---|---|---|
| Code for all 5 v1 phases plus phases 6 and 7 | Code-complete | `.planning/ROADMAP.md:252-258` |
| Reply pillar in the chat UI | **Enabled** (`REPLY_PILLAR_ENABLED = true`; re-enabled in quick-076) | `app/[lang]/chat/chat-header.tsx:61`; `.planning/quick/quick-kayinleong-076/CLAIM.md` |
| Firestore rules and indexes deploy (cohorts, flags, audit-log filters) | **Open human gate.** `/flags` and filtered `/audit-log` fail with FAILED_PRECONDITION until it is done. | `.planning/STATE.md:48-52` |
| Live Promptfoo evals, Playwright e2e, Finder pilot provisioning | Open (Phases 3 and 4) | `STATE.md:65-77` |
| BM / 中文 native-speaker sign-off on UI copy | Open | `STATE.md:28`, `:71` |
| Model config in Firestore (no Remote Config IAM needed) | Live | `STATE.md:54-61` |
| Anthropic account credit | Was **out of credit** on 2026-08-28; current status unknown | `.planning/quick/quick-kayinleong-069/CLAIM.md:15-22` |
| Journey state machine, comprehension grading, activity tracking (COACH-03/09, the CDASH-01 stage view) | **Not wired** (finding 4) | see section 0 |
| Coach KB-miss escalation and gap feed (COACH-06, CDASH-03 for Coach) | **Not wired** (finding 3) | see section 0 |
| WhatsApp Business API, auto-send | Out of scope for v1 | `.planning/PROJECT.md:59`; ROADMAP Phase 8 |

Hard-coded English the UAT will see in BM/中文:
- toasts (`chat-input.tsx:264,331,339,341,468,621`);
- refusal headers (`match-list.tsx:109`);
- "Sources:" (`message-list.tsx:192`);
- the truncated notice (`message-list.tsx:179-180`);
- the nudge (`runDueJobs.ts:132`).

---

## 4. Edge behaviours worth a test case

| # | Scenario | Expected per code |
|---|---|---|
| E1 | Coach: an off-topic question (e.g. a recipe or a stock tip) | Polite decline and redirect. No sources. (`coach/prompt.ts:83-86`) |
| E2 | Coach: a D2 question the KB doesn't cover | One- or two-sentence "not in the KB yet" plus the "coach notified" toast (finding 3) |
| E3 | Finder: an area with no stock | Refusal naming the area and offering a next step. No other areas suggested. (`finder/prompt.ts:120-126`) |
| E4 | Finder: "budget RM900k" vs "budget 900k" | May differ (finding 2) |
| E5 | Finder: a sold-out project named directly | "NOT AVAILABLE" up front, never shortlisted (`tools.ts:795-799`) |
| E6 | Finder: a first query with no segment | Clarifying question, then "just show me" makes it search with the "Not confirmed" line (`prompt.ts:137,145-150`) |
| E7 | Finder: a foreign buyer asks about a legal price threshold | Defers to D2 sales admin (`prompt.ts:152-155`) |
| E8 | Finder: Details button on any row | Detail answer about that exact project (`prompt.ts:170-181`). May be truncated on Netlify (finding 8). |
| E9 | Reply: "hi" with Reply pinned | Clarifying question, no gap row (`reply/prompt.ts:71-76`) |
| E10 | Reply in Auto with no lead | Lead picker opens, then the message auto-sends after a pick (`chat-shell.tsx:240-262`) |
| E11 | Reply: two leads, alternating | No cross-lead content. Note the lead can't be switched without reloading (`chat-shell.tsx:252`). |
| E12 | Reply: an inbound with a phone number or IC | The draft must not show tokens. If it does, it shows `<PHONE_HASH:…>` (`pdpa.ts:124`). |
| E13 | Manual chip pinned to Coach, then a property query | Coach answers (override wins, `router/index.ts:72-74`) |
| E14 | Language chip BM, message typed in English | English answer (finding 1) |
| E15 | Mixed BM/English input | Detection uses franc; anything not Malay or Chinese defaults to `en` (`src/i18n/detect.ts`). Answer language is up to the model. |
| E16 | The 101st message in 24h | 429 response plus a toast: "You've reached your daily usage limit. It resets in 24 hours." (`route.ts:428-434`; `chat-input.tsx:335-339`) |
| E17 | Session idle for more than 1h | 401: "Session expired" toast, then redirect to sign-in (`chat-input.tsx:328-334`) |
| E18 | Model or provider error mid-stream | Toast: "The assistant could not finish that response." plus the localized error bubble (`chat-input.tsx:466-475`). A router failure silently goes to Coach (`router/index.ts:94-103`). |
| E19 | Reload or reopen a past conversation | Transcript restored, Finder table restored from the persisted envelope (`conversation-messages-map.ts:71-94`) |
| E20 | Coach inline correction, then the same question again | The new answer reflects the correction (the CDASH-04 loop) |
| E21 | Hero cards | "Draft: loan eligibility…" is pinned to Reply but isn't a client inbound, so expect a lead picker and then a clarifying question. "Pricing for Royal Suites" is pinned to Coach, so a KB miss is likely. (`hero-empty-state.tsx:26-30`; `en.json:26-31`) |

---

## 5. Tester accounts and roles

- **Accounts are email + password**, created by an admin on `/[lang]/users`. That one step creates the Firebase Auth user and sets the role claim (`(admin)/users/actions.ts:119-158`). There is no self-signup and no Google sign-in.
- **What the role decides:**
  - `new-agent` gets an `agentProfiles` doc with `onboarding/start` and an **empty `seniorCoachId`** (`src/firebase/auth.ts:185-194`). It lands on `/chat`.
  - `senior-coach` lands on Home and `/dashboard`.
  - `admin` sees everything.
  - `read-only` sees Home, KB (view only) and Usage.
- **Required setup for coach-side tests:**
  - assign each test agent to a senior coach on `/coach-assignment`, otherwise stalls, handoffs and gaps are written with `seniorCoachId: ''` and no coach dashboard shows them;
  - for Reply, an admin must create at least one lead **owned by the tester's account** on `/leads` (`leads/actions.ts:173-206`).
- A role is re-assigned on `/roles`. Custom claims refresh on the next ID token, so testers should sign out and back in after a role change. (The cookie holds a 1h ID token, quick-059.)

---

## 6. Open questions for Derek

1. Should the BM/中文 chip **force** the answer language (it doesn't today), or is following the agent's own language correct?
2. Are the 9 `[Example]` Coach and Reply seed docs (`docs/kb-seed/`) reviewed, or replaced with real D2 SOPs, before UAT? If not, should Coach and Reply output quality be out of scope for this round?
3. Paid ads: should COACH-07 (Meta ad walkthrough) be formally dropped, since Coach now refuses the topic?
4. Should the UAT cover onboarding journey, stall and KB-miss escalation behaviour, knowing it isn't wired (findings 3 and 4)? Or should those be fixed first?
5. Which host is UAT on (Netlify with a 30s limit, or Firebase App Hosting)? Is the Anthropic account funded?
6. Per-tester daily cap of 100 messages: raise it for UAT, or have an admin reset it on request?
7. Reply drafts: should the draft text ever contain `[SOP:…]` tags? Copy-draft would paste them into WhatsApp. The prompt says "cite the SOP doc ID in every draft" (`reply/prompt.ts:80`).
8. Confirm the working-hours window for escalations (default Mon–Fri 09:00–18:00 KL; `PROJECT.md:108`) and the DSR multiple of 4.5 (`search.ts:177`).
