# Claim: quick-kayinleong-077
- owner: kayinleong
- session: claude-code
- branch: quick-kayinleong-045-whatsapp-ingest
- started: 2026-08-28
- status: claimed
- summary: a Reply turn with no lead dies on a bare 400 — open the lead picker instead, and send the message automatically once a lead is chosen

## Measured first — the five questions, in Auto, as an agent would ask

| # | question | routed | result |
|---|---|---|---|
| 1 | "i wanted to know the property leads, and how does it manage" | **finder** | misrouted; answers with a "slight misunderstanding" clarification |
| 2 | "how to respond when a lead comes in from a listing portal?" | coach | "doesn't have a specific SOP … yet" |
| 3 | "WhatsApp leads — how to follow up and convert…" | coach | "isn't in the D2 knowledge base yet" |
| 4 | "Walk-in / referral leads — how to qualify and track them?" | coach | "doesn't have specific content … yet" |
| 5 | "Walk me through my first client viewing" | coach | "doesn't have a specific SOP or playbook" |

**None of them error.** All five return 200. Four are honest `kb_miss` answers, because Coach
holds 3 documents / 35 chunks and none cover leads, portals, WhatsApp follow-up, walk-ins or
viewings. That is a CONTENT gap, not a code one — see the report.

## The error the user is actually hitting

Found it by probing the Reply paths directly:

| path | result |
|---|---|
| manual Reply chip, no lead | **HTTP 400 `{"error":"leadId required for reply"}`** |
| **Auto**, pasted inbound (heuristic routes to reply), no lead | **HTTP 400, same** |
| manual Reply chip WITH a leadId | 200, `no_sop_match` (Reply KB is empty) |

The Auto case is the bad one: the agent never chose Reply, so a bare "Something went wrong"
tells them nothing about the lead they were supposed to pick.

`chat-shell` already has a lead picker, but its pre-check only fires when the pillar is known
CLIENT-side (header chip or hero card). In Auto the pillar is only known after the server
answers. And even on the path that does work, `pendingReplySend` is set and then discarded —
`void pendingReplySend // reserved for an auto-resume affordance; currently re-send is manual`
— so the agent has to press Send a second time.

Planned: treat the server's 400 as "pick a lead", open the picker, and dispatch the original
message automatically once one is chosen — on both paths.

## Verification

_(pending)_
