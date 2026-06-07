# Claim: quick-kayinleong-004

- owner: kayinleong
- session: claude-code
- branch: phase-kayinleong-01
- started: 2026-06-07
- status: in-progress
- summary: Fix `firestore.indexes.json` vector indexes — `vectorConfig.dimension` is a string `"1024"` but Firestore requires a number `1024`. Blocks `firebase deploy --only firestore:indexes`. Latent across all 5 vector indexes (Phase 1/3/4) since this is the first live index deploy.

## What will change

`firestore.indexes.json` — change `"dimension": "1024"` → `"dimension": 1024` (string → number) in all 5 `vectorConfig` blocks (lines ~50/64/79/102/126). No other index content changes. Then `firebase deploy --only firestore:indexes --project cy-csaiagent` to push the corrected indexes.

## What has changed

(pending)

## Verification

(pending)
