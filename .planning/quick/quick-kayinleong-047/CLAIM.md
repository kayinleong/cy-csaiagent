# Claim: quick-kayinleong-047
- owner: kayinleong
- session: claude-code
- branch: quick-kayinleong-045-whatsapp-ingest
- started: 2026-08-24
- status: claimed
- summary: Reply Assistant treats any message as a client inbound — a greeting ("hi") or a coach question typed with the Reply chip pinned returns the "no D2 reply SOP" refusal AND writes a fake knowledgeGaps row, polluting Derek's SOP-gap dashboard.

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

## What has changed

_(pending)_

## Verification

_(pending)_
