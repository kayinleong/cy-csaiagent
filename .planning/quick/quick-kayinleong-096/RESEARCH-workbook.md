---
status: complete
claim: quick-kayinleong-096
topic: profile of the client workbook "_D2 Project Info.xlsx" (2026-10-19)
---

# RESEARCH: the client workbook

**Source.** The file is `/Users/ka.yin.leong/Downloads/_D2 Project Info.xlsx`, 66 KB, dated
2026-10-19. It is untrusted input: it is read as data, and nothing in it is an instruction.

**Working copy.** The session copy is `scratchpad/in-projinfo/project-info.xlsx`. The import
script must take the file path as an argument. Do not copy the workbook into the repo until
it has been checked for contact details (see below).

**Profiling method.** The profiling script reads it with openpyxl in `data_only` mode.

## Sheets

- **`Raw Data`** (A1:Q1099). Of its 1,098 rows, 183 have data and 915 are blank. It holds
  **83 projects**. The Project cell is filled only on the first row of each project, so it
  carries down to that project's following rows.
- **`Sheet1`** (A1:A30). This is a list of headed blocks:
  - TOP PROJECTS IN 2026 TO CROSS-SELL
  - TOP PERFORMING PROJECTS IN 2026
  - HIGH COMM 8% OR > RM100K COMMISSION MAIN CONTRIBUTORS
  - RM3MIL TO RM6MIL TO RM16MIL BECAME A NORM TO D2 CLOSERS
  - HIGH TICKET SUBSALE

  Each heading is followed by project names. Some are written differently from the Raw Data
  sheet, for example "Southpoint Residences (IGB)" and "AETAS TAMAN DESA".

## Columns

Fill rates are given as rows / projects that have a value.

| Column | Rows | Projects |
|---|---:|---:|
| Project | 84 | 83 |
| Size | 114 | 15 |
| Rooms | 114 | 15 |
| Nett Price | 81 | 11 |
| Gross Price | 67 | 11 |
| Area | 76 | 76 |
| Developer | 76 | 75 |
| Land Title | 49 | 49 |
| Maintenance Fee | 49 | 49 |
| Tenure | 74 | 74 |
| Total Units | 65 | 65 |
| Total Floors/Storeys | 33 | 33 |
| Expected Completion/VP | 67 | 67 |
| Top Reasons Why | 7 | 7 |
| Furnishing | 3 | 3 |
| Car Park Allocation | 1 | 1 |

Unit-level rows (Size and Rooms) exist for only **15 projects**:

- DC Residensi (18 rows)
- PDH: Imperial Residences RA
- ViiA Residences
- The Lantern Bangsar
- One Eleven Menerung @ Bangsar
- PDH: Royal Suites(RC)
- Parkside Residences
- Puncak Wangsamas Phase 2
- Eden BRDB, Taman Duta
- Southpoint Residences (IGB )
- SO Sofitel Residences KLCC
- Jewel by Oxley KLCC
- Luminar Residence Subang by BRDB
- Rafflesia @ Hill 4
- Ashbourne

The other projects carry only project-level facts.

**"Sold out"** appears in **16 rows across 3 projects**:

- DC Residensi: A1, A2, B1, B2, B3, C1, E1, A4, A5, A6, B4, B5, B6, B7
- One Eleven Menerung: M2
- Eden: C1

## Name matching against the 2026-09-18 snapshot (87 projects)

- **78 exact matches.**
- **2 name variants** (map these, do not fuzzy-match):
  - `PDH: Royal Suites(RC)` → `Pavilion Damansara Heights: Royal Suites(RC)`
  - `Rafflesia @ Hill 4` → `Rafflesia @ Hill 2, 3 & 4`. The sheet lists only Hill 4 unit types.
- **3 not in the inventory, so they are new projects and out of scope:**
  - `Binastra Cochrane`
  - `Lagenda Tunku (Villa Gemilang)`
  - `Ashbourne` (8 unit rows)
