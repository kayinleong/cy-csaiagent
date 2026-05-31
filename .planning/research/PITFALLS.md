# Pitfalls Research

**Domain:** Multi-pillar conversational AI platform for Malaysian real-estate sales (Next.js 16 + Firebase, no Cloud Functions; Claude default; PDPA-regulated; WhatsApp paste-and-draft posture)
**Researched:** 2026-05-31
**Confidence:** MEDIUM-HIGH (Firebase + Next.js 16 specifics: HIGH from official docs; multilingual quality + WhatsApp ban patterns: MEDIUM from secondary sources; PDPA cross-border: HIGH from Hogan Lovells / pdp.gov.my)
**Phase legend:** P0 = Phase 0 Foundations · P1 = Coach MVP · P2 = Property Finder · P3 = Reply Assistant · P4 = Hardening

---

## Critical Pitfalls

### Pitfall 1: Hallucinated project inventory (recommending sold-out / hidden units)

**What goes wrong:**
The Property Finder agent confidently recommends Project X to a lead, but Project X is sold out, paused, or has had its bumiputera-quota units already exhausted. The lead views the collateral, gets excited, then learns it's unavailable — reputational damage for the agent and D2.

**Why it happens:**
RAG retrieval doesn't model inventory state; embeddings are computed once when project briefs are ingested and never re-checked at recommend-time. The LLM sees "Project X — luxury condo, RM1.2M" in retrieved context with no status flag, and so it recommends it.

**How to avoid:**
- Project entities are stored in a structured Firestore collection (`projects/{projectId}`) with an explicit `status: 'active' | 'sold_out' | 'paused' | 'hidden'` field, NOT only as embedded text.
- Property Finder uses a **tool call** (`searchProjects({criteria, status: 'active'})`) returning structured records, not a vector-search-only path. RAG fetches descriptive content; the tool enforces availability.
- System prompt: "Never recommend a project unless `status === 'active'`. If retrieved context mentions a project but no `active` record exists, say so explicitly."
- Eval set includes "user asks for a project Derek has marked sold_out" and asserts the agent refuses and offers alternatives.

**Warning signs:**
- Agent recommends a project that returned zero hits in `searchProjects`.
- Derek reports "the AI is still pitching Damansara Heights Tower 2" after he flagged it sold_out.
- Eval regression on the "sold-out refusal" scenario after a prompt change.

**Phase to address:** P2 (Property Finder data model + tool design + eval).

---

### Pitfall 2: Hallucinated D2 SOP content (the Reply Assistant invents reply rules)

**What goes wrong:**
The Reply Assistant drafts a message that sounds like D2 SOP but contradicts an actual SOP — e.g., promises a same-day site visit when the SOP says next-business-day-with-confirmation. The agent, trusting the draft, sends it. The lead arrives expecting a same-day visit. Reputational hit on the agent and D2.

