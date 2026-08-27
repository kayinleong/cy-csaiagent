# Claim: quick-kayinleong-065
- owner: kayinleong
- session: claude-code
- branch: quick-kayinleong-045-whatsapp-ingest
- started: 2026-08-27
- status: claimed
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

## Verification

_(pending)_
