# Claim: quick-kayinleong-072
- owner: kayinleong
- session: claude-code
- branch: quick-kayinleong-045-whatsapp-ingest
- started: 2026-08-28
- status: done
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

## What has changed

**Enrichment moved into the writer.** `doPersistAssistant` now attaches the server's
collateral to whatever it is about to store, so every mid-generation checkpoint
(quick-070) lands with its files rather than only the final `onFinish` write. Because
quick-056's repair usually decodes a truncated envelope, the stored partial comes out as
complete, enriched JSON.

**A dead branch removed, and the finding recorded.** I tried emitting the collateral on
`finish-step` — the earliest point it is known — and tested it live: no metadata arrived
before the kill. The SDK's own comment is accurate ("Called on `start` and `finish` events",
ai/dist/index.d.ts:2010). The attempt is left as a comment so the next person does not
repeat it.

**The client reloads the stored row when a turn is cut short.** `sawFinish` tracks whether
the stream reached its `finish` chunk; if it did not, the client waits 1.2s for the final
checkpoint and re-reads the conversation, replacing the partial render with what is actually
on disk. Only on the truncated path — a completed turn already has everything and must not
pay a Firestore read.

## Verification

- `npx tsc --noEmit` -> **0 errors**
- `npx vitest run` -> **1092 passed**, 197 skipped, 0 failed
- `npx eslint app src` -> **0 errors**; `npm run build` -> exit 0

### Tested by abandoning a real turn, twice

Killed at 18s:

| | before quick-072 | after |
|---|---|---|
| stored on revisit | 5 matches, **0 files each** | 5 matches — **12 / 12 / 12** then 0s past the top-3 cap |
| routeDecision | `…:partial` | `…:partial` |

Allowed to complete (60s): 8 matches, same **12 / 12 / 12**, `rd=finder:manual-override`.

So a killed turn and a completed turn now store the same thing, which is the point.

### Regression surface
- **The enrichment only ADDS**, and only when the text decodes with at least one match; a
  turn that does not decode is stored verbatim exactly as before.
- The writer's length guard still holds — enriched text is compared against enriched text,
  so it stays monotonic and a checkpoint can never truncate a longer stored reply.
- The client reload is gated on `!sawFinish`, so the normal path is untouched, and it is
  wrapped in try/catch: a failed read leaves the agent with the partial render they had.

## Honest gaps

1. **The client-side reload is not covered by a test.** It is React state logic inside the
   send handler and this file has no jsdom harness. The server half — the enriched row it
   reads — is verified live; the reload itself is reasoned.
2. **My probe reported "metadata arrived: NO" even on a completed turn**, which is the probe
   splitting SSE lines across chunk boundaries, not the code — an earlier run of the same
   turn matched 36 metadata URLs raw. Worth knowing that the probe under-reports.
3. **The truncation itself is untouched.** quick-071 halved a turn to ~25s and this makes the
   result survivable, but the turn still needs to fit the platform's window. Cutting further
   means shorter rationales or fewer matches, which trades against the answer quality the
   user explicitly asked for.
4. **Matches past the top 3 still have no files** (quick-067's inline cap) — consistent, but
   it will still read as odd when 8 projects show and 3 have documents.
