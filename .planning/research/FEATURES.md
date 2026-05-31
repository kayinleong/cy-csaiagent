# Feature Research — D2 Customer-Service AI Agent Platform

**Domain:** Multi-pillar AI coaching + property-matching + reply-drafting platform for a Malaysian real-estate brokerage
**Researched:** 2026-05-31
**Confidence:** HIGH for table-stakes (Intercom Fin, Ada, Sierra, Gong, Structurely all converge), MEDIUM for D2-specific differentiators (informed by category gaps), HIGH for anti-features (strongly supported by PROJECT.md constraints + competitor failure modes)

> **Reading order for downstream consumers (REQUIREMENTS.md, ROADMAP.md):**
> 1. Cross-cutting features (§3) before per-pillar features — they constrain everything.
> 2. Per-pillar feature tables (§4–§8) in order: Coach → Finder → Reply → Admin → Coach-Dashboard.
> 3. Anti-features (§9) — equally load-bearing as table-stakes; they prevent scope creep.
> 4. Dependency graph (§10) → MVP definition (§11) → prioritization matrix (§12).

---

## 1. Method & Comparison Baseline

Feature classification triangulated against five distinct competitor families:

| Family | Reference products | What we borrow |
|---|---|---|
| Generic CS AI | **Intercom Fin**, **Ada**, **Sierra AI**, **Forethought**, **Kustomer IQ** | Escalation patterns, intent routing, conversation persistence, AI-disclosure UX |
| Real-estate AI | **Lofty**, **Structurely**, **OJO Labs**, **Saleswhale** | Lead-criteria capture, property matching, long-tail follow-up patterns |
| Sales coaching AI | **Gong**, **Chorus**, **Salesloft AI Coaching** | Scorecards, downline visibility, top-rep pattern mining, weekly cadence |
| WhatsApp-centric tools | **Yalo**, **Qiscus**, **QuickReply.ai**, native WhatsApp Writing Help | Paste/draft UX, manual-send safety posture, quick-reply templates |
| SEA multilingual chatbots | **Qiscus**, **XIMNET**, **Sebenarnya**, **Dah Reply** | EN/BM/中文 code-switching, Malaysian dialect handling, PDPA posture |

**Critical contextual constraint** (from PROJECT.md): No Cloud Functions, no WABA integration in v1, no auto-send, web-first PWA, two-engineer team, 16-week envelope. Features that violate these are *automatically* anti-features regardless of competitive pressure.

---

## 2. Per-Pillar Feature Inventory Overview

| Pillar | Table-stakes count | Differentiator count | Anti-feature count | Risk profile |
|---|---|---|---|---|
| Pillar 1 — Onboarding Coach | 9 | 4 | 5 | LOW reputational, HIGH pedagogical |
| Pillar 2 — Property Finder | 6 | 5 | 4 | MEDIUM (wrong match wastes lead) |
| Pillar 3 — Reply Assistant | 5 | 4 | 6 | HIGH (wrong reply burns reputation) |
| Admin Web App | 7 | 3 | 3 | MEDIUM (KB rot = silent failure) |
| Senior-Coach Dashboard | 6 | 4 | 3 | LOW (oversight, not customer-facing) |
| Cross-cutting | 11 | 5 | 4 | Foundation — affects all pillars |

---

## 3. Cross-Cutting Features (Foundation — Affects All Three Pillars)

### 3.1 Cross-Cutting Table Stakes

| Feature | Why expected | Complexity | Notes |
|---|---|---|---|
| Single chat surface with pillar routing (intent router) | One-entry-point is required by PROJECT.md; users won't tolerate three apps | MEDIUM | Use lightweight classifier (Claude prompt + keyword heuristics), not a separate ML model. Sticky session per topic, with manual "switch agent" override. Intercom/Ada/Sierra all do this. |
| Persistent conversation history across sessions | Every named competitor has this; users expect "pick up where I left off" | MEDIUM | Firestore per-user thread store; pagination + search. Critical for 11pm-on-phone use case. |
| Conversation search (full-text within own threads) | Table stakes since Intercom Fin / Sierra. Agents will need to find "what did the coach tell me about Mont Kiara last week?" | MEDIUM | Firestore can't full-text natively — use lightweight client-side index or Algolia/Typesense. For MVP, simple substring + tag filter is acceptable. |
| Explicit AI disclosure ("You're talking to an AI") | EU AI Act Article 50 effective Aug 2026; Malaysian best practice; user trust | LOW | Static banner at chat start + reminder in handoff moments. Don't overdo it (anti-pattern: disclaimer on every message). |
| Human handoff / escalation to senior coach | Every competitor (Intercom Fin, Ada, Sierra, Forethought) has this. Required by PROJECT.md cross-cutting list. | HIGH | Three triggers: (a) explicit "talk to a human", (b) repeated failure / frustration detection, (c) topics whitelisted as "always-escalate" (commission disputes, complaints). Context bundle handed to human. |
| Multilingual EN / BM / 中文 with code-switching | 68% BM, 23% Mandarin, English universal in Malaysian business context (Qiscus data). Code-switching is the norm, not the exception. | HIGH | Language detection per-message (not per-session); RAG must retrieve in same language as query; UI strings localized day one. Claude handles this natively but RAG indexing must be multi-language aware. |
| AI confidence display / source citation | Sierra, Ada both expose this. Builds trust. Especially critical for Coach (training claims) and Finder (project facts). | MEDIUM | Cite KB chunk + show "I'm confident" / "I'm not sure" badge. Threshold-based. |
| PDPA-compliant audit logging on client-related conversations | Required by Malaysian PDPA 2026 amendments; explicit PROJECT.md requirement | MEDIUM | Per-conversation log: who, when, model version, KB version, full transcript. 12-month retention default. No client PII in app logs (separated from audit log). |
| Per-user authentication (Firebase Auth) | Required for downline mapping + audit | LOW | Email/password + magic link for low-friction agent onboarding. |
| Conversation export (per-user) | PDPA data-subject-access right (DSAR); explicit request anticipated | LOW | JSON export from user settings. |
| Soft-rate-limiting per user | Cost control + abuse prevention | LOW | Daily token budget per agent, configurable per role. |

### 3.2 Cross-Cutting Differentiators

