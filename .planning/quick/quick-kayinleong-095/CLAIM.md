# Claim: quick-kayinleong-095
- owner: kayinleong
- session: claude-code
- branch: quick-kayinleong-091
- started: 2026-10-19
- status: done
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

## What has changed

There are no application code changes, no Firestore writes and no AI API calls. Planning
used a single plan with two waves:

| Wave | Task |
| --- | --- |
| 1 | Task 1 (cases JSON) and Task 2 (plan doc), run in parallel |
| 2 | Task 3 (workbook builder and verifier) |

Client deliverables:

- `docs/UAT-Output-Test-Plan.md` — about 4,900 words in plain English, 13 sections:
  1. scope
  2. what each assistant shows today
  3. roles
  4. a 14-item Day-0 readiness checklist with owners
  5. a 10-day schedule
  6. how to run a case on a phone
  7. the rubric
  8. severity
  9. what to record
  10. exit criteria, all labelled "Proposed — Derek to confirm"
  11. 11 known issues plus data notes
  12. 14 open questions for Derek
  13. a case-count appendix
- `docs/UAT-Output-Test-Cases.xlsx` — the Phase-1 layout, with five sheets:
  - **Instructions**
  - **Rubric**: H1–H7 yes/no checks plus a 3-point usefulness verdict, each with a PASS
    and a FAIL anchor; the S1–S4 severity scale; root-cause tags.
  - **Test Cases**: the 10 Phase-1 headers verbatim, then Lang / Type / Runs / Run by /
    Double-rate. It holds 77 scripted cases and 50 exploratory slots.
  - **Run Log**: one row per run, 181 scripted + 50 exploratory + 40 spare, with
    per-dimension dropdowns.
  - **Sign-off**: COUNTIF-only counts, the exit criteria and a GO/NO-GO verdict.

Case coverage:

| Section | Cases | P0 |
| --- | --- | --- |
| F Finder | 28 | 15 |
| R Reply | 20 | 12 |
| C Coach | 15 | 7 |
| X Cross-cutting | 14 | 6 |
| **Total** | **77** | **40** |

- Types: 35 Golden, 15 Rubric, 27 Adversarial.
- Languages: EN 39, BM 19, 中文 19. 15 cases are double-rated.
- Every Expected Result is written as MUST / MUST NOT / ALSO ACCEPTABLE, and every
  prompt is quoted verbatim.

Internal files in this directory:

- `uat-cases.json` — the source of truth. Each case carries an internal `source` citation
  to the research item. The `source` field is never written to the workbook.
- `build-uat-workbook.py` — builds the workbook from the JSON.
- `verify-uat-workbook.py` — the gate: 38 checks, plus a `--self-test` mode.
- `PLAN.md` and the three `RESEARCH-*.md` files.

Small fix by the orchestrator: X8's preconditions said "Signed in" twice. That was tidied
in the JSON before Wave 2.

### Follow-ups raised (separate claims, not done here)

- PDPA scrubber: `RM` budgets are tokenized, while local phone numbers and undashed IC
  numbers are not redacted.
- Coach KB-miss: the toast says a coach was notified, but no escalation or gap is written.

## Verification

### What was tested

- **`verify-uat-workbook.py` — 38 PASS, 0 FAIL.** The orchestrator re-ran it after the
  executor did. It covers:
  - structure, and the headers matching Phase-1;
  - unique IDs and ordering;
  - non-empty MUST / MUST NOT / ALSO ACCEPTABLE clauses;
  - the S11 hygiene rules: no internal labels, paths or claim IDs in client cells, no
    phone/IC/email strings except the six synthetic placeholders, no secrets;
  - Run Log rows matching the planned runs;
  - Sign-off formulas: COUNTIF-only, on computed ranges, with no formulas on any other
    sheet;
  - the plan doc's headings, its appendix equal to the JSON counts, its known-issue
    coverage, and its plain-English rule;
  - **D8 project cross-check:** all 81 declared project mentions were matched to the
    2026-09-18 export by name, status, price, `foreignEligible` and `bumiQuota`. The export
    loader keeps only those 5 fields per record. It never prints a record and never reads
    `description`.
- **Plan-doc gate (Task 2 verify).** The 13 headings are in order, the thresholds carry the
  "Proposed" label, the appendix is exact, and there are no paths, extensions or
  non-placeholder numbers.
- **Independent orchestrator scan.** All 1,930 text cells in the workbook were scanned for
  phone, IC and email patterns, source paths, research labels, claim IDs, `chat.whatsapp`
  and `PIC:`. None were found.
- **Determinism.** Two builds produce identical cell values, styles, merges and validations.

### The gate bites

