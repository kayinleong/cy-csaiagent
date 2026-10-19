# Claim: quick-kayinleong-095
- owner: kayinleong
- session: claude-code
- branch: quick-kayinleong-091
- started: 2026-10-19
- status: in-progress
- summary: client-facing UAT test plan and test cases focused on AI output quality (Coach, Finder, Reply), for the client to run themselves

## What will change

The client wants to test the app, mainly on its output. This claim produces a test plan
and a set of test cases they can run without engineering help. There are no
application code changes, no Firestore writes and no AI API calls.

- `docs/UAT-Output-Test-Plan.md`: the plan Derek reads, in plain English.
- `docs/UAT-Output-Test-Cases.xlsx`: the workbook testers fill in. It uses the same
  layout as `docs/Phase-1-Test-Cases.xlsx` and adds Rubric and Run Log sheets.
- Under this claim directory: `uat-cases.json` (source of truth), `build-uat-workbook.py`
  and `verify-uat-workbook.py`, following the quick-094 pattern.

## Research

`--research` was requested. Three researchers ran in parallel and wrote their reports here:

- `RESEARCH-surfaces.md`: what each pillar outputs today, live vs blocked, edge cases,
  and tester accounts.
- `RESEARCH-data.md`: the Phase-1 workbook format, gold sets, KB coverage, Finder
  ground-truth leads, data gaps, and Reply sample inputs.
- `RESEARCH-method.md`: how to judge LLM output in a client UAT (rubric, runs per case,
  severity, evidence, exit criteria, schedule).

Findings that shape the plan:

- **Coach and Reply are grounded in placeholder content.** They rely on 9 engineer-written
  `[Example]` SOPs. The live Coach corpus has no real onboarding curriculum, so most Coach
  questions should expect an honest "not in the KB".
- **Finder has the best ground truth.** There are 87 projects: 83 active, 4 hidden and
  0 sold out. Its hard gates (active, location, price, foreign, bumi) give knowable
  expected results.
- **Likely defects found by reading the code, not yet confirmed live:**
  - `RM`-prefixed budgets are tokenized before the model sees them.
  - Local-format phone numbers and undashed IC numbers are not redacted.
  - The Coach "senior coach notified" toast sends nothing.
  - The language chip does not set the answer language.
  - The journey, activity tracking and cross-session lead memory are not wired.

## Decisions

- **Test the build as it is today.** Known issues are pre-flagged in the `Known Status`
  column (Phase-1 precedent) and listed in the plan. Fixes belong in separate claims.
- **Pre-UAT readiness checklist with owners.** Items: fund the Anthropic account,
  confirm the host, freeze the KB, have Derek review the seed SOPs, hide "Property 1",
  optionally mark a project sold out, set up accounts and leads, and tag UAT accounts.
- **Thresholds are proposals.** They are labelled "Proposed — Derek to confirm".
