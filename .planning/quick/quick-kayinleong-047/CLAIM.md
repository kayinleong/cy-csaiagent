# Claim: quick-kayinleong-047
- owner: kayinleong
- session: claude-code
- branch: quick-kayinleong-045-whatsapp-ingest
- started: 2026-08-24
- status: done
- summary: Three UX/correctness fixes — (1) Reply treated any message as a client inbound, so a greeting returned the "no D2 reply SOP" refusal AND wrote a fake knowledgeGaps row; (2) Meta ads removed from the Coach surface (D2 runs no paid advertising); (3) console navigation had zero feedback, added a useLinkStatus pending indicator.

## Context / Symptom

User pinned the Reply chip to test Reply, then typed "hi" and
"onboard me to first meta ad for bp". Both rendered the Reply refusal card
("NO REPLY SOP FOUND — I don't have a D2 reply SOP for this"). A third, genuine
objection inbound also returned no_sop_match, which is CORRECT (no reply SOPs are
ingested yet) — only the first two are defects.

Root cause, two parts:

1. `src/router/index.ts:71-73` — the manual-override chip wins over all heuristics
   unconditionally (T-03-19, by design). So with Reply pinned, every turn routes to
   Reply, and `app/api/chat/route.ts` passes the text in as
   `incoming: userMessageContent`, labelled to the model as
   "Incoming Message (the lead's pasted WhatsApp text)".
2. `src/agents/reply/prompt.ts` has **no branch for "this is not an inbound"**. Its
   sections are Grounding / Cold-Prospect / Objection-Financing / Tone / Output Format.
   The Coach prompt has an explicit "Greetings, help, and meta questions" section that
   answers directly and skips retrieval; Reply has no equivalent. So mandatory grounding
   fires, `retrieveReplySop("hi")` misses, and the model delivers the grounded refusal.
   The `ReplyOutput` schema ALREADY has the right escape hatch — `clarifyingQuestion`,
   documented "include ONLY when the inbound is ambiguous and you need to ask before
   drafting" — the model just is not told to use it for a non-inbound.

Data-integrity consequence (the serious half): `app/api/chat/route.ts:665`
`replyHadNoSopMatch(final)` reads the **tool** result, so every bogus miss writes a
`knowledgeGaps` row tagged `pillar:'reply'` with the greeting as the topic. That
corrupts the exact feed meant to tell Derek which SOPs to write — the signal degrades
the more anyone tests Reply.

## Decision (user, 2026-08-24)

Fix scope = prompt branch + stop the gap pollution. Do **NOT** relax the override chip
(that would contradict T-03-19 and is a design change, not a bug fix).

## What will change

- `src/agents/reply/prompt.ts`: add a "Not an inbound message" branch mirroring the
  Coach prompt's greeting section — greetings, questions addressed to the assistant, and
  onboarding/training requests must emit `clarifyingQuestion` asking for the client's
  message, must NOT call `retrieveReplySop`, and must NOT emit `noSopMatch`.
- `app/api/chat/route.ts`: gate the `knowledgeGaps` write on the **agent's own
  conclusion** (it emitted `noSopMatch`) rather than merely on the tool having missed,
  so a clarifying-question turn can never be recorded as an SOP gap.
- Tests for both.

## Scope added mid-claim (user-directed)

2. **"change to meta ad to something else as this project dont do ads"** — Meta ads were
   baked into the Coach surface in three places, pointing new agents at a channel D2 does
   not use.
3. **"when navigating to different page… user need to look at the page without any
   feedback"** — console navigation blocked for ~1s+ with nothing on screen changing.

## What has changed

Three commits.

### 1. Reply non-inbound handling + false SOP gaps (`4148d00`)
- `src/agents/reply/prompt.ts`: new **"Not an inbound message (check this FIRST)"**
  section, placed BEFORE the grounding mandate (a test asserts that ordering — after it,
  the model has already been told to call the tool first). Greetings, questions addressed
  to the assistant, onboarding requests and property searches now return only a
  `clarifyingQuestion` asking for the client's paste, and must NOT call
  `retrieveReplySop` or emit `noSopMatch`. The schema already carried this escape hatch;
  the model simply was not told to use it.
- `app/api/chat/route.ts`: new `replyAgentReportedSopGap(final)` parses the agent's own
  `ReplyOutput`. The `knowledgeGaps` write now requires BOTH the tool miss AND the
  agent's conclusion. A `clarifyingQuestion` turn is never a gap; unparseable output
  fails **closed** (a missed gap row is far cheaper than a false one).
