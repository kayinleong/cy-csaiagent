# Claim: quick-kayinleong-097
- owner: kayinleong
- session: claude-code
- branch: quick-kayinleong-097
- started: 2026-10-20
- status: claimed
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
