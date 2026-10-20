# Claim: quick-kayinleong-097
- owner: kayinleong
- session: claude-code
- branch: quick-kayinleong-097
- started: 2026-10-20
- status: done
- summary: update the client UAT output test cases so testers see and check the data loaded in quick-096 (sold-out units, nett from-prices, fact-sheet facts, held-back honesty)

## What will change

The client UAT cases (claim 095) were written before the client project sheet was loaded
in claim 096. This claim does two things:

- **Re-checks** every Finder expected result against the post-import data.
- **Adds cases that exercise the new data**, so testers can confirm it in the app's answers:
  - sold-out layouts are flagged and never offered;
  - nett "from" prices are used in budget searches;
  - the new per-unit nett and gross prices;
  - developer, maintenance, units and completion facts, which come from the new Finder
    fact sheets;
  - the 2026 focus lists;
  - honest "not confirmed" answers for values held back.

Files touched: the case source (095 `uat-cases.json`), the workbook build/verify scripts, the
client workbook and the plan doc. There are no app code changes and no Firestore writes.

## What has changed (5414453)

- **New section N · New project data (client sheet, October 2026).** It has 14 cases
  (EN N1–N8, BM N9–N11, 中文 N12–N14), placed after Finder in the tester workbook.
  - **New nett from-prices in budget searches:** Luminar Subang from RM411,000 (N1, N13),
    and Parkside from RM588,000, which was RM920,000 before the import (N2, N9).
  - **Sold-out layouts are flagged and never offered:** One Eleven Type M2 (N3, N12),
    DC Residensi (N4) and Eden Type C1 (N14).
  - **Nett is given before gross:** SO Sofitel Type B1A, nett RM1,525,440 vs gross
    RM1,906,800 (N5).
  - **Fact-sheet facts:** Eden developer, units and completion (N6), and Kensho maintenance
    (N10).
  - **2026 focus list:** Southpoint (N7).
  - **Held-back values answered honestly:** DC Residensi Type E1 size (N8) and Imperial H1a
    nett (N11).
- **Two new known-status phrases:** NEW DATA and HELD BACK.
- **The gate now checks the new figures:**
  - B7 checks unit facts against `projects.export.json` (2026-10-20).
  - B8 checks gross figures, held columns, facts and focus lists against the 096
    normalised sheet.
  - B9 checks that every size and price in an N case's MUST clause is backed by a fact.
- **Plan doc updates:**
  - §1–§3 now mention the 20 October refresh and the new N subsection.
  - §5 has 180 runs.
  - §10 exact numbers: Finder 36 of 42, adversarial 24 of 26, double-rated 13 of 16.
  - §11 gains a fact-sheet data note.
  - §13 appendix has the N rows.
- **Executor deviations** (all acceptable):
  - project names were added to 9 MUST lines so the name check passes, with no new facts;
  - the Southpoint "(IGB )" stray space is normalised in the name check;
  - Finder covers F + N for EC3/EC4;
  - the builder pins zip entry times, so rebuilds are byte-identical.

## Verification

- **Gate:** 41 PASS, 0 FAIL, re-run by the orchestrator.
  - `--self-test` catches all 12 injected defects, including:
    - N3 Type M1 size changed;
    - One Eleven M2 marked available in an export copy;
    - Eden totalUnits changed.
  - The executor also bit-tested N5's MUST price, N11's gross figure, N7's focus list,
    N8's held column and N4's B2 sold-out flag.
- **Existing cases:** the 63 existing tester cases and the 14 X cases are unchanged by id
  against HEAD, as checked by the orchestrator.
- **Determinism:** two rebuilds give a byte-identical workbook.
- **Tester read:** the orchestrator read the N rows as a tester would. Steps end with the
  paste-into-Actual / Comments line, and Known Status leads with NEW DATA or HELD BACK.
- **Hygiene:** no contacts and no internal labels in the client files (C1–C4). The export
  loader never reads `description`.

## Regression surface

- Only the 095 UAT sources, the workbook and the plan doc changed.
- No app code, no Firestore writes and no API calls.
