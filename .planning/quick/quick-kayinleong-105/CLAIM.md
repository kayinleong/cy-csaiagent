# Claim: quick-kayinleong-105
- owner: kayinleong
- session: claude-code
- branch: quick-kayinleong-105 (from quick-kayinleong-104, whose planner writes `area` and gross prices)
- started: 2026-11-21
- status: in-progress
- summary: Import the 21 Nov client workbook (_D2 Project Info.xlsx, sha256 0a390f6e…) so the Finder gets each project's Area and the new layout prices, including Pavilion Damansara Heights and its Royal Suites.

## What will change
- Rebuild the normalized sheet, mapping and held-back list from the 21 Nov workbook with the claim 096 builder, into `build/` in this claim directory, as claim 101 did.
- Fix the builder only where the new workbook needs it:
  - The new price formats: "RM630k - RM959k", "RM1.18m - RM1.6mil", "Rm4.77mil – Rm6,59mil".
  - psf-only gross cells ("RM 1.6k-2.3k psf") stay not-a-total and are never multiplied by a size.
  - The `=AI("Fill an appropriate value…")` formula cells (rows 20 and 79) are held back, never loaded.
  - Pavilion Damansara Heights' single "Phase 1" row is loaded as a layout.
- Diff against what 096/101 loaded, then dry-run the 096 import runner against live data. The report goes in this claim directory.
- Live writes happen only after the user approves the dry-run fingerprint. They also wait for the user's corrected workbook ("Damansara Height" → "Damansara Heights", rows 2 and 21).

## What has changed
(pending)

## Verification
(pending)
