# quick-kayinleong-088 — RESEARCH: Finder "more details" output depth (Task 1)

Read-only research. No source files were modified.

**Bottom line:** the rich per-layout / Quick-Facts prose the stakeholder wants is *already stored
verbatim* in `ProjectDoc.description` (the importer writes the whole Skool body:
`scripts/scrape-skool/to-inventory.ts:91`), but **no Finder code path ever hands it to the model.**
`ProjectMatch` — the only inventory shape the model sees — deliberately omits `description`
(`src/inventory/search.ts:798-820`). So this is a *carry-through* gap on the ~50% of fields the
source does have, and a genuine *source-data* gap on the per-layout price table (7 of 82 projects)
and the finance/selling-point blocks (0-3 of 82).

---

## What the agent can produce today

### The tool surface is three read-only tools, none of which return prose

`src/agents/finder/index.ts:117-132`

```
searchProjects  → makeSearchProjectsTool(userLang, rowSink)
queryInventory  → makeQueryInventoryTool(userLang)
fetchCollateral → makeFetchCollateralTool(userLang)
```

There is **no KB retrieval tool** on the Finder. `retrieve()` (`src/rag/index.ts:66-79`) has exactly
two callers in the repo — `src/agents/coach/tools.ts:21` and `src/agents/reply/tools.ts:24`. The
Finder imports nothing from `src/rag`.

### `searchProjects` — the only path the model actually uses

- `src/agents/finder/tools.ts:200-322`. Enforces `status:'active'` inside
  `searchProjects` (`src/inventory/search.ts:870` for `queryInventory`; the same gate in the
  two-stage path).
- Returns `SearchResult` → `ProjectMatch[]` (`src/inventory/search.ts:119-148`).
- The mapping at `src/inventory/search.ts:798-820` is the load-bearing fact: it copies
  **`projectId, name, priceBand, priceValue, tenure, vpStatus, bumiQuota, foreignEligible,
  bedrooms, locationText, sizeMinSqft, sizeMaxSqft, score, matchedCriteria`** and **nothing else**.
  `description` and `embedding` are dropped.
- Bounded to the model at `MAX_MATCHES = 8` via `toModelOutput`
  (`src/agents/finder/tools.ts:311-320`; constants at `src/inventory/search.ts:239` and `:255`).

**So the complete set of facts the model can cite about a project today is 12 scalars**, plus
`{type,url}` collateral links, plus its own `highlight` phrase.

### `queryInventory` — returns prose, but is unreachable for a named project

`src/agents/finder/tools.ts:336-390` → `src/inventory/search.ts:866-895`. This one **does** return
`ProjectDoc & {projectId}` — i.e. the full `description` **and** the 1024-float `embedding`, with
**no `toModelOutput` cap**. But its `inputSchema` accepts only `vpDateFrom / vpDateTo / priceBand /
vpStatus` — there is no `projectId` or `name` filter anywhere in the repo (`grep "where('name'"` →
zero hits). So it cannot be used to look up "DC Residensi", and if the model ever calls it broadly
it ships every active project's embedding into context. Worth flagging independently of Task 1.

### `ProjectDoc` — what is stored

`src/firebase/collections.ts:215-297`. Flat scalars: `name, status, priceBand, priceValue, tenure,
vpStatus, vpDate, bumiQuota, foreignEligible, description, locationText, bedrooms, sizeMinSqft?,
sizeMaxSqft?, embedding`.

- **No per-unit-type structure of any kind.** One scalar `priceValue` and one
  `sizeMinSqft`/`sizeMaxSqft` *span* for the whole project (`:271-294`). A project offering
  "1 Bedroom 904 sqft … Penthouses 2,900-4,855 sqft" stores `904 / 4855` and loses every layout in
  between.
- `description` (`:259`) is the **entire Skool body text** — 2,553 chars average
  (`src/agents/finder/schema.ts:246`), median 2,204 / max 6,846 measured on `projects.json`.
  This is where every Quick Fact currently lives, as prose.
- `sizeMinSqft`/`sizeMaxSqft` are the **precedent to follow**: real nullable fields, populated
  deterministically by `extractSizeRange` (`src/inventory/size-extract.ts:140`) and persisted by a
  dry-run-first backfill (`scripts/backfill-project-sizes.ts`), never model-authored, never
  re-parsed at render time.
