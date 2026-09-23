# Claim: quick-kayinleong-093
- owner: kayinleong
- session: claude-code
- branch: quick-kayinleong-091
- started: 2026-09-23
- status: claimed
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

_(pending)_

## Verification

_(pending)_