| Feature | Value proposition | Complexity | Notes |
|---|---|---|---|
| **Lead-context memory shared across pillars** | When the agent has been discussing "Lead Sarah, looking at Mont Kiara, RM800k budget" with the Coach, the Finder should know this without re-asking. **No competitor does this — Lofty/Structurely operate within one pillar.** | HIGH | Per-lead memory object (separate from per-conversation memory). Coach can write "Sarah: budget RM800k, two kids, KL-based". Finder reads from same. **R&D risk**: how to keep memories fresh, resolve conflicts (cf. mem0/Zep state-of-art concerns). Defer to v1.1 — too risky for MVP. |
| **D2 voice/tone calibration as a first-class artifact** | Per Sierra "brand personas" + Ghostwriter pattern. Gong learns from top reps. We codify D2's voice into a prompt artifact reviewed by Derek — not buried in code. | MEDIUM | Versioned `voice_calibration.md` in admin app, applied to all three pillars' system prompts. Updated when Derek hears "this sounds too generic". |
| **Anonymized tone-calibration training samples** | Required by PROJECT.md privacy posture. Differentiator because most competitors silently train on raw transcripts. | MEDIUM | Pipeline that PII-strips conversations before they enter the tone-curation review queue. |
| **Model-agnostic provider abstraction** | Explicit PROJECT.md requirement; not table-stakes externally but is internally. Cost / latency / capability hedging. | MEDIUM | Thin LLM-client adapter (Claude default, OpenAI/Gemini swappable). Don't over-engineer — one abstraction layer, no provider zoo. |
| **Funnel metrics tied to 60-day → 7-10 day target** | This is the core thesis of the product. No competitor tracks ramp-up compression specifically. | MEDIUM | Per-agent: first-meaningful-question day, first-property-match day, first-reply-drafted day, days-to-checkpoint-N. Aggregated to org dashboard. |

### 3.3 Cross-Cutting Anti-Features (Do NOT Build)

| Feature | Why tempting | Why problematic | Alternative |
|---|---|---|---|
| Real-time voice / audio chat | Every CS AI has it; users will ask | Out of scope per PROJECT.md; voice adds latency, transcription cost, privacy headaches, and PDPA recording-consent complexity. Doubles eval surface. | Text-only. Voice graduated to post-pilot if asked. |
| Real-time multi-user collaboration on a thread | Slack/Teams-style "two agents in the same conversation" | Explicitly out of scope per PROJECT.md. Adds presence infra, CRDT complexity, no clear demand. | Single-owner threads; senior coach can *view* but not co-type. |
| WABA / WhatsApp Business API integration | Obvious natural extension; reduces copy/paste friction | Explicitly deferred per PROJECT.md (account safety + reply-quality gating). Premature integration burns reputation if drafts are wrong. | Paste-and-draft v1; WABA only after Phase-4 quality bar proven. |
| Auto-sending of any message to any human | "Just send it" feels efficient | Explicitly excluded by PROJECT.md. One wrong auto-sent reply = lost lead. Reply mistakes are the single highest reputational risk. | Always-suggest-never-send. |

---

## 4. Pillar 1 — AI Onboarding Coach (Ships First)

### 4.1 Table Stakes

| Feature | Why expected | Complexity | Notes |
|---|---|---|---|
| Free-form Q&A grounded in D2 playbooks (RAG) | Baseline AI coach capability; every competitor (Intercom Fin, Sierra, Lofty) does grounded Q&A | MEDIUM | RAG over PowerBoost transcripts + onboarding manuals. Citation required. |
| Onboarding journey state machine (checkpoint tracking) | Coursera/Duolingo set the expectation; new agents need "what's next" | MEDIUM | Firestore-backed per-agent progress doc. Checkpoint = (a) content viewed, (b) comprehension question passed, (c) coach sign-off (optional). |
| Comprehension checkpoints (vs passive viewing) | Required by PROJECT.md; standard pedagogical pattern | MEDIUM | LLM-generated Q&A per content unit, validated against canonical answer with semantic match. Gong's coaching tools have analogous "did the rep absorb the methodology?" checks. |
| PowerBoost playlist navigation | Derek supplies PowerBoost as core content; agents need to play through it | LOW | Embedded video player + ordered sequence; can be a simple Firestore-backed list. |
| Proactive nudge on stall (2+ days behind) | Standard in onboarding-LMS category; explicit PROJECT.md requirement | MEDIUM | Daily scheduled job (Next.js cron via Firebase Hosting scheduled runner — note: no Cloud Functions, so this must run via Vercel-style edge cron or scheduled GitHub Action triggering a webhook, or client-poll on login). **Implementation risk** — flag for Phase 0. |
| Auto-escalate to senior coach after 48h no-response | Standard escalation pattern (Intercom Fin, Sierra) | MEDIUM | Re-uses cross-cutting escalation infra. |
| Explicit AI disclosure | Cross-cutting requirement | LOW | (See §3.1) |
| Human-handoff with full context | Cross-cutting requirement | MEDIUM | (See §3.1). Coach handoff carries full transcript + progress state. |
| Multilingual (EN/BM/中文) | Cross-cutting requirement | HIGH | Coach is the first pillar to validate the multilingual stack; expect dialect surprises from PowerBoost content. |

### 4.2 Differentiators

| Feature | Value proposition | Complexity | Notes |
|---|---|---|---|
| **"Spiral curriculum" — same concept revisited with deeper context** | Generic coaches dump info linearly; D2's value is *teaching* not *informing*. Standard Gong/Chorus coaching wisdom: reps need repetition with variation. | MEDIUM | Same topic asked twice → second answer assumes prior context, goes deeper. Powered by per-user memory of what's been covered. |
| **D2-specific role-play scenarios (objection handling)** | This is the moat — coaching content competitors don't have. Gong/Chorus surface objection patterns *from* calls; we coach objections *before* calls. | MEDIUM | LLM plays a difficult lead; agent practices reply; LLM critiques. Scenario library curated by Derek. |
| **"Knowledge gap" signal emitted to senior-coach dashboard** | When 5+ agents ask the same question the KB can't answer, that's a content gap. Forethought's "Discover" does this for support; we do it for coaching. | MEDIUM | Tag-and-aggregate low-confidence answers; surface to coach + admin. Drives KB updates. |
| **Comprehension checkpoint with *evidence* (agent must paraphrase)** | Multiple-choice is gameable. Forcing free-text paraphrase + LLM semantic match catches the "watched but didn't absorb" pattern. | MEDIUM | More work than MCQ but materially better signal. Differentiator vs every LMS. |

### 4.3 Anti-Features

