# Claim: quick-kayinleong-092
- owner: kayinleong
- session: claude-code
- branch: quick-kayinleong-091
- started: 2026-09-23
- status: done
- summary: attach the already-ingested Google Drive document text from the Firestore KB to the quick-091 "Raw Data" workbook, without a new Drive crawl and without spending new AI tokens

## What will change

`quick-kayinleong-091` delivered the raw Skool dump: 84 projects, 240 columns. The Drive
collateral is present only as **links** — 208 distinct URLs across 61 of 84 projects,
196 of them folder links. No document contents.

The user declined a fresh Drive crawl (needs a second interactive Google login) and
declined the OCR path (bills Gemini vision). The Drive text was already ingested once —
per `quick-kayinleong-088`, 1,079 kbDocs at 8.76M embedding tokens, already paid for. So
this claim reads that text back out of Firestore and attaches it per project.

**The join key.** `kbDocs.sourcePath` is just `kb/<docId>` and is useless for this.
But `to-kb.ts` builds each title as `"<project> — <filename>"` (and `to-kb-ocr.ts`
appends `" (OCR)"`), which `rebuild-kb-ledger.ts:19-26` documents as a reversible join
key. So the project name is recoverable from the title prefix alone — no
`drive-documents.json` needed (it does not exist in this tree).

## What has changed

Two new scripts plus a gitignore entry. **No application code touched, nothing written
back to Firestore, no model called** — the text was paid for once in quick-088 and is
simply being read back.

- `export-kb-text.ts` — read-only Firestore export. Pages `kbDocs` and `kbChunks`,
  fetching only `title` / `docId` / `text` via `.select()` — never the 1024-d embedding
  vectors. Splits each title back into project + filename + OCR flag.
- `attach-kb-text.py` — folds that text into the quick-091 workbook, still one tab.
- `.gitignore` — excludes the generated workbook, same rule as quick-090 and quick-091.

### Deliverable

`D2-Property-Raw-Data.xlsx` — one sheet, `Raw Data`, **84 rows × 692 columns**, 2.4 MB.
The original 240 columns are byte-identical to quick-091; 452 new columns carry the Drive
documents. Regenerate:

```bash
FIREBASE_PROJECT_ID=cy-csaiagent KB_OUT=$SCRATCH/kb-text.json \
  node_modules/.bin/tsx .planning/quick/quick-kayinleong-092/export-kb-text.ts
uv run --with openpyxl python .planning/quick/quick-kayinleong-092/attach-kb-text.py \
  --xlsx <quick-091 workbook> --kb $SCRATCH/kb-text.json --out D2-Property-Raw-Data.xlsx
```

### Decisions

- **One column per document, as the user directed.** The size problem was raised
  explicitly (9.2 MB of text, 45 of 65 projects over Excel's 32,767-char cell cap,
  ~54 spill columns) with four options offered including truncation and a companion-file
  split. The user chose *"everything in sheets as client requested, each field take one
  column"*. So each document gets `Drive Doc NN Name` + `Drive Doc NN Text`, assigned in
  filename order so slot N is the same position on every row. **Nothing is truncated.**
- **Documents longer than a cell continue into `(cont. N)` columns.** A cell holds at
  most 32,767 characters; the largest document here is 656,542 (`Padang Residences
  Parking List.xls`), which needs 21. Each slot gets exactly as many continuation
  columns as its widest document requires — 256 text columns in total, not 194 × 21.
- **WhatsApp transcripts excluded.** The question asked was about Drive documents. The KB
  also holds 108 WhatsApp group-chat exports totalling 23.5 MB — 2.5× the entire Drive
  corpus, and a far larger PII surface (live group chatter, not property collateral).
  They are a different source, so they are off by default; `--include-whatsapp` folds
  them in and would lift coverage from 65 to 80 of 84 projects.
- **Control characters stripped.** 295 instances of `U+000D` and a handful of C0 control
  characters (from mangled/OCR'd PDF extraction) are removed. XML 1.0 cannot represent
  them, so this is not a content decision — the file cannot be written otherwise.

## Verification

### What was tested

| Check | Result |
| --- | --- |
| Sheet count / name | 1 sheet, `Raw Data` ✓ |
| Rows | 84, unchanged ✓ |
| Original 240 headers | present, same order ✓ |
| Original cell values | unchanged across all 84 × 240 ✓ |
| Longest cell | 32,000 chars — under Excel's 32,767 cap ✓ |
| `Drive Doc Count` vs KB | exact for all 84 rows ✓ |
| **Documents reassembled from their columns** | **901 checked, 0 mismatched, 9,139,505 chars** ✓ |
| Projects carrying Drive docs | 65 of 84 ✓ |
| OCR-sourced docs carried through | 174 ✓ |

### What was ruled out and why

- **Silent truncation.** Every document was reassembled by concatenating its `Text` +
  `(cont. N)` columns and compared against the KB source: 901 of 901 identical.
- **A first run that looked like data loss.** 16 documents initially failed the
  byte-comparison. The cause was not truncation: a character-level diff showed the only
  missing character was `U+000D`, 295 times. XML normalises `\r\n`/`\r` to `\n` on read,
  so the workbook is correct and the comparison was wrong. Re-verified with line-ending
  normalisation applied to both sides: 0 mismatched.
- **Corrupting the quick-091 deliverable.** The new workbook is written to a separate
  file; quick-091's is untouched and its 240 columns were asserted byte-identical in the
  new one.
- **New token spend.** No model was called. `export-kb-text.ts` issues Firestore reads
  only, and deliberately avoids fetching embedding vectors.
- **Write-back risk.** The export is read-only — no `.set()`, `.update()` or `.delete()`
  anywhere in either script.

### Regression surface

No application code, no shared script, and no Firestore writes. Both new files are
self-contained under this claim directory; the only edit outside it is an append to
`.gitignore`. The KB collections were read with `.select()` projections, which cannot
mutate. quick-091's workbook and claim are unaffected.

## Security

- Firestore access used the developer's own ADC (`gcloud auth application-default
  login`), supplied by the user in their own shell. No service-account key was read,
  written, or committed, and no credential entered this session's context.
- The generated workbook carries the same unredacted contact details as quick-091, plus
  document text, and is **gitignored** — consistent with quick-090 and quick-091.
- `export-kb-text.ts` never fetches embedding vectors, keeping the export to text only.
