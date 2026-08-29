# Claim: quick-kayinleong-071
- owner: kayinleong
- session: claude-code
- branch: quick-kayinleong-045-whatsapp-ingest
- started: 2026-08-28
- status: claimed
- summary: the MODEL chooses which collateral URLs to transcribe, so the same project gets different files every time — the server has the real list, it should attach it

## The user's two questions, measured

Ran the identical Finder query three times against live data:

| run | duration | output | collateral URLs the model emitted |
|---|---|---|---|
| 1 | 75601ms | 9478 chars | **19** |
| 2 | 50001ms | 6885 chars | **10** |
| 3 | 48260ms | 6410 chars | **9** |

**1. Why the same project shows different attachments.** How it works today: `collateralFor()`
reads every collateral doc for the project, drops any without a web-addressable `externalUrl`
(quick-050), ranks them — documents, then curated non-WhatsApp, then videos, then photos —
and caps at 12 (quick-054). That part is deterministic. Then the tool result is handed to the
model, and **the model decides which of those 12 to copy into its JSON output, character by
character.** 19, then 10, then 9. That is the inconsistency: it is a generation choice, not a
data or retrieval difference.

**2. The truncated onboarding answer.** Their token-limit hypothesis is out — no
`maxOutputTokens` is set anywhere in the agent path, and the router request shows the SDK
default of 128000, far above a ~3.6k-char answer. Their FIRST hypothesis is right: it is a
time cutoff. The same Coach onboarding turn completes locally in **37766ms** and ends on a
complete sentence; in production it was killed mid-generation. quick-070 is why they can see
the partial at all.

Both have one fix. Transcribing ~19 URLs at ~200 chars each is roughly 40% of the output the
model has to generate, so removing it makes the answer both consistent AND materially faster.

Planned: the server attaches collateral from the tool results — the same pattern quick-046
used for citations, and for the same reason ("strictly more trustworthy than asking the model
to restate chunk IDs it can get wrong").

## Verification

_(pending)_
