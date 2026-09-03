# Claim: quick-kayinleong-085
- owner: kayinleong
- session: claude-code
- branch: main
- started: 2026-09-03
- status: claimed
- summary: Property Finder returns all relevant matches in one detailed table (price/size/rooms/features) with a per-row "show more + supporting documents" chat action, instead of 5 cards

## What will change

User feedback, verbatim:
- "make it to show all relevant result in one table"
- "show important attribute (price, size, rooms and etc)"
- Example prompt: *"show me a list of 1mil property within Klang Valley"* should return a full list,
  not 5 cards.
- Retrieval should query the database **and** check embeddings to decide which properties match.
- The table's last column gets a **"show more detailed with supporting documents"** button that
  prompts the chat to expand that one property. Supporting detail includes the important features
  surfaced during WhatsApp ingestion.

Scope to be filled in after research + planning.

## What has changed

_(pending)_

## Verification

_(pending)_
