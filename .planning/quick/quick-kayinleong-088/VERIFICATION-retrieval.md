# Verification — Finder retrieval, before and after the VECTOR conversion

Claim: `quick-kayinleong-088`. Measured against **live Firestore** on 2026-09-05.
Query embeddings via `gemini-embedding-001` @1024-d.

## The change under test

All 25,153 `kbChunks` with `pillar:'finder'` stored `embedding` as a plain `number[]`. A
Firestore vector index does not cover plain arrays, so `findNearest` matched **nothing** —
silently, with no error. `backfill-kbchunk-vectors.ts --pillar finder --apply` re-wrapped
every one with `FieldValue.vector()`. Zero token cost: the vectors already existed.

### Conversion is complete and idempotent

```
--pillar finder            → scanned 25153 · converted 25153 · already vector     0
--pillar finder (re-run)   → scanned  2000 · converted     0 · already vector  2000
all pillars (post-apply)   → scanned 25210 · converted     0 · already vector 25210 · no embedding 0
```

## Test 1 — relevance vs off-topic controls

`retrieve(q, 'en', { pillar: 'finder' })`. Every one of these returned **zero rows** before
the conversion, so the "before" column is not a regression baseline — it is a flat floor.

| | Query | Hits | Top score | Top chunk (truncated) |
|---|---|---|---|---|
| ✅ | panel bankers loan margin for Imperial Residences | 8 | **0.8337** | `Panel Bankers EF for Imperial Residences RA: 1. MBB (Margin up to 90%}…` |
| ✅ | Imperial Residences Pavilion Damansara Heights price per layout | 8 | **0.8015** | `PAVILION DAMANSARA HEIGHTS PARCEL 2 RA … (A) SELLING PR…` |
| ✅ | maintenance fee per square foot and booking fee | 8 | 0.7117 | `Maintenance fee - RM 0.80 psf + 10% sinking fund…` |
| ✅ | studio 504 sqft price range | 8 | 0.7072 | `Unit Floor Side Type Sqft SPA Price SPA PSF …` |
| ⚠ | *control:* banana bread recipe | 8 | 0.5700 | — |
| ⚠ | *control:* how do I change a car tyre | 2 | 0.5576 | — |

## Test 2 — Task 1 acceptance: is the stakeholder's reference output retrievable?

One query per field of the pasted "Imperial Residences (RA)" reference. Pass = ≥1 hit at
≥0.62 (the candidate floor from the control distribution above).

| Field | Top score | Top chunk (truncated) |
|---|---|---|
| per-layout price | 0.7471 | `1,831 sq.ft. Penthouse: 6,483 sq.ft. Regent Suites (R2)…` |
| developer | 0.7074 | `PAVILION DAMANSARA HEIGHTS KUALA LUMPUR BANK DETAILS - IMPERIAL RESIDENC…` |
| title / HDA | 0.7208 | `rm0.66psf include sinking. *Title* : commercial under HDA *carparks*: LG…` |
| VP target | 0.7294 | `…Better don't promise on early completion…` |
| booking amount | 0.7386 | `For 2.4% will be 1.6 the 0.8 For 3.2% will be…` |
| parking | 0.7587 | `Unit No Sq Ft Level Single/Tandem Carpark Level Carpark Number…` |
| maintenance fee | 0.7041 | `For 2.4% will be 1.6 the 0.8 For 3.2% will be…` |
| furnishing | 0.7296 | `Kitchen Cabinet (Kitchen/ Dry Kitchen) - Imported top and bottom cabinet…` |
| panel bankers | **0.8131** | `Panel Bankers EF for Imperial Residences RA: 1. MBB (Margin up to 90%}` |
| bank-in details | 0.7728 | `PAVILION DAMANSARA HEIGHTS KUALA LUMPUR BANK DETAILS - IMPERIAL RESIDENC…` |
| selling points | 0.7943 | `Heights* 🏙️ 1️⃣ *Freehold integrated mixed development* Own a rare piec…` |
| unit type codes | 0.7418 | `sq.m.) Type H1a 3,369 sq.ft. (313 sq.m.) Type H1 3,369 sq.ft. (313 sq.m.` |

**12 / 12 retrievable.** The Task 1 content was never missing — it was unreachable. What
remains for Task 1 is wiring a project-scoped tool so the Finder actually queries it.

### Honest caveats on precision
- `booking amount` and `maintenance fee` both top out on the same payment-scheme chunk
  (`For 2.4% will be 1.6…`). Coverage is there; ranking is imperfect.
- `VP target`'s top hit is a WhatsApp chat message, not a spec sheet. Usable context, weak
  authority. A project-scoped filter (rather than corpus-wide similarity) should improve both.

## Regression exposed by this change

`MIN_SIMILARITY = 0.55` in `src/rag/search.ts` was measured against a **14-chunk** corpus and
its own doc comment says to re-measure when real content lands. On the now-reachable
25,153-chunk corpus the controls clear it — "banana bread recipe" returns 8 citable chunks at
0.5700. This exposure is *created* by enabling retrieval, so it belongs to this claim.

Separation in the data above: relevant **0.7041 – 0.8337**, controls **0.5576 – 0.5700**. A
floor of **0.62** passes all 12 reference fields and rejects both controls, with ~0.05
clearance on the low side and ~0.08 on the high side.

⚠ Still measured on Imperial-Residences-weighted queries against one corpus. `score` carries
`_vectorDistance` on every result, so the distribution stays observable — re-measure as the
corpus grows.
