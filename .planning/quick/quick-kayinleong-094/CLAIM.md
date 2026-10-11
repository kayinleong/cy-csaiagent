# Claim: quick-kayinleong-094
- owner: kayinleong
- session: claude-code
- branch: quick-kayinleong-091
- started: 2026-10-11
- status: done
- summary: extract every unit type from the DC Residensi international brochure into an Excel sheet in the client format ("Type B2 1851 sqft 172sqm 2br+1+1"), one row per type

## What will change

The current Raw Data sheet groups DC Residensi layouts into ranges
("2+1 Bedrooms: 1,600 – 1,800 sqft"). The client wants each unit type listed
exactly and individually. Source: `DC Residensi (ENG) Intl Brochure FA-compressed.pdf`
(user's Downloads). Output: a standalone `.xlsx` under this claim directory.
No application code, no Firestore writes.

## Research

`--research` was requested. The open question was how to read the source, not which
library to use, so it was answered directly rather than by a spawned researcher:

- The PDF is **16 pages and image-only**: pdfjs finds no text layer (one item in the
  whole file, a phone number). Text extraction is impossible; the pages must be read.
- `pypdf`/`poppler` are absent and pdfjs + `@napi-rs/canvas` fails on `Path2D`.
  macOS **PDFKit via `swift`** renders every page cleanly — used at 1x to survey and
  3x to read labels. Render scripts lived in the session scratchpad, not the repo.
- Unit data is on **PDF pages 14 and 15** (brochure pp.24–27): one spread per tower,
  9 types each, with a key plan. PDF page 11 (p.19) states *"18 layouts ranging from
  904 sf to 2,982 sf"*, which gives an independent completeness check.
- No penthouses, car-park allocations, prices or per-unit facing appear anywhere in the
  brochure.

## What has changed

Three new files under this claim directory, plus the workbook. No application code,
no Firestore writes, no project AI tokens.

- `unit-types.json` — hand transcription of all 18 types: tower, type, sqft, sqm,
  layout, key-plan unit number, and every room label drawn on the plan.
- `build-unit-types.py` — formats the JSON into the workbook. The listing is a string
  template (`Type {type} {sqft} sqft {sqm}sqm {layout lowercased}`); room columns are a
  label-for-label split. Nothing is calculated. An unrecognised room label fails the build.
- `verify-unit-types.py` — 108 checks, below.
- `DC-Residensi-Unit-Types.xlsx` — deliverable. Committed: it holds only brochure facts,
  no contact details (unlike the gitignored 091–093 workbooks).

### Deliverable

Three sheets:

1. **Unit Types** — 18 rows, one per type, in brochure order. Column A is the client
   format, e.g. `Type B2 1851 sqft 172sqm 2br+1+1`. Then Project, Tower, Type, sqft, sqm,
   layout, then the rooms as labelled on each plan (bedrooms / study-utility-maid's-family /
   bathrooms & WC / other spaces), key-plan unit number, and source page.
2. **Paste Into Raw Data** — all 18 lines in a single cell, for the Raw Data sheet's
   `Built-Up sizes & Layout` column.
3. **Notes** — source, method, completeness check, and caveats.

### Decisions

- **Rooms are copied, not interpreted.** The brochure never says which room a "+1" is.
  The column lists every study/utility/maid's/family room drawn on the plan instead of
  asserting a mapping (e.g. A1 is 1BR+1 but draws both a Study Room and a Utility).
- **No bathroom count.** Whether a powder room or maid's WC counts as a bathroom is a
  judgement call; the labels are given instead.
- **Plain values, no formulas.** No LibreOffice here to cache formula results, and the
  user opens the sheet in Google Sheets on mobile; plain text is what they copy.
- **The Raw Data workbook was not edited.** The request was a new Excel file. Its
  disagreements with the brochure are recorded in the Notes sheet instead.

### Findings — current Skool write-up vs brochure

| Skool write-up | Brochure |
| --- | --- |
| 1+1 Bedrooms: 1,100 sqft | 1BR+1 types are 1,152 / 1,163 / 1,184 / 1,194 sqft |
| 2+1 Bedrooms: 1,600 – 1,800 sqft | 2BR+1 is 1,668; 2BR+1+1 is 1,765 / 1,851 / 1,862 |
| 3+1 Bedrooms: 2,700 – 2,900 sqft | 3BR+1 (C1) is 2,077; 3BR+1+1 is 2,702 / 2,982 |
| Penthouses: 2,900 – 4,855 sqft | not in this brochure |

## Verification

### What was tested

`verify-unit-types.py` — **108 PASS, 0 FAIL.** The transcription is checked against
facts on the page that are independent of each other:

| Check | Result |
| --- | --- |
| 18 types, unique codes | ✓ |
| sqft ÷ 10.7639 agrees with the printed sqm (within 1) | 18 / 18 ✓ |
| Layout's BR count = bedrooms drawn on the plan | 18 / 18 ✓ |
| Mirror pairs identical across towers (S1/S2, A1/A5, A2/A6, B1/B5, B2/B6, B3/B7) | 6 / 6 ✓ |
| Range 904–2,982 sqft matches brochure p.19 | ✓ |
| Key-plan numbers per tower are 1, 2, 3, 3a, 5–9 once each | 2 / 2 ✓ |
| Every listing matches the client format; client's own example appears verbatim | ✓ |
| Workbook cells equal the transcription; room columns hold every label exactly once | 18 / 18 ✓ |
| Paste sheet = the 18 listings in order; Arial throughout; no formulas | ✓ |

### The gate bites

On a scratch copy, a transposed digit (B2 1851 → 1815) and a wrong layout (C1 3BR+1 →
2BR+1) were injected. The verifier failed **4 checks**: the sqm agreement, the bedroom
count, the B2/B6 mirror and the client example.

### What was ruled out and why

- **Misread digits.** Each sqft value is checked against its own printed sqm, and six
  types are checked against their mirror in the other tower.
- **Missed types.** The brochure states its own count and range, and both match.
- **Invented values (the quick-088 trap).** Nothing is derived. Every cell is a
  transcribed label or a string template over transcribed labels.

### Regression surface

None. No application code, no shared script, no Firestore, no edit to any earlier
claim's workbook. All files are new and under this claim directory.
