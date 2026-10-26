# Claim: quick-kayinleong-098
- owner: kayinleong
- session: claude-code
- branch: quick-kayinleong-098
- started: 2026-10-26
- status: done
- summary: fix the Finder causes behind the 24 Oct UAT project failures — location 'near' scope, directional words, required no-match next step, property-type filter — plus the matching data corrections (dry-run first; live apply only on approval)

## What will change

The 24 Oct UAT run (docs: UAT-Output-Test-Cases-RESULTS.xlsx) failed four projects. Each was
reproduced by running the real gates in `src/inventory/search.ts` over the 2026-10-20 live export:

- d'Brightton titiwangsa returned for a KLCC search (F9).
- Alstonia Hilltop Homes returned for a North Kiara search (F5); St. Regis passes the same gate.
- No-match answers can drop the required next step (F11 run 3) and imply stock that does not exist.
- Office projects (Aspire office @ KL ecocity) appear in residential own-stay searches (N2).

Code and data fixes are planned in PLAN.md. Live Firestore writes happen only after the user
approves the dry-run diff.

## What has changed

### Code (all offline-tested)

- **Location gate, "near" scope** (`src/inventory/search.ts` `locationHaystack`). A proximity
  phrase now runs on through the comma list after it, until the sentence ends or a clause
  names a street or area. Over the 83 active projects only four searches change, and every
  change is a correct exclusion: KLCC (d'Brightton), Mid Valley (Lunar Seputeh, Parkside),
  Petaling Jaya (Enlace) and KL Sentral (Lunar Seputeh).
- **Compass words** (`COMPASS_TOKENS`). north/south/east/west and utara/selatan/timur/barat no
  longer count as free tokens. "North Kiara" now returns exactly Miranda Hill and Tangen (the
  F5 MUST); Alstonia, St. Regis and Eden drop out.
- **No-match gate.** `SearchResult` no_match carries `gate` (eligibility, location,
  property_type, price, relevance or inventory). The tool passes it to the model unchanged.
- **Next steps on every refusal.**
  - `FinderRefusalSchema.nextSteps`, optional for decode, coerced and capped by `normalizeFinderShape`.
  - The prompt requires 1–3 next steps and gate-specific wording: a location miss is "no project in that area at all" and may not suggest units there.
  - The refusal card renders the steps and falls back to translated defaults (EN/BM/中文).
  - The offline builder emits gate-aware explanations and steps.
- **Property type.**
  - `ProjectDoc.propertyType`.
  - `propertyTypeOf`: the stored tag wins, then the name rule, then residential.
  - `ParsedCriteria.propertyType` and the tool input: `residential | commercial | any`. Omitted means residential.
  - The gate runs after location and before price.

### Data (applied to live Firestore on 2026-10-26, e50e102)

`scripts/fix-uat-location-and-type.ts` (planner in `.plan.ts`). The live dry run on
2026-10-26 (`DATA-DRYRUN.md`, fingerprint `bfe09eae…3882`) planned 8 changes and skipped 0:
- 4 location corrections:
  - Alstonia → client sheet Area
  - St. Regis → `KL Sentral, Kuala Lumpur`
  - Rimbun Saujana → client sheet Area
  - d'Brightton → `… and KLCC`
- 4 `propertyType: commercial` tags: Aspire office, The Stride Office, E&O Laman Embun Commercial, The MET Corporate Tower.

The user approved that fingerprint and it was applied: 8 records written (`DATA-APPLY.md`).
The backup is `backups/2026-10-26T09-01-49-942Z.json` and holds location text and type tags
only. Undo with `--restore` on that file.

**Code vs data in production.** The data is live now; the code fixes take effect only once
this branch is merged and deployed. Until then, on the deployed build:
- F5 (Alstonia) and F9 (d'Brightton) are already fixed by the corrected location text alone.
- N2 (Aspire office) and F11 (next steps) still need the deploy, because the deployed code
  ignores `propertyType` and has no `nextSteps`.

## Verification

- **Reproduction → fix.** `scratchpad/replay.ts` runs the real gates over
  `projects.export.json`. Before: d'Brightton passes KLCC; Alstonia passes North Kiara (token
  tier); Aspire passes Bangsar + RM650k. After: KLCC no longer returns d'Brightton, North Kiara
  returns only Miranda Hill and Tangen, and the default residential gate drops Aspire.
- **New tests fail on the old code.** The three Wave-1 tests were run against the stashed
  pre-change `search.ts`: 3 failed, 44 passed. With the change: all pass.
- **Full suite:** 1587 passed, 223 skipped. Baseline before the claim: 1562 passed. +25 new
  tests across search, finder, tools, decoder and the patch planner.
  - The one failing suite is pre-existing and environmental: `tests/finder-corpus-gates.test.ts`
    reads the gitignored `projects.inventory.json`, which is not on this machine. It failed
    identically before any change. Its Petaling Jaya expectation was updated 4 → 3, verified
    against the export.
- **Typecheck:** `npm run typecheck` clean.
- **Lint:** 0 errors. The 13 warnings are the pre-existing unused `_args` mock pattern in
  `search.test.ts`, which the new describe block copies.

### Regression report

| Surface | Checked | Result |
|---|---|---|
| Every Finder search with a location | Corpus diff over 83 active projects, 35 area probes | Only the 4 searches above change, all correct exclusions. Park Green keeps Bukit Jalil; Star Residences and PSQ keep their street clauses (pinned by tests) |
| Phrase/token matching (Bukit Jalil vs Bintang, Sri Petaling vs PJ, Klang Valley skip) | Existing tests | Unchanged, pass |
| Every Finder search (property-type default) | Name rule over the live corpus; UAT cases grep | Exactly 4 projects are commercial; no UAT case expects any of them |
| Persisted / older Finder turns | Decoder tests | A refusal without `nextSteps` still decodes; a malformed list is dropped, never fatal |
| Price gate, unpriced admission, matchedCriteria grounding | Existing tests | Unchanged, pass |
| Tool → model payload | tools.test | The gate passes through; `propertyType` reaches searchProjects |
| i18n | en/ms/zh | The same 6 new keys in each |

### Live data verification (read-only, after apply)

- Re-running the planner against live data plans 0 changes and skips 8 (already corrected or tagged), so the patch is idempotent.
- The 4 relocated projects store the corrected text and a fresh embedding: plain number[], length 1024, finite, norm 1.000.
- The 4 commercial projects store `propertyType: commercial`.
- Live searches through the new location and residential gates:
  - KLCC: 22 projects, d'Brightton gone.
  - North Kiara: exactly Miranda Hill and Tangen.
  - Mont Kiara: Alstonia and St. Regis gone.
  - Subang: Rimbun Saujana gone, still found under Shah Alam.
  - Sungai Buloh still finds Alstonia, and Titiwangsa still finds d'Brightton.
  - Bangsar (residential) has no Aspire; Bangsar (commercial) is Aspire only.
  - Cheras: 0.

**Not verified:**
- **Live model behaviour:** whether the model fills `nextSteps` and follows the gate wording. That needs a live chat; D-017 is blocking the live backend. The UI fallback covers a missing `nextSteps`.
- **The refusal card's appearance in the browser:** it needs an authenticated live Finder turn. Typecheck only.
