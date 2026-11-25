# Claim: quick-kayinleong-106
- owner: kayinleong
- session: claude-code
- branch: quick-kayinleong-106 (from origin/main 901319f, after PR 55 merged 104 + 105)
- started: 2026-11-25
- status: claimed
- summary: Finder shows each project's quick facts with the matches table; Damansara Heights' nearby set includes all the Bangsar projects in budget; "RM1.5mil-RM2.5mil" reaches the model as a budget, not a FIN_HASH token; import the 25 Nov client workbook (_D2 Project Info.xlsx, sha256 d7e46d3c…).

## What will change
Four items from the user (2026-11-25), each tested locally before any deploy (Firebase deploys are costly):

1. **Quick facts with the table.** When the Finder shows matching projects, each project carries a short summary built from its stored quick facts (like a "best for / layouts / key selling points" card), not only the table row.
2. **Nearby set for Damansara Heights.** "Damansara Heights, RM1.5M-2.5M, 2 or 3 bedrooms" should list the Bangsar projects in budget around it. The user counts 3 in Bangsar; the live table shows One Eleven Menerung only.
3. **Budget written as "RM1.5mil-RM2.5mil".** The PDPA pseudonymizer turns it into `<FIN_HASH:…>` tokens, so the model cannot read the budget. Budgets must reach the model; real financial identifiers must stay masked.
4. **25 Nov workbook.** Diff against the 21 Nov build (claim 105), dry-run the import and the fact sheets against live data, and apply only after the user approves the dry-run fingerprints.

Research first (`--research`), then plan in waves. Details are added here as they are settled.

## What has changed
(nothing yet)

## Verification
(pending)
