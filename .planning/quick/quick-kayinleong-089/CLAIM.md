# Claim: quick-kayinleong-089
- owner: kayinleong
- session: claude-code
- branch: main
- started: 2026-09-05
- summary: harden what quick-088 exposed — a corpus test that cannot pass in CI, pipeline tooling that exists on one machine only, and a Coach corpus that is 55% mislabelled property content
- status: done

## What will change

Fallout from quick-kayinleong-088, in three parts.

1. **`src/inventory/size-extract.test.ts` cannot pass in CI.** Its corpus sweep reads
   `projects.inventory.json`, a gitignored scrape artifact (`.gitignore:59`) that is never
   present in CI. Worse, a partial artifact turns the sweep into ~10 spurious failures that
   read as an extractor regression — which is exactly what happened during 088 when a
   3-record dry run overwrote the 82-record file. `unit-types.test.ts` already solved this
   with `loadCorpus()` + `describe.skipIf(CORPUS === null)`, gated on record COUNT not mere
   existence. Apply that pattern. Do not weaken any pinned count to make it pass.

2. **Untracked pipeline tooling.** `scripts/scrape-skool/kb-cleanup.ts` is the canonical
   definition of the ingest ledger's shape and is cited by the committed
   `rebuild-kb-ledger.ts` — yet it exists on one machine only. That is the same fragility
   that caused 088: `drive-kb-ledger.json` and `google-profile` vanished from disk and the
   ledger had to be rebuilt from Firestore. Triage each untracked script, commit the real
   tooling, delete genuine throwaways, and sync the README Files table. Check every file for
   hardcoded credentials before staging.

3. **The Coach corpus is mislabelled** (measured in 088, see `VERIFICATION-coach-pillar.md`).
   Of 47 `pillar:'coach'` chunks: 26 (55%) are property material, 5 are orphaned with no
   parent kbDoc, 16 are `[Example]` placeholders, and 0 are real onboarding curriculum.
   Re-pillar the property docs to `finder` and resolve the orphans, so the Coach returns an
   honest `kb_miss` + handoff (D-10) rather than answering onboarding from a tower FAQ.

Already done in 088, not repeated here: `/drive-kb-ledger.json` added to `.gitignore`
(commit `d9f98c1`, `.gitignore:65`).

## What has changed

**1. `src/inventory/size-extract.test.ts`** (`bd4f472`) — `loadCorpus()` +
`describe.skipIf(CORPUS === null)`, gated on record COUNT not mere existence. Source switched
from `projects.inventory.json` (rewritten by every `to-inventory.ts` run, including a
`--limit N` dry run) to `projects.json` (only changes on a full re-scrape), matching
`unit-types.test.ts`.

**2. Untracked pipeline tooling** (`66fb270`) — 4 kept, 3 deleted, README Files table synced.

| File | Verdict | Reason |
|---|---|---|
| `scrape-skool/kb-cleanup.ts` | keep | canonical definition of the ledger's `partial` status; `rebuild-kb-ledger.ts` cites it 6× |
| `scrape-skool/ocr-token-split.ts` | keep | cited 3× by the committed 088 research doc; produced its coverage numbers |
| `scrape-skool/kb-token-sum.ts` | keep | encodes the `tokens` field, the `(OCR)` title convention, and `.select()` so it never pulls 1024-d vectors |
| `inspect-reply-readiness.ts` | keep | sibling of the committed `inspect-usage-distribution.ts`; both named in `quick-050/PLAN.md` |
| `scrape-skool/ocr-trial.ts` | delete | strict subset of committed `to-kb-ocr.ts` — same prompt, same model, same call shape |
| `scrape-skool/gtest.ts` | delete | superseded by `gdrive-save-state.ts`, which probes five selectors instead of the one 088 recorded failing |
| `scrape-skool/gembed-test.ts` | delete | zero references, and independently ineligible: it printed the Gemini API key's length and first 6 characters to stdout |

**3. Coach corpus cleanup** (`scripts/fix-coach-pillar-mislabels.ts --apply`) — deleted 2
kbDocs + 31 chunks. **Deletion, not re-pillaring**, because finder already held both:

| Removed | Chunks | Preserved in finder as |
|---|---:|---|
| `0uFVYzDdnkSsPMYlxPiQ--coach` (Bangsar Hill Park FAQ) | 21 | `0uFVYzDdnkSsPMYlxPiQ` (21 chunks) |
| `g3YG8KgrydA8B9sKRuMM` (Core Residence @ TRX email) | 5 | `0ciFnNIwbNYsgkSSqfE6` (4 chunks) |
| orphaned chunks, parent `aWXEQ4oqOdRXonDcI9SX` absent | 5 | — no source to re-ingest from |

Dry-run by default; refuses to touch anything not `pillar:'coach'`, and refuses to delete a
doc whose finder twin is missing or empty. Full backup of every deleted document and chunk
written before the write, so the change is reversible.

Already done under 088, not repeated: `/drive-kb-ledger.json` in `.gitignore` (`d9f98c1`).

## Verification

### The test guard — proven by reintroducing both failure modes

| Corpus state | Result |
|---|---|
| full 82 records | **150 passed**, 0 skipped, 0 failed |
| truncated to 3 (the exact 088 failure) | 125 passed, **25 skipped**, 0 failed |
| absent entirely (the CI case) | 125 passed, **25 skipped**, 0 failed |

The 125 fixture traps carry the behavioural contract and run in every case; only corpus
verification skips, and only when there is no corpus. `projects.json` restored
byte-identical afterwards (`cmp` clean).

**No pinned count was weakened.** `EXPECTED_PARSED = 66` and `EXPECTED_NULL = 16` are
untouched; the only assertion change is the literal `82` becoming `EXPECTED_CORPUS_SIZE`.
Before switching source I verified both files give identical results — 82 records, 66
parsed, 16 null, 7/7 spot checks matching by name — because `to-inventory.ts` stores
`description: p.body.text` verbatim. Measured, not assumed.

### Coach cleanup — measured live after apply

```
coach chunks 47 → 16      finder chunks 25,153 (unchanged)
twin 0uFVYzDdnkSsPMYlxPiQ  exists, pillar=finder, 21 chunks
twin 0ciFnNIwbNYsgkSSqfE6  exists, pillar=finder,  4 chunks
removed docs: kbDoc gone, 0 chunks     orphan chunks remaining: 0
```

⚠ **Honest reading of the result.** Retrieval on six onboarding questions returns
**identical top scores to before the cleanup** (0.5632 / 0.7076 / 0.6697 / 0.7092 / 0.7702;
only "commission split" moved, 8→7 hits). The mislabelled property content was never winning
the top slots — the `[Example]` docs were. It sat in the *tail* of the 8 results, where the
Coach could still cite it (`MAX_CITATIONS = 5`).

So this closes a real citation path and it does **not** improve what the Coach answers with.
The substantive gap is unchanged: 16 chunks, all `[Example]` placeholders, **zero real
onboarding curriculum**. "How do I get my REN tag" still returns one unrelated chunk at
0.5632 — above the 0.55 coach floor, and there is still no REN content anywhere to find.

Loading real onboarding content remains the blocker, and it is Derek's to supply. No
retrieval tuning substitutes for it.

### Suite
`npm run typecheck` clean (via `tsconfig.typecheck.json`). Full suite **1337 passed / 0
failed / 197 skipped**. One transient failure was observed while a parallel agent was running
(suite 12.4s vs 9.7s) and did not reproduce on a clean re-run — consistent with the
load-sensitive 5s timeout diagnosed in quick-085, not this diff.
