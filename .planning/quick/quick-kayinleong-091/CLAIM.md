# Claim: quick-kayinleong-091
- owner: kayinleong
- session: claude-code
- branch: quick-kayinleong-091
- started: 2026-09-23
- status: done
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

Three new scripts under this claim directory plus one gitignore entry. **No application
code was touched**, and `to-inventory.ts` was never invoked — zero Gemini/Claude API
tokens were billed to the project.

- `build-raw-data-workbook.py` — the committed generator. Reads the raw `projects.json`
  from `scripts/scrape-skool/scrape.ts` and emits the single-tab workbook.
- `verify-tail-scrape.ts` — targeted re-scrape used by the verification pass (see below).
- `verify-against-skool.py` — diffs the shipped workbook against one or more independent
  re-scrapes.
- `.gitignore` — excludes the generated `.xlsx`, matching the rule already in place for
  quick-090's LIVE workbook.

### Deliverable

`D2-Property-Raw-Data.xlsx` — one sheet, `Raw Data`, **84 properties × 240 columns**,
2,273 populated cells. Gitignored (see Security below); regenerate with:

```bash
PROJECTS_JSON=$SCRATCH/projects.json node_modules/.bin/tsx --env-file=$SCRATCH/skool.env \
  scripts/scrape-skool/scrape.ts
uv run --with openpyxl python .planning/quick/quick-kayinleong-091/build-raw-data-workbook.py \
  --in $SCRATCH/projects.json --out D2-Property-Raw-Data.xlsx
```

### Decisions

- **Fields are discovered, not schema'd.** The D2 write-ups are semi-structured
  `Label: value` prose. Rather than impose the 11-field `Extracted` zod schema from
  `to-inventory.ts`, the generator parses every `Label:` line and takes the **union of
  all labels across all 84 projects** as the column set. 1,178 distinct labels were
  found; the 227 appearing in ≥2 projects become columns, the 951 one-offs are preserved
  verbatim in an `Additional Fields` column. Nothing is dropped, inferred, or explained —
  which is what "raw value, no explanation" asks for.
- **Case-variants merged, wording-variants not.** `Project co-leader` and
  `Project Co-leader` collapse to one column (cosmetic). `Tenure` vs `Land Tenure` stay
  separate — deciding those mean the same thing would be interpretation.
- **Values that start on the line after their label run until the next label.** The
  write-ups separate every line with a blank line, so truncating a value at the first
  blank line would cut multi-item fields like `Facilities` down to a single entry. The
  inclusive rule can over-capture instead (e.g. `Maintenance Fee` absorbing a following
  `Viewing Info` heading). Over-capturing is verbatim and recoverable; truncating loses
  data. `Full Write-up` carries the byte-exact source for any cell in doubt.
- **PII kept raw, on the user's explicit instruction.** The concern was raised (PDPA is a
  hard project constraint, and quick-090 redacted phone numbers); the user chose "fully
  raw, phones included". The workbook is therefore gitignored rather than committed.
- **Roster is 84, not 82.** The classroom has grown by two projects since the
  quick-039 scrape. No test/placeholder filtering was applied — this sheet is the raw
  classroom as it stands.

## Verification

### What was tested

**1. Transform fidelity** — workbook vs. the scrape it was built from:

| Check | Result |
| --- | --- |
| Sheet count / name | 1 sheet, `Raw Data` ✓ |
| Row count | 84 rows = 84 scraped projects ✓ |
| Project names, order | identical to scrape ✓ |
| `Full Write-up` | byte-identical to `body.text` for all 84 ✓ |
| `Skool ID` / `Skool URL` / `Section` | verbatim for all 84 ✓ |
| Label/value pairs accounted for | 2,884 checked, **0 unaccounted** ✓ |

**2. Second pass against live Skool** — the independent re-verification the user asked
for. Two fresh scrapes, diffed against the shipped workbook by
`verify-against-skool.py`:

| Check | Result |
| --- | --- |
| Roster | 84 on Skool / 84 in workbook ✓ |
| Projects returning content on re-scrape | 84 / 84 ✓ |
| Write-up text drift | none ✓ |
| Field cells re-checked against live Skool | **2,884 — all match** ✓ |

Verdict: `RESULT: PASS — workbook matches a second independent scrape of Skool`.

### What was ruled out and why

- **Data loss in the label parser.** Every parsed `Label: value` pair was asserted to
  appear either in its own column or in `Additional Fields`: 2,884 checked, 0 unaccounted.
- **Column-name collision.** Found and fixed a real defect: a write-up carrying a literal
  `Project:` line produced a discovered label identical to the `Project` metadata column,
  and `row[lab] = ...` silently overwrote the project name with the parsed value — 82 of
  84 name cells came back blank. Colliding labels now get a `(write-up field)` suffix.
  Re-asserted: 0 duplicate headers, 0 blank project cells, names in order.
- **Throttled re-scrape producing false confidence.** The full second crawl returned
  empty write-ups for the last 19 projects (Skool stops embedding the SSR payload past
  ~65 sustained requests). Treating those as "match" would have silently verified nothing.
  Instead they are reported as *not verified*, and `verify-tail-scrape.ts` re-fetched just
  those 19 with slower pacing and back-off — all 19 returned content on the first try, at
  description lengths identical to the first scrape. Verification coverage is 84/84, not
  65/84.
- **Project API token spend.** `to-inventory.ts` was never run. The only network calls
  were authenticated page reads against Skool.

### Regression surface

No application code, no Firestore writes, no shared script modified — the three new files
are self-contained under this claim directory, and the only edit outside it is an append
to `.gitignore`. `scripts/scrape-skool/*` was read but not changed, so the
quick-039 scrape→inventory pipeline is untouched. The inventory in Firestore is
unaffected: nothing in this claim writes to it.

## Security

- The Skool password was never handled by the assistant: sign-in ran through the repo's
  existing `login.ts` human-completes-login flow, with the password supplied via the
  user's own shell (`read -rs`) and never written to a file.
- The scrape env file lives in the session scratch dir outside the repo and contains no
  password. `skool-state.json` (the saved session) likewise stays out of the repo.
- The generated workbook contains unredacted D2 staff contact details and is **gitignored**
  — the same treatment `.gitignore` already gives quick-090's LIVE workbook.
