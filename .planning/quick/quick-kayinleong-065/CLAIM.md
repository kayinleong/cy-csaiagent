# Claim: quick-kayinleong-065
- owner: kayinleong
- session: claude-code
- branch: quick-kayinleong-045-whatsapp-ingest
- started: 2026-08-27
- status: done
- summary: "Copy to" alongside "Move to" — Coach needs content but moving a sales kit out of Finder breaks Finder

## What will change

User: "add a copy function too", on the working bulk bar from quick-064.

Move is destructive to the source pillar, and that is the wrong tool for the actual
situation: Coach has 10 chunks and needs content, but the 1068 Finder documents are Finder
inventory that the Finder agent still needs. Copy gives Coach the material without taking it
away from Finder.

Planned: `copyDocsToPillar()` — duplicate the kbDoc and its chunks under the target pillar.
- The embedding is copied VERBATIM. Vectors are pillar-agnostic, so a copy needs no Gemini
  call and costs nothing but storage.
- Deterministic copy id (`<sourceId>--<pillar>`) so a repeat click is a no-op and the client
  loop is safe to re-run — an equality query on two fields would need a composite index.
- Version lineage (`supersedesId` / `supersededBy` / `correctedBy`) is NOT copied; it belongs
  to the source's chain and carrying it over would corrupt both.

## What has changed

**`src/kb/crud.ts` — `copyDocsToPillar()` + `copyDocId()`**
Duplicates the kbDoc and every one of its chunks under the target pillar, leaving the
original untouched.

- **The embedding is copied verbatim.** Vectors are pillar-agnostic, so a copy makes no
  Gemini call, does no re-chunking, and is retrievable the moment it is written. It costs
  storage and nothing else.
- **`copyDocId(source, pillar)` = `<sourceId>--<pillar>`, deliberately deterministic.** The
  client LOOPS this action and a user can double-click; with a generated id every pass would
  mint another duplicate and quietly double the corpus. Deriving the id makes "already
  copied?" a single `get()` — the equality query on `(copiedFromId, pillar)` that would
  answer the same question needs a composite index.
- **Version lineage is NOT copied.** `supersedesId` / `supersededBy` / `correctedBy` describe
  the SOURCE's chain; carrying them over would make two documents claim one place in one
  history. The copy starts at v1 with `copiedFromId` pointing home.
- Copying into the pillar a document already lives in is skipped, not duplicated.
- `COPY_DOC_LIMIT = 3`, lower than `REPILLAR_DOC_LIMIT`: a copy WRITES a chunk per source
  chunk rather than updating one, each carrying a 1024-float embedding.

**`app/[lang]/(admin)/kb/kb-doc-list.tsx`** — `handleMove` generalised to
`handleBulk(mode, pillar)`, and the bar became two labelled rows. Six identical buttons on
one line would not say which of them takes the documents away from their current pillar.

## Verification

- `npx tsc --noEmit` -> **0 errors**
- `npx vitest run` -> **1067 passed**, 197 skipped, 0 failed (was 1060; **+7**)
- `npx eslint app src` -> **0 errors**; `npm run build` -> exit 0

### Looked at it
Rendered the REAL `KbDocList` with a seeded selection, compiled the project's own
`app/globals.css` through the Tailwind 4 CLI, and screenshotted: `2 selected … Clear`, then
`Move to [Coach][Finder][Reply]` and `Copy to [Coach][Finder][Reply]`. This also closes the
quick-064 gap where the bar had never been seen rendered.

### What the tests pin
Doc AND chunks duplicated with the new docId and pillar; the embedding copied verbatim; no
version lineage on the copy; a repeat click is a no-op (`skipped`, no write); same-pillar
copy skipped; bounded per call; non-admin and an invalid pillar both refused before any
write.

### A bug caught before commit
The copy confirm string was written as a template literal spliced with `' +`, so the dialog
would have shown `Chunks are ' + 'duplicated`. It typechecked and would have shipped — found
by reading the rendered line back rather than trusting tsc.

### Regression surface
- **Additive.** `repillarDocs` is untouched and its 7 tests pass unchanged; the move path
  now runs through the shared `handleBulk` with identical behaviour.
- `copiedFromId` is a new OPTIONAL field on `KbDocDoc`; nothing reads it yet, so no existing
  query or render changes.
- Copies are ordinary published kbDocs, so publish / unpublish / delete / supersede all work
  on them exactly as on any other document.

## Honest gaps

1. **Storage cost is real and not surfaced in the UI beyond a sentence in the confirm
   dialog.** Copying all 1068 Finder docs would add ~25k chunks, each with a 1024-float
   embedding. The confirm says "this adds to storage"; it does not estimate how much.
2. **Deleting a source does not delete its copies.** They are independent documents by
   design — `copiedFromId` records the link but nothing acts on it.
3. **A copy does not track its source.** Edit the Finder original and the Coach copy keeps
   the old text; it is a snapshot, not a mirror. Re-copying after deleting the copy is the
   way to refresh it.
4. **Not exercised end to end** — no admin session to run a real copy against Firestore. The
   writes are unit-tested against mocks and the markup is screenshotted, but the round trip
   is not proven.
