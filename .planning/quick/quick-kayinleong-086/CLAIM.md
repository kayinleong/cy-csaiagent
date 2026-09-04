# Claim: quick-kayinleong-086
- owner: kayinleong
- session: claude-code
- branch: main
- started: 2026-09-04
- status: done
- summary: the "still only one result" report was a STALE DEV SERVER running pre-fix code, proved by simulating the old gate (4 survivors, exactly 1 above RM1.5M = AT6, the project in the screenshot) — and the new code was verified end-to-end against the real model, closing quick-085's biggest open risk

## What is wrong

User report, twice: *"show me > 1.5mils house within klang valley"* returns **one card**, not the
table. Their own reading — *"Klang Valley means including KL and Selangor"* — is correct, and is
exactly what quick-085's `REGION_ALIASES` fix already implements.

Two post-fix turns are persisted in Firestore (`2026-09-03T16:41:46Z`, `2026-09-04T02:34:13Z`),
both routed `finder:classifier`, both storing:

    envelope keys=[matches]   matches=1   ROWS=KEY ABSENT

`rows` absent → `match-list.tsx:145` (`rows.length > 0`) falls back to `MatchCard`.

### My first diagnosis was WRONG, and is recorded here rather than quietly replaced

I concluded the model had called `queryInventory` (which has no row sink) and invented a false
exclusivity claim. That was inference from elimination — no `searchProjects` input I tried could
return 1 match — and it was wrong on both counts.

### What is actually happening

Driving the **real model** through the real tool loop (`scripts/diag-finder-toolpick.ts`, added by
this claim) with the user's exact prompt and the production model id from
`appConfig/modelConfig`:

    model = claude-sonnet-4-6
    step 1  TOOL: searchProjects
            input: {"priceMin":1500000,"locationPref":"Klang Valley","bedrooms":null,...}
            -> searchProjects returned 50 items
    SINK ROWS: 50

**The current code is correct end to end.** The model picks the right tool, passes the right
criteria, gets 50 rows, and the sink fills. A table would render.

So the failing turns cannot have run this code. Simulating the **pre-fix** literal-substring gate
against the live corpus:

    OLD literal gate "Klang Valley": 4 of 83 active survive
       - Enlace Suites @ Pantai Sentral Park   783,600
       - Riana Trees Residences                628,000
       - AT6 Residensi @ Ampang Tengah       6,425,000
       - Anyara Hills                                0
    ... of those, priceValue > 1.5M: 1
       >>> AT6 Residensi @ Ampang Tengah (nsls9Gq69qXQFzPia0MX)

Exactly one survivor above RM1.5M, and it is **the exact project in the user's screenshot**, with
the exact id. Under the old gate the model's line — *"The only active D2 project in Klang Valley
priced above RM1.5M"* — was **true and correctly grounded**. It was not a hallucination; I was
wrong to call it a grounding violation.

**Root cause: the dev server process serving those turns is running pre-quick-085 code.** Nothing
in the repository is defective. The fix is to restart it.

## What changed

| file | change |
|---|---|
| `scripts/diag-finder-toolpick.ts` | **new.** Drives the real model + real tools for one prompt; prints the tool chosen, its arguments, the item count and the sink size. Needs no authenticated browser. |

No application code was touched. This claim is a diagnosis plus the harness that produced it.

The harness normalises `ANTHROPIC_BASE_URL`, which `.env.local` sets without the `/v1` suffix —
harmless in the Next runtime, a 404 from any script. Documented in the file header rather than
changing the env.

## Verification

| check | result |
|---|---|
| real-model tool selection, user's exact prompt | `searchProjects`, `priceMin 1500000`, `locationPref "Klang Valley"` → **50 items, SINK ROWS 50** |
| pre-fix gate simulation | 4 survivors; exactly 1 above RM1.5M = AT6, the screenshot's project and id |
| `searchProjects` elimination sweep (9 criteria combinations) | floor is 3 matches; **no input yields 1** on current code |
| `npx tsc --noEmit` | exit 0 |
| `npx eslint scripts/diag-finder-toolpick.ts` | clean |

### What this closes

This was quick-085's single largest open risk — *"no real Finder turn has run through a live
model"*. It has now run, and the sink/rows chain is confirmed at the layer that actually decides
whether a table can render. What is still unproven is only the HTTP/SSE layer above it
(`/api/chat` streaming metadata and the browser render of a live turn), which needs a signed-in
session.

### Ruled out

- **Not `queryInventory`.** The model chose `searchProjects` on a faithful reproduction.
- **Not the region alias.** `locationPref: "Klang Valley"` yields all 83 active candidates, 50
  after the >RM1.5M gate — precisely the user's expectation.
- **Not a grounding violation.** The exclusivity claim was true under the gate that produced it.
- **Not the sink wiring.** `makeTools` forwards `rowSink` into `makeSearchProjectsTool`
  (`src/agents/finder/index.ts:117-131`) and the sink filled with 50.

## Known gaps — real, but NOT what bit the user

1. **`makeQueryInventoryTool` still has no row sink** (`src/agents/finder/tools.ts:336`). If the
   model ever answers a lead query with it, no table can render, and it cannot express a
   `>RM1.5M` threshold (it filters 4 coarse `priceBand` buckets) or any location at all. Its own
   description invites the misuse: *"show active leasehold projects under RM500k"*. Latent, not
   active — filed as follow-up rather than fixed reflexively on a wrong hypothesis.
2. **The live browser path** (`/api/chat` SSE → `messageMetadata.finderRows` → render) is still
   only unit-asserted end to end.

## The lesson

Two rounds were spent on a code hunt for a defect that was a stale process. What broke the loop
was reproducing the failure numerically — simulating the *old* gate and finding it produced the
user's exact project and id. Before assuming the code is wrong, check that the code under test is
the code that ran; when a report and a measurement disagree, one of them is measuring a different
build.
