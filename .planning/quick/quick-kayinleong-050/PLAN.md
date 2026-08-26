# Plan: quick-kayinleong-050

Research: `RESEARCH-truncation.md`, `RESEARCH-collateral.md`, `RESEARCH-finder-relevance.md`.
Live-data probes: `scripts/inspect-usage-distribution.ts`, `scripts/inspect-reply-readiness.ts`.

## User decisions (2026-08-24)

1. **Finder** — hard filter on `locationPref` + `priceMax`, honest `no_match` refusal when
   nothing matches. (Not the labelled-alternatives or taxonomy options.)
2. **TOKEN_CAP** — 50_000 → **300_000** (~50 turns at the measured 5,812 mean).
   Deliberately WITHOUT the undercount fix: `route.ts` keeps decrementing
   `final.usage.totalTokens` (last step only). That errs generous, which is the safe
   direction; the existing REGRESSION-NOTE stays.
3. **Collateral** — fix ingestion AND backfill the 11,774 existing dead docs.

## Measured facts driving this

- Per-turn tokens (n=58): mean 5,812 · p50 3,422 · p90 14,703 · p99 23,455.
  50_000 ⇒ ~8 turns. 4 of 8 real user-days already at/over cap.
- Finder is the costly pillar: mean 7,209/turn vs Coach 3,273.
- collateral: 12,020 docs, **11,774 `whatsapp-media` with `storagePath` only** (98% dead),
  246 clickable. Zero docs have both fields.
- Inventory: 83 active projects, `locationText` populated 82/82 (mean 81 chars).
  **Zero Cheras projects.** No geographic taxonomy anywhere.

## Track A — orchestrator

Files: `app/api/chat/route.ts` (+test), `src/ratelimit/window.ts` (+test),
`app/[lang]/chat/conversation-messages-map.ts` (+test),
`app/[lang]/chat/load-conversation-messages.ts`, `src/i18n/messages/{en,ms,zh}.json`

1. **Truncation (the headline bug).** `onFinish`'s `final.text` is the LAST STEP's text
   only (`ai/dist/index.mjs:4822-4824`). The live UI accumulates every block while the
   PERSISTED copy keeps only the final one — so a message is whole while you watch it and
   truncated when you come back. Join `final.steps[*].text` and use that at `route.ts:639`
   (message content), `:700` (`latestDraft` → leadContext, silently degrading Reply's
   cross-turn memory) and `:771` (audit `contentHash`).
2. **Raw JSON on history-loaded turns.** `conversation-messages-map.ts:46-53` drops the
   pillar, so a restored Finder/Reply turn has nothing for the client decoder to gate on
   and renders its raw envelope. `MessageDoc.routeDecision` already stores `pillar:reason`
   — carry it through so history behaves like a live turn.
3. **TOKEN_CAP → 300_000**, with the sizing evidence in the comment.
4. **Suggestion chip.** All three locales ship `"Find me a 2-bedroom in Cheras, budget
   800k"` — a query guaranteed to hit zero inventory. Replace with a real area from the
   corpus; verify the replacement routes to Finder via the real `heuristicPillar()`.
5. Log `finishReason` in `onFinish` so a `stepCountIs(5)` halt stops being unfalsifiable.

## Track B — agent: Finder relevance

Files: `src/inventory/search.ts` (+tests), `src/agents/finder/prompt.ts`
MUST NOT touch `src/agents/finder/tools.ts` (Track C owns it).

- Make `locationPref` and `priceMax` real filters; today `locationPref` appears once, at
  `search.ts:363`, purely in the `matchedCriteria` echo.
- Add a relevance floor + top-N cap. Stage A currently returns all 83 active projects with
  no floor and no cap — that is also a ~10k-token tool payload feeding the usage-cap problem.
- Stop `applySegmentWeights` (`search.ts:174-210`) demoting the vector score below
  `locationText.length`.
- `prompt.ts:104` must allow an honest refusal now that the tool can genuinely return
  no_match.
- **`matchedCriteria` must stop asserting "within budget" / "location preference: X" for
  criteria that were never applied** — that is a false grounding claim, not a cosmetic issue.
- `status:'active'` enforcement stays.

## Track C — agent: collateral URLs

Files: `app/[lang]/(admin)/whatsapp-import/whatsapp-import-form.tsx`,
`src/agents/finder/tools.ts`, new `scripts/backfill-collateral-urls.ts`
MUST NOT touch `src/inventory/search.ts` or `src/agents/finder/prompt.ts` (Track B).

- Ingestion: `whatsapp-import-form.tsx:349-360` calls `uploadBytes` and discards the
  result ref. Keep it, `getDownloadURL(snap.ref)`, write as `externalUrl` alongside
  `storagePath` (`crud.ts:265` already permits both).
- Backfill: server-side script for the 11,774 existing docs. Objects uploaded via the web
  SDK carry `firebaseStorageDownloadTokens` metadata, so the canonical download URL can be
  reconstructed with the Admin SDK — no IAM signing, no expiry. Dry-run by default,
  `--apply` to write, resumable, bounded concurrency.
- Guard: `tools.ts:267` (`data.externalUrl ?? data.storagePath`) must never hand the model
  a bare bucket key again.

⚠ Derek sign-off: Firebase download URLs are capability URLs that BYPASS `storage.rules`.
Probably intended (agents forward brochures to leads) but must be an explicit decision.

## Open question — carried to the user

What revision is actually deployed? CI runs on `main` but does not deploy; the App Hosting
rollout branch lives in the Firebase console. Two reported items (history-lost-on-refresh,
raw JSON output) were fixed in quick-046/048 which landed the same day, so they may simply
predate the tester's build. Re-verify post-deploy before treating either as a new bug.

## Verification

`tsc` 0 · full `vitest` green · `eslint app src` 0 errors · `next build` · i18n parity.
Backfill runs dry-run only in this claim; `--apply` is the user's call.