- ⚠ Per `.planning/quick/quick-kayinleong-085/SUMMARY.md` ("Not verified"), the size backfill
  `--apply` **had not been run** — so `sizeMinSqft`/`sizeMaxSqft` may still be null in production.

### `CollateralDoc`

`src/firebase/collections.ts:299-325`. `{tenantId, projectId, type, storagePath, externalUrl?, lang}`.
Only `externalUrl` is web-addressable; storage-path-only docs are **omitted**
(`src/agents/finder/tools.ts:485-537`). Ranked + capped at `MAX_COLLATERAL_ITEMS = 12`, inline for
the top `INLINE_COLLATERAL_MATCHES = 3` matches.

---

## The "more details" path, traced end to end

Claim `quick-kayinleong-085` shipped a per-row action. **It is not a detail endpoint — it is a
canned chat message.** There is no `projectDetail` server action, no detail tool, no new query.

| step | file:line | what happens |
|---|---|---|
| 1 | `app/[lang]/chat/match-table.tsx:194-217` | `Details` button; `onClick` → `onAsk?.(t('showMorePrompt', {name, projectId}))` |
| 2 | `src/i18n/messages/en.json` → `chat.matchTable.showMorePrompt` | the literal payload: `"Tell me more about {name} ({projectId}) — full details and all supporting documents."` (translated in ms/zh) |
| 3 | `app/[lang]/chat/match-list.tsx:152` → `:45` | `MatchTable rows matches onAsk` — prop forwarded, no logic |
| 4 | `app/[lang]/chat/message-list.tsx:139` → `:65` | forwarded again |
| 5 | `app/[lang]/chat/chat-shell.tsx:319` | `onAsk={(prompt) => handleSuggestion(prompt, 'finder')}` — `handleSuggestion` defined at `:211`, the pre-existing one-shot suggestion path |
| 6 | `app/api/chat/route.ts` (chat SSE) | a **normal Finder turn** with that sentence as the user message |
| 7 | `src/agents/finder/prompt.ts:153-158` | the "Answering a question ABOUT a project" branch tells the model to look the project up "with your tools as usual" and reply in `answer` |
| 8 | `src/agents/finder/tools.ts:200-322` | `searchProjects` runs again — semantic, `locationPref`/`priceMax` null, so Stage A admits all active projects and Stage B re-ranks on the query vector |
| 9 | `src/agents/finder/schema.ts:316-330` | the reply lands in `answer` (markdown escape hatch, quick-051) |
| 10 | `app/[lang]/chat/match-list.tsx:120-131` | `<MarkdownMessage content={answer} />` |

**Two consequences.**

1. **Fields returned = the same 12 scalars.** Step 8 returns `ProjectMatch`, so the detail answer is
   built from exactly the same data as the table row it was launched from. The button cannot
   surface anything the table did not already show, except collateral links.
2. **The named project is not guaranteed to be in scope.** The lookup is semantic re-rank capped at
   `MAX_MATCHES = 8` for the model. There is no exact-name or by-id lookup in the codebase. A
   `Details` click on row 37 of 50 may hand the model eight *other* projects — and
   `prompt.ts:158` then correctly makes it say it cannot find the project. This is a latent
   correctness bug in the 085 action, independent of output depth.

---

## The target — checklist

Per-layout price table:

- [ ] a repeating row of `{sizeSqft, layoutLabel (Studio / 1+1Room / 2+1Room / 3Room), typeCode, priceFrom, priceTo}`
- [ ] a "Layouts from X to Y" summary line derived from that array
- [ ] per-layout parking allocation

Quick Facts block:

- [ ] Project Name
- [ ] Developer **+ company registration number**
- [ ] Location
- [ ] Title (e.g. "Commercial (HDA)")
- [ ] Completion ("52 months from SPA date")
- [ ] VP Target ("Q4 2029")
- [ ] Construction / billing stage ("2Eii billing")
- [ ] Sizes by type code ("3380sft Type H1 (North Wing) 4+1 rooms")
- [ ] Booking amounts ("RM100k standard / RM200k penthouse")
- [ ] Parking allocation per size
- [ ] Price range per sqft ("RM1700-RM2300 psf")
- [ ] Maintenance fee ("RM0.88 psf")
- [ ] Facilities floors
- [ ] Furnishing + appliance brands
- [ ] 360° virtual tour link
- [ ] Main contractor
- [ ] Panel bankers **with margin % per bank**
- [ ] Booking bank-in details

