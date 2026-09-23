# Claim: quick-kayinleong-092
- owner: kayinleong
- session: claude-code
- branch: quick-kayinleong-091
- started: 2026-09-23
- status: claimed
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

Planned shape: stays **one tab**, `Raw Data`. New per-project columns for the KB document
titles and their text. Excel caps a cell at 32,767 characters, so the text will need
splitting or truncating across columns — the exact layout depends on the real size
distribution, which cannot be measured until the Firestore read works.

Constraints carried over from quick-091: no new AI tokens, raw values only, one tab.

## What has changed

_(pending — blocked on Firestore credentials)_

## Verification

_(pending)_
