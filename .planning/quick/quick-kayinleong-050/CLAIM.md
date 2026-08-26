# Claim: quick-kayinleong-050
- owner: kayinleong
- session: claude-code
- branch: quick-kayinleong-045-whatsapp-ingest
- started: 2026-08-24
- status: done
- summary: Address tester feedback after ~10 real questions — usage cap hit again, response truncation, raw Finder JSON still leaking, collateral links pointing at Google Drive instead of the WhatsApp-ingested file, and Finder showing far-away projects when Cheras has no match.

## Raw feedback (verbatim, from the tester via Kayin)

functionality:
- for agent email, the conversation history is not saved, the recent chat is gone after a
  refresh and not traceable (the conversion history is empty)
- some part of the response is truncated. not sure is the ui rendering issue or backend
  maximum length or user issue
data quality:
- the agent in some scenario will show the raw unprocessed output (see image)
- the link to the source can put the google drive one instead of the whatsapp one.
- the agent choose to show projects from other location when asking for cheras. I noticed
  that the agent do acknowledge that there is no project in Cheras but still show the
  other project which is not close to Cheras at all (open for discussion)
"For the direct straight forward questions the agent is doing pretty good."

Plus: "i got hit by the usage limit again" after ~10 questions.

## Triage — which of these are already fixed vs genuinely new

**BLOCKING UNKNOWN: what revision was the tester actually running?** quick-046 through
quick-049 all landed on `main` on 2026-08-24, the same day as this feedback. CI
(.github/workflows/ci.yml) runs on main but does NOT deploy; the App Hosting rollout
branch is configured in the Firebase console, so the deployed revision cannot be read
from the repo. Two reported items are things already fixed today, so re-fixing them blind
would be wasted work — and worse, would hide a deploy-pipeline problem.

- **History lost on refresh** — fixed in quick-046 (`f6350bc`): chat-shell minted a fresh
  cid every mount and nothing hydrated a transcript at mount. Expected to be resolved on
  a current build. If it reproduces post-deploy it is a NEW bug (candidate: the fix uses
  `localStorage['d2-active-cid']`, which does not survive a different browser/device or a
  cleared profile; and the history DRAWER being empty is a separate path —
  `conversation-list.tsx` filters out `coach-*` threads per quick-035 and requires both
  ownerUid and tenantId equality filters per quick-016).
- **Raw unprocessed output** — the screenshot shows the Finder JSON envelope plus
  narration ("Let me pull up the project details and collateral ... simultaneously."),
  which is exactly the quick-048 defect fixed in `10705a5` (anti-narration + bare-JSON
  rules on the Finder prompt). Same deploy question.
- **Truncation — GENUINELY NEW, and I got this wrong before.** In quick-048 I dismissed a
  truncated response as "just where the stream had reached." This is a second,
  independent report, so that dismissal was premature. Must be investigated properly:
  no `maxOutputTokens` is set anywhere, so the provider default applies; and
  `stopWhen: stepCountIs(5)` can halt a Finder loop mid-answer.
- **Collateral link points at Google Drive instead of the WhatsApp file — GENUINELY NEW.**
  Screenshot 2 shows WhatsApp-ingested collateral rendered as raw, unclickable Storage
  paths (`collateral/<projectId>/whatsapp/kensho-brochure.pdf`) while only the Drive
  folder is a real hyperlink. So the agent surfaces the usable link for the wrong source.
- **Finder shows far-away projects on a Cheras miss — GENUINELY NEW, and a judgment call.**
  The tester explicitly flags it as open for discussion.
- **Usage cap hit again — KNOWN, deferred twice.** `TOKEN_CAP = 50_000` / 24h
  (`src/ratelimit/window.ts:28`) against `stepCountIs(5)` + RAG. Flagged in quick-046
  (RC-4) and again in quick-049, where I added an admin reset but explicitly did NOT
  raise the cap. This is now the second real-user report — the escape hatch is not
  sufficient.

## User decisions (2026-08-24)