Selling points:

- [ ] "Top 12 Reasons to Invest…" ordered list

---

## Gap table

| Target field | Available today? | Where it would come from | Blocker |
|---|---|---|---|
| Per-layout size → price rows | **No** — one scalar `priceValue`, one sqft *span* | `description` prose, **only 7/82 projects** | Both: no schema slot **and** source data missing for 75/82 |
| "Layouts from Studio to 3 rooms" | No | derivable from a `unitTypes[]` array | needs the array to exist |
| Per-layout parking | No | `description` prose, 18/82 | source + schema |
| Sizes by type code | No | `description` prose, 31/82 with `Type X … sqft` | source + schema |
| Project Name | Yes — `ProjectDoc.name` | already in `ProjectMatch` | none |
| Developer | No | `description` (`^Developer:` in 70/82) | not carried to model |
| Developer company reg no. | **No** | **0/82** in source | source data absent |
| Location | Yes — `locationText` | already in `ProjectMatch` | none |
| Title (Commercial/HDA) | No | `description`, 25/82 | not carried to model |
| Completion "N months from SPA" | No | `description`, 7/82 | source thin + not carried |
| VP Target "Q4 2029" | Partial — `vpStatus` bool + `vpDate` exist on the doc but **`vpDate` is not in `ProjectMatch`** | `description`, 2/82 for the Qn-YYYY phrasing | not carried; source thin |
| Billing stage "2Eii" | **No** | 2/82 | source data absent |
| Booking amounts | No | `description`, 19-25/82 | not carried to model |
| psf price range | No | `description`; 60/82 mention psf, only 6/82 state a *range* | not carried; source thin |
| Maintenance fee RM psf | No | `description`, 28/82 explicit `RM x psf` (61/82 mention the fee) | not carried to model |
| Facilities + floors | No | `description`, 21/82 with a floor/level; 65/82 list facilities | not carried to model |
| Furnishing + brands | No | `description`, 50/82 | not carried to model |
| 360° virtual tour link | Partial | `collateral.externalUrl` may hold it; `description` 9-18/82 | not typed as a distinct field |
| Main contractor | **No** | 4/82 | source data absent |
| Panel bankers + margin % | **No** | panel bankers 2/82; margin % **0/82** | source data absent |
| Booking bank-in details | **No** | 2/82 | source data absent — **and this is account-number data; treat as sensitive, not chat output** |
| "Top N Reasons to Invest" | **No** | 3/82 | source data absent |
| Supporting documents | **Yes** | `fetchCollateral` / inline top-3 | none |

---

## Source-data availability (`projects.json`, repo root, 1.4 MB, 82 projects)

Measured with a size-and-price line detector over `projects[].body.text`
(size = `\d{3,5}\s*(sqft|sq ft|sf|sft)`, price = `RM[\d,.]+(k|m|mil|million)?`):

| measure | count |
|---|---|
| projects total | 82 |
| **≥2 lines carrying BOTH a size and a price (a real per-layout price table)** | **7 / 82 (8.5%)** |
| ≥1 such line | 14 / 82 |
| **≥2 lines carrying a size + a layout label (sizes-by-type, price absent)** | **48 / 82 (58.5%)** |
| projects mentioning any RM figure | 74 / 82 |
| projects with a "price/from/starting … RM" phrase | 40 / 82 |
| literal "Quick Facts" header | **81 / 82** |
| `Developer:` line | 70 / 82 |
| developer **with company reg no.** | **0 / 82** |
| `Location:` line | 65 / 82 |
| HDA / commercial-title mention | 25 / 82 |
| maintenance fee stated as `RM x psf` | 28 / 82 |
| any psf figure | 60 / 82 (explicit *range* only 6) |
| furnishing mention | 50 / 82 |
| facilities with a floor/level | 21 / 82 |
| booking fee with an RM amount | 19 / 82 |
| parking bays/lots | 18 / 82 |
| 360°/virtual tour | 9 / 82 |
| completion "N months … SPA" | 7 / 82 |
| main contractor | 4 / 82 |
| "Top N reasons" | 3 / 82 |
| booking bank-in details | 2 / 82 |
| VP target `Qn YYYY` | 2 / 82 |
| panel bankers | 2 / 82 |
| billing stage (`2Eii`-style) | 2 / 82 |
| margin of finance % | **0 / 82** |

