# Claim: quick-kayinleong-066
- owner: kayinleong
- session: claude-code
- branch: quick-kayinleong-045-whatsapp-ingest
- started: 2026-08-27
- status: claimed
- summary: kbChunks store `embedding` as a plain number[], which a Firestore vector index does not cover — findNearest has returned 0 for every Coach and Reply query since day one

## What will change

User: "coach is not working too, please test on ur side first before pushing".

Tested against live Firestore, and this is not a tuning problem:

| step | result |
|---|---|
| `where(pillar==coach, status==published, lang in [en])` | **14 chunks** |
| the same filters + `findNearest`, **no similarity floor** | **0 hits** |
| `Array.isArray(chunk.embedding)` | **true** — a plain Array, not a VectorValue |
| one probe chunk written with `FieldValue.vector()`, same query | **1 hit, score 0.8517** |

A Firestore vector index only covers fields stored as the VECTOR type. All 25,167 kbChunks
were written with a plain `number[]`, so the index has never contained a single one and
`findNearest` has always returned nothing. **Coach and Reply RAG have never worked.** Every
kb_miss reported in this project traces here.

`FieldValue.vector()` appears exactly twice in the repo: in `spike-rag.test.ts` (the SPIKE
that proved the pattern) and for the QUERY vector in `search.ts:176`. No production write
path ever adopted it.

Finder is unaffected — `src/inventory/search.ts` scores in memory, never through
findNearest, which is why it has always returned matches.

Planned:
1. Write embeddings as `FieldValue.vector()` at ingestion.
2. Backfill the 25,167 existing chunks.
3. Prove it with the user's own failing question BEFORE pushing.

## Verification

_(pending)_
