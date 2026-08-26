# Claim: quick-kayinleong-050
- owner: kayinleong
- session: claude-code
- branch: quick-kayinleong-045-whatsapp-ingest
- started: 2026-08-24
- status: claimed
- summary: Address tester feedback after ~10 real questions — usage cap hit again, response truncation, raw Finder JSON still leaking, collateral links pointing at Google Drive instead of the WhatsApp-ingested file, and Finder showing far-away projects when Cheras has no match.

## Raw feedback (verbatim, from the tester via Kayin)

functionality:
- for agent email, the conversation history is not saved, the recent chat is gone after a
  refresh and not traceable (the conversion history is empty)
- some part of the response is truncated. not sure is the ui rendering issue or backend
  maximum length or user issue
data quality:
- the agent in some scenario will show the raw unprocessed output (see image)
- the link to the source can put the google drive one instead of the whatsapp one.
- the agent choose to show projects from other location when asking for cheras. I noticed
  that the agent do acknowledge that there is no project in Cheras but still show the
  other project which is not close to Cheras at all (open for discussion)
"For the direct straight forward questions the agent is doing pretty good."

Plus: "i got hit by the usage limit again" after ~10 questions.

## Triage — which of these are already fixed vs genuinely new

**BLOCKING UNKNOWN: what revision was the tester actually running?** quick-046 through
quick-049 all landed on `main` on 2026-08-24, the same day as this feedback. CI
(.github/workflows/ci.yml) runs on main but does NOT deploy; the App Hosting rollout
branch is configured in the Firebase console, so the deployed revision cannot be read
from the repo. Two reported items are things already fixed today, so re-fixing them blind
would be wasted work — and worse, would hide a deploy-pipeline problem.

- **History lost on refresh** — fixed in quick-046 (`f6350bc`): chat-shell minted a fresh
  cid every mount and nothing hydrated a transcript at mount. Expected to be resolved on
  a current build. If it reproduces post-deploy it is a NEW bug (candidate: the fix uses
  `localStorage['d2-active-cid']`, which does not survive a different browser/device or a
  cleared profile; and the history DRAWER being empty is a separate path —
  `conversation-list.tsx` filters out `coach-*` threads per quick-035 and requires both
  ownerUid and tenantId equality filters per quick-016).
- **Raw unprocessed output** — the screenshot shows the Finder JSON envelope plus
  narration ("Let me pull up the project details and collateral ... simultaneously."),
  which is exactly the quick-048 defect fixed in `10705a5` (anti-narration + bare-JSON
  rules on the Finder prompt). Same deploy question.
- **Truncation — GENUINELY NEW, and I got this wrong before.** In quick-048 I dismissed a
  truncated response as "just where the stream had reached." This is a second,
  independent report, so that dismissal was premature. Must be investigated properly:
  no `maxOutputTokens` is set anywhere, so the provider default applies; and
  `stopWhen: stepCountIs(5)` can halt a Finder loop mid-answer.
- **Collateral link points at Google Drive instead of the WhatsApp file — GENUINELY NEW.**
  Screenshot 2 shows WhatsApp-ingested collateral rendered as raw, unclickable Storage
  paths (`collateral/<projectId>/whatsapp/kensho-brochure.pdf`) while only the Drive
  folder is a real hyperlink. So the agent surfaces the usable link for the wrong source.
- **Finder shows far-away projects on a Cheras miss — GENUINELY NEW, and a judgment call.**
  The tester explicitly flags it as open for discussion.
- **Usage cap hit again — KNOWN, deferred twice.** `TOKEN_CAP = 50_000` / 24h
  (`src/ratelimit/window.ts:28`) against `stepCountIs(5)` + RAG. Flagged in quick-046
  (RC-4) and again in quick-049, where I added an admin reset but explicitly did NOT
  raise the cap. This is now the second real-user report — the escape hatch is not
  sufficient.

## What will change

_(pending research + user decisions)_

## Verification

_(pending)_