| Feature | Why tempting | Why problematic | Alternative |
|---|---|---|---|
| Gamification (badges, leaderboards, streaks) | Duolingo pattern; "make learning fun" | Real-estate-agent culture in Malaysia is performance-driven, not game-driven. Senior coaches will find it juvenile. Also: vanity metric trap. | Tangible progress: "you've completed 60% of onboarding, est. 4 days to certification". |
| Coach AI initiating cold conversations daily | Engagement-style nudge "Hi! Want to learn about X today?" | Annoyance / unsubscribe risk; trains agents to ignore notifications | Stall-based nudges only (already in table stakes); user-initiated otherwise. |
| Coach AI giving definitive legal / commission / tax advice | Agents will ask; LLM is happy to answer | Liability + accuracy risk; D2 isn't licensed to give tax/legal advice | Whitelist topics; auto-decline + escalate. Use Sierra-style "guardrails" pattern. |
| Coach AI quoting hard performance numbers ("avg agent closes 4 deals/month") | Looks authoritative, motivating | Hallucination magnet; numbers change quarterly; demoralizes if wrong | Refer to current senior coach for performance benchmarks. |
| LMS-style structured course videos with quizzes-by-section | Familiar pattern; easy to build | Competes with the *chat surface* — defeats single-entry-point thesis | Embed PowerBoost in chat thread, not in a separate "Courses" tab. |

---

## 5. Pillar 2 — AI Property Finder

### 5.1 Table Stakes

| Feature | Why expected | Complexity | Notes |
|---|---|---|---|
| Paste lead criteria → ranked property matches | Core value prop; Lofty / Structurely both do match-ranking | MEDIUM | LLM extracts criteria (budget, area, beds, lifestyle); ranks D2 inventory via structured filter + semantic rerank. |
| Each match includes attached collateral (poster / video / fact sheet) | D2 has poster/video/fact sheet per project; agents *will* send these to leads | MEDIUM | Firestore Storage URLs in project records; rendered as cards with thumbnails. |
| Per-lead context memory within Finder | Generic chat memory doesn't suffice — "the lead" is a stable entity across multiple queries | MEDIUM | Lead object (id, criteria, history of suggestions) created on first criteria-paste; updated on subsequent turns. |
| Re-rank when criteria shift mid-conversation | Real estate criteria are fluid; static answers feel dumb | MEDIUM | When new criteria are detected, re-score the inventory list against updated lead profile. |
| Filtered queries ("which projects have completed VP this year") | Required by PROJECT.md; structured queries on inventory metadata | LOW | Standard Firestore composite-index query. |
| Investment vs own-stay segmentation | Required by PROJECT.md; affects ranking heuristics | LOW | LLM-extracted attribute; pipeline weights yield/rental differently for investment vs lifestyle factors for own-stay. |

### 5.2 Differentiators

| Feature | Value proposition | Complexity | Notes |
|---|---|---|---|
| **Financing-situation factoring** | Most real-estate matchers ignore this. Lofty matches on stated budget; D2 should factor "first-time buyer with EPF withdrawal eligibility" or "investor with 30% cash". | MEDIUM | LLM extracts financing structure as a lead attribute; ranking weights affordability bands accordingly. |
| **"Why this match" explanation per result** | Generic matchers show a score; D2 shows *reasoning* — "matches your budget, walking distance to MRT, completed VP, two-bed unit available". Sierra-style explanation pattern. | MEDIUM | LLM-generated short rationale per match. Cache for cost. |
| **D2-specific lifestyle ontology** (chinese-school-radius, halal-food-density, MRT-feeder-route) | Generic ontologies miss what Malaysian buyers actually filter on. This is hard-to-replicate local knowledge. | HIGH | Per-project metadata curated in admin app. Initial seed by Derek; refined per-criteria-query that fails. |
| **Output format: agent-shareable summary** | Agent will copy this to the lead's WhatsApp. Format must be paste-friendly with embedded asset links. | LOW | "Share to WhatsApp" template per match (or per bundle). |
| **Inventory-freshness staleness flag** | Stale inventory is silent failure. Surface "this project's data is 90 days old" inline. | LOW | Timestamp on every project record, surfaced as a badge in results. |

### 5.3 Anti-Features

| Feature | Why tempting | Why problematic | Alternative |
|---|---|---|---|
| Direct lead-capture (Finder asks the lead questions itself) | Lofty/Structurely do this; "skip the agent" feels efficient | Explicitly out of scope per PROJECT.md ("no public-facing recommender on D2 website" in v1). Cannibalizes agents' role. | Agent-mediated only; the agent talks to the lead, the Finder talks to the agent. |
| Auto-pricing predictions / valuation models | Lofty has CMA features; consultants will ask | R&D-level effort; requires transaction data D2 doesn't own; valuation errors carry legal/regulatory risk | Defer indefinitely; surface only D2's official price band per project. |
| Cross-project competitive comparison (D2 vs Mah Sing vs SP Setia) | "Better recommendation if we know competitors" | Sales-conflict — D2 should never recommend a competitor project. Also: data we don't have / can't trust. | D2 inventory only. |
| Auto-assignment of leads to available agents | Lofty pattern | Explicitly out of scope per PROJECT.md (post-pilot, possibly never) | Manual lead ownership; Finder is per-agent, not per-lead-pool. |

---

## 6. Pillar 3 — AI Reply Assistant

### 6.1 Table Stakes

| Feature | Why expected | Complexity | Notes |
|---|---|---|---|
| Paste incoming WhatsApp → AI-drafted reply | Core value prop; mirrors WhatsApp's native "Writing Help" (Mar 2026) | LOW | LLM with reply-SOP RAG. |
| Edit-and-send loop (never auto-send) | Required by PROJECT.md; account-safety posture | LOW | Copy-to-clipboard explicit; no API integration. |
| Per-lead thread context across parallel conversations | Agents juggle 20+ leads at once; without context, drafts are generic | MEDIUM | Lead-thread Firestore doc; agent picks lead from a list or LLM infers from pasted history. |
| Multi-language draft selection (reply in same language as incoming) | EN/BM/中文 code-switching is the norm in Malaysian property WhatsApp | MEDIUM | Detect incoming language; draft matches. Allow agent to request "draft in BM" override. |
| AI disclosure to internal agent ("This is an AI draft") | Required by PROJECT.md; AI never inserts itself into the agent-lead conversation | LOW | UI is the disclosure — the agent knows they're using a drafter. |

### 6.2 Differentiators

