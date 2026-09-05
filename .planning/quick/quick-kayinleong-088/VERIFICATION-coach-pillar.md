# Verification — Coach pillar filter (quick-kayinleong-088)

Follow-up verification for commit `8fdc330`, which added `{ pillar: 'coach' }` to both
`retrieve()` call sites in `src/agents/coach/tools.ts`. Measured live 2026-09-05.

The code change was already committed and pushed before this check ran. What follows is the
two verifications that were requested — and the finding that came out of the second one.

## Check 1 — the composite vector index is generic over `pillar` ✅

`firestore.indexes.json`, `kbChunks` collection group:

| Fields |
|---|
| `lang` ASC, `ownerCollection` ASC |
| `lang` ASC, `embedding` VECTOR(1024) |
| `lang` ASC, `status` ASC, `embedding` VECTOR(1024) |
| **`pillar` ASC, `lang` ASC, `status` ASC, `embedding` VECTOR(1024)** |

The fourth index is keyed on the **field path** `pillar`, not on a value, so it serves
`pillar == 'coach'`, `'finder'` and `'reply'` identically. It is not reply-specific and there
is no `FAILED_PRECONDITION` risk. Confirmed empirically too — every coach-pillar query below
executed without error, which only happens if the index is deployed.

## Check 2 — does the Coach still retrieve anything? ✅ mechanically, ❌ in substance

Eight real onboarding questions through `retrieve(q, 'en', { pillar: 'coach' })`:

```
retrieved: 8/8    honest kb_miss: 0/8    cross-pillar leaks: 0
```

Every returned chunk carries `pillar:'coach'`. The filter does exactly what it should.

**But the corpus it filters to is not what the label implies.** Auditing all 47 coach chunks
across their 8 source documents:

| Composition | Chunks | Share |
|---|---:|---:|
| `[Example]` placeholder docs (5 of them) | 16 | 34% |
| **Property material tagged `pillar:'coach'`** | **26** | **55%** |
| Orphaned — parent `kbDoc` no longer exists | 5 | 11% |
| **Genuine D2 onboarding curriculum** | **0** | **0%** |

The property docs:
- `Bangsar Hill Park — FAQ - Tower B, C.pdf (OCR)` — **21 chunks**, 45% of the whole coach
  corpus on its own. Carries `copiedFromId` pointing at **itself**, so it arrived through
  `copyDocsToPillar` and the copy's id collided with the source id.
- `Core Residence @ TRX — Emailing 629-TRX-ARC-CA-ENL-TWR3-108-A1n-RFi-35` — 5 chunks, no
  `copiedFromId` at all, so it was ingested directly as `pillar:'coach'`. An architect's
  email about a tower drawing, filed as onboarding material.

Keyword presence across all 47 coach chunks:

| Term | Chunks containing it |
|---|---:|
| `ren tag` / `ren` / `negotiator` | **0** |
| `commission` | **0** |
| `onboarding` | **0** |
| `meta ad` / `facebook` | **0** |
| `first week` / `training` | **0** |

**Not one of the topics the probe asked about exists in the corpus.**

That explains results which look like successes and are not:
- *"how do I get my REN tag"* → 1 hit at 0.5632, and the chunk is about people stating what
  they want in a first message. It clears the 0.55 coach floor and is unrelated. There is no
  REN content to find.
- *"what is the D2 onboarding journey"*, *"what training do I need in my first week"* and
  *"what commission split does D2 use"* all top out on the **same** chunk, which begins
  *"Starter document written to give the Coach something to answer with. Derek should review
  and co…"* — content that labels itself a stub awaiting review.

## Conclusion

The pillar fix is **correct and necessary, and not sufficient.** It stops the Coach searching
25,153 property chunks. It cannot stop the Coach citing property content, because 55% of the
coach corpus **is** property content wearing a coach label — a data problem the filter is
blind to by construction.

`0 cross-pillar leaks` above is true by the `pillar` field and misleading in substance. Do
not read it as "the Coach is now grounded in onboarding material".

## Recommended follow-ups (not done — these are Derek's call, not a code fix)

1. **Re-pillar the two property docs** to `finder`. This makes the Coach *worse* at returning
   something and *more honest*: an onboarding question would produce a `kb_miss` + handoff,
   which is the designed D-10 behaviour, instead of a confident answer sourced from a Bangsar
   Hill Park tower FAQ. Leaves the coach corpus at 21 chunks, 16 of them placeholders.
2. **Delete or re-ingest the 5 orphaned chunks** (`aWXEQ4oqOdRXonDcI9SX`). They are still
   retrievable because `status` is denormalized onto the chunk, but any citation pointing at
   the parent doc will break.
3. **Load real onboarding content.** This is the actual blocker on the Coach pillar, and no
   amount of retrieval tuning substitutes for it. Until then the honest outcome for most
   onboarding questions is `kb_miss` + escalation.
4. **Re-measure the coach floor afterwards.** `MIN_SIMILARITY_BY_PILLAR.coach = 0.55` was
   measured against this 47-chunk corpus, so it is calibrated against placeholder and
   property text. Left untouched deliberately — re-measuring it against a corpus this
   unrepresentative would not improve it.
