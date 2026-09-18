# Claim: quick-kayinleong-090
- owner: kayinleong
- session: claude-code
- branch: quick-kayinleong-090
- started: 2026-09-18
- summary: produce a client-facing Excel workbook enumerating every property/project attribute in the D2 inventory model, one row per project, blanks where data is missing, so Derek can fill the gaps
- status: claimed

## What will change

The client (Derek) owns D2's project inventory data but there is no single artifact that
shows, field by field, what the platform expects versus what has actually been supplied.
The inventory schema lives in `src/inventory/` and the 82-project roster is recoverable
from `projects.tokens.json`, but the populated records live only in Firestore — the
`/projects.inventory.json` dump is gitignored (`.gitignore:59`) and absent from a fresh
clone.

Deliverable: an `.xlsx` workbook with
1. a **data-dictionary** sheet — every field in the inventory model with type, required
   flag, allowed values, meaning, and whether it is client-supplied or system-derived;
2. a **per-project matrix** sheet — one row per D2 project, one column per client-supplied
   field, blank where the repo has no value, so gaps are visible at a glance;
3. notes on which fields the Property Finder actually matches/filters on, so the client can
   prioritise which blanks matter most.

No application code changes. This is a documentation/deliverable artifact only.

## What has changed

(in progress)

## Verification

(pending)