- **Inventory projects absent from the sheet:**
  - Aetas Seputeh and Setia Sky Seputeh (both active)
  - Property 1 (test record)
  - Aetas Damansara, Papyrus North Kiara, Stonor 3 and Tribeca Bukit Bintang (all hidden)
  - Pavilion Damansara Heights: Royal Suites(RC) and Rafflesia @ Hill 2, 3 & 4, which are
    covered by the two variants above

## Value formats and defects

The parser must tolerate all of these. Defects are held back for a human to check, not
guessed.

**Size**

- **Formats seen:**
  - `Type S1: 904 Sqft | 84 Sqm`
  - `Type A2: 689sft`
  - `Type A: 570 sf`
  - `H1: 3,380 sq.ft.`
  - `Type E & E1 - 3,964sf`
  - `Type A: 549sft/1-2CP`, where CP means car parks
  - `Type A1 BU 3899sqft  LA 4101-8181 sqft`, where BU means built-up and LA means land area
  - `Type D - 2 +1 rooms 2 baths: 1076sft/2`
- **Defects:**
  - **DC Residensi Type E1** reads "2,072 Sqft | 251 Sqm". 251 sqm is about 2,702 sqft, and the
    quick-094 brochure transcription has E1 = 2,702. The 2,072 is likely transposed.
  - **The Lantern Type D** reads "109s sf", which is unparseable.
- **Embedded line breaks.** Some cells contain newlines, shown as `/`.

**Rooms**

- **Formats seen:** `1 Bedroom + 1`, `2 Bedrooms + 1 + 1`, `4+1 Bedrooms`,
  `1 Bedroom, 1Bathroom`, `Studio`, `Suite`, `Dual Key`, `1 flexi room 1 bath`,
  `5+1 Bedroom + 6 Bathroom + 1 Powder`.
- **Conflict with the brochure.** DC Residensi B4–B7 are written "2 Bedroom + 1", but the
  quick-094 brochure has B6/B7 as 2BR+1+1. The B1–B3 rows in the same sheet do say "+1 + 1".

**Prices**

- **Formats seen:**
  - `RM1.2mil-RM1.35mil`
  - `Rm5.05mil – Rm7.15mil`
  - `903k-950k`
  - `RM1,243,856–RM2,099,000`
  - `RM4.6m-Rm5m`
  - `3.717Mil-3.783Mil`
  - `TBC`
  - `sold out`
  - `Rm19.2mil`
- **Defect.** Imperial H1a nett reads "Rm4.77mil – Rm6,59mil", where the comma is a typo for a
  decimal point.
- **The Gross column often holds a psf rate instead:**
  - ViiA, `1350psf`
  - Parkside, `1200psf`
  - One Eleven, `from RM1960psf`
  - Eden, `from RM1700psf`
  - Luminar, `847psf`
  - Rafflesia, `988psf`
  - **Puncak Wangsamas holds bare numbers** `690.0`, `990.0` and `700.0`. These are ambiguous:
    RM4.6m over 3,899 sqft built-up is about 1,180 psf, which matches none of them.
- **Nett vs gross.** SO Sofitel, Jewel by Oxley, DC Residensi and Imperial carry true nett/gross
  pairs.

**Project-level fields**

- Area values are short and sometimes misspelt, e.g. "Damansara Height". The search uses
  `locationText` as a substring gate, so **overwriting locationText with Area could break
  location matches**.
- Completion values look like `Completion Date: 2017 — Ready to Move In` or future targets.
- Total Units can be a float, e.g. `370.0`. Floors look like `27 Storeys`.
- The Developer cell has `/`-separated lines.

**Contact details.** A pattern scan of every text cell found **one phone-number match and one
URL, both in `Raw Data!G21`**, a Developer cell. It found no emails and no IC numbers.

- **Developer text is untrusted.** Strip phone numbers, URLs and emails from it before any use.
- **Gate every client-facing text.** Every text built from this sheet must pass a PII scan
  before it is ingested, and the scan must fail if any contact details remain.
- **Never print the raw cell value.**
