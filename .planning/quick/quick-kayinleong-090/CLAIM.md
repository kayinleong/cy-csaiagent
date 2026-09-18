# Claim: quick-kayinleong-090
- owner: kayinleong
- session: claude-code
- branch: quick-kayinleong-090
- started: 2026-09-18
- summary: produce a client-facing Excel workbook enumerating every property/project attribute in the D2 inventory model, one row per project, blanks where data is missing, so Derek can fill the gaps
- status: done

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

Two new files, both under this claim directory. **No application code was touched.**

- `build-property-workbook.py` — the committed generator. Reads the schema (transcribed from
  `src/firebase/collections.ts`) and the per-project coverage matrix from
  `.planning/quick/quick-kayinleong-088/DATA-COMPLETENESS.md`, and emits the workbook. Committed
  so the artifact is reproducible rather than a one-off binary:
  `uv run --with openpyxl python .planning/quick/quick-kayinleong-090/build-property-workbook.py`

- `D2-Property-Data-Gaps.xlsx` — 8 sheets:
  1. **Read Me** — purpose, provenance, caveats, legend.
  2. **Property Details** — the fill-in matrix. 87 rows; the 5 non-Skool records are marked
     `SKIP` so the client roster reads as 82. 225 blanks to fill + 246 booleans to confirm.
  3. **Data Dictionary** — all 22 `ProjectDoc` fields: type, required, allowed values, meaning,
     client-supplied vs system-derived, traps.
  4. **Gap Summary** — per-field missing counts, prioritised.
  5. **Unit Types** / 6. **Collateral** — the two sub-records.
  7. **Not Yet Captured** — 33 attributes D2 talks about that have no field at all, with how
     often each appears in the 82 write-ups.
  8. **Data Traps** — the 9 conventions that corrupt the data if misread.

### Decisions

- **Presence, not values.** The workbook marks "on file" / blank rather than printing values.
  The populated records live only in Firestore; `/projects.inventory.json` is gitignored
  (`.gitignore:59`) and absent from a clean clone. The upstream report records presence only,
  by design (no PII, no values). Printing values would require a live read.
- **Client roster is 82, not 87.** `Property 1` is a test record; `Aetas Damansara`, `Stonor 3`,
  `Tribeca Bukit Bintang` and `Papyrus North Kiara` are hidden WhatsApp-import placeholders.
  Their cells are greyed so Derek is not asked to fill them.
- **Added confirm-columns for `vpStatus` / `bumiQuota` / `foreignEligible`.** These three are
  required booleans that the completeness report never measured — a boolean is always "present".
  A wrong Bumi or foreign-eligibility flag is an eligibility error with legal weight, so they are
  surfaced for confirmation rather than silently treated as complete.

## Verification

### Number provenance — a conflict resolved, not averaged

Two incompatible price-gap figures exist in `.planning/`:

| Source | `priceValue` missing | "no price signal at all" |
|---|---|---|
| `quick-088/CLAIM.md` | 57 | 37 |
| `quick-088/DATA-COMPLETENESS.md` | 27 | 7 |

Resolved by git, not by preference: `DATA-COMPLETENESS.md` was last regenerated **2026-09-07**
by `1f4586e` (quick-089's WhatsApp price recovery), while `088/CLAIM.md` was last written
**2026-09-06**. The CLAIM's figures are pre-recovery. **The workbook uses the
DATA-COMPLETENESS.md numbers**, and the Read Me states this so the client is not handed two
contradictory stories.

### What was tested

- Parser round-trip: exactly **87** rows parsed; the script `sys.exit`s if not. Status split
  83 active / 4 hidden matches the report header.
- Coverage cell conservation: 257 blank + 613 "on file" = **870 = 87 x 10** — every project x
  every measured field accounted for, none dropped or double-counted.
- Roster split: **82** rows marked `yes`, **5** marked `SKIP`, and the 5 are exactly the
  documented non-Skool records.
- Fill-target isolation: **225** yellow cells and **246** peach cells (= 82 x 3) fall on roster
  rows; **0** of either fall on skipped rows.
- Type hygiene: the KB-chunks column is integer throughout (min 0, max 2,550); the `(+N?)`
  fuzzy-match annotations were split into their own column rather than left to poison the type.
- Workbook re-opens cleanly in openpyxl; 8 sheets, dimensions as expected.

### Regression surface — nil, and checked

`git status` shows only the two new files under `.planning/quick/quick-kayinleong-090/`. No
source file, test, config, rule or script was modified, so no runtime behaviour can change. The
generator is standalone (`uv run --with openpyxl`) and adds no project dependency — `openpyxl`
is not in `package.json` and nothing in the app imports it. Secret scan over the new files:
clean. The upstream `DATA-COMPLETENESS.md` was read, never rewritten.

### Follow-up: real values instead of presence markers

Derek asked to see the actual value in each cell, not "on file". The values are not in the
repo, so this needed a live read:

- `scripts/export-projects-for-workbook.ts` — read-only dump of `projects` (+ per-project
  collateral counts) to a gitignored `projects.export.json`. Drops `embedding`. Added to
  `.gitignore` because full `description` prose can carry agent contact details — the same
  exposure that gitignored `/projects.json` and `/projects.inventory.json`.
- The generator now auto-detects that export. With it: real values, blanks only where the
  value is genuinely missing, plus two new sheets — **Layouts (data)** (one row per unit type)
  and **Descriptions** (the full write-up, where every unmodelled attribute still lives).
  Without it: the previous presence-marker behaviour, and the Read Me says which mode it is in.

Presence is recomputed from the exported values rather than trusted from the 088 report, so
the sheet is self-consistent with whatever the export actually contains.

**Value path was tested before shipping.** `PROJECTS_EXPORT` / `WORKBOOK_OUT` env overrides
let the generator run against a fixture; a synthetic 87-row export built from the hand-verified
spot-checks in `src/inventory/size-extract.test.ts` and `unit-types.test.ts` produced correct
scalars (`785,000`), formatted ranges (`802 – 2,125`, `1,700 – 2,300`), `Yes`/`No` booleans,
4 layout rows and 87 description rows. The literal-`"Unknown"` tenure trap fires: it renders
yellow and italic rather than counting as a known value.

### Known limitation (stated, not hidden)

Coverage is a **snapshot as of quick-089 (2026-09-07)**, not a live read. If inventory has
changed since, regenerate before sending to the client:

```
node_modules/.bin/tsx --env-file=.env.local scripts/data-completeness-report.ts
uv run --with openpyxl python .planning/quick/quick-kayinleong-090/build-property-workbook.py
```
