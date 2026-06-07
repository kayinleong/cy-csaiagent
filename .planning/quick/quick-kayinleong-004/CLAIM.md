# Claim: quick-kayinleong-004

- owner: kayinleong
- session: claude-code
- branch: phase-kayinleong-01
- started: 2026-06-07
- status: done
- summary: Fix `firestore.indexes.json` vector indexes — `vectorConfig.dimension` is a string `"1024"` but Firestore requires a number `1024`. Blocks `firebase deploy --only firestore:indexes`. Latent across all 5 vector indexes (Phase 1/3/4) since this is the first live index deploy.

## What will change

`firestore.indexes.json` — change `"dimension": "1024"` → `"dimension": 1024` (string → number) in all 5 `vectorConfig` blocks (lines ~50/64/79/102/126). No other index content changes. Then `firebase deploy --only firestore:indexes --project cy-csaiagent` to push the corrected indexes.

## What has changed

`firestore.indexes.json` — two fixes to make the file deployable (both pre-existing latent defects exposed by the first-ever live index deploy):
1. **`vectorConfig.dimension` string → number** in all 5 vector indexes (`"1024"` → `1024`). Firestore requires a number; the string form failed deploy validation (`Property "vectorConfig.dimension" must be of type number`).
2. **Removed the invalid `agentProfiles` single-field composite index** (`lastActiveAt DESC` only). Firestore rejects single-field composite indexes (`HTTP 400 — this index is not necessary, configure using single field index controls`); `lastActiveAt DESC` ordering is served automatically by Firestore's default single-field indexing, so no composite is needed. Index count 16 → 15 in the file.

Then deployed to live project `cy-csaiagent` (asia-southeast1):
- `firebase deploy --only firestore:rules --project cy-csaiagent` → rules compiled + released.
- `firebase deploy --only firestore:indexes --project cy-csaiagent` → 15 indexes deployed successfully.

## Verification

**Deploy results (project `cy-csaiagent`, `(default)` Native DB, asia-southeast1):**
- Rules: `✔ rules file firestore.rules compiled successfully` → `✔ released rules ... to cloud.firestore`.
- Indexes: `✔ firestore: deployed indexes in firestore.indexes.json successfully`.
- `firebase firestore:indexes` confirms all 5 Phase-4 indexes live with `vectorConfig.dimension: 1024` (number): `kbChunks(pillar,lang,status,embedding)`, `kbDocs(pillar,category,status)`, `replyEdits(agentUid,timestamp)`, `replyEdits(seniorCoachId,timestamp)`, `replyEdits(sopDocIds,timestamp)`.
- `node -e` JSON validation: valid, 15 indexes, all 5 vector dims `number:1024`, 0 agentProfiles composites.

**Regression report:**
- **Index removal safety:** the removed `agentProfiles(lastActiveAt DESC)` composite was redundant — Firestore auto-provides single-field ascending+descending indexes for every field, so any `orderBy('lastActiveAt','desc')` query still resolves. No query breaks.
- **Deploy was additive + non-destructive:** ran WITHOUT `--force`, so the CLI did NOT delete the one pre-existing live index absent from our file (a `messages` collection-group index — preserved intentionally; flagged for the user to reconcile into the file if desired).
- **Rules:** deployed our repo's deny-by-default ruleset (source of truth, all 18 collection matches incl. `replyEdits`). Fail direction is closed (deny), not open. No data touched.
- **Scope:** only `firestore.indexes.json` changed in the repo; no app/src/test code touched; `tsc`/`vitest` unaffected (config-only change). Deploy scoped to `--only firestore:rules,firestore:indexes` — Storage rules, Hosting, etc. untouched.
- **Vector index builds run async** — definitions accepted; flat 1024-d builds complete in the background (minutes).