Body length: min 572 / median 2,204 / mean 2,550 / max 6,846 chars. All 82 have a non-empty body.

### Three verbatim examples of a real per-layout price table

**1. Quill Residences KLCC** (`id 66e844e18d4145e6939bdfe3a84bdeac`) — closest match to the
stakeholder's reference format:

```
Type S1 667sf (intermediate) - 1 room, 1 bath, 1 balcony
Type C3 732sf (corner) - 1 room 1+1 bath
Type C1 1367sf - 2rooms, 2 baths, 2 balconies
...
Price:
667sf - RM761k
732sf - RM878k
1367sf - RM1.403m
```

Note the layout block and the price block are **separate**, joined only by the sqft figure.

**2. Padang Residences** (`id 1dedb78cf61b4a0aba93aa6038ed7367`) — size + rooms + parking + price
range on one line:

```
Type A: 1,199 sqft | 3R 2B | 2 CP — From RM785,000 – RM819,000
Type B: 1,033 sqft | 3R 2B | 2 CP — From RM678,000 – RM710,000
Type C: 902 sqft | 2+1R 2B | 1 or 2 CP — From RM624,000 – RM672,000
Type D: 802 sqft | 2R 2B | 1 CP — From RM580,000 – RM611,000
Type SU1: 1,558 sqft | 4R 3B | 3 CP — From RM1.03 million
Type SU6: 1,708 sqft | 4R 3B | 3 CP — From RM1.10 million
Type SU7: 2,125 sqft | 4R 3B | 3 CP — From RM1.30 million
```

**3. Lunar Seputeh** (`id 85da8a10ca914ca1bf8659b2e0af7337`) — with unit counts:

```
Type A — 683 sqft | 93 units (19%) | RM607,800 – RM643,800 | 1 car park
Type B1 / B1A — 841 sqft | 107 units (22%) | RM752,800 – RM795,800 | 2 car parks
Type B2 — 930 sqft | 31 units (6%) | RM845,800 – RM875,800 | 2 car parks
Type C1 — 1,280 sqft | 76 units (16%) | RM1,112,800 – RM1,158,800 | 3 car parks
Type C2 / C2A — 1,280 sqft | 107 units (22%) | RM1,101,800 – RM1,140,800 | 3 car parks
Type D — 1,646 sqft | 69 units (14%) | RM1,416,800 – RM1,453,800 | 3 car parks
```

(Others in the 7: `Southpoint Residences (IGB)`, `Kensho @ Taman Desa`,
`St. Regis Residences Kuala Lumpur`, `d'Brightton titiwangsa`.)

And a full Quick Facts block that has **everything except prices** —
`Damansara City Residency (DC Residensi)`, `id 84695b27c72f4f62b754b64262fa19d6`:

```
Quick Facts:
Project Name: DC Residensi
Developer: Damansara City Sdn Bhd (a subsidiary of GuocoLand Malaysia)
Location: Jalan Damanlela, Pusat Bandar Damansara, 50490 Kuala Lumpur
Land Tenure: Freehold
Total Units: 370 Exclusive Residences
Built-Up Sizes & Layouts:
1 Bedroom: 904 sqft | 1 car park bay
1+1 Bedrooms: 1,100 sqft | 1 car park bay
2+1 Bedrooms: 1,600 – 1,800 sqft | 2 car park bays
...
Maintenance Fee:
RM0.65 psf (inclusive of sinking fund)
Booking Fee: RM20,000 upon signing Letter of Offer to Purchase
```

### Reading of the numbers

- The **Quick Facts prose exists** (81/82 have the header) and it is **already in Firestore** —
  `to-inventory.ts:91` writes `description: p.body.text`, and 085's `extractSizeRange` parsed
  66/82 real sqft ranges out of the *live* `description`, which proves the live field holds the
  prose. So the Quick-Facts half of Task 1 is **almost entirely a carry-through problem**.
