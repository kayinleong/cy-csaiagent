# Claim: quick-kayinleong-093
- owner: kayinleong
- session: claude-code
- branch: quick-kayinleong-091
- started: 2026-09-23
- status: done
- summary: extract property field values out of the Drive document text, merge them into the real field columns of the Raw Data sheet, and drop the Drive Doc columns

## What will change

`quick-kayinleong-092` put 901 Drive documents into the sheet as 452 raw-text columns.
The user now wants the *data* out of those documents folded into the actual field
columns, and the document columns removed.

**Why this is not a parsing job.** The Skool write-ups are semi-structured
`Label: value` prose, which is why quick-091 could parse them deterministically. The
Drive documents are not: running the same parser over all 901 yields labels from only
362, and those labels are overwhelmingly boilerplate — `Disclaimer`, `NOTE`,
`No. Pendaftaran LAM`, architect names, fax numbers. The corpus is 186 e-brochures,
69 price lists, 62 payment schedules, 45 parking lists, 38 floor plans and 444 mixed
sales kits / FAQs / forms. Getting fields out means reading them.

**The known trap.** `quick-kayinleong-088` found that **21 of 51 stored prices were
invented** by exactly this kind of extraction — the extractor multiplied a stated psf
rate by a square footage it made up (Luminar: "RM720 psf" became RM360,000 on a write-up
that said "below RM800K"). Any value taken from these documents has to be quoted
verbatim from the source or discarded, which is the guard `to-inventory.ts` already
encodes as `priceEvidence`.

### Approach

Two stages, so that no model ever has to swallow 9.16M characters:

1. **Deterministic candidate harvest.** Regex over the document text for lines that could
   carry a target field (tenure keywords, `RM` amounts, `psf`, `sqft`, completion/VP
   dates, bumi/MM2H mentions, maintenance and booking fees, storey/unit counts). Reduces
   the corpus to a small set of verbatim candidate lines per project.
2. **This session reads the candidates** and decides each value — no project Gemini/Claude
   tokens, per the standing instruction. Every accepted value must appear verbatim in a
   candidate line; anything requiring arithmetic is rejected.

### Merge policy

- Fill a field **only where the Skool write-up left it blank.** The Skool text is D2's own
  curated summary and stays authoritative; documents supplement, never overwrite.
- A field found in documents that Skool never had becomes a new column.
- Cells stay raw values only — provenance is recorded in a separate audit artifact under
  this claim, not in the sheet.
- All `Drive Doc *` columns are dropped, and `Drive Doc Count` / `Drive Doc Titles` with
  them.

## What has changed

Four new scripts plus a gitignore entry. **No application code touched, no Firestore
writes, no project AI tokens spent** — the reading was done by this Claude Code session,
per the standing instruction.

- `harvest-candidates.py` — stage 1, deterministic. Regex over the document text for
  lines that could state one of 20 target fields. **9,160,578 chars → 1,357 verbatim
  candidate lines (154k chars).**
- `merge-doc-fields.py` — stage 3. Enforces the gates and writes the merged sheet.
- `verify-merge.py` — traces every written value back to the source document text.
- `AUDIT.json` — per-value provenance: evidence line, source filename, target column.

### Deliverable

`D2-Property-Raw-Data.xlsx` — one sheet, `Raw Data`, **84 rows × 242 columns**. All 452
`Drive Doc` columns removed (including `Drive Doc Count` / `Drive Doc Titles`);
**62 values merged into the real field columns** across 23 projects; 2 new columns
(`Bumi Quota`, `Price psf`).

### Results

Cross-referencing the 1,357 candidates against the sheet: 131 field-slots were already
filled from Skool, **192 were blank with document candidates** across 49 projects. Of
those 192, **62 were filled** (32%). Merged by field:

| | | | |
| --- | --- | --- | --- |
| Bumi Quota 15 | Price 11 | Main Unit Layouts 8 | Target Completion 5 |
| Total Storeys 4 | Facilities 3 | Booking Fee 3 | Ceiling Height 2 |
| Total Units 2 | Car Parks 2 | Maintenance Fee 2 | Units Per Floor 1 |
| Price psf 1 | Furnishing 1 | Tenure 1 | Developer 1 |

