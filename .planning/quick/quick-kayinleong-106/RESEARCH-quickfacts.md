---
status: complete
claim: quick-kayinleong-106
topic: per-project "quick facts" summary under the Finder result table
researched: 2026-11-25
confidence: HIGH (data model, wiring) / MEDIUM (token + latency estimates)
---

# Quick facts under the Finder table: research

## TL;DR
- **"Quick facts" is not a stored summary. It is the raw Skool write-up** in `projects/{pid}.description`.
  Across the 86 active projects it averages 2,471 chars (median 2,158, p90 4,894, max 6,846). It is
  English prose with label lines, it is not translated, and it holds PIC phone numbers and WhatsApp links.
  Nothing in it matches the competitor's "Best for / Layouts & Sizing / Key Selling Points". "Best for"
  is not stored anywhere. "Top Reasons Why" exists for only **12 of 84** projects, and only in the KB
  fact sheet, not on the project doc.
- The table reaches the UI as **server-built `rows` with no description at all**. The allowlist drops it
  on purpose. Rendering quick facts means new data has to travel. The UI has nothing it could fetch.
- **Recommendation: (c) hybrid, shown as a numbered "Project summaries" list below the table, covering
  only the shortlisted matches (at most 8).**
  - **Layouts & Sizing: deterministic.** The server builds it from `unitTypes`. The model never writes
    it, which keeps the 105 bedroom/budget rule intact.
  - **Best for and Key selling points: model-written**, grounded in a sanitized, capped Quick-Facts
    excerpt that the model sees for its top 8 only, in the user's language.
- **The user must confirm one thing first:** the client's 3-line format has to be *written* from the
  stored facts. It cannot be copied out of them. Pure deterministic rendering (option a) would show
  facts (developer, tenure, completion, layouts) with no "Best for", and only in English.

## 1. What "quick facts" is in the data model
| Where | What | Evidence |
|---|---|---|
| `projects/{pid}.description` | The whole Skool write-up. A `Quick Facts:` block sits inside it after the PIC/WhatsApp preamble. This is what the code calls "the Quick Facts prose". | `src/inventory/search.ts:1316` "The full stored write-up — the Quick Facts prose. Never truncated here."; `search.ts:1271-1275` (Quick Facts live in `description`, written by `to-inventory.ts`) |
| `projects/{pid}.unitTypes` | Structured per-layout rows: `label, sizeSqft, bedrooms, priceMinRM, priceMaxRM, grossMinRM?, grossMaxRM?, raw, soldOut?`. Present on 55 of 86 active projects (median 5, max 21 layouts). | `src/firebase/collections.ts:448-479` |
| KB doc `"<name> — D2 project facts (client sheet)"` (pillar finder) | Client-sheet facts: area, developer, land title, tenure, maintenance fee, units, storeys, completion, furnishing, car park, **top reasons why**, unit table. Only `projectDetail` reads it, by exact title. | `src/kb/client-factsheets.ts:41-43`; `src/agents/finder/tools.ts:796-820`; `src/inventory/client-workbook-new.ts:55` (`['topReasons', 'Top Reasons Why']`) |
| Details answer (UI) | The "Quick Facts" block on the Details sheet is **model-written markdown** (`answer`), laid out by the prompt template. The server only builds the contacts and links. | `src/agents/finder/project-sheet.ts:5-10`; `app/[lang]/chat/project-sheet.tsx:7-11`; `src/agents/finder/prompt.ts:213-239` |

**Structure, measured on `projects.export.json` (live export, 2026-11-25, gitignored):**
- 81 of 86 descriptions contain a "Quick Facts" heading.
- Label lines present: Developer 73, tenure/title 81, Location 65, completion 69, Facilities 53.
- Top-reasons, highlights or "why" wording appears in 15. "best/ideal/suitable for" appears in 3.
- 2 of 86 contain any CJK, so the corpus is effectively **English-only**.
- From the Quick Facts heading to the end runs a median of 1,982 chars. After stripping links and phone
  numbers and collapsing blank lines it is still a median of 1,815.
- Client sheet (`build/client-sheet.normalized.json`, 84 projects): `facts.topReasons` is non-null for
  12, with a median of 952 chars.

