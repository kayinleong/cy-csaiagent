# Claim: quick-kayinleong-068
- owner: kayinleong
- session: claude-code
- branch: quick-kayinleong-045-whatsapp-ingest
- started: 2026-08-28
- status: done
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

## What has changed

`src/agents/finder/prompt.ts` only — one new section plus two cross-references.

**"When the agent tells you NOT to ask"** — recognises "don't ask questions", "no
questions", "just show me", "just give me the results", and a waved-off answer
("doesn't matter" / "any" / "skip it"). Runs searchProjects immediately with `unknown` /
null for whatever is missing, and does not re-ask later in the conversation.

**It explains WHY that is safe, not just that it is allowed.** `'unknown'` means the tool
applies NO filter (Pitfall 23), so the result set gets WIDER, never wrong — no lead is shown
a project they are ineligible for on the basis of a guess. Without that reasoning in the
prompt the model has to infer it, and the conservative read is to keep asking.

**It still requires the gap to be stated.** One short line after the matches naming which
eligibility-critical facts were not confirmed. Skipping the question must not become quietly
asserting the answer.

**Cross-referenced from both rules it overrides** — the segmentation rule and the
missing-data section each now point at it. A rule that says ASK and an override forty lines
away is how a model ends up obeying whichever it read last.

## Verification

- `npx tsc --noEmit` -> **0 errors**
- `npx vitest run` -> **1077 passed**, 197 skipped, 0 failed (was 1073; **+4**)
- `npx eslint app src` -> **0 errors**; `npm run build` -> exit 0

Tests pin the override exists, that the safety reasoning is present (not just the
permission), that the unconfirmed-facts line is still required, and that both overridden
rules cross-reference it. Plus the existing no-backtick guard, which has caught this file
twice before.

### Scope: Finder only, deliberately
Checked Coach and Reply. Reply's `clarifyingQuestion` cases are "you pasted something that
is not a client message" and "this inbound is ambiguous" — overriding those would make it
draft a reply to a non-message, which is worse than asking. Coach's asks are comprehension
gates, which are the teaching method, not an obstacle. Neither is the behaviour reported.

### Regression surface
- **Prompt-only.** No schema, no tool, no route. `clarifyingQuestion` remains a valid
  FinderOutput state and MatchList still renders it.
- The default path is unchanged: an agent who has NOT said "don't ask" still gets asked.
- Eligibility safety is untouched — the deterministic tool gates still decide, and this
  never fabricates a nationality, income or segment. It declines to filter on one.
- Also removes a round trip, which quick-067 established the turn cannot afford.

## Honest gaps

1. **Prompt instructions are not guarantees.** This makes the behaviour much more likely,
   not certain — unlike a schema or a tool gate, which is why the eligibility rules stay
   deterministic in the tool rather than moving into the prompt.
2. **Not tested against a live model.** The tests assert the prompt CONTAINS the rule; they
   cannot assert the model obeys it. A promptfoo eval with "find me something in KLCC, don't
   ask me anything" as the case would close that, and this project has the harness for it.
3. **The trigger list is phrase-based.** "I'm in a rush" or "whatever" may not be recognised.