**Why it happens:**
LLM has strong priors about "how good reply assistants sound" from training data. When SOP retrieval is weak (low similarity match, or SOP doesn't cover this scenario), the model fills the gap from priors.

**How to avoid:**
- Reply Assistant system prompt **requires** quoting the retrieved SOP snippet by ID in an internal scratchpad: "Cite SOP-IDs you used; if none apply, say `no_sop_match` and produce a safer, more generic acknowledgement."
- When `no_sop_match` is detected, the UI tags the draft "no SOP matched — review carefully" instead of presenting it as confident.
- Eval set includes adversarial messages where no SOP applies and asserts the agent produces a `no_sop_match` flag.
- Each SOP is stored as a Firestore doc with `sop_id`, `version`, `last_updated_by`, `applies_to: [scenarios]` — retrieval returns IDs, not opaque chunks.

**Warning signs:**
- Drafts cite SOP-IDs that don't exist (check post-hoc in analytics).
- Agents edit drafts to add concrete commitments not present in any SOP.
- LLM-judge eval rates drafts as "high confidence" but ground-truth SOP says "ambiguous."

**Phase to address:** P3 (Reply Assistant). Foundation in P0 (SOP schema with stable IDs).

---

### Pitfall 3: Tone drift — drafts sound like ChatGPT, not D2

**What goes wrong:**
Drafts use phrases ("I'm delighted to assist you today!", "Certainly!", em-dashes everywhere, three-paragraph corporate replies) that real D2 agents would never send. Leads recognize it as AI-generated; the agent's credibility crashes.

**Why it happens:**
Stock instruction-tuned models default to corporate-AI register. Without strong few-shot grounding and explicit anti-patterns, the model regresses to mean.

**How to avoid:**
- Few-shot examples of **real, anonymized D2 reply pairs** in the system prompt (Derek and pilot agents supply 30–50 gold examples per scenario type).
- Explicit anti-pattern list in system prompt: "Never start with 'I'm delighted', 'Certainly', or 'Great question!'. Never use em-dashes. Match the lead's message length within ±50%. Use casual WhatsApp register, not email register."
- LLM-judge eval scored against a "sounds like D2" rubric (length match, casual register, no AI tells), graded by a separate Claude prompt instructed with the anti-patterns.
- Edit-distance telemetry: track how much agents edit drafts; spikes signal tone drift.

**Warning signs:**
- Agents consistently edit drafts (>40% character change before send).
- Pilot agents say "I just rewrite from scratch."
- LLM-judge tone score drops after prompt or model swap.

**Phase to address:** P3 (Reply Assistant). Tone rubric and few-shot library start in P0.

---

### Pitfall 4: Multilingual quality cliff (BM and Mandarin drafts noticeably worse than English)

**What goes wrong:**
English drafts pass review; BM drafts read as machine-translated, Mandarin drafts mix Simplified/Traditional inappropriately or miss Cantonese/Hokkien code-switching that's natural in Malaysian-Chinese WhatsApp culture. Non-English-comfortable agents stop using the product.

**Why it happens:**
- Embedding models are English-first; cross-lingual retrieval (BM query → English SOP) has low recall.
- Claude is strong on Mandarin and competent in BM, but generic prompts don't tell it about Malaysian colloquialisms ("boleh", "lah", "ya", code-switching norms).
- Eval set is English-only, so regressions in BM/Mandarin go undetected.

**How to avoid:**
- Use a multilingual-strong embedding model (verify recall on a BM/Mandarin test set; the Malaysian-specific embedding from Mesolitica or Cohere multilingual-v3 outperform OpenAI ada-002 on BM per arxiv 2402.03053). Test before committing.
- Index every SOP and project brief in all three languages (translate, then have a native speaker review the translation — automated MT is not enough).
- Eval set has parallel English/BM/Mandarin variants of every scenario, scored independently.
- System prompt includes localization examples: "Malaysian-Chinese clients often code-switch — 'ok lah, see you tomorrow can?'. Match the register of the lead's message language."
- Pilot agent group must include at least one BM-primary and one Mandarin-primary agent.

**Warning signs:**
- BM/Mandarin retrieval scores 30%+ lower than English in eval.
- Agents in pilot only use English mode.
- LLM-judge tone scores diverge between languages.

**Phase to address:** P0 (embedding model decision + multilingual eval scaffolding), enforced in P1/P2/P3.

---

### Pitfall 5: Reply Assistant cross-contaminates leads (Lead A's context bleeds into Lead B's draft)

**What goes wrong:**
Agent has 8 parallel WhatsApp threads. They paste a message from Lead B and the Reply Assistant produces a draft referencing Lead A's financing situation or project preference because per-lead context wasn't isolated. Agent sends it. Lead B is confused or offended.

**Why it happens:**
- A naive design uses one chat thread per agent and accumulates context across leads.
- Or: a Firestore "leads" subcollection exists, but the prompt assembly forgets to scope retrieval to `lead_id`.

**How to avoid:**
- Hard isolation: every Reply Assistant invocation requires a `lead_id`. Context retrieval (lead profile, prior messages, agent's notes on this lead) is scoped by `lead_id` in Firestore queries (`agents/{aid}/leads/{lid}/messages`).
- UI shows the active lead's name and last 3 messages prominently — agent visually confirms before pasting.
- Server-side check: refuse to generate a draft if `lead_id` is missing or doesn't exist in the agent's lead subcollection.
- Eval: simulate parallel-lead scenarios; assert no cross-lead reference appears in drafts.

**Warning signs:**
- Drafts contain lead names other than the active lead.
- Agents report "the draft talked about budget but this lead never mentioned budget."

**Phase to address:** P3 (Reply Assistant data model + UI).

---

### Pitfall 6: Firestore Security Rules leak cross-agent or cross-tenant data

**What goes wrong:**
A senior coach (or worse, an agent) can read other agents' conversations, leads, or PII because the security rules use `request.auth.uid != null` without tenant/scope checks. Per Mike Oude Reimer's Sept 2025 disclosure, ~150 top-ranked apps were exposed this way.

**Why it happens:**
- Rules start in "test mode" (allow all) and never get tightened.
- `match /{document=**}` rules that grant any-authenticated-user access.
- `collectionGroup` queries that bypass parent-path scoping.

**How to avoid:**
- Phase 0 ships **deny-by-default** rules. Every read/write requires explicit `request.auth.uid == resource.data.ownerId` (or a defined role check).
- Multi-tenant boundary: `agents/{agentId}/...` and rules check `request.auth.uid == agentId`. Coach access is via a separate `coaches/{coachId}/downline/{agentId}` lookup that the rules verify.
- Use Firestore Rules Unit Tests (`@firebase/rules-unit-testing`) — every rule has a test that asserts unauthorized access is denied. Run in CI.
- No `collectionGroup` query without a corresponding rule that scopes by tenant ID.
- Quarterly audit using the Firestore Emulator + a simulated "attacker" account.

**Warning signs:**
- A query for `db.collection('conversations').get()` returns >0 docs as an unauthenticated user.
- Rules contain `allow read: if request.auth != null;` without further scoping.
- New collections added without corresponding rules + tests.

**Phase to address:** P0 (foundations). Re-audited at every phase boundary.

---

### Pitfall 7: Sending real client PII to Claude in violation of PDPA

**What goes wrong:**
Reply Assistant prompts include the lead's full name, phone number, and message history. Anthropic's API stores prompts for 7 days in US infrastructure (per Anthropic privacy docs, post-Sept 2025 reduction from 30 days). Under Malaysia's Cross-Border Personal Data Transfer Guidelines (PDP, April 2025), this is a transfer that requires either a substantially-similar-law finding or a Transfer Impact Assessment. Without one, D2 is non-compliant.

**Why it happens:**
- "We're just using the API, it's fine" — common misconception.
- No data-flow diagram identifying what PII crosses borders.
- Engineers paste user data into prompts as a convenience.

**How to avoid:**
- Conduct a documented Transfer Impact Assessment (TIA) in Phase 0; valid for 3 years per PDP guidelines.
- Pseudonymize before sending to Claude: replace lead names with `<LEAD_ID:abc123>`, phone numbers with `<PHONE_HASH>`. Reconstitute only client-side after the response.
- Maintain a `pdpa_redacted: true` flag on every outbound LLM call; refuse to send if false in production.
- Audit log every Claude call with `lead_id`, hashed prompt, hashed response, timestamp — never raw PII.
- Evaluate Bedrock-Singapore (ap-southeast-1) as a deployment target since direct Anthropic API has no Asian residency as of May 2026. Bedrock-SG keeps inference in-region. Document this in Key Decisions.
- Document consent: agent onboarding flow includes an explicit "I have my lead's consent to process their messages through an AI assistant" checkbox per lead, stored in Firestore.

**Warning signs:**
- Audit log contains plaintext phone numbers or full names.
- Pen-test of the prompt-assembly module finds PII in the outbound payload.
- No documented TIA when asked by D2 legal or auditor.

**Phase to address:** P0 (TIA + redaction layer). Enforced at every phase.

---

### Pitfall 8: Firestore 1MB document limit hit by long conversation history

**What goes wrong:**
A conversation document stores `messages: [...]` as an array. After ~3 months of active use, an enthusiastic pilot agent's coaching thread has 800 messages with embedded retrieved chunks; Firestore rejects the write at 1 MiB. The app crashes for that user; rolling them back is expensive.

**Why it happens:**
Embedded arrays grow unbounded. Engineers don't model conversation as a subcollection because "messages in an array is simpler."

**How to avoid:**
- Conversations are stored as a parent doc (`conversations/{cid}` — metadata only) and a `messages` **subcollection** (`conversations/{cid}/messages/{mid}`). Subcollection docs don't count against the parent's 1 MiB limit.
- Retrieved RAG context is stored separately in `messages/{mid}/context` subcollection or in Cloud Storage with a reference; never inlined into the message doc.
- Documents have a `size_bytes` field updated on write; a soft alert fires at 800 KB.
- Long conversations are truncated to last-N messages for LLM context; older messages summarized into a single rolling summary doc.

**Warning signs:**
- Any single Firestore doc exceeds 500 KB.
- Write failures with "document too large" in production logs.
- Conversation load time exceeds 2s.

**Phase to address:** P0 (data model). Verified continuously.

---

### Pitfall 9: Cost runaway on Firestore reads as conversation history grows

**What goes wrong:**
Every chat page load fetches the full message history (200+ docs). At 400 agents × 50 sessions/day × 200 reads = 4M reads/day, costing ~$2.40/day on reads alone (well within budget) — but the same pattern in the Coach dashboard fetching downline data without aggregation hits 50× more. Bill arrives.

**Why it happens:**
- Frontend uses `.get()` on entire collections without pagination.
- Coach dashboard reads every message of every downline agent to compute "knowledge gaps."
- Aggregation queries used in client without server-side caching.

**How to avoid:**
- Use Firestore aggregation queries (`count()`, `sum()`, `average()`) instead of fetching docs to count them.
- Maintain denormalized aggregate docs (`coaches/{cid}/downline_summary` updated by triggers — but since no Cloud Functions, update via Server Actions inside Next.js).
- Paginate message history (last 20 messages on load, cursor for older).
- Use Next.js 16 `use cache` directive with `cacheTag` to cache derived aggregates per-coach.
- Budget alert on Firebase project (Google Cloud Billing alert at 50% of expected monthly spend).
- Daily ops dashboard tracks read/write counts by collection.

**Warning signs:**
- Bill jumps >20% week-over-week without user growth.
- p95 dashboard load >3s.
- Firestore reads/day > 10× message volume.

**Phase to address:** P0 (data model); P1 (dashboard); P4 (cost hardening).

---

### Pitfall 10: Embedding 100MB of PDFs in a Next.js Server Action and hitting Firebase Hosting 60s timeout

**What goes wrong:**
Derek uploads the PowerBoost transcripts (50 PDFs, ~120MB total). Admin UX calls a Server Action that embeds them sequentially. Firebase Hosting kills the request at 60 seconds (this is a hard Firebase Hosting limit per docs); Derek gets a 504 and assumes the system is broken. He retries; the system creates duplicate embeddings.

**Why it happens:**
- Heavy lifting attempted inside the request lifecycle.
- No background job pattern because "we don't have Cloud Functions."
- No idempotency check on re-upload.

**How to avoid:**
- Admin UX uploads files to Firebase Storage first (`storage/uploads/{batch_id}/...`); Server Action only records the upload manifest.
- A separate ingestion worker runs **outside Firebase**: a GitHub Actions scheduled workflow (or a small Cloud Run / Vercel cron job — but **not** Firebase Cloud Functions per constraint) polls `manifests/pending` and processes batches.
- Alternative: an "admin-triggered ingestion" pattern where the admin clicks "Ingest" and a long-poll WebSocket / Server-Sent Events keeps them updated; ingestion runs in chunks of <60s each, resumable via a Firestore state doc.
- Idempotency: file hash (sha256) checked before embedding; duplicates skipped.
- Progress UI shows per-file state (`pending`, `embedding`, `complete`, `failed`).

**Warning signs:**
- Any Server Action exceeds 30s in production.
- Re-ingesting the same file creates duplicate vectors.
- Admin UX shows "Loading…" with no progress indicator.

**Phase to address:** P0 (ingestion architecture decision). Built in P0/P1.

---

### Pitfall 11: Cron-without-Cloud-Functions stall detection silently breaks

**What goes wrong:**
The Onboarding Coach is supposed to detect agents stalled 2+ days and nudge them, then escalate to senior coach at 48h no-response. This requires a daily cron job. The team picks a free cron service (e.g., cron-job.org). Six weeks in, the free tier lapses or the service is rate-limited, and stall detection silently stops. Agents stall; coaches don't know. By the time Derek notices, the AI's value proposition is dead in pilot feedback.

**Why it happens:**
- Constraint forbids Cloud Functions, so the team picks the easiest external cron.
- No monitoring on the cron itself (the cron is supposed to monitor the system — but who monitors the cron?).

**How to avoid:**
- Use a paid, reliable scheduler. Options ranked: (1) Google Cloud Scheduler hitting a Next.js Route Handler (~$0.10/job/month, 3 free, doesn't violate "no Cloud Functions" since Scheduler is a separate service); (2) GitHub Actions scheduled workflow with `workflow_dispatch` as backup; (3) Vercel/Render cron if hosting moves there.
- The cron endpoint writes a heartbeat (`system/cron/{job_name}/last_run`) on every invocation.
- A separate watchdog (in the admin UI, on coach dashboard load) reads heartbeats and shows a red banner if any cron has missed its expected window by >2×.
- Cron endpoints are idempotent (use lock tokens in Firestore) so duplicate triggers don't double-nudge.
- Escalation logic stores escalation history (`agents/{aid}/escalations`) so we can detect "should have escalated but didn't" via offline audit.

**Warning signs:**
- Heartbeat doc older than expected window.
- Coach reports "I haven't gotten a stall alert in weeks" (and the team can't confirm whether that's because no one stalled, or because the cron broke).
- Agents in pilot show declining engagement with no alerts firing.

**Phase to address:** P1 (Coach features). Watchdog UI in P1, audit log in P4.

---

### Pitfall 12: Reply drafts look obviously AI-generated and burn agent's reputation with lead

**What goes wrong:**
Lead notices the agent's response style suddenly became formal, used em-dashes, opened with "Certainly!", or used phrases the agent has never used in 6 months of conversation. Lead asks "are you using ChatGPT to talk to me?" Trust evaporates. Agent stops using the tool. Word spreads in the office.

**Why it happens:**
- Tone calibration is generic (see Pitfall 3).
- No per-agent voice profiling — every agent gets the same "D2 voice" instead of their personal voice.
- AI-tells (em-dashes, "I'd be happy to", excessive politeness, "Let me know if…") slip through.

**How to avoid:**
- Per-agent voice fingerprint: at onboarding, the agent provides 10 of their own past WhatsApp replies (anonymized). Stored as `agents/{aid}/voice_samples`. Used as few-shot in their Reply Assistant prompt.
- Anti-pattern detector runs on every draft pre-display: regex/LLM check for em-dashes, "Certainly!", "I'd be happy to", "Let me know if you have any questions", excessive emoji-density relative to lead's message.
- "AI-tell" eval set: 50 messages, asserts none of the anti-patterns appear in drafts.
- Edit telemetry: if an agent's edit-rate exceeds 40% character change, flag in admin dashboard — the tone isn't right for them.

**Warning signs:**
- High edit-rate (>40% character change) on drafts.
- A lead asks the agent about AI use.
- Pilot feedback: "doesn't sound like me."

**Phase to address:** P3 (Reply Assistant). Voice-sample capture in P0/onboarding.

---

### Pitfall 13: Legal-advice slip — AI states things construable as financial/legal advice

**What goes wrong:**
Property Finder, asked "can a Singaporean buy in Bukit Bintang under RM800k?", confidently answers "yes, you can". The actual threshold is RM1M in KL and varies by state, plus state-authority approval, plus 8% stamp duty for foreigners as of Jan 2026. Lead acts on the wrong info. Liability question for D2.

**Why it happens:**
- Real-estate questions blend product knowledge (which D2 has) with legal/regulatory rules (which change). LLM blurs the line.
- No explicit refusal instructions for legal/regulatory questions.

**How to avoid:**
- System prompt: "You are not a lawyer or licensed financial advisor. For questions about foreign-buyer thresholds, bumiputera quota rules, stamp duty, MM2H, loan eligibility, or tax: provide the D2-validated reference if available, then explicitly direct the user to consult a Malaysian solicitor or licensed mortgage advisor. Never give a definitive yes/no on regulatory eligibility."
- A `legal_topics` taxonomy of forbidden-confidence topics. If the user's message matches one, the response template includes a disclaimer block automatically.
- Eval set includes adversarial questions ("can my Indonesian client buy this Penang condo?") and asserts the answer includes a disclaimer + redirect-to-solicitor.
- For known facts (e.g., 2026 stamp duty for foreigners = 8%), source these from a Firestore `regulations` collection with a `last_verified_date` field, and only include in context if `last_verified_date` within 90 days.

**Warning signs:**
- Eval flags responses that give definitive regulatory answers without disclaimers.
- Derek or a coach reports "the AI told my lead they qualify for MM2H but they don't."
- Regulatory collection has stale `last_verified_date` (>180 days).

**Phase to address:** P2 (Property Finder). Legal-topics taxonomy in P0.

---

### Pitfall 14: Bumiputera quota / foreign-buyer rules confusion

**What goes wrong:**
Property Finder recommends a unit in a development to a foreign lead, but that specific unit is part of the bumiputera allocation. Or recommends a Penang island unit at RM600k to a foreign buyer (below the RM1M island threshold). Lead is excited, agent confirms with sales admin, finds out it's not available — bad agent experience and trust hit.

**Why it happens:**
- Project data model has unit-level details but not per-unit eligibility flags.
- Foreign-eligibility rules are state-specific and threshold-based; the LLM doesn't have these reliably.

**How to avoid:**
- Project schema: `projects/{pid}/units/{uid}` with `bumi_reserved: boolean`, `foreign_eligible: boolean`, `state`, `price`. Property Finder filters by lead's nationality + state + price.
- Lead profile schema: `nationality`, `pr_status`, `bumi_status`. Filtering is a tool call, not LLM judgment.
- Edge case: when the lead's nationality is unknown, the agent is prompted to confirm before recommendations are shown.
- Eval set: "Indonesian lead, Penang island, RM600k budget" → asserts no recommendation, with an explanation of the threshold.

**Warning signs:**
- Agent feedback: "the AI suggested a unit I knew was bumi."
- Eval regression on foreign-buyer scenarios.
- Lead nationality field is missing on >30% of active leads.

**Phase to address:** P2 (Property Finder data model).

---

### Pitfall 15: Investment-vs-own-stay segmentation confused

**What goes wrong:**
Lead profile says "investor, looking for rental yield." Property Finder recommends a luxury 2-bed in KL Sentral (high price, low yield) because the lead said "I want something nice." LLM optimized for "nice" instead of yield. Lead disengages — they came for ROI numbers.

**Why it happens:**
- Lead intent is captured but not used to weight recommendations.
- LLM treats criteria as additive ("nice" + "near LRT") rather than profile-conditional ("for an investor, 'nice' means tenant-attractive").

**How to avoid:**
- Lead schema includes `intent: 'investment' | 'own_stay' | 'mixed'`.
- Property Finder system prompt branches: "If `intent === 'investment'`, prioritize gross_yield, rental_demand_signal, completion_status (completed > under-construction). If `own_stay`, prioritize lifestyle fit, school proximity, completion date relative to lead's move-in target."
- Property records include `est_gross_yield`, `rental_demand_signal` fields where Derek has marked them.
- Eval set: parallel investor / own-stay queries with same surface criteria, assert different top-3 recommendations.

**Warning signs:**
- Investors get recommendations identical to own-stay queries with similar surface keywords.
- Pilot agents say "the AI ignores that this is an investor."

**Phase to address:** P2.

---

### Pitfall 16: Over-nudging the agent — they disable notifications, AI becomes useless

**What goes wrong:**
The Onboarding Coach sends 5 nudges per day (morning checkpoint, midday quiz, afternoon SOP review, evening reflection, "you haven't checked in 4 hours"). Agent silences the app. AI now has no engagement signal and no nudge channel.

**Why it happens:**
- Engineers tune nudge cadence by "engagement maximization" intuition, not user research.
- Each nudge type was designed independently; no global cadence governance.

**How to avoid:**
- Global nudge budget: max 2 push notifications/day per agent. In-app nudges (visible only when agent opens the app) unlimited but tracked.
- Per-agent nudge cadence learning: track open-rate; reduce frequency if open-rate <30% over 7 days.
- Snooze controls: "remind me later" / "off for today" / "I'm busy this week, check in Monday."
- Pilot survey explicitly asks: "Are nudges helpful or annoying?" — track on a 1-5 scale weekly.
- Eval: simulate a 14-day agent journey; assert total nudges ≤ 28.

**Warning signs:**
- Push-open rate <20%.
- Pilot feedback: "too many pings."
- Notification permission revocation rate >30%.

**Phase to address:** P1 (Coach features).

---

### Pitfall 17: Under-escalating — agent fails silently, senior coach finds out too late

**What goes wrong:**
Agent is confused on day 3 about objection handling. They ask the Coach AI, get an unhelpful answer (gap in KB), they don't push, they don't ask their senior. Two weeks later, they've quit. Senior coach had no signal.

**Why it happens:**
- Escalation thresholds are tuned conservatively to avoid coach overload.
- No detection of "low-quality interaction" — only of "no interaction."
- AI doesn't flag its own low-confidence answers.

**How to avoid:**
- Self-rated confidence: every Coach response includes an internal confidence score (LLM-judged or based on retrieval similarity). Low-confidence + low follow-up engagement = escalation signal.
- Negative signal definition: 3+ consecutive "thanks" / "ok" / "I'll think about it" without progress on the checkpoint within 48h = stall.
- Coach dashboard shows "agents likely struggling" (heuristic-flagged), not only "agents inactive."
- Test: simulate a series of confused agent messages; assert escalation fires within the threshold.

**Warning signs:**
- Agents drop out of pilot without an escalation having fired on them.
- Senior coach says "I didn't know X was struggling."
- Self-rated confidence <0.5 events not surfaced anywhere.

**Phase to address:** P1.

---

### Pitfall 18: Comprehension checkpoints feel like quizzes; agents game them

**What goes wrong:**
Coach AI asks "what is D2's three-step objection-handling framework?" Agent gets the answer, retypes it, passes. They didn't internalize anything. Subsequent live calls show they can't apply it.

**Why it happens:**
- Checkpoint format mirrors school quizzes.
- LLM grading is keyword-based.

**How to avoid:**
- Scenario-based checkpoints: "A lead says 'it's too expensive.' Type the next thing you'd say in WhatsApp." Then AI critiques: tone, framework alignment, missed opportunities.
- Checkpoint isn't pass/fail; it's a generative practice with feedback.
- LLM-judge evaluates the agent's response against the SOP, gives a rubric score and concrete suggestion. Stores all attempts; coach can review trajectory.
- No "score 100% and unlock the next module" gamification. Use "completed N practices" + senior coach sign-off for unlocking sensitive content.

**Warning signs:**
- Agents complete checkpoints in <30 seconds (suggests copy-paste).
- High checkpoint pass rate, low live-call performance.
- Pilot feedback: "this feels like an exam."

**Phase to address:** P1.

---

### Pitfall 19: KB stale — PowerBoost content updated but RAG index wasn't re-embedded

**What goes wrong:**
Derek records a new PowerBoost session that supersedes an older one ("here's the new objection-handling script — ignore last quarter's"). Derek uploads it. The RAG returns BOTH the new and old transcripts; the LLM blends them; agents get a hybrid answer that doesn't match the actual current script.

**Why it happens:**
- Ingestion adds new content but doesn't deprecate old.
- No version metadata on content.

**How to avoke:**
- Every KB doc has `effective_date`, `supersedes: [doc_ids]`, `status: 'active' | 'deprecated'`.
- Retrieval filters by `status === 'active'`. Deprecated docs remain for audit but never enter context.
- Admin UI requires "this supersedes:" selection when uploading content marked as a replacement.
- Eval: ingest a v1 doc, then a v2 marked as superseding; assert retrieval returns only v2.

**Warning signs:**
- Agents report contradictory answers to similar questions.
- KB collection has multiple active docs covering the same SOP scenario.
- Eval flagging "outdated content" matched.

**Phase to address:** P0 (KB schema) and P1 (admin UX).

---

### Pitfall 20: Coaches feel undermined; adoption fails politically

**What goes wrong:**
Senior coaches see the AI answering questions they used to answer. They feel their role is shrinking. They subtly discourage agents from using it ("the AI doesn't know our edge cases — come to me"). Adoption craters.

**Why it happens:**
- Product positioned as replacing coach work, not augmenting it.
- Coaches not involved in design; have no ownership.

**How to avoid:**
- Frame AI as "extending the coach's reach" — coaches see metrics on time saved, downline progress, knowledge-gap identification. They look more effective, not less.
- Coach dashboard shows "questions the AI escalated to you" — coaches see they're still the authority on hard cases.
- Coaches contribute KB content; their name attached: "From [Coach Name]'s playbook." Agents see coach authorship.
- In-line AI correction: coach can mark an AI response as "off" and submit a fix that becomes a new SOP. Their corrections are credited.
- Senior coaches included in pilot from week 1 as co-designers, not subjects.

**Warning signs:**
- Coaches don't open the dashboard.
- Adoption rate among agents whose senior coach is dismissive is <50% of others.
- KB additions come only from Derek, never from coaches.

**Phase to address:** P0 (coach co-design); P1 (coach dashboard); P4 (sustained adoption).

---

### Pitfall 21: Next.js 16 implicit caching surprise — production API costs spike

**What goes wrong:**
Team migrates from Next.js 15 (or follows training-data patterns) and assumes Server Components cache by default. In Next.js 16, **implicit caching is removed**; every Server Component data fetch runs uncached unless `use cache` is applied. Suddenly every chat page load triggers a fresh Firestore read and a fresh Claude call. API bill spikes.

**Why it happens:**
- AGENTS.md warns about this but engineers code from memory.
- Next.js 16 made caching opt-in via the `use cache` directive (stable in 16.2).

**How to avoid:**
- Read `node_modules/next/dist/docs/01-app/02-guides/caching.md` (and related) before writing data-fetching code.
- Adopt explicit `use cache` directives on read-heavy server functions (project lookup, KB metadata, coach dashboard aggregates).
- Use `cacheLife` to set TTLs; use `cacheTag` + `updateTag` (Server Actions only) for invalidation on KB updates.
- **Do not** use `use cache` on LLM calls (they're per-conversation, non-deterministic).
- Read budget alert in Firebase project.

**Warning signs:**
- Firestore reads/day rises sharply post-migration without traffic growth.
- p95 chat page load slow (no cache hits on warm content).
- Claude bill exceeds projections by >30%.

**Phase to address:** P0 (caching strategy decision).

---

### Pitfall 22: Server Actions in Next.js 16 used where Route Handlers are required (or vice versa)

**What goes wrong:**
Team writes `updateTag` calls in a Route Handler. In Next.js 16 this is Server-Action-only and throws at runtime. Or: uses `cookies()` synchronously — removed in 16, must be awaited. Or: relies on `middleware.ts` which is deprecated in favor of `proxy.ts`.

**Why it happens:**
- Training data is mostly Next.js 13/14/15 patterns.
- AGENTS.md warns but engineers follow Stack Overflow.

**How to avoid:**
- Read `node_modules/next/dist/docs/01-app/02-guides/` before each new feature.
- Lint rule (or pre-commit grep) flagging: synchronous `cookies()`, `headers()`, `params`, `searchParams`; `middleware.ts` filename; `revalidateTag(tag)` without 2nd arg; `updateTag` in Route Handlers.
- CI runs Next.js `lint` with strict TS.

**Warning signs:**
- Build emits deprecation warnings.
- Runtime errors mentioning "must be called from a Server Action."
- TypeScript errors in strict mode on cache APIs.

**Phase to address:** P0 (project setup + CI lint).

---

### Pitfall 23: Streaming responses don't work on Firebase App Hosting as expected

**What goes wrong:**
Chat UI is designed to stream Claude's response token-by-token via `text/event-stream` from a Next.js Route Handler. Firebase App Hosting buffers the response or terminates connections; agents see "thinking…" then the full response dumps at once after 30s. UX feels broken.

**Why it happens:**
- Firebase Hosting has historically had quirks with long-lived responses and SSE.
- Next.js 16's Deployment Adapter API (stable in 16.2) is supposed to fix this, but verify under real load.

**How to avoid:**
- **Phase 0 spike**: deploy a minimal streaming endpoint to Firebase App Hosting; verify tokens arrive incrementally with realistic Claude streaming (5–10s response). Test from a mobile network (4G), not localhost.
- Use Next.js streaming patterns from `node_modules/next/dist/docs/` (Suspense + streaming server components for static parts, `ReadableStream` for the LLM token stream).
- Set explicit `Cache-Control: no-store` and `Content-Type: text/event-stream` headers.
- Fallback: if streaming proves unreliable, accept request-response with a loading indicator + show partial chunks via polling. Don't ship streaming if it's flaky.
- Document in Key Decisions whether streaming is confirmed working on App Hosting.

**Warning signs:**
- Stream looks instantaneous in dev but batched in prod.
- Mobile users report long wait + sudden dump.
- App Hosting logs show response duration =60s with no body progress.

**Phase to address:** P0 (verify before committing to streaming UX).

---

### Pitfall 24: Mid-build review at week 4 skipped because "we're behind"

**What goes wrong:**
The Implementation Plan calls for a structured review at the end of Phase 1 (week 4). Team is racing, skips it. Critical assumption (e.g., that streaming works on App Hosting, or that the eval rubric matches what Derek thinks "good" means) only surfaces at week 12. Recovery cost is 4× higher than catching it at week 4.

**Why it happens:**
- "We'll review when we have time."
- No external accountability.

**How to avoid:**
- Mid-build review is a calendar-blocked, mandatory ceremony with Derek + both engineers + at least one pilot agent + one coach.
- Agenda is fixed: (1) demo Coach MVP end-to-end; (2) eval scores walkthrough; (3) "what surprised you?" round; (4) decision: continue / pivot / extend P1.
- Output is a written go/no-go memo committed to the repo.
- Treat it as a phase boundary: cannot start P2 until the memo is signed.

**Warning signs:**
- Calendar invite gets pushed.
- Team says "let's combine the week-4 and week-8 reviews."
- Demo isn't ready by week 4.

**Phase to address:** P1 boundary.

---

### Pitfall 25: Pasted-message parsing fails on emojis, voice-note placeholders, image refs

**What goes wrong:**
Lead sends a voice note. Agent's WhatsApp transcribes it imperfectly and pastes it. Or the agent pastes "🏠❤️ ok deal, 6pm tomorrow? 📍 https://..." and the Reply Assistant strips the emojis, loses the location pin context, and drafts something tone-deaf.

**Why it happens:**
- Pre-processing pipeline normalizes input naively (strips emoji, URL parsing fails).
- LLM treats emojis as noise instead of communicative signal.

**How to avoid:**
- Preserve emojis in input verbatim; the LLM is multimodal-text-savvy enough to interpret them.
- Detect WhatsApp voice-note transcription markers (often `[Voice note transcript:]` or `~~Voice note~~`) and tag them in the prompt as "imperfect transcription, may have errors."
- Detect URLs and pinned-location markers; preserve them in prompt; instruct LLM to ask for clarification on ambiguous references.
- Eval set includes emoji-heavy, voice-note-transcribed, and mixed-media-reference messages.

**Warning signs:**
- Drafts ignore emojis present in original message.
- Drafts contradict location info ("see you at the office" when lead pasted a pinned address).
- Pilot agents say "the AI doesn't get tone with emojis."

**Phase to address:** P3.

---

### Pitfall 26: Tiny, hidden AI disclosure → trust violation when discovered later

**What goes wrong:**
Agents using Reply Assistant don't tell their leads they're using AI-assisted drafting. Lead later finds out (maybe from a tone slip, maybe from a press article about D2's AI). Lead feels deceived; relationship damaged.

**Why it happens:**
- Disclosure is treated as a legal checkbox, not a trust feature.
- Disclosure is in the agent's onboarding TOS, not the lead-facing conversation.

**How to avoid:**
- v1 posture: Reply Assistant is **strictly drafting** for the agent; the lead-facing message comes from the agent's phone, agent's voice. This is the legal posture and supports the "not auto-sent" requirement.
- However: D2 should publish a public statement that agents may use AI tools to help with research and drafting, with human review. Frame as transparency, not concealment.
- Coach AI: disclose to the agent prominently ("You're chatting with an AI coach trained on D2 playbooks") — non-negotiable.
- For Property Finder: when an agent forwards AI-generated content (e.g., a project comparison) to a lead, the artifact should be presented as "D2 project info" not as a chatbot transcript. The AI is a research tool for the agent.
- Audit log preserves enough info to answer "did agent X have AI assistance on this lead's reply" if asked.

**Warning signs:**
- TOS update with disclosure but no in-product surface.
- Pilot agents say "I don't tell my leads I use AI."
- No D2 public statement on AI use.

**Phase to address:** P0 (policy decision); P1 (Coach disclosure UX); P3 (Reply Assistant policy).

---

### Pitfall 27: Handoff to senior coach loses context; coach starts cold and bails

**What goes wrong:**
AI escalates to senior coach: "Agent X needs help." Coach opens the dashboard, sees no conversation history, no summary of what AI tried, no flagged issue. They have to interview the agent from scratch. They give up after a few of these.

**Why it happens:**
- Escalation is a notification, not a context transfer.
- No structured handoff artifact.

**How to avoid:**
- Escalation includes a structured artifact: summary of the conversation, flagged issue, what AI tried, AI's confidence rating, suggested coach action. Stored as `escalations/{eid}`.
- Coach dashboard opens the escalation in a single click; shows full thread + AI's annotations inline.
- Coach can respond directly through the dashboard; their response is delivered to the agent inside the same chat surface with a clear "from [Coach Name]" label.
- Eval: simulate escalations, measure time-to-coach-response and coach satisfaction (post-session 1-5 rating).

**Warning signs:**
- Coaches say "I don't know what's going on when I get escalations."
- Time-to-response on escalations >24h.
- Coaches don't engage with dashboard.

**Phase to address:** P1 (escalation pipeline + dashboard).

---

### Pitfall 28: Eval set drift — production conversations diverge from eval

**What goes wrong:**
Eval set was built in week 2 based on Derek's curated examples. By week 12, real pilot conversations look nothing like the eval set — agents ask different questions, in different languages, with different slang. Eval scores stay 90%+ but production complaints rise.

**Why it happens:**
- Eval set is static.
- No discipline of mining production for hard cases.

**How to avoid:**
- Weekly: sample 20 random pilot conversations, anonymize, score with the LLM-judge, identify any with score <0.7. Add the hard ones to the eval set.
- Quarterly: refresh 10–20% of the eval set with production-derived examples (per Anyscale RAG eval guidance).
- Track eval-vs-production score gap; alert if eval is >0.2 above production rolling average.
- Eval set has language coverage parity with production traffic.

**Warning signs:**
- Eval score climbs while pilot satisfaction declines.
- Eval set hasn't been touched in >4 weeks.
- Production complaint themes don't appear anywhere in eval.

**Phase to address:** P1 (eval infrastructure); P4 (formal drift monitoring).

---

### Pitfall 29: LLM-judge eval bias inflates scores

**What goes wrong:**
The LLM-as-judge eval rates every response 8.5/10. Team thinks they're shipping quality. Production users disagree. LLM judges have known biases: verbosity preference, self-preference (Claude judging Claude), positional bias, leniency on style.

**Why it happens:**
- Judge prompt is generic ("rate 1-10 for quality").
- No human-graded calibration set.

**How to avoid:**
- Judge rubric is concrete and binary where possible: "Does the response cite a real SOP-ID? Y/N." "Does it contain any of these AI-tells? Y/N." "Does the language match the lead's? Y/N."
- Human-graded calibration set (100 examples scored by Derek + a coach). Judge must agree with humans on >85% of calibration set before being trusted.
- Use a different model for judge than for generation when possible (e.g., GPT-4o or Gemini as judge for Claude-generated responses), to mitigate self-preference.
- Track judge-human disagreement rate over time; recalibrate when it drifts.

**Warning signs:**
- Judge scores everything >0.8.
- Human review disagrees with judge >30% of the time.
- Judge and prompt evaluator are the same model.

**Phase to address:** P0 (eval infra); P1 (calibration set).

---

### Pitfall 30: Derek-as-bottleneck on KB updates

**What goes wrong:**
Admin UX requires Derek to manually tag, version, and supersede every doc. Derek is busy. KB updates fall behind. New PowerBoost content stale for 3 weeks. Agents complain.

**Why it happens:**
- Admin UX over-engineers required metadata.
- No delegation paths.

**How to avoid:**
- Admin UX has progressive disclosure: minimum required = title + content + language. Advanced fields (supersedes, effective_date, applies_to) have sensible defaults and are optional.
- Senior coaches can contribute (with their content marked as "coach contribution, pending Derek review"). Coach contributions show up immediately in their downline's KB, queued for Derek to globally promote.
- Bulk import: Derek can upload a folder of PDFs at once; admin UX runs ingestion in background (per Pitfall 10) with progress and surfaces any flagged items.
- Track time-to-publish on new KB content; if >7 days median, redesign admin UX.

**Warning signs:**
- KB additions <1/week despite content team producing more.
- Derek says "I haven't had time to add the new playbooks."

**Phase to address:** P0 (KB UX design); P1 (admin tooling).

---

### Pitfall 31: Demoing to non-pilot users too early

**What goes wrong:**
At week 6, a leadership demo happens. Coach MVP is shown. A senior executive says "this is amazing, can the whole team use it next month?" Pressure mounts. The team ships before P1 is ready. Quality regresses. Pilot agents lose trust.

**Why it happens:**
- Demo enthusiasm misread as product-readiness.
- No formal "who has access" gating.

**How to avoid:**
- Pilot access is gated by an explicit allow-list in Firestore (`agents/{aid}.pilot_access: true`). Engineers don't add anyone without Derek + a phase-readiness sign-off.
- Demos to non-pilot stakeholders use a read-only sandbox account with sample data, not pilot data.
- Roadmap published with explicit "GA = end of Phase 4" milestone; communicated to leadership at kickoff.

**Warning signs:**
- "Can my team have access?" requests in the chat.
- Demo recordings circulating internally.
- Leadership pushing to accelerate rollout.

**Phase to address:** P0 (access policy); P1 (pilot allow-list).

---

### Pitfall 32: PII in eval datasets

**What goes wrong:**
Eval set is built from real pilot conversations. The conversations contain lead names, phone numbers. The eval set is stored in Git. PII is now in the repo. PDPA breach.

**Why it happens:**
- Eval engineering doesn't apply the same redaction discipline as production.
- "It's just internal" misconception.

**How to avoid:**
- Eval set has a strict redaction pipeline: same pseudonymization as production prompts (Pitfall 7). Names → `<LEAD_NAME>`, phones → `<PHONE>`, addresses → `<ADDRESS>`.
- Eval dataset stored in Firestore (`internal/evals/{eval_id}`), not Git. If exported to file for offline analysis, file is encrypted and gitignored.
- CI scans eval JSON for PII patterns (Malaysian phone regex `+?60\d{9,10}`, IC number regex `\d{6}-\d{2}-\d{4}`) and fails the build if found.
- Eval submitters sign a PDPA acknowledgement in their onboarding.

**Warning signs:**
- Phone numbers / IC numbers in any committed file.
- Eval dataset has real lead names.
- No PII scan in CI.

**Phase to address:** P0 (eval pipeline design).

---

### Pitfall 33: Cross-lingual retrieval failure — BM query doesn't find English SOP

**What goes wrong:**
SOPs are mostly in English (Derek wrote them in English). An agent asks the Coach in BM "macam mana nak handle objection harga?" — the embedding model gives a low-similarity score to the English "How to handle price objections" SOP. No match returned. Agent gets a hallucinated answer.

**Why it happens:**
- Embedding model is biased to English; cross-lingual similarity is weaker than mono-lingual.

**How to avoid:**
- Translate every SOP into all three languages at ingestion, store as parallel docs (`sops/{sid}` with `lang: 'en' | 'bm' | 'zh'` and `translation_of: <parent_sop_id>`).
- Retrieval first filters by detected query language, then expands cross-lingually if recall is low.
- Use a multilingual-strong embedding model verified on BM/Mandarin (see Pitfall 4).
- Eval: parallel BM/EN/ZH queries for the same scenario must retrieve the corresponding-language SOP variant with score ≥ 0.7.

**Warning signs:**
- BM/Mandarin retrieval recall@5 < 70% of English.
- Agents using BM/Mandarin disable the AI.

**Phase to address:** P0 (KB ingestion).

---

### Pitfall 34: Scope creep on Phase 4 hardening

**What goes wrong:**
Phase 4 is "harden + scale." Mid-Phase 4, leadership requests three new features ("oh, can it also...?"). Team accepts. Hardening work is deprioritized. Phase 4 ships without the resilience work. Production launch has avoidable incidents.

**Why it happens:**
- "Hardening" doesn't have a visible deliverable, so it loses budget battles.
- Feature requests are concrete and easy to say yes to.

**How to avoid:**
- Phase 4 deliverables are made concrete: SLO definitions, runbooks, on-call rota, backup/restore tested, security audit, load test passed, cost-projection at 400 agents validated. Each is a checklist item.
- New feature requests in P4 are written down and parked for post-launch backlog; the answer is "post-launch" by default.
- Mid-P4 review (week 14) gates launch on the checklist completion, not on feature count.

**Warning signs:**
- "Quick add" features merged in P4.
- Hardening checklist items moved to "later."

**Phase to address:** P4.

---

### Pitfall 35: Audit log retention conflicts with right-to-be-forgotten

**What goes wrong:**
PDPA grants data subjects a right to erasure. A lead requests deletion. The audit log of conversations involving them is preserved (for D2's compliance) but contains their PII. Compliance contradiction.

**Why it happens:**
- Audit log designed for D2's internal compliance without considering lead's PDPA rights.
- No erasure pipeline.

**How to avoid:**
- Audit log stores **hashes/pseudonyms**, not raw PII. Original PII is in `leads/{lid}` doc, separately deletable.
- On erasure request: delete `leads/{lid}` (the canonical PII record); audit log retains the lead's pseudonym + hashed message history but no recoverable PII.
- Document the erasure workflow in PDPA compliance docs.
- Quarterly fire-drill: simulate an erasure request and verify the pipeline works in <72h (PDPA expectation).

**Warning signs:**
- Audit log contains raw phone numbers.
- No documented erasure workflow.
- Erasure request never tested.

**Phase to address:** P0 (data model + PDPA workflow design).

---

### Pitfall 36: Lead financing situation mismatch (recommending unaffordable units)

**What goes wrong:**
Lead profile says "household income RM6k/month, no existing properties." Property Finder recommends RM800k units (>10× income; bank financing extremely unlikely). Lead gets excited, sees agent, can't qualify for a loan. Agent looks unprofessional.

**Why it happens:**
- Affordability not modeled as a hard filter.
- LLM doesn't reliably compute loan eligibility heuristics.

**How to avoid:**
- Lead schema includes `household_income`, `existing_commitments`, `target_dsr`.
- Property Finder uses a deterministic affordability filter (rough heuristic: max property price = 5× annual household income, configurable per market) before LLM re-ranks.
- When affordability is unknown, the AI asks for it before recommending.
- Recommendations include an affordability note: "Estimated monthly installment: RM4,800. At your stated income, this is borderline; we suggest verifying with a mortgage advisor."

**Warning signs:**
- Recommendations include units >7× annual income.
- Agents say "the AI shows leads stuff they can't afford."

**Phase to address:** P2.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Inline messages array in conversation doc | Simpler queries | 1MB document limit hit; full rewrite to subcollection | Never — start with subcollection |
| Skip per-agent voice fingerprint, use one D2 voice | Faster Reply Assistant ship | Tone drift, agent rejection, rework | Only in Phase 3 alpha demo, not pilot |
| LLM-judge eval without human calibration | Eval set ready quickly | Inflated scores, missed regressions | First week only; calibrate by week 2 |
| Hard-code KB content in prompt instead of RAG | Faster Coach MVP | Updates require code change; no admin UX | Only for system-level prompt, never SOP content |
| Single Claude prompt for all three pillars | One prompt to maintain | Conflicting instructions, harder eval | Never — separate per pillar from start |
| Skip Firestore Rules tests | Faster setup | Cross-tenant leak risk; PDPA breach | Never |
| Free cron service for stall detection | Zero cost | Silent failures, lost pilot value | Only with watchdog monitoring + paid backup |
| Raw PII in audit log | Easier debugging | PDPA breach; conflict with erasure | Never |
| Skip mid-build review at week 4 | Save 2 days | Catch issues at week 12 = 4× cost | Never |
| Plaintext Anthropic API key in Server Action | Quick prototype | Bot scrapers; credential rotation pain | Never — environment variable from day 1 |

---

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| Firebase App Hosting + Next.js 16 | Assume streaming "just works" | Phase 0 spike to verify SSE + Suspense streaming on real App Hosting deploy from mobile network |
| Firestore + multi-tenant data | Rely on app-layer filters | Tenant ID in path + Rules enforcement + collectionGroup audit |
| Firestore + vector search | Treat as full-fledged vector DB | Verify recall@k on real Bahasa/Mandarin queries; benchmark vs dedicated vector store before committing |
| Anthropic API + PDPA | Send raw PII assuming "API is private" | Pseudonymize at the boundary; document TIA; consider Bedrock-Singapore |
| Next.js Server Actions + heavy work | Run embedding/ingestion in the action | Offload to external worker (GH Actions, Cloud Run, or polling Firestore); 60s Firebase Hosting timeout is hard |
| `revalidateTag` (Next.js 16) | Call without 2nd arg in Route Handler | Use `revalidateTag(tag, { expire: 0 })` in Route Handlers; `updateTag` only in Server Actions |
| `cookies()` / `headers()` (Next.js 16) | Use synchronously | Always `await`; sync access removed |
| `middleware.ts` (Next.js 16) | Use the old filename | Rename to `proxy.ts`, export `proxy` function |
| WhatsApp paste-and-draft | Assume the message is clean text | Preserve emojis, detect voice-note markers, preserve URLs/pin context |
| Claude streaming on App Hosting | Stream all responses | Verify in Phase 0; have non-streaming fallback ready |

---

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Full conversation history fetched on every page load | Slow chat open, Firestore read spike | Paginate (last N), summarize older messages | ~50 messages per thread |
| Coach dashboard fetches all downline conversations | Dashboard >5s load | Denormalized aggregates updated by Server Actions; `use cache` with tag invalidation | 10+ agents per coach |
| Re-embedding entire KB on every change | Long admin UX waits, cost spike | Embed only added/changed docs; content-hash dedup | 100+ KB docs |
| Synchronous Claude calls blocking page render | Page TTFB >3s | Stream responses; Suspense boundaries | Any LLM call in a hot path |
| Inflated context window (everything in prompt) | High token cost; latency; lower quality | Hard cap context tokens; tier retrieval relevance | Conversations >20 turns |
| Vector search on every chat turn | Cost + latency | Cache embeddings for stable content; reuse query embeddings within a session | High-volume usage |
| Polling for cron heartbeat from every dashboard load | Firestore reads spike | Cache heartbeat in `use cache` with 60s TTL | 50+ concurrent dashboard users |
| Naive intent-router that runs all three pillars in parallel | 3× LLM cost, 3× latency | One cheap router call → route to one pillar | Day 1 |

---

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Firestore Rules in test mode in production | Full data exposure (per Sept 2025 disclosures) | Deny-by-default; CI-tested rules from Phase 0 |
| Anthropic API key in client bundle | Key theft, runaway bill | Env var, server-only; rotate quarterly |
| PII in audit log | PDPA breach | Hash/pseudonymize at the boundary |
| Cross-border data transfer without TIA | PDPA non-compliance | Documented TIA in Phase 0; valid 3 years |
| PII in eval datasets in Git | PDPA breach + data leak | Redaction pipeline; CI PII scan |
| Coach can read other coaches' downline | Internal politics + privacy | Rules scope coach access to their own downline only |
| Agent can read other agents' leads | Cross-agent leakage | Path-based tenant boundary; Rules check ownership |
| No rate limit on Claude-backed endpoints | Cost attack from any logged-in user | Per-agent rate limits in Server Actions; daily token budget per agent |
| Lead consent not captured before AI processing | Consent failure under PDPA | Explicit per-lead consent flag; refuse to draft without it |
| Firestore Storage bucket world-readable | KB content (potentially proprietary) leaked | Storage Rules same discipline as Firestore Rules |

---

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| AI disclosure hidden in TOS only | Trust violation when discovered | Visible in-app: "AI Coach" labeled, transparent to agent |
| Reply drafts shown without active-lead context | Cross-lead confusion | Active lead's name + last 3 messages always visible |
| Generic D2 voice for every agent | "Doesn't sound like me" → low adoption | Per-agent voice fingerprint + few-shot from agent's own messages |
| Notifications every couple of hours | App muted; AI value lost | Global nudge budget (2/day push); learn cadence per agent |
| Quiz-format checkpoints | Agents game them, no real learning | Scenario-based generative practice + AI critique |
| No coach context on escalation | Coach starts cold, gives up | Structured escalation artifact with summary + AI confidence |
| AI confidently answers regulatory questions | Misinformation → liability | Forced disclaimer + redirect for legal/financial topics |
| Sold-out projects in recommendations | Embarrassed agent, frustrated lead | Tool-call based search with `status: 'active'` filter |
| Lead nationality not asked before recommendations | Bumi/foreign mismatches | Capture nationality early; soft block on recommendations without it |
| "Loading…" spinner during ingestion | Admin abandons; double-uploads | Progress UI per file; ETA estimate; resumable |

---

## "Looks Done But Isn't" Checklist

- [ ] **Coach MVP demo:** Often missing escalation pipeline — verify a stalled agent triggers a coach notification end-to-end
- [ ] **Property Finder:** Often missing affordability + nationality filters — verify a foreign lead with RM500k budget on KL gets a refusal-with-explanation, not a recommendation
- [ ] **Reply Assistant:** Often missing per-lead context isolation — verify pasting Lead B's message after Lead A doesn't reference Lead A
- [ ] **Multilingual:** Often only tested in English — verify BM and Mandarin parity in eval set
- [ ] **PDPA compliance:** Often missing TIA documentation — verify a written, signed TIA exists before launch
- [ ] **Streaming:** Often only verified in dev — verify on Firebase App Hosting from a real mobile network
- [ ] **Firestore Rules:** Often missing test coverage — verify CI runs rules-unit-tests and they cover every collection
- [ ] **Audit log:** Often contains PII — verify no raw names/phones in audit collection
- [ ] **Cron heartbeat:** Often not surfaced — verify dashboard shows red banner if any cron missed window
- [ ] **Eval set:** Often English-only — verify trilingual parity and language-tagged scoring
- [ ] **Voice fingerprint:** Often skipped for agents added post-onboarding — verify onboarding flow captures samples for every new agent
- [ ] **AI disclosure:** Often missing in-product — verify Coach screen has "AI Coach" labeling and disclosure copy
- [ ] **Erasure pipeline:** Often theoretical — verify a test erasure completes in <72h end-to-end
- [ ] **Cost dashboard:** Often missing per-collection breakdown — verify Firestore reads/writes broken down by collection daily
- [ ] **Mid-build review (week 4):** Often skipped — verify a signed memo exists in the repo before P2 starts
- [ ] **Stale KB:** Often no version metadata — verify every KB doc has `effective_date` and `status`
- [ ] **Sold-out refusal eval:** Often missing — verify a test case asserts the AI refuses to recommend a `sold_out` project

---

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Hallucinated project facts in production | MEDIUM | (1) Issue correction to affected leads via agent; (2) Add the case to eval; (3) Add the project's structured fields; (4) Patch system prompt; (5) Apologize to pilot agent |
| PDPA breach (PII leaked to Claude) | HIGH | (1) Halt the offending endpoint; (2) Notify Derek + legal; (3) Document scope of leak; (4) Notify affected leads if required by PDPA; (5) Patch redaction layer; (6) Update TIA |
| Firestore Rules cross-tenant leak | HIGH | (1) Lock down rules immediately; (2) Audit access logs for actual reads; (3) Notify affected parties if PII was read; (4) Add rules tests; (5) Pen-test before re-opening |
| WhatsApp account suspension on a pilot agent | MEDIUM | (1) Pause that agent's Reply Assistant use; (2) Document send patterns; (3) Verify our drafts don't encourage burst sending; (4) Coach the agent on volume practices |
| Streaming broken on App Hosting | LOW-MEDIUM | (1) Fall back to non-streaming with loading indicator; (2) File issue with Firebase; (3) Test alternative deployment adapters; (4) Revisit at next Next.js patch |
| KB-stale-content drift | LOW | (1) Mark old docs deprecated; (2) Re-index; (3) Fix admin UX to require supersedes selection |
| Eval-vs-production drift discovered | LOW-MEDIUM | (1) Sample 50 production conversations; (2) Add hard cases to eval; (3) Re-score prompts; (4) Roll back if regressions found |
| Cron silently broke | LOW | (1) Identify gap from heartbeat; (2) Re-run missed window; (3) Switch to paid scheduler; (4) Add watchdog |
| Adoption stalled because coaches are dismissive | HIGH | (1) Coach-only listening session; (2) Reframe positioning; (3) Add coach-authored content; (4) Make coach metrics visible; (5) Quote coaches in product copy |
| Cost runaway on Firestore reads | LOW-MEDIUM | (1) Identify hot collection from billing; (2) Add `use cache`; (3) Paginate; (4) Add aggregates; (5) Set budget alert |

---

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| 1. Hallucinated project inventory | P2 | Eval: "recommend sold-out project" returns refusal |
| 2. Hallucinated SOP content | P3 (foundation P0) | Eval: drafts cite real SOP-IDs only |
| 3. Tone drift | P3 (foundation P0) | LLM-judge tone rubric, edit-distance telemetry |
| 4. Multilingual quality cliff | P0 + P1/P2/P3 | Recall@k parity on BM/EN/ZH eval |
| 5. Reply cross-contamination | P3 | Eval: parallel-lead scenarios, no cross-references |
| 6. Firestore Rules leak | P0 | CI rules-unit-tests; quarterly pen-test |
| 7. PII to Claude | P0 | Pseudonymization unit tests; TIA on file |
| 8. 1MB doc limit | P0 | Doc size monitoring; subcollection from start |
| 9. Cost runaway | P0 + P4 | Daily cost dashboard; per-collection breakdown |
| 10. Ingestion timeout | P0 + P1 | Server Action duration <30s; offload pattern |
| 11. Cron silently breaks | P1 | Heartbeat dashboard; paid scheduler |
| 12. AI-tells in drafts | P3 | Anti-pattern detector + eval |
| 13. Legal-advice slip | P0 + P2 | Forbidden-topic taxonomy; disclaimer eval |
| 14. Bumi/foreign confusion | P2 | Unit-level eligibility flags; eval |
| 15. Investor/own-stay mismatch | P2 | Intent-conditional eval scenarios |
| 16. Over-nudging | P1 | Nudge budget; open-rate monitoring |
| 17. Under-escalating | P1 | Confidence-based escalation; eval |
| 18. Quiz-gaming | P1 | Scenario-based checkpoint format |
| 19. KB stale | P0 + P1 | Status/version fields; supersedes UX |
| 20. Coach undermining | P0 (co-design) + P1 | Coach dashboard engagement metrics |
| 21. Next.js 16 caching surprise | P0 | Explicit `use cache`; cost monitoring |
| 22. Server Action / Route Handler misuse | P0 | CI lint; TS strict |
| 23. Streaming broken on App Hosting | P0 | Spike + verified deployment |
| 24. Mid-build review skipped | P1 boundary | Calendar-locked; signed memo |
| 25. Pasted-message parsing | P3 | Emoji + voice-note + URL eval |
| 26. Hidden AI disclosure | P0 (policy) + P1/P3 (UX) | Visible labeling; public D2 statement |
| 27. Lost handoff context | P1 | Structured escalation artifact |
| 28. Eval drift | P1 + P4 | Weekly production sampling; quarterly refresh |
| 29. LLM-judge bias | P0 + P1 | Human-calibrated; cross-model judge |
| 30. Derek-as-bottleneck | P0 + P1 | Progressive disclosure admin UX; coach contribution path |
| 31. Premature demo | P0 + P1 | Pilot allow-list; sandbox demo account |
| 32. PII in evals | P0 | Redaction pipeline; CI PII scan |
| 33. Cross-lingual retrieval | P0 | Translated parallel docs; multilingual recall eval |
| 34. Phase 4 scope creep | P4 | Concrete hardening checklist; new-feature parking lot |
| 35. Audit vs erasure conflict | P0 | Pseudonym-only audit log; tested erasure pipeline |
| 36. Affordability mismatch | P2 | Income field + heuristic filter; eval |

---

## Sources

- [Malaysia's Groundbreaking Cross Border Data Transfer Guidelines explained — Hogan Lovells](https://www.hoganlovells.com/en/publications/malaysias-groundbreaking-cross-border-data-transfer-guidelines-explained) — HIGH confidence on PDPA TIA requirements
- [PUBLIC CONSULTATION PAPER NO. 05/2024: CROSS BORDER PERSONAL DATA TRANSFER — pdp.gov.my](https://www.pdp.gov.my/ppdpv1/wp-content/uploads/2025/08/JPDP-FSB-241001-Cross-Border-PCP-ENG-TC.pdf) — HIGH (official)
- [Anthropic API Data Residency — Claude API Docs](https://platform.claude.com/docs/en/manage-claude/data-residency) — HIGH (official Anthropic doc; Asian residency not GA as of May 2026)
- [Anthropic API vs Amazon Bedrock for Claude in Malaysia — Anchor Sprint](https://www.anchorsprint.com/blog/anthropic-api-vs-bedrock-malaysia-2026/) — MEDIUM (third-party; supports Bedrock-SG as the path to Asian residency)
- [Firebase App Hosting — official docs](https://firebase.google.com/docs/app-hosting) — HIGH
- [Deploying Next.js 16 + Nx Monorepo on Firebase App Hosting — Flavio Ribeiro](https://medium.com/@xflavioribeiro/deploying-a-next-js-16-nx-monorepo-on-firebase-app-hosting-20d964a5a6db) — MEDIUM (field-experience report on App Hosting quirks)
- [Firebase Hosting Functions docs](https://firebase.google.com/docs/hosting/functions) — HIGH (confirms 60s request timeout)
- [Next.js 16 release blog](https://nextjs.org/blog/next-16) — HIGH (official)
- [Next.js 16 Caching Bugs — Squared Tech](https://www.squaredtech.co/7-nextjs-16-caching-bugs-that-silently-break-production) — MEDIUM (third-party but corroborates official deprecations)
- [Next.js 16 use cache directive](https://nextjs.org/docs/app/api-reference/directives/use-cache) — HIGH (official)
- [Firestore vector search — Firebase docs](https://firebase.google.com/docs/firestore/vector-search) — HIGH
- [Firestore storage size calculations](https://firebase.google.com/docs/firestore/storage-size) — HIGH (1MB document limit, subcollection workaround)
- [Firestore Security Rules — insecure-rules guidance](https://firebase.google.com/docs/firestore/security/insecure-rules) — HIGH
- [Firebase Misconfiguration: Exploits & Security — JSMon (Sept 2025 disclosure context)](https://blogs.jsmon.sh/what-is-firebase-database-misconfiguration-ways-to-exploit-examples-and-impact/) — MEDIUM
- [Multi-Lingual Malaysian Embedding (arxiv 2402.03053)](https://arxiv.org/pdf/2402.03053) — HIGH (peer-reviewed; Malaysian-specific embedding outperforms ada-002 on BM recall)
- [Foreigners Buying Property Malaysia 2026 — iProperty](https://www.iproperty.com.my/guides/foreigners-buying-property-malaysia-complete-guide-12332) — HIGH (domain-authoritative for thresholds + bumi rules)
- [Malaysia Foreign Property Rules — PropertyGuru](https://www.propertyguru.com.my/property-guides/malaysia-foreign-property-rules-what-it-costs-buyers-pjx-79683) — MEDIUM
- [WhatsApp Business Account Block guide — Omnichat](https://blog.omnichat.ai/whatsapp-business-account-block/) — MEDIUM (volume thresholds + ban patterns)
- [WhatsApp Business Policy — official](https://business.whatsapp.com/policy) — HIGH
- [RAG Evaluation guide — Evidently AI](https://www.evidentlyai.com/llm-guide/rag-evaluation) — MEDIUM-HIGH
- [Case-Aware LLM-as-a-Judge for Enterprise RAG (arxiv 2602.20379)](https://arxiv.org/pdf/2602.20379) — HIGH (judge bias evidence)
- [Anyscale RAG Evaluation docs](https://docs.anyscale.com/rag/evaluation) — HIGH (quarterly eval refresh guidance)
- [The Ultimate Guide to In-App Nudges — Plotline](https://www.plotline.so/blog/in-app-nudges-ultimate-guide) — MEDIUM (over-nudging fatigue)
- [Anthropic supported countries](https://www.anthropic.com/supported-countries) — HIGH
- AGENTS.md (project file) — Next.js 16 breaking-change warning, locally authoritative
- node_modules/next/dist/docs/01-app/ — HIGH (project-local authoritative Next.js 16 documentation)

---
*Pitfalls research for: Multi-pillar conversational AI platform on Next.js 16 + Firebase (no Cloud Functions) for Malaysian real-estate sales, PDPA-regulated, WhatsApp paste-and-draft posture*
*Researched: 2026-05-31*
