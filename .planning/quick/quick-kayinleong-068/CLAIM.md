# Claim: quick-kayinleong-068
- owner: kayinleong
- session: claude-code
- branch: quick-kayinleong-045-whatsapp-ingest
- started: 2026-08-28
- status: claimed
- summary: when the agent says "don't ask me questions", search with what is known and state the assumptions instead of asking again

## What will change

User: "in chat page when user mention dont ask any questions, the chat page should return
the results without asking again".

Three prompt rules currently force a question before any search:
- Segmentation: "If segment is 'unknown': ask whether the lead is buying to stay or invest
  BEFORE running searchProjects."
- Missing data: "If nationality is unknown ... ASK the lead's nationality first."
- Missing data: "If monthly income is unknown ... ASK the income range rather than guessing."

Planned: an explicit override. When the agent has said not to ask, search with `unknown` for
whatever is missing and say plainly which eligibility facts are unconfirmed.

This is safe, and that matters: `CriteriaSchema` defines `'unknown'` as "do NOT apply the
filter" (Pitfall 23). Searching with unknowns widens the result set, it never narrows it to
a wrong one — so no lead is shown a project they are ineligible for on the basis of a guess.
The agent still has to be told what was not confirmed, or the answer would be quietly
asserting facts it does not have.

It also removes a round trip, which quick-067 established the turn cannot afford.

## Verification

_(pending)_