**Example 1: Skool write-up, Pavilion Damansara Heights (`hAAy2kb4t5Aigzmv7MPO`, 1,680 chars, excerpt):**
```
Quick Facts:
Developer: Pavilion Damansara (Impian Ekspresi Sdn Bhd)
Land Size: 15.92 acres
Title: Freehold
Total Units: 1,314
Windsor: 568 units — 614 – 1,831 sqft
Regent: 582 units — 605 – 1,878 sqft
Maintenance Fee: (inclusive of sinking fund)  R1 / R2: RM0.92 psf
```
**Example 2: client fact sheet, `build/factsheets/pavilion-damansara-heights-hAAy2k.md`, "top reasons why":**
```
Pavilion reputable premium developer
Exclusive Damansara Heights address
Freehold mixed developer: Premium Mall, MRT, Hotel
Quality fittings: Bosch, Gaggenau, marble & timber flooring, double-glazed windows
```
The preamble before "Quick Facts:" contains the PIC name, a personal phone or wa.me link, and the
group invite. `project-sheet.ts:39-91` already strips those for the sheet. **Raw description must never
be rendered or attached as-is.**

## 2. How the table reaches the UI today
1. **Search.** `searchProjects` Stage A loads every active doc into memory, so `description` and
   `unitTypes` are in hand. The mapper at `src/inventory/search.ts:1161-1176` then copies 12 scalars into
   `ProjectMatch` (`search.ts:125-160`) and **drops description and unitTypes**. The cap is
   `MAX_ROWS = 100` (`search.ts:286`).
2. **Tool.** `makeSearchProjectsTool` (`src/agents/finder/tools.ts:240-375`):
   - `execute` writes `sink.rows = enriched.matches.map(toFinderRow)` (`tools.ts:341`).
   - `toFinderRow` (`tools.ts:204-222`) is an allowlist copy.
   - `toModelOutput` caps what the model sees at `MAX_MATCHES = 8` (`tools.ts:362-371`; `search.ts:270`).
3. **Schema.** `FinderRowSchema` (`src/agents/finder/schema.ts:258-284`) is an explicit allowlist. Its
   comment says "NO `description` (2,553 chars average)…" (`schema.ts:253-255`). `tools.test.ts:192-240`
   pins exactly 14 keys and asserts that `description` is stripped.
4. **Route.** `finderRowSink` lives at `app/api/chat/route.ts:632`. The rows go out twice:
   - into `messageMetadata.finish.finderRows` (`route.ts:1385-1389`);
   - into the persisted envelope through `attachFinderRows` (`route.ts:719-735`;
     `app/[lang]/chat/decode-structured-output.ts:440-446`).

   The client merges them in `chat-input.tsx:526-533`.
5. **Render.**
   - `MatchList` matches branch → `<MatchTable rows matches onAsk>` (`app/[lang]/chat/match-list.tsx:151-160`).
   - The table has 8 columns, 10 rows per page, and horizontal scroll at 440px
     (`match-table.tsx:38,143-280`).
   - The model's `matches[].highlight` (≤120 chars, `schema.ts:234`) fills the Highlight cell for at most
     8 rows (`match-table.tsx:99-108,248`).
   - **`matches[].rationale` (required, `schema.ts:172`) is NOT rendered in table mode.** Only the
     MatchCard fallback shows it (`match-list.tsx:300`). The model already writes up to 8 grounded
     sentences that nobody sees.
6. **Details button.** It sends a translated `projectId: <id>` prompt (`match-table.tsx:252-277`), which
   triggers a **new chat turn** through `projectDetail` (`tools.ts:881-1042`). That turn returns the full
   `description`, `unitTypes`, fact sheet and KB. `ProjectSheet` (`schema.ts:290-321`) carries contacts
   and links only, not quick facts. **The row payload carries only scalars plus the id. Nothing lazily
   fetches quick facts. Details is a full model turn.**

**Over-the-wire note (pre-existing, not part of this claim):** ai@5.0.193 `toUIMessageStream` enqueues
`tool-output-available` with the **raw `execute` output** (`node_modules/ai/dist/index.mjs:5647-5656`),
not the `toModelOutput` view. The route applies no transform (`route.ts:1333`). So today the browser
already receives all ≤100 `ProjectMatch` objects. It also receives `projectDetail`'s full `description`,
phone numbers included. **Any field added to `ProjectMatch` reaches the client, so sanitize at the
source.** Flag this to the PDPA sibling and orchestrator.

## 3. Options
| | (a) Deterministic | (b) Model-written | (c) Hybrid (recommended) |
|---|---|---|---|
| Content | Parsed label lines (Developer, Tenure, Completion), `unitTypes` layouts, top reasons where present | "Best for", layouts, selling points written from the excerpt | Layouts come from `unitTypes` (server). Best for and selling points come from the excerpt (model). |
| Matches the client's format | Partly. No "Best for", and selling points exist for ~15/86 | Yes | Yes |
| Rows covered | All ≤100 (can be collapsible) | Top ≤8 (model view) | Top ≤8 |
| Hallucination | None. Parsing is heuristic (73-81/86 lines found) | Highest. Layout/budget claims break the 105 rule (`prompt.ts:144`), and "Best for" invites unsupported claims like "strong expat rental demand" | Layout claims are impossible by construction. Free text is limited to two short grounded fields. |
| i18n | Labels translated, values English | Writes in the user's language (`prompt.ts:198`) | Layout labels translated, numbers language-neutral, prose in the user's language |
| Model tokens | 0 | Excerpt input plus ~550 output tokens | Excerpt input plus ~400 output tokens |
| Latency | 0 | +6-10 s output [ASSUMED rate]. Finder turns already run 14-40 s (`route.ts:1300-1325`) | +5-8 s [ASSUMED] |
| Constraint | D3: no description snippets in the Highlight column (`match-table.tsx:90-97`). Put the content in a separate block, not in that column. | Grounding: the excerpt has no chunk id. Cite `projectId`, as matches already do (`prompt.ts:110`). | Same as (b) |