`Foreign Eligible` got **zero** accepted values — every candidate mentioned foreigners
without stating eligibility (tourist marketing, consent-fee liability, bank margins), so
no column was created for it.

### The finding: KB project attribution is unreliable

The single most important result is not a number in the sheet. `to-kb.ts` takes a
document's project from its **Drive folder**, and some folders are shared collateral
dumps. `Damansara City Residency (DC Residensi)` is credited with **194 documents that
are overwhelmingly other developments** — WOLO, Ashwood, The Reya, OAKA, ALTRIS, Skyline
Embassy, Papyrus, The Atrium, Maple Residences, Allevia. Measured across the corpus by
filename, **61 of 901 documents name a different development than the project they are
filed under**; by text content the true figure is higher.

A naive merge would have written OAKA's completion date and competitors' psf rates into
the wrong rows — the exact quick-088 failure mode. This is a live defect in the KB that
also affects Finder retrieval, not just this workbook.

### Decisions

- **Fill blanks only.** 0 Skool values were overwritten; D2's curated write-ups stay
  authoritative. (0 collisions actually arose — the 62 all landed in genuinely empty cells.)
- **Never calculate.** The documents state **per-unit-type** figures, not project-level
  ones. Deriving a range means a min/max across lines, which is arithmetic — and
  arithmetic is what invented 21 of 51 prices in quick-088. All five readers independently
  refused those, and that is the single largest rejection category.
- **Evidence gate scoped per project, not per field.** The harvester's bucketing is
  imperfect (a completion year lands in the `Price` bucket because the line contains
  "RM"). The gate exists to prove text came from real source documents, not to police
  regex bucketing.
- **Scope wording preserved inside values.** Where a figure covers one tower or phase
  (Star Residences' Ascott Star tower, Aetas Block A, Enlace Suite 1), the qualifier stays
  in the value rather than being presented as project-wide.
- **Provenance kept out of the sheet.** Cells are raw values only, per the original
  brief; evidence and source filename live in `AUDIT.json`.

## Verification

### What was tested

| Check | Result |
| --- | --- |
| Sheet count / name | 1 sheet, `Raw Data` ✓ |
| Rows | 84, unchanged ✓ |
| `Drive Doc` columns remaining | **0** ✓ |
| Skool values overwritten | **0** ✓ |
| Extractions passing the evidence gate | 62 / 62 ✓ |
| Extractions passing the attribution gate | 62 / 62 ✓ |
| **Values traced to verbatim text in the document they cite** | **62 / 62** ✓ |
| Cited document actually belongs to that project | 62 / 62 ✓ |
| Value present in the cell it claims | 62 / 62 ✓ |

`verify-merge.py` deliberately checks against `kb-text.json` — the source document text —
rather than against `candidates.json`, which is my own intermediate artifact. Verifying
against the intermediate would have proved nothing about the documents.

### What was ruled out and why

- **Invented values (the quick-088 trap).** Two independent gates: evidence must appear
  verbatim among the harvested lines, and the value must appear inside its own evidence.
  Then verification re-checks the evidence against the full document text. Every value in
  the sheet is readable in a real document.
- **Cross-project contamination.** A programmatic attribution gate rejects any value whose
  source filename names a different development. It fired zero times at merge, because the
  five readers had already rejected those candidates — the gate is the backstop, and the
  independent verification confirms all 62 cite documents belonging to their own project.
- **Silent overwriting of curated data.** Asserted cell-by-cell against the quick-091
  baseline across all 84 × 240: zero changes to any populated Skool value.
- **A broken gate passing everything.** The gate was proven to bite: an earlier per-field
  scoping discarded a correct completion year, which is what surfaced the bucketing issue.

### Regression surface

No application code, no shared script, no Firestore writes. All new files are
self-contained under this claim directory; the only edit outside it is an append to
`.gitignore`. quick-091 and quick-092 workbooks are untouched — this writes a new file
and uses quick-091 read-only as the baseline.

## Security

Same posture as quick-091/092: the generated workbook carries unredacted contact details
and is **gitignored**. `AUDIT.json` holds evidence lines from property documents (no
contact details) and is committed for traceability.