`--self-test` first runs a clean control copy, which passes. It then injects six defects
into temporary copies, and the verifier fails on every one ("BITES"):

1. a duplicate ID
2. a hidden project under MUST
3. a non-placeholder phone number
4. an empty MUST NOT
5. a changed header
6. a changed appendix total

The executor also tried five extra mutations, and each one was rejected:

- a shortened Sign-off range
- a formula on Test Cases
- a changed Result value
- a source label in a cell
- a deleted Run Log row

### What was ruled out and why

- **Invented facts.** Every project fact comes from a 33-row register pinned in PLAN.md
  S3. The planner spot-checked that register against the export, and the verifier
  re-checked it.
  - Two research names were wrong and were corrected:
    - "The Atera, PJ" → "The Atera, PJ by Paramount Property"
    - "PDH Imperial Residences" → dropped
  - Names that contain other names, e.g. "Pavilion Damansara Heights" inside
    "…: Royal Suites(RC)", are matched longest-first.
- **PII leakage.** Only synthetic names and the six designated placeholders appear. The
  export's `description` field, which holds PIC contact details, is never read into any
  output. The 091–093 workbooks, which contain contacts, were not opened.
- **Testing content the KB lacks and blaming the model.** Coach golden cases cover only
  the 5 `[Example]` seed topics, and are marked to be re-pointed once real SOPs land.
  Everything else is an honest-miss case.
- **Stale data.** Expected results come from the 2026-09-18 snapshot. Readiness item 12
  makes the Day-0 re-export and re-check mandatory before any tester runs a case.

### Not verified (honest gaps)

- **Nothing was run against the live app.** Every expected result is what the code and
  data say should happen. The known issues come from reading the code. The Day-0
  readiness checklist exists to close this gap.
- **No visual check in Google Sheets on a phone.** LibreOffice isn't available here.
  Cell content, wrapping and widths were checked programmatically. Formulas have no
  cached values and calculate on open, the same as the Phase-1 workbook.

### Regression surface

None. No application code, no shared scripts, no Firestore, no earlier claim's files.
The only files outside this directory are the two new files in `docs/`.

## Amendment (2026-10-19): tester-only workbook

kayinleong trimmed `docs/UAT-Output-Test-Cases.xlsx` so testers see only what they test.
That edit was committed as-is in 423c755.

**What the trimmed workbook contains**

- **One tab, `Test Cases`**, holding sections F, R and C (63 cases).
- **Removed:** the Instructions, Rubric, Run Log and Sign-off tabs, and the X and E sections.

The user then asked to align everything with it (f1307cb).

**Builder** (`build-uat-workbook.py`)

- It now builds only `meta.tester_sections` = F, R and C.
- The JSON keeps all 77 cases. X is retained for a later round.
- The golden check against the user's file matched every cell for value, fill, font,
  alignment and border. It also matched the merges, the validation and the column widths.
- Freeze panes were reset from A19 to A2 (header row), which the user approved.
- Two builds give byte-identical output.

**Case text**

- Every Steps cell now ends "Then paste the full answer into the Actual / Comments
  column." It used to point at the removed Run Log.
- In the EC3 JSON text, "Cross-cutting" was dropped.

**Gate** (`verify-uat-workbook.py`)

- **38 PASS, 0 FAIL.**
- `--self-test` passes a clean control and catches all 9 injected defects. That includes
  three new ones: an extra sheet, a plan that names a removed tab, and moved freeze panes.

**Plan doc**

- §1–§3 say this round covers Finder, Reply and Coach. Routing, privacy, injection, session
  and exploratory are "not in this round".
- §5: 149 planned runs, about 3–4 runs per tester per day.
- §6 and §9: testers record results in Result and Actual / Comments, and send screenshots
  to the coordinator.
- §7 now carries the H1–H7 and U PASS/FAIL anchors itself.
- §10 gives the exact numbers needed to pass:

  | Measure | Needed |
  | --- | --- |
  | Finder | 24 / 28 |
  | Reply | 17 / 20 |
  | Coach | 13 / 15 |
  | EN | 25 / 31 |
  | BM | 13 / 16 |
  | 中文 | 13 / 16 |
  | Adversarial | 21 / 23 |
  | Double-rated agreement | 12 / 14 |

- §11 moves the issues that only X cases touched into "Not tested this round". These are
  phone/IC redaction, the language chip, sticky routing, and journey/stall.
- §13 appendix: 63 cases, 149 runs, 14 double-rated.

**To confirm with Derek**

- The second-rater process proposed in the plan: each rater keeps their own copy, and the
  coordinator lines the two up.
- The tester load of about 3–4 runs per day.
