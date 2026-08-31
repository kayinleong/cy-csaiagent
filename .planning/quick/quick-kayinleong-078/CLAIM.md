# Claim: quick-kayinleong-078
- owner: kayinleong
- session: claude-code
- branch: quick-kayinleong-045-whatsapp-ingest
- started: 2026-08-28
- status: done
- summary: seed Coach and Reply with example content — both pillars answer kb_miss to every non-property question because there is nothing in them

## Why

Measured in quick-077 by running the user's five questions:

| pillar | kbDocs | kbChunks | result |
|---|---|---|---|
| coach | 3 | 35 | four of five questions answered "not in the D2 knowledge base yet" |
| reply | **0** | **0** | any Reply turn answers `no_sop_match`, even with a lead attached |
| finder | 1068 | 25153 | fine |

Nothing covers lead sources, portal response, WhatsApp follow-up, walk-ins, referrals or
viewings — the whole non-property half of the coach's job.

## What will change

Author seed documents and ingest them:
- **Coach** — lead lifecycle, listing-portal response, WhatsApp follow-up, walk-in/referral
  qualifying, first client viewing.
- **Reply** — one per canonical category the schema expects: `cold-prospect`,
  `objection-handling`, `financing`, `voice`.

## The thing to be honest about

**I am writing D2's operating procedures, and I do not know them.** An agent will repeat
this to a client as company policy. I raised it; the user said do it; so it is done — but
every document is titled `[Example]` and opens with a line saying it is a starter pending
Derek's review, and the source markdown is committed to `docs/kb-seed/` so he can edit and
re-upload rather than reverse-engineer what the bot said.

Nothing here states a price, a legal threshold, a commission figure, or a bumiputera/foreign
eligibility rule — those are exactly the facts that must come from the real inventory and
from Derek, not from me.

## What has changed

**Nine seed documents** in `docs/kb-seed/`, ingested — 5 Coach (lead lifecycle, portal
response, WhatsApp follow-up, walk-in/referral, first viewing) and 4 Reply, one per canonical
category (`cold-prospect`, `objection-handling`, `financing`, `voice`). 26 chunks.

**`scripts/ingest-kb-seed.ts`** — dry-run by default, skips a title already in the KB so a
re-run cannot duplicate the corpus, and drives the same bounded poll loop the browser does.

**A bug the content exposed: `category` was never denormalized onto chunks.**
`retrieveReplySop` narrows in memory — `results.filter((r) => r.category === category)` — but
the pipeline only ever wrote `category` on the kbDoc. So every categorised Reply lookup
filtered out ALL of its hits. Retrieval was scoring **0.69** and the agent still answered
`no_sop_match`. Fixed the same way `pillar` is: threaded through `IngestFile` -> the job doc
-> the chunk write, plus `scripts/backfill-kbchunk-category.ts` for what already existed.

## Verification

- `npx tsc --noEmit` -> **0 errors**
- `npx vitest run` -> **1135 passed**, 197 skipped, 0 failed
- `npx eslint app src <new scripts>` -> **0 errors**; `npm run build` -> exit 0

### The five questions, before and after

| # | before | after |
|---|---|---|
| 1 | finder, misrouted | **unchanged — still misroutes** |
| 2 | coach, "doesn't have a specific SOP yet" | coach, **5 citations**, grounded answer |
| 3 | coach, "isn't in the knowledge base yet" | coach, **5 citations**, grounded answer |
| 4 | coach, "doesn't have specific content yet" | coach, **5 citations**, grounded answer |
| 5 | coach, "doesn't have a specific SOP" | coach, **5 citations**, 3788-char answer |

And a Reply turn with a lead attached went from `no_sop_match` to a real drafted reply that
retrieved both the objection SOP and the voice guide.

    kbChunks  coach 35 -> 47    reply 0 -> 10

### A 25,000-write mistake avoided
The first backfill dry run reported **25,184** chunks to update. The WhatsApp/inventory
importer had put the PROJECT NAME in `category` on all 1068 Finder docs — "Tangen Residences",
"Kensho @ Taman Desa". Those are not SOP categories and nothing reads them; Finder scores in
memory over `projects` and never touches kbChunks. Added `--pillar` and ran it for `reply`
only: **10 chunks**. Running the dry run first is the only reason that did not happen.

### Regression surface
- `category` is OMITTED rather than written as undefined when a doc has none — Firestore
  rejects undefined field values.
- The Finder path is untouched: it never reads chunk category, and its 25k chunks were not
  written to.
- Ingestion is re-runnable and title-deduplicated.
- The seed markdown is committed, so editing means changing a file and re-uploading rather
  than reverse-engineering what the bot said.

## Honest gaps — read this before trusting the content

1. **I wrote D2's operating procedures and I do not know them.** I raised this; you said do
   it; it is done. Every document is titled `[Example]` and opens with a line saying it is a
   starter pending Derek's review. **Agents will repeat this to clients as company policy.**
   Nothing in it states a price, a legal threshold, a commission figure, or a bumiputera /
   foreign-eligibility rule — those must come from real inventory and from Derek — but the
   process advice is my judgement, not D2's.
2. **Q1 still misroutes to Finder.** "how does it manage leads" is a product question and the
   heuristic reads "property leads" as a search. Untouched — it is a routing change.
3. **The `[Example]` prefix shows in citations**, so agents will see it. That is deliberate.
4. **The Coach docs have no `category`**, so a categorised Coach lookup would filter them all
   out the same way Reply's did. Nothing does that today; worth knowing before something
   starts to.