1. **Finder** — hard filter + honest refusal.
2. **TOKEN_CAP** — 300_000 (without the undercount fix, so the two could not compound).
3. **Collateral** — fix ingestion AND backfill.

## What has changed

Four commits, three parallel tracks with disjoint file ownership.

### Track A — truncation, history rendering, cap, demo chip (`fc52be8`)
- **Truncation root cause:** `onFinish`'s `final.text` is the LAST STEP's text only
  (`ai@5.0.193 dist/index.mjs:4822-4824`). The client accumulates every block, so a
  message was whole while it streamed and truncated once reloaded. New `fullTurnText()`
  applied at all three sites that were persisting a partial turn: message content,
  `replySlot.latestDraft` (silently degrading Reply's cross-turn memory) and the audit
  `contentHash`.
- **Raw JSON on history:** `conversation-messages-map.ts` dropped the pillar.
  `routeDecision` was already persisted; now carried through. Finder decodes to the card;
  Reply surfaces readable draft text and deliberately does NOT render `ReplyDraftCard`,
  which needs a non-optional `leadId` history cannot supply.
- **TOKEN_CAP 50_000 → 300_000**, sized from 58 measured turns.
  `window.test.ts` now IMPORTS the caps instead of mirroring literals that would have gone
  stale silently.
- **Demo chip:** all three locales shipped a Cheras query against zero Cheras inventory.
- `finishReason` warn so a `stepCountIs(5)` halt stops being unfalsifiable.

### Track B — Finder filtering (`84a5e2b`)
`locationPref` and `priceMax` are now real, hard filters; relevance floor + `MAX_MATCHES=8`
cap (tool payload ~10,100 → ~1,000 tokens per step, ~90% cut, which also relieves the
usage cap); `applySegmentWeights` no longer sorts by `locationText.length`;
`matchedCriteria` stops asserting criteria that were never applied (a false grounding
claim); the prompt now requires a refusal on `found:false` and bans proximity claims.
Proximity clauses are stripped from `locationText` before matching, so "Bangsar Hill Park"
no longer matches "KLCC".

### Track C — collateral URLs (`3708660`)
Ingestion keeps the `uploadBytes` ref and writes a real `externalUrl`; `tools.ts` will
never hand the model a bare bucket key again (omits, warns, and tells the model an empty
array means "never invent a link"); resumable dry-run-by-default backfill script.

## Verification

- `npx tsc --noEmit` → **0 errors**
- `npx vitest run` → **953 passed**, 197 skipped, 0 failed — **3 consecutive clean runs**
  (was 900; +53)
- `npx eslint app src` → **0 errors** (70 pre-existing warnings)
- `npm run build` → exit 0, 72 static pages
- Live Firestore probes (read-only, no writes): usage distribution over 58 turns;
  collateral field coverage over 12,020 docs; area/price coverage over 83 active projects.
- Backfill dry-run against live data: 22 scanned, 20 would backfill, 0 missing objects,
  0 tokenless, 0 errors; ledger resume proven on a second run; **three constructed URLs
  GET-probed unauthenticated returned HTTP 206**, so they genuinely resolve.
- Cheras refuses (`no_match`) against the real corpus, as do Setapak/Sentul/Kepong/Puchong.

### A correction I owe on my own verification
I reported the replacement demo chip returns "exactly 2 real matches". It returns **3**.
My probe script filtered `bedrooms >= 2`, but the implementation deliberately does NOT
filter bedrooms — 29 of 83 projects have `bedrooms: 0` meaning unknown, so filtering would
wrongly exclude them. I verified against a filter the product does not apply. The chip
still works (3 real Bangsar matches under budget); one of the three is 1BR.

### Sparse-data hazards handled rather than ignored
- `priceValue` populated on only **51/83**. Unpriced projects are excluded when a bound is
  stated — including them renders "Price: RM0k" to a budget-constrained lead. `priceBand`
  was rejected as a fallback because `priceBandFor(0) === 'under_500k'` mislabels all 32
  unpriced as cheap.
- `bedrooms` is 0 (unknown) on **29/83**, so it is not a filter.

## Post-close: backfill EXECUTED and live verification done (user authorised)

### Collateral backfill — APPLIED against production
```
scanned docs         : 12020      backfilled          : 11722
already had a URL    :   296      missing object (404):     2
candidates seen      : 11724      no download token   :     0
processed this run   : 11724      errors              :     0
```
Verified INDEPENDENTLY of the script's own summary by scanning all 12,020 docs:
**12,018 now carry an https `externalUrl` — 2.0% → 99.98%**, and a GET on a backfilled
`whatsapp-media` URL returns **HTTP 206** unauthenticated.

The 2 stragglers are the SAME malformed path duplicated across two docs:
`collateral/WsCKdwpNCvFwHy5cHTH6/whatsapp/RA New Broucher ` — trailing space, no file
extension, object absent from Storage. A WhatsApp-import artifact. The `tools.ts` guard
omits them, so the agent never surfaces them; left in place rather than deleted (that is
the user's call).

### Finder verified LIVE — real Firestore, real Gemini embeddings, no mocks
- `"Cheras"` + 800k → **`found:false, reason=no_match`** — the headline fix works live.
- `"Bangsar"` + 900k → **3 matches**, all genuinely Bangsar, all ≤900k
  (900k / 720k / 799k) — inclusive boundary correct.
- unfiltered query → capped at `MAX_MATCHES = 8`.
This closes gap 1 below for the filter path.

### MIN_RELEVANCE measured — it is a NO-OP
83/83 projects clear 0.20 for every query tried, including "banana bread recipe"
(top 0.494) and "quantum chromodynamics…" (top 0.499). Real relevant queries score
0.558–0.719. The floor filters nothing; `MAX_MATCHES` does the payload work and the hard
gates do the correctness work. Deliberately NOT retuned on four probe queries — the
separation window (0.50–0.55) is narrow and a floor set too high produces SILENT false
negatives. Documented in-code so it is not mistaken for an active guard.

### Carried items cleared (`034558a`)
- Doc drift in `finder/schema.ts`, `inventory/crud.ts`, `firebase/collections.ts` — all
  three claimed a path→URL resolution that no code performed. That shared fiction is why
  the gap survived: every reader assumed someone else did it.
- `match-list.tsx` now filters non-http URLs before rendering an anchor.
- `collateral-form.tsx` says "no link" instead of printing a raw path that reads like one.

## Honest gaps — NOT verified## Honest gaps — NOT verified

1. **Partially closed.** The FILTER path is now verified live (Cheras refuses, Bangsar
   returns 3, cap binds) and `MIN_RELEVANCE` is measured as a no-op. Still unverified:
   the model's actual refusal WORDING under the new prompt, which needs a real chat turn.
2. **Ingestion fix has no automated test** — it is a browser upload path with no harness.
   Needs one real WhatsApp import.
3. ~~Backfill `--apply` NOT run.~~ **DONE** — 11,722 backfilled, 2 orphans remain (see above).
4. **No authenticated click-through** of chat or the admin surfaces.
5. **Deploy revision unknown.** Two reported items (history-lost-on-refresh, raw JSON) were
   fixed in quick-046/048 which landed the same day as this feedback. CI does not deploy;
   the App Hosting rollout branch is console-side. Re-verify post-deploy before treating
   either as a new bug.

## Carried / needs a decision

- ⚠ **Derek sign-off:** Firebase download URLs are capability URLs that BYPASS
  `storage.rules` — the collateral becomes link-public.
- **`priceValue` backfill** (32 active projects unpriced) — otherwise a budget query
  silently excludes them.
- Doc-comment drift still claiming a signed-URL resolution that never existed
  (`schema.ts:116`, `crud.ts:250-251`, `collections.ts:281`).
- `match-list.tsx:171` / `collateral-form.tsx:134` unhardened — unreachable via the agent
  now, but a hand-entered storage path in the admin form still yields a dead chip.
- The route's last-step-only ratelimit decrement remains (deliberate; errs generous).
