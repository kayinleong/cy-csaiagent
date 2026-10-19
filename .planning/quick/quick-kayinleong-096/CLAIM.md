# Claim: quick-kayinleong-096
- owner: kayinleong
- session: claude-code
- branch: quick-kayinleong-091
- started: 2026-10-19
- status: claimed
- summary: ingest the client's updated "_D2 Project Info.xlsx" (per-unit-type sizes, nett/gross prices, sold-out units, project facts, 2026 cross-sell list) into the existing project records

## What will change

The client supplied a workbook with updated data for projects that already exist in
the inventory. This claim maps that workbook onto the existing project records and
writes the new values. It does not create new projects.

How the data is merged, and which environment it goes into, are confirmed with the
user before anything is written to live Firestore.
