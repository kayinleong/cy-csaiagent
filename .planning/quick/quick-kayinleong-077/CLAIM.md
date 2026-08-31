# Claim: quick-kayinleong-077
- owner: kayinleong
- session: claude-code
- branch: quick-kayinleong-045-whatsapp-ingest
- started: 2026-08-28
- status: done
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

## What has changed

**`src/agents/reply/schema.ts`** — `LEAD_REQUIRED_ERROR`, one shared constant. The route
EMITS it and the client MATCHES on it; two hand-typed copies of that string is a silent break
waiting to happen.

**`chat-input.tsx`** — on a 400 whose `error` is that constant: drop the empty assistant
placeholder (the turn has not happened yet — otherwise the agent stares at a blank bubble
under their question while a modal asks something apparently unrelated), stop streaming, and
hand the text to the shell instead of toasting a generic failure.

**`chat-shell.tsx`**
- `handleLeadRequired(text)` — the AUTO path, which `handleBeforeSend` structurally cannot
  catch, because the router decides the pillar server-side.
- `pendingReplySend: boolean` -> `pendingReplyText: string | null`. The boolean was voided
  out with a comment calling auto-resume "reserved"; holding the TEXT is what makes the
  resume possible.
- `handleLeadPicked` now DISPATCHES, reusing the hero-card path
  (`setSubmittedSuggestion`) rather than adding a second one, pinned to `'reply'` because
  that is what the turn was — whether the agent chose it or the router did.
- Cancel drops the held text, so it cannot resurface on an unrelated later turn.

## Verification

- `npx tsc --noEmit` -> **0 errors**
- `npx vitest run` -> **1135 passed**, 197 skipped, 0 failed (was 1125; **+10**)
- `npx eslint app src` -> **0 errors**; `npm run build` -> exit 0

Tests pin: the route emits the shared constant and no literal survives; the client imports
and matches it; the placeholder is cleared; the shell opens the picker on the server refusal;
the text is held rather than a flag; the dispatch goes through the existing path pinned to
reply; cancel clears it; and the manual-chip path still blocks AND holds its text.

## Honest gaps

1. **The modal was not clicked through.** Driving it needs a real Firebase CLIENT session
   (`clientAuth.currentUser`), and I only have a server cookie — I can mint an ID token but
   not sign in through the UI without credentials. I could create a test user with a known
   password via the Admin SDK, but that writes an account to your Firebase project and I am
   not doing that unasked. **The 400 contract, the wiring and the state machine are tested;
   the click-through is not.** Worth you trying once.
2. **The five questions do not error — they come back empty-handed**, which is the more
   important finding and is NOT fixed here:

   | routed | outcome |
   |---|---|
   | Q1 -> **finder** | misrouted — a CRM/lead-management question treated as a project search |
   | Q2-Q5 -> coach | honest `kb_miss` — Coach holds 3 docs / 35 chunks, none covering leads, portals, WhatsApp follow-up, walk-ins or viewings |

   That is a CONTENT gap. Reply is worse: 0 docs, so even a correctly-routed Reply turn with
   a lead attached answers `no_sop_match` (verified — HTTP 200, `no_sop_match`).
3. **Q1's misrouting is untouched.** "how does it manage leads" is a product question, and
   the heuristic sent it to Finder. Worth a look once there is content to route to.
