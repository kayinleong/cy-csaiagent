# Claim: quick-kayinleong-072
- owner: kayinleong
- session: claude-code
- branch: quick-kayinleong-045-whatsapp-ingest
- started: 2026-08-28
- status: claimed
- summary: quick-071 attached collateral only at onFinish, so a TRUNCATED turn now shows no files at all — enrich at every checkpoint instead

## What will change

User: "the output still truncated / also now the files went missing".

**The missing files are a regression I introduced in quick-071.** I moved collateral off the
model and onto the server, but attached it in only two places, and neither runs when a turn
is cut short:

- `messageMetadata` — the AI SDK calls it "on `start` and `finish` events" only
  (ai/dist/index.d.ts:2010). A killed turn never reaches `finish`, so the client gets no map.
- the persist-time rewrite — inside `onFinish`, which also never runs.

Before 071 the model had already transcribed some URLs into the text, so a truncated turn
kept whatever had streamed. Now it keeps nothing. Strictly worse for exactly the case that
was already failing.

Planned: enrich inside the writer itself, so every mid-generation checkpoint (quick-070)
stores the envelope WITH its files. A truncated turn then renders its files on revisit.

The truncation itself is the pre-existing timeout — quick-071 halved a turn from 48-76s to
~25s, which is not enough on its own.

## Verification

_(pending)_
