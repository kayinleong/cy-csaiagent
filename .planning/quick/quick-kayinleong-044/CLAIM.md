# Claim: quick-kayinleong-044

- owner: kayinleong
- session: claude-code
- branch: quick-kayinleong-044-phase1-test-excel
- started: 2026-07-19
- status: in-progress
- summary: Create a human-usable Excel workbook of Phase 1 (AI Onboarding Coach MVP) test cases so a tester can verify Phase 1 is complete.

## Context

`/gsd-quick --research`. Research is already in hand: this session produced a full Phase 1 (Coach MVP) scope audit + `PHASE-1-TEST-TABLE.md` (UI acceptance + 12 scope items + the 4 live-route wiring gaps). This task packages that into a tester-friendly `.xlsx`. Phase numbering: PDF "Phase 1" = Coach MVP = GSD ROADMAP Phase 2 (see memory `phase-numbering-mismatch`).

## What will change

- `docs/Phase-1-Test-Cases.xlsx` (new) — 3 sheets:
  - **Instructions** — purpose, prerequisites (accounts/seed data/languages/lazy-cron), legend (which columns the tester fills), one worked EXAMPLE row.
  - **Test Cases** — grouped matrix (UI/chat, Coach MVP scope, admin/management) with ID, Area, Test Case, Priority, Preconditions, Steps, Expected Result, Result (Pass/Fail/Blocked/Not Run dropdown), Actual/Comments, Known Status (flags the 4 wiring gaps expected to fail today).
  - **Sign-off** — the 5 Phase-1 success criteria + the M-03 pilot gate + a COUNTIF result summary + overall Go/No-Go verdict, tester, date.

## What has changed

_(filled as work completes)_

## Verification

_(Regression Report — filled before status: done)_
