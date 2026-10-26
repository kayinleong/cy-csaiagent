# Claim: quick-kayinleong-098
- owner: kayinleong
- session: claude-code
- branch: quick-kayinleong-098
- started: 2026-10-26
- status: claimed
- summary: fix the Finder causes behind the 24 Oct UAT project failures — location 'near' scope, directional words, required no-match next step, property-type filter — plus the matching data corrections (dry-run first; live apply only on approval)

## What will change

The 24 Oct UAT run (docs: UAT-Output-Test-Cases-RESULTS.xlsx) failed four projects. Each was
reproduced by running the real gates in `src/inventory/search.ts` over the 2026-10-20 live export:

- d'Brightton titiwangsa returned for a KLCC search (F9).
- Alstonia Hilltop Homes returned for a North Kiara search (F5); St. Regis passes the same gate.
- No-match answers can drop the required next step (F11 run 3) and imply stock that does not exist.
- Office projects (Aspire office @ KL ecocity) appear in residential own-stay searches (N2).

Code and data fixes are planned in PLAN.md. Live Firestore writes happen only after the user
approves the dry-run diff.
