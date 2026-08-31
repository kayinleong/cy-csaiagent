# Claim: quick-kayinleong-078
- owner: kayinleong
- session: claude-code
- branch: quick-kayinleong-045-whatsapp-ingest
- started: 2026-08-28
- status: claimed
- summary: seed Coach and Reply with example content — both pillars answer kb_miss to every non-property question because there is nothing in them

## Why

Measured in quick-077 by running the user's five questions:

| pillar | kbDocs | kbChunks | result |
|---|---|---|---|
| coach | 3 | 35 | four of five questions answered "not in the D2 knowledge base yet" |
| reply | **0** | **0** | any Reply turn answers `no_sop_match`, even with a lead attached |
| finder | 1068 | 25153 | fine |

Nothing covers lead sources, portal response, WhatsApp follow-up, walk-ins, referrals or
viewings — the whole non-property half of the coach's job.

## What will change

Author seed documents and ingest them:
- **Coach** — lead lifecycle, listing-portal response, WhatsApp follow-up, walk-in/referral
  qualifying, first client viewing.
- **Reply** — one per canonical category the schema expects: `cold-prospect`,
  `objection-handling`, `financing`, `voice`.

## The thing to be honest about

**I am writing D2's operating procedures, and I do not know them.** An agent will repeat
this to a client as company policy. I raised it; the user said do it; so it is done — but
every document is titled `[Example]` and opens with a line saying it is a starter pending
Derek's review, and the source markdown is committed to `docs/kb-seed/` so he can edit and
re-upload rather than reverse-engineer what the bot said.

Nothing here states a price, a legal threshold, a commission figure, or a bumiputera/foreign
eligibility rule — those are exactly the facts that must come from the real inventory and
from Derek, not from me.

## Verification

_(pending)_