**Why (c):** it is the only option that produces the client's format without breaking the 105
"never say which layouts fit the budget" rule. The layout line is computed from `unitTypes` and
`soldOut`, the same source the prompt sends the model to (`prompt.ts:144`, "Only projectDetail's unitTypes
says that"), and the server is allowed to state it. If the user rejects model prose, drop the two model
fields and (c) degrades to (a) with no rework.

## 4. Recommended design (c)
**Data shapes**
- `src/inventory/quick-facts.ts` (NEW, pure, core):
  - `quickFactsExcerpt(description, maxChars = 700): string`. It:
    - slices from "Quick Facts";
    - drops URLs, phone numbers and PIC/leader/co-leader/WhatsApp lines (the same patterns as
      `project-sheet.ts:27-62`; move them here and re-export, because src/inventory must not import from
      src/agents);
    - collapses blank lines and caps the length.
  - `summaryLayouts(unitTypes, bedrooms?)`: available layouts first, the requested bedroom count first,
    at most 6. Fields: `{label, sizeSqft, bedrooms, priceMinRM, priceMaxRM, grossMinRM, grossMaxRM, soldOut}`.
    `raw` is dropped.
- `ProjectMatch` (`search.ts:125`) gains `quickFacts: string` and `layouts: SummaryLayout[]`, set in the
  mapper at `search.ts:1161`. **That is a 2-line edit in sibling (a)'s file, so merge order is needed.**
- `toFinderRow` keeps dropping both, so rows stay at 14 keys and `tools.test.ts:192` is unchanged.
- `toModelOutput` (`tools.ts:362`) passes `quickFacts` for the 8 and strips `layouts`.
- `FinderRowSink` (`tools.ts:177`) gains `summaries: Record<projectId, {layouts}>` for every row.
- `FinderMatchSchema` gains `bestFor?: string(≤100)` and `sellingPoints?: string(≤200)`, both
  `.optional()` (see `schema.ts:216-233` on why a required field deletes matches through
  `dropUnrenderableMatches`).
- A NEW server-attached `FinderOutput.summaries?: Array<{projectId, layouts}>` (≤8) works like
  `projectSheets`. Attach it only for `projectId`s in `matches`. It goes into `attachFinderRows` or a
  sibling `attachSummaries` in `decode-structured-output.ts`, through `route.ts:731` + `route.ts:1385`
  and `chat-input.tsx:531`, plus `parseMessageMetadata` (`decode-stream-chunk.ts:110-136` type, `:154` parser).

**Prompt** (`src/agents/finder/prompt.ts`): add a "Summary" section beside "Highlight" (`prompt.ts:131-136`):
- `bestFor` and `sellingPoints` come ONLY from that match's `quickFacts`. Omit a field rather than infer it.
- No layout, bedroom, size or budget claims (the system shows the layouts).
- No yield or rental-demand claims unless the text states them.
- Write in the agent's language.
- Keep `rationale` to one sentence, to pay for the extra output tokens.

**UI**
- NEW `app/[lang]/chat/match-summaries.tsx` (client), rendered in `match-list.tsx:154-160` below
  `<MatchTable>`.
- Numbered list in table rank order, with the same in-area/nearby headings
  (reuse `groupHeadingBefore`, `match-table.tsx:125`).
- Each entry shows:
  - the name;
  - **Best for**;
  - **Layouts & sizing**: one line per layout, `label · 1,076 sqft · 2 bed · Nett RM1.2m–1.35m · Gross …`;
    "sold out" layouts are grouped and never priced; price ≤0 or null renders nothing (reuse `formatPrice`);
  - **Key selling points**;
  - the existing Details button (reuse `showMorePrompt`).
- Mobile-first. Plain text only, never markdown or `dangerouslySetInnerHTML`.
- An entry with no fields is not rendered.
- New i18n keys `chat.matchTable.summaryTitle|bestFor|layouts|sellingPoints|soldOut` in en/ms/zh
  (`src/i18n/messages/*.json`). The `match-table.test.ts:110-140` key-resolution test pattern covers them.

**Tests**
- `src/inventory/quick-facts.test.ts` (NEW):
  - the excerpt strips phone, wa.me, chat.whatsapp and PIC lines;
  - it starts at "Quick Facts";
  - it caps at 700;
  - it returns `''` when the description is empty or missing.
  - `summaryLayouts`: drops `raw`, puts available layouts first, puts the requested bedroom count first,
    caps at 6, keeps `soldOut`.
- `src/agents/finder/tools.test.ts`:
  - `toModelOutput` carries `quickFacts` on ≤8 and no `layouts`;
  - the sink gets summaries;
  - the row allowlist is still 14 keys (existing test).
- `app/[lang]/chat/decode-structured-output.test.ts` or `project-sheet.test.ts`:
  - attach summaries replaces model-written ones (server truth wins), keeps only matched ids, and is a
    no-op when the list is empty;
  - `parseMessageMetadata` reads `summaries`;
  - a match without `bestFor` still decodes.
- `app/[lang]/chat/match-table.test.ts`, or a new `match-summaries.test.ts` (no jsdom, so use source
  greps and pure formatters):
  - every new key resolves in the 3 locales;
  - match-list renders the summaries after MatchTable;
  - the layout formatter never prints RM 0;
  - sold-out layouts carry no price.
- Eval (optional): one promptfoo case (`evals/promptfooconfig.yaml`) asserting no bedroom-fits-budget
  phrasing in `bestFor` or `sellingPoints`.

## 5. Payload size
| Path | Today | With (c) | With raw description (rejected) |
|---|---|---|---|
| Model, per step (8 matches) | ~1,000 tok (`search.ts:264`) | +8×≤700 = ≤5.6k chars, about **+1.5k tok** | +8×2,471 = 19.8k chars, about +5.3k tok (p90 39k chars) |
| Model, per turn (re-sent each step, `stepCountIs(5)`) | | about +3-7.5k tok (typically 2-5 steps) | about +11-27k tok against `TOKEN_CAP` 300,000/24h (`src/ratelimit/window.ts:50`) |
| Model output | | about +400 tok (8 × two short fields) | |
| Client metadata + persisted doc | 50 rows ≈ 10-12 KB (`search.ts:276-280`) | +≤8 × ~0.8 KB (slim layouts JSON: median 786 B, max 1,309 B with 6-8 layouts) ≈ +6 KB | 100 × 2.5 KB ≈ +250 KB per message (the 1 MB doc limit becomes real) |
| SSE tool-output (raw) | ≤100 `ProjectMatch` | +100 × (≤700 + ~800) ≈ +150 KB per search on the wire. **Mitigation:** compute `quickFacts`/`layouts` only for the top `MAX_MATCHES` in the mapper, leaving the rest empty, which gives ≈ +12 KB. | |

Caps that exist today: `MAX_MATCHES = 8` for the model (`search.ts:270`), `MAX_ROWS = 100` for the
client (`search.ts:286`), `MAX_PROJECT_SHEETS = 3` (`tools.ts:188`).

## Pitfalls
1. **PII.** Description preambles hold personal phones and wa.me links. Allowlist lines rather than
   blocklist them, and never ship the raw description.
2. **105 rule.** Any model text about which layouts fit the budget is a regression. Only the
   deterministic layout line may show per-layout prices, and only per layout. It must never say "fits
   your budget".
3. **Required schema fields delete matches** (quick-056/071, `schema.ts:216-233`). New model fields must
   be `.optional()`.
4. **Highlight-column D3 decision** (`match-table.tsx:90-97`). Do not back-fill cells with description
   snippets.
5. **Latency and timeouts.** Extra output tokens lengthen an already 14-40 s Finder turn
   (`route.ts:1300-1325`). Keep the fields short.
6. **Sibling overlap.** `search.ts` (mapper at line 1161) is under sibling (a) research, and the budget
   fields go through `src/audit/pdpa.ts` (sibling b). Do not filter layouts by the possibly-masked
   budget. Filter by `bedrooms` only.

## Assumptions / open questions
| # | Item | Risk |
|---|---|---|
| A1 | The user accepts model-written "Best for" and selling points (grounded in quick facts) rather than verbatim stored text, because the format is not stored | If they want verbatim only, ship (a) without "Best for" |
| A2 | Output rate of about 50-80 tok/s, which gives the +5-10 s latency estimates | Measure on one live turn |
| A3 | About 3.7 chars/token (derived from `tools.ts:402-405`: 254,375 chars ≈ 68,750 tok) | Token figures are ±20% |
| Q1 | Should `topReasons` (12 projects) be persisted onto the project doc by the client-workbook importer, so selling points can be read without a KB read per match? | Follow-up claim. Not needed for (c). |