- Updated the pre-existing D-11 fixture to carry the envelope a real `no_sop_match` turn
  emits — without it, that test asserted a gap row for a turn the agent never declared a
  gap on, i.e. the exact false positive this guard prevents.
- **Not changed:** the override chip stays absolute (T-03-19). Relaxing it is a design
  decision, not a bug fix — user chose the prompt+guard scope.

### 2. Meta ads off the Coach surface (`ef91516`)
- `chat.suggestions.coachAd` → `coachViewing` = "Walk me through my first client
  viewing", EN/BM/ZH at parity, `hero-empty-state.tsx` updated. **Verified against the
  real router before picking it:** `heuristicPillar()` routes it deterministically to
  coach via `\bviewing\b`, so it never falls through to the LLM classifier, and it keeps
  the original card's "Walk me through my first …" onboarding shape.
- `coach/prompt.ts`: dropped "Meta ads" and the first-Meta-ad walkthrough from the
  channel-playbook list; the Coach is now told D2 runs no paid advertising and to say so
  plainly if asked, instead of searching the KB for a playbook that should not exist.
  Also repaired the header docstring (stale Meta-ad line, and a design-principles list
  quick-046 had split mid-way).

### 3. Console navigation feedback (`0ea97b4`)
- New `app/[lang]/_components/nav-pending.tsx` using `useLinkStatus` (Next 16.2.6,
  exported from `next/link`), rendered inside the sidebar `<Link>`.
- `app/globals.css`: 180 ms delay before the indicator fades in, so a fast or prefetched
  navigation never flashes a spinner. Uses the quick-046 motion tokens; opacity and
  transform only.
- Root cause worth recording: the `loading.tsx` files added in quick-046 do **not** cover
  sibling navigation. A `loading.tsx` fallback only renders for the segment being
  ENTERED, and every console page shares the `(admin)`/`(coach)` route-group boundary, so
  `/kb → /users` never re-suspends it. The Next docs name this exact case for
  `useLinkStatus`.

## Verification

- `npx tsc --noEmit` → **0 errors**
- `npx vitest run` → **860 passed**, 197 skipped, 0 failed (was 851; +9)
- `npx eslint app src` → **0 errors** (66 pre-existing warnings)
- `npm run build` → exit 0
- i18n parity test green (EN/BM/ZH `chat.suggestions` key sets identical)
- Router probe: ran the real `heuristicPillar()` over 8 candidate replacement prompts
  before choosing one, to avoid shipping a card that misroutes.
- Browser (dev server on :3100): `nav-pending` rule resolves to
  `animation-delay 0.18s, 0.18s` / `duration 0.14s, 0.7s` /
  `iteration 1, infinite` / `fill forwards, none` with `opacity: 0` at rest — genuinely
  invisible until the delay elapses. Both keyframes present. No console or server errors.

### Regression surface audited
- **Grounding mandate intact.** A test asserts the Reply prompt still contains "Call the
  retrieveReplySop tool BEFORE drafting any reply" and "NEVER invent a SOP" (D-06 /
  REPLY-01) — the new branch must not have weakened it.
- **Gap-feed semantics narrowed, never widened.** The write now requires two signals
  instead of one, so it can only produce FEWER rows. A genuine no_sop_match turn still
  records (proven by the updated D-11 test).
- **Hero-card key rename** touches only `hero-empty-state.tsx` + the three catalogs; the
  CI-enforced parity test covers the catalogs and passed.
- **My own CSS bug caught pre-commit:** the fade keyframe originally animated `transform`
  alongside `nav-pending-spin`. When two animations on one element target the same
  property the later one wins, so the scale would have been silently dead code. Fade is
  now opacity-only, documented inline.

### Honest gaps — NOT verified
1. **The pending spinner appearing mid-navigation** needs an authenticated session to
   reach the sidebar. CSS and wiring are verified; the live behaviour is not.
2. **The Reply non-inbound branch is prompt-level**, so it is model-dependent. The
   server-side gap guard is the deterministic backstop and IS test-covered.
3. **BM/中文 copy for the new hero card is machine-assisted** — needs Derek's sign-off.
4. **`src/coach/journey/config.ts:151` still contains the `first-meta-ad` checkpoint**
   plus three `kb-coach-meta-ad*` doc IDs. Left alone deliberately: that is a journey
   state-machine change with REQ traceability, not copy. The doc IDs are already inert
   placeholders, but the checkpoint is unreachable-by-design and needs Derek's call on
   what D2 channel replaces it.
5. `COACH_PATTERNS` still matches `\bmeta\s+ad` on purpose, so such a question routes to
   Coach and gets the new honest answer rather than falling through to the classifier.
