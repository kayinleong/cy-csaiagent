# Claim: quick-kayinleong-104
- owner: kayinleong
- session: claude-code
- branch: quick-kayinleong-104
- started: 2026-11-21
- status: in-progress
- summary: Finder Damansara Heights search. The budget floor checks a project's gross layout prices instead of its cheapest "from" price, and the client sheet's Area is saved on existing projects and used by the location search.

## The report
"budget around RM1.5MIL TO RM2.5MI 2 OR 3 BEDROOM IDEALLY ... under damansara height". The Finder showed The Cedar and One Eleven Menerung @ Bangsar. D2 has five projects in Damansara Heights. Measured on the live data (read-only):

| Project | from price (priceValue) | Why it was dropped |
|---|---|---|
| Pavilion Damansara Heights | RM861,120 | from price under the RM1.5M floor |
| Pavilion DH: Royal Suites (RC) | RM652,284 | same |
| DC Residensi | RM1,200,000 | same, and its address ("Pusat Bandar Damansara, ...") does not say Damansara Heights |
| The Cedar | RM2,946,200 | over RM2.5M (the user's run let it through, so that run did not cap at RM2.5M) |
| PDH: Imperial Residences | RM5,050,000 | over RM2.5M |

A re-run of the real Finder on the same message applied RM1.5M-2.5M and returned only One Eleven Menerung (nearby, Bangsar).

## What will change
1. **Budget floor on gross prices** (the user's call: "use gross price").
   - `UnitTypeEntry` gains `grossMinRM` / `grossMaxRM`. The client-sheet import stores the sheet's Gross Price per layout next to the nett price. A psf-only gross cell ("RM 1.6k-2.3k psf") is not a total and stays null; it is never multiplied by a size.
   - `projectMatchesPrice`: the floor (`priceMin`) is checked against the project's TOP price: the highest gross price among its available layouts, else their highest nett price, else the from price (`priceValue`) as today. The ceiling (`priceMax`) stays on the from price. Unknown price is still admitted.
   - Measured on the live data: keeping every project without layout prices would let 74 of 82 through an "above RM3M" search (today 33). The fallback to the from price keeps that at today's behaviour.
   - The Finder prompt's budget rule is corrected: a from price under the floor is expected when larger layouts reach it.
2. **Area column used for search.**
   - The import writes the sheet's Area to a new `area` field on existing projects (a blank cell never clears it; `locationText` is never overwritten). New projects get it too.
   - The location gate and the in-area/nearby classification read `area` as part of the project's own address.
3. **Not in this claim's code:** importing the new workbook (`_D2 Project Info.xlsx`, sha256 0a390f6e…). It is built and dry-run here; the apply is a production write and waits for the user. The sheet needs two fixes first: "Damansara Height" → "Damansara Heights" (rows 2 and 21), and the `=AI(...)` formula cells (rows 20 and 79).

## What has changed
(pending)

## Verification
(pending)