| Feature | Value proposition | Complexity | Notes |
|---|---|---|---|
| **Edit-as-signal feedback loop** | When agents edit a draft heavily, that's the strongest possible signal for SOP refinement. Saleswhale-style "learn from corrections". | MEDIUM | Diff-capture per send; flag drafts with >40% edit distance for SOP review queue. **Privacy gate**: PII-strip before queue. |
| **Tone calibrated to D2 voice (NOT generic AI)** | Generic "Hi Sarah, I hope this finds you well" replies are tells. D2's voice is more direct; agents will reject anything that sounds wrong. | MEDIUM | Voice calibration artifact (see §3.2); few-shot examples curated by Derek; eval gate before any release. |
| **Multiple draft variants per query (formal / casual / brief)** | Sierra-style multivariate. Real-estate replies vary by lead temperature. | LOW | Generate 2–3 variants in one LLM call; agent picks. |
| **SOP-citation per draft** | "Drafted from reply-SOP §3.2 (Negotiation phase)" — builds agent trust and lets them argue back if SOP is wrong | LOW | Cite RAG chunk inline below draft. |

### 6.3 Anti-Features

| Feature | Why tempting | Why problematic | Alternative |
|---|---|---|---|
| WABA integration / auto-send | Removes copy-paste; "real automation" | Explicitly out of scope per PROJECT.md. One wrong auto-send = lost lead + reputational damage. Highest-risk feature in the platform. | Paste-and-draft v1; WABA only post-pilot. |
| AI initiating outbound messages to leads | Structurely's whole model | Explicitly out of scope; D2 wants agent-mediated only. | Agent initiates; AI drafts. |
| Sentiment/emotion analysis of incoming lead message | Sierra/Gong have it | Brittle, easily wrong on multilingual + code-switched messages; risks priming wrong response | Let the agent read the message and judge sentiment themselves. AI drafts based on stated intent, not inferred emotion. |
| Auto-translation between agent's language and lead's language | "Agent only speaks EN, lead speaks BM" | Brittle on Malaysian code-switching; risk of awkward / impolite phrasing in target language; PDPA concern (translation logs) | Agent must speak the lead's language already; Reply Assistant drafts *in* the target language. |
| Memory of "best replies" globally (this draft worked, share it) | Saleswhale-style global pattern mining | Privacy nightmare (cross-tenant data leak risk in shared models); also: best replies are agent-specific and lead-specific | Per-agent reply pattern memory only. |
| Reply timing / send-time recommendation | "Best time to send" features in CRMs | No causal evidence for real-estate; introduces decision-fatigue; agent should send when they want | Agent decides. |

---

## 7. Admin Web App (Knowledge-Base Custodian Tool)

### 7.1 Table Stakes

