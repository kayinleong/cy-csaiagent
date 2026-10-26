# Plan: quick-kayinleong-098

Fix the causes behind the 24 Oct UAT project failures, in code and in data.

## Evidence

Every failure was reproduced by running the real gates in `src/inventory/search.ts` over
`projects.export.json` (live Firestore, 2026-10-20). The stored strings match the UAT captures
word for word.

| UAT | Project | Cause |
|---|---|---|
| F9 | d'Brightton titiwangsa | `…; near Taman Tasik Titiwangsa, KLCC`. The haystack splits on commas before it drops proximity clauses, so the trailing `KLCC` survives as if it were the address. |
| F5 | Alstonia Hilltop Homes | `…Sungai Buloh, KL North (Mont Kiara/Dutamas region)`. The token tier accepts "North Kiara" when "north" and "kiara" appear anywhere. St. Regis (`KL Sentral … (Mont Kiara/Dutamas area, KL North)`) passes the same gate and is only hidden by its RM2.28m price. |
| F11 | (no project) | The refusal schema has only `reason` + `explanation`, so a next step is optional prose. Run 3 dropped it. Run 1 also implied Cheras stock that does not exist. |
| N2 | Aspire office @ KL ecocity | No property type exists, so an office passes a residential own-stay search. Its unknown price passes any budget (quick-085). |

## Out of scope

- **OAKA price (D-014).** Stored RM750,000 is the "RM750k–RM1.4m" range floor; its 4 layouts carry no structured price. F1 expects OAKA inside an RM800k budget, so changing the price flips F1. That is Derek's decision.
- **Binastra Cochrane.** Never loaded (096 skipped new projects). Adding it flips F11/F19, so it waits for Derek.
- **Appending the client sheet's Area to `locationText`** for the other projects that lack it. 096 deferred it, it fixes no UAT failure, and several client Area values need cleaning first (for example "aman U-Thant").
- **Admin UI for editing property type.** The Inventory page is down (D-013). The name heuristic below covers untagged projects until that page is fixed.
- **The `KLCC/Bukit Bintang area` lumping** in some location strings. The tester accepted those rows.

## Waves

All code tasks write `src/inventory/search.ts`, and tasks 3–4 both write `prompt.ts` and `tools.ts`, so they run in sequence in one writer (file-disjoint rule). Task 5 needs the new gate code. Task 6 runs last.

### Wave 1: location gate (`src/inventory/search.ts`)

1. **Near scope.** Split `locationText` into sentences on `; . | – —`, then into comma clauses. A proximity clause starts a run that drops the comma clauses after it, until the sentence ends or a clause names a street or area (Jalan, Lorong, Persiaran, Off, Taman, Bukit, Kampung, Desa, Sri, Bandar, Mont, …; or contains area/district/region). A clause made only of qualifier or compass words ("KL North", "Centre of KL") is kept but does not end the run. If every clause is dropped, fall back to the full text, as today.
   - Corpus diff (prototype over all 83 active records): only landmark lists are dropped. The changed searches are KLCC (d'Brightton leaves), Mid Valley (Lunar Seputeh and Parkside leave), Petaling Jaya (Enlace leaves) and KL Sentral (Lunar Seputeh leaves). Park Green keeps "Bukit Jalil", and Star Residences and PSQ keep their street clauses.
2. **Compass words.** north/south/east/west and utara/selatan/timur/barat no longer count as discriminating tokens. A preference that contains one must match as an exact phrase, as `Sri Petaling` already does. "North Kiara" still matches Miranda Hill and Tangen. It no longer matches Alstonia, St. Regis or Eden.

### Wave 2: no-match next step + property type

3. **No-match next step.**
   - `SearchResult` no_match carries `gate`: `eligibility | location | property_type | price | relevance`.
   - `FinderRefusalSchema.nextSteps`: up to 3 strings. It stays optional only so older persisted turns still decode; quick-056/071 showed that a required field deletes real answers.
   - The prompt requires 1–3 next steps on every refusal and makes the explanation follow the gate. For `location`, it must say D2 has no active project in that area at all, and must never suggest units there may exist.
   - The refusal card renders `nextSteps`. When they are missing, it shows translated default steps (EN/BM/中文), so a no-match card never ends without one.
   - The offline builder (`index.ts`) emits gate-aware next steps.
4. **Property type.**
   - `ProjectDoc.propertyType?: 'residential' | 'commercial'`.
   - `propertyTypeOf(doc)`: the stored field wins; otherwise the name heuristic (office, commercial, corporate tower, retail, shop lot, shop office); otherwise residential.
   - `ParsedCriteria.propertyType` and the tool input: `residential | commercial | any`, defaulting to residential. The gate runs after location and before price. An empty set gives `no_match` with gate `property_type`.

### Wave 3: data patch (`scripts/fix-uat-location-and-type.ts`)

5. **Dry run by default.**
   - Location corrections, each gated on the stored text still being exactly the 20 Oct value:
     - Alstonia → client sheet Area `Bukit Rahman Putra (BRP), Sungai Buloh, Selangor`
     - St. Regis → `KL Sentral, Kuala Lumpur` (drops the fabricated Mont Kiara/KL North tag)
     - Rimbun Saujana → client sheet Area `Shah Alam, Selangor` (drops `KL West/PJ/Subang region`, which leaks it into Subang searches)
     - d'Brightton → `…; near Taman Tasik Titiwangsa and KLCC`
   - `propertyType`: commercial for Aspire office, The Stride Office, E&O Laman Embun Commercial and The MET Corporate Tower; residential for every other project.
   - Location changes re-embed via `embedProject` (`locationText` is embedding-relevant). `propertyType` is not.
   - `--apply` writes a before-image backup first. `--restore <file>` undoes it.
   - **Live apply only after the user approves the dry-run report.**

### Wave 4: verify

6. Run vitest, typecheck and lint over the changed files. Update the pinned corpus expectation (Petaling Jaya 4 → 3), which was verified against the export because `projects.inventory.json` is not on this machine. Write the regression report into CLAIM.md.
