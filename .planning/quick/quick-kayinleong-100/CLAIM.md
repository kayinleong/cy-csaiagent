# Claim: quick-kayinleong-100
- owner: kayinleong
- session: claude-code
- branch: quick-kayinleong-100 (stacked on quick-kayinleong-099, so the fix can be checked live on the Gemini dev server)
- started: 2026-10-27
- status: done
- summary: scope projectDetail's knowledge-base extracts to the project asked about, and default a missing `matches` to [] when decoding Finder replies

## What will change

Both defects came out of the 2026-10-27 field-check re-test (docs/UAT-Field-Check-Retest-2026-10-27.xlsx):

1. `projectDetail` fetched KB extracts with an unscoped similarity search
   (`src/agents/finder/tools.ts`). Other projects' fact sheets came back, and answers quoted
   their facts: St. Regis stated a developer that is not in the St. Regis fact sheet it cited;
   Aster Hill stated the St. Regis fact sheet's developer word for word.
2. A Finder reply without a `matches` key failed `FinderOutputSchema`, so a valid refusal
   (reason, explanation, next steps) rendered as a bare sentence (UAT F11 on Gemini).

## What has changed (db43118)

- `src/rag/search.ts`: `RetrieveOpts.limit` (findNearest top-K override, clamped 1–100;
  default unchanged at 8).
- `src/agents/finder/tools.ts`:
  - `projectDetail` retrieves `KB_CANDIDATES_FOR_DETAIL` (40) candidates, then
    `ownProjectChunks` keeps only chunks whose kbDoc belongs to the project, in similarity
    order, and takes the top `KB_CHUNKS_FOR_DETAIL` (5).
  - Ownership (`kbDocBelongsToProject`): `category == project name` or title subject
    (`"<name> — …"` / `"WhatsApp — <name>"`) `== project name`, exact after normalisation.
    These are the conventions `scripts/data-completeness-report.ts` already uses.
  - If the kbDocs read fails, the extract is an honest miss; nothing unscoped is used.
- `src/agents/finder/schema.ts`: `matches` defaults to `[]`. `decodeFinderOutput` still
  requires a populated state. Every caller already picks the decoder by the server's pillar,
  so a Reply envelope is never fed to it.

## Verification

- Tests:
  - 9 new tests (ownership rule, scoped extracts, the read-failure path, `limit` clamping,
    decoding without `matches`), plus an updated retrieve-options assertion.
  - Run against the pre-fix source, the 8 behaviour-change tests fail, and they pass with
    the fix. The 9th, a category-kept regression guard, passes on both.
  - Full suite: 1599 passed, 223 skipped. The only failing suite is the pre-existing
    `tests/finder-corpus-gates.test.ts` (gitignored `projects.inventory.json` absent).
  - Typecheck clean. Lint: 0 errors.
- Live probe (read-only, real `retrieve` and the new rule, 12 projects):
  - Old code: 49 of the top 96 extracts were foreign.
  - New code: every project keeps 3–5 extracts of its own, and none is left empty.
- Live chat re-check (local Gemini dev server, chat UI, new conversation each):
  - F11 now renders the "No match found" card with the 2 next steps (saved envelope:
    refusal + nextSteps, no `matches`).
  - 8 projects (St. Regis, Aster Hill, Eaton, Kensho, Katana 2, The Centrix, PSQ, Platinum
    Face): every KB source the answers cite is now the project's own. Before, The Centrix
    cited an "11 projects comparison" PDF.
- **Finding during verification.** The extra developer names in those answers come from each
  project's OWN stored write-up, not from other projects. Each write-up names the developer
  that the client sheet places in a different row (the Developer-column offset; see
  docs/UAT-Field-Check-Retest-2026-10-27.xlsx). That is a data fix for the client sheet, not
  a retrieval defect.

### Regression report

| Surface | Checked | Result |
|---|---|---|
| Coach / Reply retrieval | `limit` is opt-in; default top-K unchanged | rag tests pass, Reply SOP tests pass |
| projectDetail when the project has no own extracts | Unit test (all foreign) + live probe (0 of 12 empty) | Honest miss, never borrowed |
| Older persisted Finder turns | Decoder tests (with and without `matches`, `{}` and `{rows:[]}` still null) | Pass |
| Reply decoding | Callers gated by server pillar (`chat-input.tsx`, `conversation-messages-map.ts`, `route.ts`) | Unaffected |

### Known limitation

35 of the 108 WhatsApp kbDocs are titled with a variant project name (e.g. "Eaton KLCC",
"Core Res TRX", "Kensho materials") and have no `category`. They now belong to no project, so
their chat history no longer feeds detail answers. Fix: a reviewed mapping that sets each
one's `category` to its inventory name. Not done here: data write, and some names are
ambiguous.