| Feature | Why expected | Complexity | Notes |
|---|---|---|---|
| KB CRUD in plain language (no engineering) | Required by PROJECT.md; Dify/TypingMind patterns confirm category expectation | MEDIUM | Markdown editor; tag/category management; preview-and-publish flow. |
| Versioning + rollback of KB entries | Standard CMS; bad edits will happen | MEDIUM | Firestore subcollection per entry; restore-from-revision UI. |
| Bulk upload of source documents (PDF, transcripts, scripts) | Derek has stacks of PowerBoost transcripts + project briefs | MEDIUM | File upload to Firestore Storage; async chunking + indexing job. **Implementation note**: chunking job can't be a Cloud Function — must be a Next.js Route Handler or client-driven. |
| RBAC: admin / coach / agent | Standard; required by audit + ops needs | LOW | Firebase custom claims. |
| Project-inventory CRUD (Finder's structured data) | Required to keep Finder fresh | LOW | Firestore form-based editor; lifestyle ontology fields. |
| Reply-SOP editor with preview | Required to keep Reply Assistant grounded | MEDIUM | Markdown + structured templates ("Negotiation phase", "Cold lead", etc). Each SOP linked to RAG chunks. |
| Embedding-index refresh control | Non-engineers need to push KB updates live | MEDIUM | "Publish" button triggers re-embedding; status indicator. Avoid silent staleness. |

### 7.2 Differentiators

| Feature | Value proposition | Complexity | Notes |
|---|---|---|---|
| **Knowledge-gap inbox (driven by Coach low-confidence answers)** | Closes the loop: AI tells Derek what content is missing. Forethought "Discover" pattern. | MEDIUM | Aggregated queue of low-confidence + thumbs-down moments → Derek triages → writes new KB entry. |
| **Eval gate before publish ("does this change break existing answers?")** | Most no-code KB tools let bad edits ship silently. We run a gold-set regression before publishing. | HIGH | 100–300 prompt/response gold set (per Confident AI / Deepchecks pattern); auto-run on KB change; surface regressions before publish. **R&D risk** for the eval framework itself; defer full gating to Phase 4. |
| **Voice-calibration editor with side-by-side preview** | Lets Derek tweak D2's voice prompt and see immediate before/after on canned scenarios | MEDIUM | Versioned voice-calibration artifact + live diff preview using a small set of test prompts. |

### 7.3 Anti-Features

| Feature | Why tempting | Why problematic | Alternative |
|---|---|---|---|
| Visual flow-builder / no-code "agent designer" (Sierra Studio / Ada Playbooks-style) | Looks impressive in demos; "low-code for everyone" | 6-12 weeks of build time, requires a designer, and Derek doesn't want to design flows — he wants to maintain a knowledge base. We don't have a multi-tenant story to justify this surface. | Markdown KB + voice-calibration prompt + structured project inventory. Three artifacts only. |
| Multi-tenant / multi-brand support | "What if D2 wants to white-label this for other brokerages later?" | Adds auth complexity, RBAC sprawl, data partitioning, and pricing model decisions — none in scope | Single-tenant; revisit only if D2 explicitly asks |
| Real-time collaboration on KB edits (Google-Docs-style) | "Two admins editing PowerBoost transcript at once" | Adds CRDT / OT complexity; usage frequency is too low to justify | Last-write-wins + audit log; lock-on-edit if conflicts surface |

---

## 8. Senior-Coach Dashboard

### 8.1 Table Stakes

| Feature | Why expected | Complexity | Notes |
|---|---|---|---|
| Downline list with progress at a glance | Gong/Chorus team-rep table is the reference; PROJECT.md requirement | LOW | Per-agent: % onboarding complete, days-in, last-active, stall flag. |
| Stall alerts (agents 2+ days behind) | Required by PROJECT.md; reuse cross-cutting nudge infra | LOW | Surfaces same signal as agent-side nudge, from coach's POV. |
| Per-agent conversation drilldown (read-only) | Coach needs to see *why* an agent is stalled | MEDIUM | Conversation viewer with full transcript + checkpoint state. **PDPA gate**: audit-log every coach access. |
| Knowledge-gap signals aggregated to dashboard | Required by PROJECT.md; closes loop with admin app | MEDIUM | "Your downline has asked these questions 5+ times in the last week and the AI couldn't answer" — actionable list. |
| In-line AI correction ("the right answer was X") | Coach turns AI errors into KB updates without leaving the dashboard. Forethought-style. | MEDIUM | Correction → feedback queue → admin reviews → KB update. |
| Funnel metrics for downline (days-to-ramp, conversion) | Required by PROJECT.md core thesis | MEDIUM | (See §3.2) |

### 8.2 Differentiators

| Feature | Value proposition | Complexity | Notes |
|---|---|---|---|
| **Coach "ghost mode" — observe a Coach conversation in progress** | Lets senior coach jump in only when needed. Intercom-style supervisor view. | MEDIUM | Real-time conversation read-only stream; PDPA-audited. |
| **Top-rep pattern mining ("agents who closed in <14 days asked these questions")** | Gong's whole pitch, applied to onboarding. Helps identify what fast-rampers do differently. | HIGH | Requires enough graduates to mine patterns; defer to post-pilot. |
| **Weekly digest email to coach (downline summary)** | Standard sales-coaching cadence; 76% of weekly-coached reps hit quota (mysalescoach.com data) | LOW | Scheduled email via SendGrid / Firebase Trigger Email extension. |
| **AI-suggested coaching action per stalled agent** | "Agent X is stuck on objection-handling; suggest 30-min role-play". Differentiator vs static dashboards. | MEDIUM | LLM generates per-agent recommendation from progress + recent Q&A. |

### 8.3 Anti-Features

| Feature | Why tempting | Why problematic | Alternative |
|---|---|---|---|
| Performance scoring / forced ranking of agents | Gong/Chorus scorecard culture | Cultural fit risk in Malaysian brokerage; demotivating; gameable; senior coaches haven't asked for it | Show progress + activity; let coaches judge. |
| Coach can edit agent's chat history | "Fix what the agent saw" | Trust catastrophe; rewrites the past; audit nightmare | Coach can annotate / correct *future* answers via KB update; cannot edit transcripts. |
| Coach-to-coach competitive dashboard ("which coach's downline ramps fastest?") | "Engagement for managers" | Same forced-ranking concerns at coach level | Show coach their own data + org aggregate; not other coaches' data. |

---

## 9. Anti-Feature Summary (Consolidated — Most Load-Bearing for Roadmap)

These should NOT be built — collected here for visibility:

| # | Anti-feature | Pillar | Reason |
|---|---|---|---|
| 1 | WABA / WhatsApp Business API integration | Reply, Coach | PROJECT.md out-of-scope; account safety + quality bar not yet earned |
| 2 | Auto-send any message | Reply | PROJECT.md out-of-scope; reputational risk |
| 3 | Public-facing lead chatbot on D2 website | Finder | PROJECT.md out-of-scope; cannibalizes agents |
| 4 | Auto-assignment of leads to agents | Finder | PROJECT.md out-of-scope |
| 5 | Voice / audio input | All | PROJECT.md out-of-scope; PDPA recording-consent complexity |
| 6 | Real-time multi-user collaboration on a thread | All | PROJECT.md out-of-scope; CRDT complexity, no demand |
| 7 | Native mobile apps | All | PROJECT.md out-of-scope; PWA suffices |
| 8 | Visual flow-builder / no-code agent designer | Admin | Out of scope; not Derek's need; 6–12 wks build |
| 9 | Multi-tenant / white-label | Admin | Single-tenant; no validated demand |
| 10 | Gamification (badges, leaderboards, streaks) | Coach | Cultural mismatch + vanity-metric trap |
| 11 | Cross-tenant "best reply" pattern mining | Reply | Privacy & PDPA red line |
| 12 | Sentiment / emotion analysis of inbound | Reply | Brittle on multilingual; can mislead |
| 13 | Auto-translation between agent and lead languages | Reply | Code-switching brittleness; PDPA |
| 14 | AI legal / commission / tax advice | Coach | Liability + accuracy red line |
| 15 | Reply timing / send-time recommendation | Reply | No causal evidence; decision fatigue |
| 16 | Performance scoring / forced ranking of agents | Coach-Dashboard | Cultural fit; not requested |
| 17 | Coach editing agent transcripts | Coach-Dashboard | Trust + audit catastrophe |
| 18 | Coach-vs-coach competitive dashboard | Coach-Dashboard | Forced ranking, no demand |
| 19 | Lofty/Structurely-style 12-month long-tail follow-up | Reply, Finder | We're agent-mediated; AI doesn't have a relationship with the lead |
| 20 | Auto-pricing / valuation models | Finder | R&D-heavy; regulatory risk |
| 21 | Cross-project competitive comparison (D2 vs SP Setia) | Finder | Conflict-of-interest + data we don't own |

---

## 10. Feature Dependencies

```
[Firebase Auth + RBAC] (cross-cutting foundation)
      ├──> [Per-user thread storage] (cross-cutting)
      │         ├──> [Persistent history] (cross-cutting)
      │         │         └──> [Conversation search] (cross-cutting)
      │         └──> [Audit logging] (cross-cutting, PDPA)
      ├──> [Admin RBAC + KB CRUD] (Admin)
      │         ├──> [KB versioning] (Admin)
      │         ├──> [Embedding index refresh] (Admin)
      │         │         └──> [RAG pipeline] (cross-cutting → all pillars)
      │         └──> [Voice-calibration artifact] (Admin)
      │                   └──> [Tone-calibrated drafts] (Reply, Coach)
      └──> [Downline mapping] (Coach-Dashboard)
                └──> [Senior-coach dashboard] (all dashboard features)

[RAG pipeline] ──> [Coach Q&A] ──> [Comprehension checkpoints]
                                    ──> [Knowledge-gap signal]
                                              └──> [Coach-dashboard gap inbox]
                                              └──> [Admin gap inbox]

[Intent router] ──> [Single chat surface]
       ├──> [Coach pillar]
       ├──> [Finder pillar]
       │       └──> [Per-lead memory] ──enhances──> [Coach lead context]
       └──> [Reply pillar]
               └──> [Per-lead thread]
               └──> [Edit-as-signal feedback]
                          └──> [SOP refinement queue] (Admin)

[Human-handoff infra] ──requires──> [Audit logging] + [Coach-dashboard ghost view]

[Eval framework / gold set] ──gates──> [KB publish]
                                ──gates──> [Voice-calibration update]
                                ──gates──> [Model swap]

[Multilingual RAG] ──blocks──> [Any non-EN content in any pillar]
                  ──conflicts──> [Sentiment analysis] (brittle on code-switch — anti-feature anyway)

[Lead-context memory shared across pillars] ──requires──> [Per-lead memory in Finder]
                                              + [Reply per-lead thread]
                                              + [Coach per-user memory]
                                            (defer to v1.1 — R&D risk per mem0/Zep state-of-art)
```

### Dependency Notes

- **RAG pipeline blocks everything content-grounded.** Must be in Phase 0 / 1.
- **Multilingual is not a v2 feature.** It must be baked into the RAG pipeline from day one — retrofitting language support causes index rebuilds + retrieval-quality regressions.
- **Eval framework is the most underestimated dependency.** Without a gold set + regression gate, KB edits ship silently broken; voice-calibration changes regress unpredictably. Start the gold set in Phase 0 even if the harness is minimal.
- **Audit logging must precede any pilot.** PDPA non-negotiable; retrofit is painful.
- **Cross-pillar lead memory is enhancement-not-requirement.** Each pillar must work standalone before they share state.
- **Voice-calibration artifact must precede Reply Assistant.** Generic tone is the #1 failure mode users will notice.
- **No Cloud Functions constraint cascades into scheduled work** (nudges, embedding refresh, eval runs). All async work must be Next.js Route Handlers + client-driven or external cron pinging webhooks. Surface this in Phase 0.

---

## 11. MVP Definition

### Launch With (v1 — Phase 1 Coach MVP, 5–10 pilot agents)

Ruthless cut: only Coach pillar + the cross-cutting bones it needs.

- [ ] Firebase Auth + email login + agent/coach/admin roles
- [ ] Single chat surface (Coach pillar only; intent router not yet needed)
- [ ] AI Onboarding Coach: RAG-grounded Q&A in EN/BM/中文 over PowerBoost + onboarding playbooks
- [ ] Onboarding journey state machine + checkpoint tracking
- [ ] Comprehension checkpoints (free-text paraphrase + LLM semantic match)
- [ ] AI disclosure banner
- [ ] Human-handoff to senior coach (manual escalation; auto-escalate-on-48h-stall can come in v1.1)
- [ ] Persistent conversation history + per-user thread storage
- [ ] PDPA audit logging on every conversation
- [ ] Admin app: KB CRUD (markdown) + RBAC + project-inventory editor scaffold (not used yet)
- [ ] Senior-coach dashboard: downline list + stall alerts + read-only conversation drilldown
- [ ] Minimal eval gold set (50 prompts) + manual regression check before any release
- [ ] Voice-calibration artifact (versioned; reviewed weekly by Derek)
- [ ] Funnel metrics: days-since-signup, % onboarding complete, last-active

### Add After Validation (v1.x — Phases 2 & 3)

- [ ] **Intent router** — needed once Finder + Reply pillars enter the same chat surface
- [ ] **AI Property Finder** (Phase 2) — full §5 table-stakes + financing-factoring + "why this match" + lifestyle ontology
- [ ] **AI Reply Assistant** (Phase 3) — full §6 table-stakes + edit-as-signal + multi-variant drafts + SOP citation
- [ ] Per-lead context memory (Finder + Reply)
- [ ] Proactive nudge + 48h auto-escalation (once cron pattern is settled)
- [ ] Multilingual UI copy localization
- [ ] Conversation search (full-text)
- [ ] Knowledge-gap inbox (admin + coach)
- [ ] Coach in-line AI correction
- [ ] Coach weekly digest email
- [ ] Expanded gold set (100–200 prompts) + automated regression on KB publish
- [ ] D2-specific role-play scenarios (Coach)
- [ ] Spiral-curriculum revisit pattern (Coach)

### Future Consideration (v2+ — Post-Phase 4)

- [ ] Cross-pillar lead-context memory (R&D risk; mem0/Zep landscape immature)
- [ ] WABA integration (gated on quality bar; PROJECT.md graduation milestone)
- [ ] Coach ghost-mode (real-time observation)
- [ ] AI-suggested coaching actions per stalled agent
- [ ] Top-rep pattern mining (requires enough graduates to mine)
- [ ] Inventory freshness staleness flag (low priority until inventory size grows)
- [ ] Tamil language (if Malaysian Indian demographic emerges as material customer base)
- [ ] Eval framework full gating with confidence intervals (Deepchecks/Confident-AI integration)

---

## 12. Prioritization Matrix (Top 25 Features)

| Feature | User value | Implementation cost | Priority | Phase |
|---|---|---|---|---|
| RAG pipeline (multilingual-aware) | HIGH | HIGH | P1 | 0/1 |
| Firebase Auth + RBAC | HIGH | LOW | P1 | 0 |
| Per-user thread storage + history | HIGH | MEDIUM | P1 | 1 |
| Coach RAG Q&A | HIGH | MEDIUM | P1 | 1 |
| Onboarding journey state machine | HIGH | MEDIUM | P1 | 1 |
| Comprehension checkpoints (paraphrase + semantic match) | HIGH | MEDIUM | P1 | 1 |
| AI disclosure banner | HIGH | LOW | P1 | 1 |
| Human-handoff (manual) + context bundle | HIGH | MEDIUM | P1 | 1 |
| PDPA audit logging | HIGH | MEDIUM | P1 | 0/1 |
| Admin KB CRUD + versioning | HIGH | MEDIUM | P1 | 1 |
| Senior-coach downline + stall alerts | HIGH | LOW | P1 | 1 |
| Voice-calibration artifact | HIGH | MEDIUM | P1 | 1 |
| Minimal eval gold set | HIGH | MEDIUM | P1 | 1 |
| Intent router | HIGH | MEDIUM | P2 | 2 |
| Finder: paste criteria → ranked matches | HIGH | MEDIUM | P2 | 2 |
| Finder: per-lead context memory | HIGH | MEDIUM | P2 | 2 |
| Finder: collateral attachment | HIGH | LOW | P2 | 2 |
| Finder: lifestyle ontology | HIGH | HIGH | P2 | 2 |
| Reply: paste → draft (manual send) | HIGH | LOW | P2 | 3 |
| Reply: per-lead thread context | HIGH | MEDIUM | P2 | 3 |
| Reply: voice-calibrated tone | HIGH | MEDIUM | P2 | 3 |
| Reply: edit-as-signal feedback | MEDIUM | MEDIUM | P2 | 3 |
| Knowledge-gap inbox | MEDIUM | MEDIUM | P2 | 3 |
| Auto-escalate-on-48h-stall | MEDIUM | MEDIUM | P2 | 2 |
| Coach in-line AI correction | MEDIUM | MEDIUM | P2 | 3 |
| Conversation search | MEDIUM | MEDIUM | P3 | 4 |
| Coach ghost-mode | MEDIUM | MEDIUM | P3 | 4+ |
| Cross-pillar lead memory | HIGH | HIGH (R&D) | P3 | post-4 |

---

## 13. Competitor Feature Cross-Reference

| Feature | Intercom Fin | Sierra | Ada | Lofty | Structurely | Gong/Chorus | Our approach |
|---|---|---|---|---|---|---|---|
| Single chat surface | Yes | Yes | Yes | Partial | Yes | n/a | Yes — intent router, sticky topic |
| RAG over org content | Yes | Yes (Ghostwriter) | Yes (with caveats — non-EN translates from EN) | Yes | Yes 2.0 | n/a | Yes — native multilingual, not translate-from-EN |
| Auto-escalate on frustration | Yes (non-billable) | Yes | Yes | No | Limited | n/a | Yes — explicit triggers only (frustration detection is brittle) |
| Multilingual native | 50+ langs | 30+ langs (Ghostwriter) | 50+ langs (caveats) | Limited | English-first | English-first | EN/BM/中文 native, code-switching aware |
| Voice/tone calibration | Persona settings | Brand personas + guardrails | Persona settings | Limited | Limited | Top-rep mining | Versioned artifact + eval gate |
| Edit-as-signal feedback | Limited | Yes (Workspaces) | Limited | Limited | Yes | Yes (call-pattern mining) | Yes — diff-based; >40% edit triggers SOP review |
| KB regression gating before publish | No | Multivariate testing | No | No | No | No | Yes (differentiator) |
| Human-handoff with full context | Yes | Yes | Yes | Yes | Limited | n/a | Yes |
| Per-lead persistent memory | Per-customer | Per-customer | Per-customer | Per-lead | Per-lead | Per-account | Per-lead, cross-pillar (deferred) |
| Coaching content (objection role-play) | n/a | n/a | n/a | n/a | n/a | Top-rep pattern mining | Yes — proactive scenarios (differentiator vs Gong's reactive mining) |
| Cross-tenant data pooling | Yes | Yes | Yes | Yes | Yes | Yes | **No (PDPA + privacy red line)** |
| Auto-send / direct lead messaging | Yes (with controls) | Yes | Yes | Yes | Yes | n/a | **No (explicit anti-feature)** |

---

## 14. Cross-Cutting Concern Resolution

| Concern | Decision | Rationale |
|---|---|---|
| **AI disclosure UX** | Static banner at thread start + "AI draft" label on every Reply Assistant suggestion + handoff disclosure ("a human is now joining"). No per-message disclaimer (annoyance + EU AI Act Article 50 doesn't require it). | Best practice per markswebb / agentmodeai 2026 patterns. |
| **Human-handoff thresholds** | (a) Explicit user request, (b) 3 consecutive low-confidence answers, (c) Whitelisted topics (commission, complaints, legal, tax). NO sentiment/frustration trigger — brittle on multilingual. | Borrowed from Intercom Fin's explicit triggers; rejected Sierra's emotion-detection trigger. |
| **Conversation history persistence + search** | All threads persisted indefinitely (subject to 12-month default PDPA retention, configurable). Search = substring + tag in v1; full-text v1.x. | PDPA 12-month guidance + user expectation. |
| **Lead-context memory across pillars** | Defer to v1.1+. Each pillar maintains its own per-lead memory in v1; bridge later via a `lead_profile` aggregator. | Tech R&D risk too high for MVP; mem0/Zep ecosystem state-of-art still ships major changes. |
| **Tone / voice calibration** | Versioned `voice_calibration.md` artifact in admin app, applied to all pillars' system prompts. Reviewed weekly by Derek; eval-gated on change. | The most under-recognized failure mode in this category. |
| **Feedback loop** | (1) Thumbs-up/down per AI response. (2) Edit-as-signal (Reply Assistant diff capture). (3) Coach inline correction (Coach pillar). All flow into a single `feedback_queue` reviewed by admin. | Combines Saleswhale's correction-as-signal with Forethought's gap-discovery. |
| **Quality / regression catching** | Gold set of 50 prompts in Phase 1 → 200 by Phase 4. Manual regression in v1; automated on KB publish in v1.x. Confident-AI / Deepchecks patterns. | Industry standard 2026; non-negotiable for content-grounded systems. |
| **Audit logging** | Every conversation logged with: user, timestamps, model version, KB version, transcript, escalation events. Coach-dashboard read-access is itself audit-logged (who-read-whose-conversation). 12-month default retention. No client PII in app logs (separate, restricted-access log). | PDPA 2026 amendment compliance + Pertama/Shearn Delamore guidance. |

---

## 15. PDPA & Multilingual Implications Per Feature (Summary)

| Feature | PDPA implication | Multilingual implication |
|---|---|---|
| Persistent conversation history | 12-month retention default; DSAR export required | Detect + store per-message language tag |
| Per-lead context memory | PII heavy — Sarah's budget, family size, etc. — must be encrypted at rest; access-logged | Lead criteria may be code-switched; canonicalize fields |
| Audit logging | Required; encrypted; access-controlled; 72-hour breach notification | Logs in native language; no machine translation of audit trail (legal-evidentiary integrity) |
| Coach dashboard read-access | Each access logged; PDPA Security Principle | n/a |
| Tone-calibration training samples | PII-strip before review queue; explicit consent for inclusion | Sample diversity across EN/BM/中文 mandatory |
| Knowledge-gap inbox | Aggregated; PII-strip queries before showing to admin | Cluster queries by intent across languages |
| Edit-as-signal queue | PII-strip diffs; explicit consent in agent ToS | Diffs preserve language; don't auto-translate |
| Funnel metrics | Aggregated; per-user metrics restricted to coach-of-record + admin | n/a |
| Conversation search | Search-within-own only by default; coach can search downline transcripts (audit-logged) | Multilingual tokenization; BM/中文 word-boundary handling |

---

## Sources

**Generic CS AI:**
- [Intercom Fin AI Agent — escalation guidance](https://www.intercom.com/help/en/articles/12396892-manage-fin-ai-agent-s-escalation-guidance-and-rules)
- [Intercom Fin AI guide 2026 (myaskai)](https://myaskai.com/blog/intercom-fin-ai-agent-complete-guide-2026)
- [Sierra AI guide 2026 (myaskai)](https://myaskai.com/blog/sierra-ai-complete-guide-2026)
- [Sierra constellation of models](https://sierra.ai/blog/constellation-of-models)
- [Ada AI multilingual KB analysis (eesel)](https://www.eesel.ai/blog/ada-cx-review)
- [Ada platform](https://www.ada.cx/platform/)
- [Forethought AI guide 2026 (myaskai)](https://myaskai.com/blog/forethought-ai-complete-guide-2026)
- [Kustomer IQ AI agents overview](https://www.kustomer.com/resources/blog/ai-customer-service-agents/)
- [Best multilingual AI agents 2026 (Fin)](https://fin.ai/learn/best-multilingual-ai-agents-customer-service)

**Real-estate AI:**
- [Lofty review 2026 (AgentAdvice)](https://www.agentadvice.com/lofty-review/)
- [Lofty Homeowner Agent launch (Inman)](https://www.inman.com/2026/04/03/lofty-launches-ai-tool-to-turn-crm-contacts-into-seller-leads/)
- [Structurely](https://www.structurely.com/)
- [Structurely deep-dive (Skywork)](https://skywork.ai/skypage/en/Structurely-&-Aisa-Holmes:-My-Deep-Dive-into-the-AI-That's-Reshaping-Real-Estate-Sales/1976503235370872832)
- [Conversational AI for real estate (Crescendo)](https://www.crescendo.ai/blog/conversational-ai-for-real-estate)
- [AI for real estate agents 2026 (Bounti)](https://bounti.ai/blog/ai/ai-for-real-estate-agents-2026-complete-guide)
- [OJO Labs (Silverton)](https://www.silvertonpartners.com/portfolio/ojo-labs/)
- [Saleswhale (Capterra)](https://www.capterra.com/p/159601/Saleswhale/)

**Sales coaching:**
- [Gong vs Chorus 2026 (Cirrus Insight)](https://www.cirrusinsight.com/gong-vs-chorus)
- [AI-driven call coaching 2026 (Quantum Leap)](https://www.thequantumleap.business/blog/ai-driven-call-coaching-2026-capabilities-use-cases-trends)
- [Sales coaching statistics 2026 (mysalescoach)](https://www.mysalescoach.com/blog/sales-coaching-statistics-2026)
- [7 best AI sales coaching tools (Nooks)](https://www.nooks.ai/blog-posts/7-best-ai-tools-for-sales-team-coaching-in-2026)

**WhatsApp-centric:**
- [WhatsApp AI-drafted responses (TechCrunch)](https://techcrunch.com/2026/03/26/whatsapp-can-now-draft-ai-generated-responses-based-on-your-conversations/)
- [Automate WhatsApp customer service AI 2026 (Darwin)](https://blog.getdarwin.ai/en/automate-whatsapp-customer-service-ai-2026)
- [WhatsApp AI agent 2026 (Yalo)](https://yalomedia.com/en/crm/whatsapp-ai-agent-guide/)
- [Best AI tools for WhatsApp 2026 (Jestor)](https://blog.jestor.com/best-ai-tools-whatsapp-customer-service-2026/)
- [WhatsApp AI support (Meta)](https://faq.whatsapp.com/1083092416402722)

**Multilingual SEA:**
- [Multilingual chatbot guide for Malaysia/SEA (Qiscus)](https://www.qiscus.com/en/blog/multilingual-chatbot/)
- [AI chatbot Malaysia comprehensive guide (Axrail)](https://www.axrail.ai/post/ai-chatbot-malaysia-comprehensive-guide-to-cost-features-vendor-comparison)
- [Sebenarnya multilingual chatbot launch (TechNave)](https://technave.com/gadget/Sebenarnya-Chatbot-launches-in-Malaysia-supports-queries-in-English-Bahasa-Malaysia-Mandarin-and-Tamil-41362.html)

**PDPA / Compliance:**
- [PDPA Malaysia AI compliance (Pertama Partners)](https://www.pertamapartners.com/insights/malaysia-pdpa-ai-compliance)
- [PDPA Malaysia 2026 amendments (InCorp)](https://malaysia.incorp.asia/blogs/pdpa-malaysia-compliance-2026-new-rules/)
- [PDPA Malaysia compliance (Shearn Delamore)](https://www.shearndelamore.com/whats-new/publications/pdpa-malaysia-compliance-guide/)
- [EU AI Act Article 50 disclosure UX](https://agentmodeai.com/eu-ai-act-article-50-transparency-disclosure/)
- [UX for AI compliance 2026 (Markswebb)](https://markswebb.com/insights/ux-for-ai-compliance-regulatory-ux/)

**Eval / Memory infrastructure:**
- [LLM evaluation frameworks 2026 (Future AGI)](https://medium.com/@future_agi/llm-evaluation-frameworks-metrics-and-best-practices-2026-edition-162790f831f4)
- [LLM regression testing pipeline (TestQuality)](https://testquality.com/llm-regression-testing-pipeline/)
- [Top 7 LLM evaluation tools 2026 (Confident AI)](https://www.confident-ai.com/knowledge-base/compare/best-llm-evaluation-tools)
- [State of AI agent memory 2026 (mem0)](https://mem0.ai/blog/state-of-ai-agent-memory-2026)
- [Best AI agent memory frameworks 2026 (Atlan)](https://atlan.com/know/best-ai-agent-memory-frameworks-2026/)

**RAG admin tooling:**
- [Enterprise RAG 2026 (Keerok)](https://keerok.tech/en/blog/enterprise-rag-building-an-ai-knowledge-base-in-2026/)
- [Best open-source RAG frameworks 2026 (Firecrawl)](https://www.firecrawl.dev/blog/best-open-source-rag-frameworks)

---

*Feature research for: D2 Customer-Service AI Agent Platform (cy-csaiagent)*
*Researched: 2026-05-31*
*Downstream consumers: REQUIREMENTS.md (full REQ-ID list), ROADMAP.md (phase sequencing)*
