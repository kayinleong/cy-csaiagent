# Claim: quick-kayinleong-089
- owner: kayinleong
- session: claude-code
- branch: main
- started: 2026-09-05
- summary: harden what quick-088 exposed — a corpus test that cannot pass in CI, pipeline tooling that exists on one machine only, and a Coach corpus that is 55% mislabelled property content
- status: claimed

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
TBD

## Verification
TBD
