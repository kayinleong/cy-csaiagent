# Claim: quick-kayinleong-044

- owner: kayinleong
- session: claude-code
- branch: quick-kayinleong-044-phase1-test-excel
- started: 2026-07-19
- status: done
- summary: Create a human-usable Excel workbook of Phase 1 (AI Onboarding Coach MVP) test cases so a tester can verify Phase 1 is complete.

## Context

`/gsd-quick --research`. Research is already in hand: this session produced a full Phase 1 (Coach MVP) scope audit + `PHASE-1-TEST-TABLE.md` (UI acceptance + 12 scope items + the 4 live-route wiring gaps). This task packages that into a tester-friendly `.xlsx`. Phase numbering: PDF "Phase 1" = Coach MVP = GSD ROADMAP Phase 2 (see memory `phase-numbering-mismatch`).

## What will change

- `docs/Phase-1-Test-Cases.xlsx` (new) — 3 sheets:
  - **Instructions** — purpose, prerequisites (accounts/seed data/languages/lazy-cron), legend (which columns the tester fills), one worked EXAMPLE row.
  - **Test Cases** — grouped matrix (UI/chat, Coach MVP scope, admin/management) with ID, Area, Test Case, Priority, Preconditions, Steps, Expected Result, Result (Pass/Fail/Blocked/Not Run dropdown), Actual/Comments, Known Status (flags the 4 wiring gaps expected to fail today).
  - **Sign-off** — the 5 Phase-1 success criteria + the M-03 pilot gate + a COUNTIF result summary + overall Go/No-Go verdict, tester, date.

## What has changed

- `docs/Phase-1-Test-Cases.xlsx` (new) — 3-sheet human test plan (Arial, no gridlines, frozen headers, section bands, yellow tester-input cells):
  - **Instructions** — purpose, prerequisites (accounts / trilingual seed KB / mobile / on-visit lazy-cron), a "fill only the yellow cells" legend, and one worked EXAMPLE row.
  - **Test Cases** — 34 cases in 3 groups: A1–A13 (UI & chat surface), B1–B17 (Coach MVP core scope), C1–C4 (admin/management). Columns: ID, Area, Test Case, Priority (P0/P1/P2), Preconditions, Steps, Expected Result, Result (Pass/Fail/Blocked/Not Run dropdown, defaults "Not Run"), Actual/Comments, Known Status. The 4 live-route wiring gaps are flagged "KNOWN GAP … expected to FAIL" across B4–B8; recent fixes (B3, C1–C4) noted "should PASS".
  - **Sign-off** — an auto COUNTIF result summary + the 5 Phase-1 success criteria + the M-03 pilot gate (Pass/Fail/Partial dropdowns) + an overall GO/NO-GO verdict, tester, role, date.

## Verification

- Built with `openpyxl`. Structure verified by reading the file back: 3 sheets; **34 data rows** all defaulting to "Not Run"; 3 section headers; all 34 IDs present (A1–A13, B1–B17, C1–C4); Result dropdown on Test Cases; 2 dropdowns on Sign-off (criteria + GO/NO-GO); summary formulas reference `'Test Cases'!$H$2:$H$38`.
- `recalc.py` could NOT run (no LibreOffice/`soffice` on this machine). The only formulas are 5 standard `COUNTIF`/sum summary cells (Excel-2007-era, guaranteed-valid); Excel / Google Sheets / Numbers / LibreOffice all recalculate on open, so they compute for the tester (initial: Total 34, Not run 34, Pass/Fail/Blocked 0). Only the cached preview value is absent until first open — cosmetic.
- Content grounded in this session's Phase 1 scope audit + `.planning/quick/quick-kayinleong-032/PHASE-1-TEST-TABLE.md`.

**Regression Report**
- *Surface:* none in the app — this claim adds a single documentation artifact (`docs/Phase-1-Test-Cases.xlsx`). No `src/`, `app/`, config, or test code changed; no build/test impact.
- *Accuracy:* the "Known Status" flags mirror the audited live-route gaps (KB-miss recording, journey injection, checkpoint advancement, activity-timestamp) so a tester isn't surprised when B4–B8 fail on the current build; the recently-fixed items (B3, C1–C4) are marked expected-PASS.
- *Recalc caveat:* documented above — no local LibreOffice; formulas are trivial and self-correct on open.
