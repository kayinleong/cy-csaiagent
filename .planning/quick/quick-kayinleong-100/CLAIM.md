# Claim: quick-kayinleong-100
- owner: kayinleong
- session: claude-code
- branch: quick-kayinleong-100 (stacked on quick-kayinleong-099, so the fix can be checked live on the Gemini dev server)
- started: 2026-10-27
- status: claimed
- summary: scope projectDetail's knowledge-base extracts to the project asked about, and default a missing `matches` to [] when decoding Finder replies

## What will change

Both defects came out of the 2026-10-27 field-check re-test (docs/UAT-Field-Check-Retest-2026-10-27.xlsx):

1. `projectDetail` fetched KB extracts with an unscoped similarity search
   (`src/agents/finder/tools.ts`). Other projects' fact sheets came back, and answers quoted
   their facts: St. Regis stated a developer that is not in the St. Regis fact sheet it cited;
   Aster Hill stated the St. Regis fact sheet's developer word for word.
2. A Finder reply without a `matches` key failed `FinderOutputSchema`, so a valid refusal
   (reason, explanation, next steps) rendered as a bare sentence (UAT F11 on Gemini).
