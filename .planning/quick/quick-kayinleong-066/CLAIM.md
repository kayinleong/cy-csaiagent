# Claim: quick-kayinleong-066
- owner: kayinleong
- session: claude-code
- branch: quick-kayinleong-045-whatsapp-ingest
- started: 2026-08-27
- status: done
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

## What has changed

**`src/kb/ingest/pipeline.ts`** — `embedding: FieldValue.vector(embedding)` instead of the
bare array. This is the whole bug in one line.

**`src/firebase/collections.ts`** — `KbChunkDoc.embedding: number[] | VectorValue`, with the
reason written where the next person will read it. `VectorValue` is declared in
`@google-cloud/firestore`; `firebase-admin/firestore` re-exports the runtime
`FieldValue.vector()` helper but not the type.

**`src/kb/crud.ts`** — both pillar paths repair the type on the way past:
- `copyDocsToPillar` normalises through a `toVector()` helper. Copying a pre-066 chunk
  verbatim would faithfully reproduce an unsearchable one.
- `repillarDocs` converts a bare array while it updates `pillar`. Without this, MOVING a doc
  to Coach would relabel an unsearchable chunk and look like it had done nothing — the
  quick-064 feature would have silently not worked.

**`scripts/backfill-kbchunk-vectors.ts`** — new, dry-run by default, `--pillar` and `--limit`
flags, paged with a cursor because 25k x 1024 floats will not fit in one `get()`.
Re-runnable: an already-converted chunk reads back with `toArray()` and is skipped.

**`src/rag/search.ts`** — `MIN_SIMILARITY` 0.35 -> **0.55**. See below; this only became
measurable once the fix worked.

## Verification

- `npx tsc --noEmit` -> **0 errors**
- `npx vitest run` -> **1068 passed**, 197 skipped, 0 failed
- `npx eslint app src scripts/backfill-kbchunk-vectors.ts` -> **0 errors**
- `npm run build` -> exit 0

### Tested against live Firestore, BEFORE pushing (as asked)

Diagnosis:

| step | result |
|---|---|
| `where(pillar==coach, status==published, lang in [en])` | **14 chunks** |
| same filters + `findNearest`, **no similarity floor** | **0 hits** |
| `Array.isArray(chunk.embedding)` | **true** — plain Array, no `toArray()` |
| one probe chunk written with `FieldValue.vector()`, same query | **1 hit, score 0.8517** |

The probe chunk was deleted immediately after.

Then ran the backfill on the 14 coach chunks (`--pillar coach --apply`) and re-ran the
user's own failing question through the real `firestoreRetrieve`:

| | before | after |
|---|---|---|
| "onboard me to core residence @ trx" | 0 results (kb_miss) | **8 results, top 0.6294** |
| "what unit types are available at core residence" | 0 | **8 results, top 0.6060** |
| "banana bread recipe" | 0 | **0 (correctly rejected)** |
| "what is the capital of France" | 0 | **0 (correctly rejected)** |

### The floor, measured at last
The fix made a second defect visible: at 0.35, "banana bread recipe" returned 8 chunks and
the Coach would have cited TRX pricing for it. Measured top-score distribution over the
coach corpus:

    RELEVANT   0.6060 .. 0.6496
    OFF-TOPIC  0.4587 .. 0.4924

0.55 sits in the gap with ~0.06 clearance either side. The old value's own comment admitted
it was unvalidated — it could not be validated, because nothing ever reached it.

### Regression surface
- **Finder is untouched.** `src/inventory/search.ts` scores in memory over `projects` and
  never calls `findNearest`, which is exactly why Finder has always returned matches while
  Coach never did.
- **Nothing reads `embedding` back.** Grepped: no production reader anywhere. The field
  exists to be indexed, so changing its stored type is safe.
- **Three tests asserted the OLD behaviour and were corrected, not weakened**:
  `kb.test.ts` asserted `Array.isArray(embedding) === true` — that assertion was pinning the
  bug in place. It now asserts a VECTOR with a 1024-element `toArray()`.
- Two test files' `FieldValue` mocks lacked `vector`; that was a mock gap, not behaviour.

## Honest gaps

1. **The other 25,153 chunks are NOT backfilled.** Only the 14 coach ones were, because
   those are what Coach retrieves. Finder's kbChunks are unused by any findNearest path
   today, and both the copy and move paths now repair the type as they go — so this is not
   blocking. Running `--apply` with no `--pillar` converts the rest whenever wanted.
2. **The floor is measured over 14 chunks from ONE project.** Both distributions will move
   as real coach content lands. Re-measure then; `score` carries `_vectorDistance` on every
   result so it stays observable.
3. **Duplicate chunks are in the results** — the same text three times. That is upstream:
   the source KB has duplicate documents, and copying both produced both. Not caused here.
4. **Reply is still empty** (0 chunks), so Reply SOP retrieval remains untested against real
   content even though the mechanism is now sound.
5. **Not clicked through in the browser** — verified through the real `firestoreRetrieve`
   against live Firestore, which is the function the Coach agent calls, but not through an
   authenticated chat turn.
