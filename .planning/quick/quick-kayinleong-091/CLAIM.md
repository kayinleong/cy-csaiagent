# Claim: quick-kayinleong-091
- owner: kayinleong
- session: claude-code
- branch: quick-kayinleong-091
- started: 2026-09-23
- status: claimed
- summary: scrape every raw property field from the D2 Skool classroom into a single-tab "Raw Data" Excel workbook — raw values only, no explanation — structured by this Claude Code session rather than the project's Gemini/Claude API budget

## What will change

`quick-kayinleong-090` shipped a data-*gap* workbook: it marks which fields are present
or blank, because the populated records live only in Firestore and the upstream
completeness report recorded presence, not values.

This claim produces the complementary artifact: the **raw values themselves**, taken
straight from the source of truth (the Skool classroom), in one flat sheet.

Deliverable: an `.xlsx` with exactly one tab named `Raw Data` — one row per property,
one column per field, raw scraped values. No read-me sheet, no data dictionary, no
gap summary, no commentary.

Constraint from the user: **do not spend the project's Gemini/Claude API tokens.**
`scripts/scrape-skool/to-inventory.ts` is the existing extraction path and it calls the
Anthropic API per project (`EXTRACT_MODEL`) — so it is explicitly out of scope. The
field extraction is done by this Claude Code session reading the raw scrape instead.

## What has changed

_(pending)_

## Verification

_(pending — includes the second pass back against Skool the user asked for)_