- The **per-layout price table does not exist for 75/82 projects.** No amount of pipeline work
  produces it. That half of Task 1 requires new source (Drive price lists / WhatsApp price
  updates — Task 2's territory), or a stated "price list not on record for this project".
- The **finance / selling-point blocks** (panel bankers + margin %, bank-in details, top-N reasons,
  main contractor, developer reg no., billing stage) are effectively **absent from the Skool
  corpus** (0-4 of 82). The stakeholder's reference is a *sales-kit PDF*, not a Skool post. That
  content lives in Drive collateral, which `scripts/scrape-skool/to-kb.ts:178` already ingests
  into `kbChunks` with `pillar:'finder'` and `category:<project folder name>` — **and which no
  Finder tool queries.**

---

## Grounding constraints any design must preserve

1. Answers cite source IDs (`prompt.ts:78`); `projectId` is the citation (D-04).
2. `searchProjects` always enforces `status:'active'` — no sold-out recommendations.
3. **Per-layout prices must never be model-authored.** The precedent is explicit: 085/D1 put
   `sizeMinSqft`/`sizeMaxSqft` on the doc, populated by a deterministic regex
   (`src/inventory/size-extract.ts:140`) and a dry-run-first backfill, with the comment "never by a
   model, and never re-parsed at render time". A `unitTypes[]` array must follow that exactly.
4. Never render an unknown as a value: `priceValue: 0` means UNKNOWN, and
   `priceBandFor(0) === 'under_500k'` — which is why `priceBand` is banned from the client payload
   (`src/agents/finder/schema.ts:241-249`). A `unitTypes[]` entry with a missing price must be
   `null`, never `0`.
5. Token budget is a real constraint, not a nicety. `toModelOutput` exists because 82 uncapped
   projects measured ~10,100 tokens/step against a 300,000/24h cap
   (`src/agents/finder/tools.ts:295-310`). **Nothing that returns full `description` may be
   attached to a multi-project search result** — only to a single-project detail lookup.
6. PDPA: booking bank-in account details are sensitive. Recommend excluding them from chat output
   entirely rather than plumbing them through.

---

## Recommended approach

### Option A — `unitTypes[]` on `ProjectDoc`, deterministically extracted

Add `unitTypes?: Array<{ label, typeCode?, sizeSqft, sizeMaxSqft?, bedrooms?, parkingBays?,
priceFromRM: number|null, priceToRM: number|null }> | null`, populated by a new
`src/inventory/unit-type-extract.ts` + `scripts/backfill-project-unit-types.ts`, mirroring
`size-extract.ts` / `backfill-project-sizes.ts` one-for-one. Add `unitTypes` to `ProjectMatch` and
`FinderRow`, and to the prompt as citable data.

- **Pro:** exactly the 085/D1 precedent, so it is reviewable and testable offline. Structured, so
  the *table* can also show per-layout data, and a future admin editor can fix a bad row.
- **Pro:** the extractor is achievable — the 7 real tables are line-oriented and regular
  (see the three examples), and 48/82 have parseable sizes-by-type even without prices.
- **Con:** delivers a price table for **7 of 82 projects.** For the other 75 it produces
  sizes-only rows or nothing — which is honest but is not what the stakeholder pasted.
- **Con:** the 4-8 heterogeneous line formats mean real parse risk. 085 hit six mis-parses on the
  *simpler* sqft extractor and had to add `NON_BUILT_UP_LABEL`. Budget a full 82-project eyeball
  audit, as 085 did.
- **Con:** does nothing for panel bankers, bank-in details, top-N reasons, contractor, reg no.

### Option B — a project-scoped detail tool that returns the stored prose

Add `makeProjectDetailTool(userLang)`: input `{ projectId }`, reads `projects/{pid}` directly,
returns `{projectId, name, ...the 12 scalars, description, vpDate}` — **one** project, `description`
included, `embedding` stripped, plus its ranked collateral. Optionally extend `RetrieveOpts`
(`src/rag/search.ts:74`) with a `category` match against the project name so the Drive `kbChunks`
(already `pillar:'finder'`, already carrying `category`) can be pulled in for the sales-kit content.

- **Pro:** **immediately unlocks every Quick Fact the source has** — developer, title, maintenance
  fee, furnishing + brands, facilities floors, booking terms, parking, psf — because they are all
  already sitting in `description`. Zero new source data, zero backfill, zero re-embed.
- **Pro:** fixes the latent 085 bug: an exact by-id read replaces the semantic re-rank, so the
  `Details` button can no longer fail to find its own row.
- **Pro:** token-safe by construction — one project (~2.5k chars ≈ 700 tokens), only on a detail
  turn, never on a search. Sidesteps the `queryInventory` blowup entirely.
- **Pro:** the KB extension reaches the panel-banker / top-N-reasons content that lives in Drive
  and is *already ingested*, without changing the ingest pipeline.
- **Con:** the model is *summarising prose*, so the exact numbers it quotes are not schema-verified
  the way `unitTypes[]` would be. Mitigation: the prose is verbatim stored source, the prompt
  already forbids inventing figures, and it is the same trust model as Coach/Reply KB answers.
- **Con:** output shape will vary run to run (prose in, prose out). No structured per-layout table
  for the UI.

### Option C — a richer `projectDetail` Server Action + a detail panel

Skip the chat round trip: the `Details` button opens a sheet/drawer fed by a Server Action that
reads the project + collateral + KB chunks and renders them deterministically.

- **Pro:** zero hallucination risk — no model in the loop. Deterministic, cacheable, cheap.
- **Con:** it is a **product change**, not a capability fix. The stakeholder's ask is "the agent can
  *answer* at this depth" so the agent can paste it into WhatsApp at 11pm; a UI panel is not a
  message they can forward, and it bypasses the multilingual surface.
- **Con:** biggest surface area of the three (new action, new component, i18n, tests) for the least
  movement on the actual complaint.

### Recommendation: **B now, A next, C not for this claim**

Do **Option B** in this claim, and split **Option A** into its own claim.

**Why B first.** The gap table says ~11 of the 18 Quick-Facts fields are *already stored and simply
not carried*. B closes those with one new read-only tool, one prompt section, and no data migration
— it is the smallest change that closes the largest part of the gap, and it also repairs the 085
`Details`-button lookup bug on the way. Option A, by contrast, delivers a per-layout price table for
7 of 82 projects and touches the schema, the search mapper, the row allowlist, the client table, and
a backfill.

**Cost of B:** new `src/inventory/detail.ts` (or a `getProjectById` in `crud.ts`) + a
`makeProjectDetailTool` in `src/agents/finder/tools.ts`; register it in `makeTools`
(`index.ts:117-132`) — note the `ReturnType<typeof finderAgent.makeTools>` union that
`app/api/chat/route.ts` derives its `agentTools` from, so adding a key is a typed change to verify;
a "Detail requests" prompt section directing the model to call it by `projectId` and answer in
`answer`; retarget `chat.matchTable.showMorePrompt` so the model reliably reaches for the new tool;
tests mirroring `tools.test.ts` (read-only assertion, `embedding` stripped, unknown id handled).
Optionally one field on `RetrieveOpts` for the KB half. Estimate: one focused claim, no backfill, no
re-embed, no schema change.

**Then A**, scoped honestly as "per-layout price rows for the 7 projects that state them, and
sizes-by-type for the 48 that state sizes" — with a dry-run parse audit over all 82 as 085 did.

**Do not gold-plate the missing source.** Panel bankers + margin %, booking bank-in details,
main contractor, developer reg no. and billing stage are 0-4 of 82. The right output for those is
the grounded "not on record for this project" the prompt already mandates
(`prompt.ts:158`) — plus a Task-2 note that this content lives in Drive sales kits, is already in
`kbChunks` with `pillar:'finder'`, and needs a retrieval path rather than a schema field. And keep
bank-in account details out of chat output on PDPA grounds regardless of availability.

---

## Two incidental findings worth separate claims

1. **`queryInventory` ships embeddings to the model.** `src/inventory/search.ts:891-894` returns the
   full `ProjectDoc` including the 1024-float `embedding` and the ~2.5 KB `description`, for every
   matching active project, and the tool (`src/agents/finder/tools.ts:368-388`) has **no
   `toModelOutput` cap** — unlike `searchProjects`, which was capped for exactly this reason. One
   broad `queryInventory` call is a five-figure token event.
2. **The 085 size backfill `--apply` may never have run** (085 SUMMARY, "Not verified"), in which
   case `sizeMinSqft`/`sizeMaxSqft` are null in production and the table's Size column is empty for
   all 50 rows. Confirm before building on those fields.
