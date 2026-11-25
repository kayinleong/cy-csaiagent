---
status: complete
claim: quick-kayinleong-106
item: 3 (budget "RM1.5mil-RM2.5mil" reaches the model as a FIN_HASH token)
researched: 2026-11-25
---

# Research: Finder budgets are masked by the PDPA pseudonymizer

## Bottom line
- **Cause.** One pillar-agnostic `FINANCIAL_REGEX` turns every `RM<number>` into `<FIN_HASH:…>`. It runs on every user and assistant message before routing (`app/api/chat/route.ts:535-540`). It was added in Phase 4 to protect **income in pasted WhatsApp messages (Reply)**. Nobody checked what it did to Finder budgets.
- **Second bug.** The suffix match is case-sensitive, and when it fails the regex backtracks. So `RM1.5MIL` becomes `<FIN_HASH>.5MIL`: half the figure is masked and the rest leaks.
- **Recommendation: option (b), pillar-aware and context-aware redaction.**
  - In the Finder pillar, RM figures that read as a budget or price pass through. Income, loan and bank figures stay masked.
  - Reply and Coach keep today's strict masking.
  - Fix the regex for every pillar.
  - Add a display-side scrub so a raw `<…_HASH:…>` token never reaches the screen.
  - Five source files, about 120 lines. Details below.

## 1. Redaction path (what is masked, where, and what happens to the mapping)

| Fact | Evidence |
|---|---|
| Regex: `/\bRM\s?\d[\d,]*(?:\.\d{1,2})?(?:\s?(?:k\|K\|juta\|million\|mil\|ribu))?\b/g`. The `RM` prefix and the `mil`/`juta`/`million`/`ribu` suffixes are case-sensitive. There is no `m`/`M`/`bil` suffix. | `src/audit/pdpa.ts:97` |
| Token is `<FIN_HASH:${sha256(match).slice(0,12)}>`. It is **unsalted** and deterministic. | `pdpa.ts:105-107`, `:172-180` |
| Order: names → phones → IC → email → financial | `pdpa.ts:222-226` |
| **All** messages are redacted, **user and assistant alike**. `system` and `context` are redacted only if passed, and the route passes neither. | `pdpa.ts:252-263`; route passes `{ messages }` only at `route.ts:535-540` |
| The client re-sends the full history every turn, so the whole history is re-redacted each time. Tokens are stable because they are deterministic. | `app/[lang]/chat/chat-input.tsx:283` |
| **Not** redacted: the system prompt (`route.ts:894`), tool inputs and outputs (project prices are not PII), and the Finder `leadContext`. That last one only adds a sentence; it does not inject numbers (`src/agents/finder/prompt.ts:97-100`). | — |
| **The `mapping` is discarded.** The route destructures only `{ redacted, pdpa_redacted }`. No consumer exists anywhere in `app/`, `src/` or `scripts/`. | `route.ts:535`; grep: `mapping` occurs only in `pdpa.ts` |
| Raw user text is persisted (in-region Firestore) after the gate | `route.ts:594-602` (`content: userMessageContent`) |
| The Finder prompt says nothing about tokens, so the model improvises. That produced the "budget figures are still being masked" reply and the suggested workarounds. | grep of `src/agents/finder/prompt.ts` finds no `HASH` or `token` rule |

### Input forms, probed with node against the exact `pdpa.ts:97` regex
| Input | Model sees today | Status |
|---|---|---|
| `RM1.5mil-RM2.5mil` | `<FIN>-<FIN>` | **broken** (reported) |
| `budget around RM1.5MIL TO RM2.5MIL` | `<FIN:RM1>.5MIL TO <FIN:RM2>.5MIL` | **broken + partial leak** |
| `RM1.5MIL TO RM2.5MI` | `<FIN:RM1>.5MIL TO <FIN:RM2>.5MI` | **broken + partial leak** |
| `RM 1.5 mil` | `<FIN>` | **broken** |
| `RM1,500,000` / `RM650,000.00` | `<FIN>` | **broken** |
| `RM1.5 juta` / `RM2mil` / `RM1.5million` / `RM1.25mil` | `<FIN>` | **broken** |
| `RM800k` / `RM800K` / `RM 800 k` | `<FIN>` | **broken** |
| `RM1.2M`, `RM1.5m`, `RM1.5bil` | `<FIN:RM1>.2M` etc. | **broken + partial leak** |
| `RM 1.5M - 2.5M` | `<FIN:RM 1>.5M - 2.5M` | **broken + partial leak** |
| `RM1.5 Mil` | `<FIN:RM1.5> Mil` | **broken** |
| `RM3.5k psf` | `<FIN> psf` | **broken** (psf rate masked) |
| `1.5m-2.5m`, `1.5 juta`, `1.5mil-2.5mil`, `500k to 1mil`, `budget 650k` | unchanged | passes (no `RM`), which is why the bot's workaround works |
| `rm1.5mil`, `Rm800k`, `MYR 1.5mil` | unchanged | passes (case-sensitive `RM`) |
| `RM700psf` | unchanged | passes (no boundary after `700`, so no match) |
| `RM6000/month`, `I earn RM6000` | `<FIN>/month`, `I earn <FIN>` | masked as intended |

The partial leak happens because `\.\d{1,2}` matches `.5`, the case-sensitive suffix then fails on `MIL`, and `\b` fails against the `M`. The engine backtracks to `RM1`, where `\b` before `.` succeeds. The result is a redaction failure in **strict mode too**: the digits after the point reach the model.

### Router: a separate PDPA gap (flag to the caller)
- The router is handed the **raw** messages: `routeAsync(messages.map(...))` at `route.ts:558-561`, not `redacted.messages`.
- The heuristic is local, so that part is harmless.
- On ambiguous turns, though, `classifyIntent` sends `compactSummary(messages)` to `modelFor('router')`, an Anthropic model (`src/router/classifier.ts:86-96`).
- So raw names, IC numbers, emails and phones in an ambiguous turn reach the router model unredacted.
- Both docstrings claim the input is "PDPA-redacted" (`classifier.ts:63`, `:81`, `src/router/index.ts:63`). It is not.
- This breaks the CLAUDE.md hard constraint ("Pseudonymize PII at the Claude boundary"), independent of the budget bug.

## 2. Why RM figures are redacted (the governing text)
- **TSD §5.3** (`.planning/TSD.md:189`): "Pseudonymize at the boundary: names → `<LEAD_ID:…>`, phones → `<PHONE_HASH>`; reconstitute client-side." It says nothing about financial figures.
- **TIA §2.1** (`.planning/phases/01-foundations/PDPA-TIA.md:27-32`) lists what *does* cross the border: "Conversation content | Coaching questions, **property queries**, reply drafts | Medium (**may contain property-search context**)".
- **TIA §2.2** (`PDPA-TIA.md:36-42`), the "never leave the server as plaintext" list: names, phones, IC, auth tokens, audit entries. **No financial figures.**
- The TIA status is "Pending Derek sign-off" (`PDPA-TIA.md:6`, `:229`).
- **Origin of FIN_HASH** is Phase 4, Reply. `04-RESEARCH.md:319`: "A pasted WhatsApp message like 'Hi, this is Ahmad, my IC is <IC example>, **I earn RM6000/month**' … the name, IC, **income** … are sent to Claude in plaintext."
- The fix was "RM-amount financials" for "the Reply paste" (`04-RESEARCH.md:323`, `:393` "Pitfall A", `:509`), implemented in 04-02 (`04-02-SUMMARY.md:12-14`). The 04-02 plan never mentions the Finder (`04-02-PLAN.md`, grep).
- It reached the Finder only because GATE 3 runs before routing, for every pillar (`route.ts:516-521`).
- **Conclusion.** The concern is a lead's **income**, disclosed in a pasted WhatsApp message.
  - A property budget typed by the agent for a pseudonymized lead is "property-search context". The TIA already accepts that crossing the border.
  - Income and loan figures stay sensitive, and should stay masked in every pillar.

## 3. How the Finder receives a budget
- The `searchProjects` tool takes numbers: `priceMin: z.number().nullable()`, `priceMax: z.number().nullable()`, `monthlyIncome: z.number().nullable()`, `freeText: z.string()` (`src/agents/finder/tools.ts:258-263`, `:282`). The same shape is in `CriteriaSchema` (`src/agents/finder/schema.ts:51-63`).
- **The model extracts the numbers itself** from `redacted.messages`. There is no server-side criteria parser.
  - `onFinish` writes the stored or empty criteria, never values parsed from this turn (`route.ts:1130-1143`).
  - `mergeFinderCriteria(stored, {})` uses an empty delta (`route.ts:840`).
- `makeTools` is built per request with a request-scoped sink (`route.ts:849`), so a per-request closure such as a mapping is structurally possible.
- The prompt needs the model to **compare** prices against the budget:
  - "from RM<priceValue>, with larger layouts in the budget range" (`prompt.ts:144`)
  - a price-gate refusal naming the budget (`prompt.ts:156`, `:258`)
  - "Never claim within budget when matchedCriteria.priceMax is null" (`prompt.ts:168`)
- Router heuristic Finder signals include `/\bRM\b/` and `/\bRM\s?\d/i` (`src/router/heuristic.ts:59`, `:101`), run on raw text. Redacting before the heuristic would weaken routing.
- **Side effect of masking:** income typed as `RM…` is unreadable, so `monthlyIncome` is null and the FIND-10 affordability gate silently never applies.

## 4. Design options

**(a) Token reconstitution at the tool boundary.** Rejected.
- What would be needed:
  - Mechanically possible: pass `mapping` into `makeTools` the same way as the sink.
  - The schema becomes `number | string(token)`, and the server parses the mapped "RM1.5mil" into a number. That needs the parser from (c) anyway.
- The model still cannot do the comparisons the prompt requires (`prompt.ts:144/156/168/258`). Refusals and highlights would quote tokens.
- Display de-tokenization **cannot** use `streamText({ experimental_transform })`. AI SDK 5.0.193 feeds the *transformed* text back to the model in the next step ("use transformed content to create the messages for the next step", `node_modules/ai/dist/index.mjs:5305-5307`). The raw figure would leak to Anthropic on step 2+ of every Finder turn, which is 3-4 steps.
  - The only safe place is wrapping the UI-message stream after `toUIMessageStreamResponse` (`route.ts:1333`), plus handling tokens split across deltas.
- **Low PDPA value.**
  - The token is an unsalted, truncated sha256 of a low-entropy string (`pdpa.ts:105-107`). Anyone can recompute `sha256("RM1.5mil")` and enumerate every RM amount in seconds.
  - So FIN_HASH hides a figure from a casual reader, not from the importer.

**(b) Pillar-aware, context-aware redaction.** Recommended.
- PDPA-wise, budgets cross as property-search context. That is inside TIA §2.1 and not in the §2.2 never-cross list. Income, loan and bank figures stay tokenized in every pillar.
- Reply and Coach are unchanged (strict mode).
- No hard constraint is touched: no new GCP surface, no auto-send, model-agnostic. The PDPA gate still throws before `streamText`.

**(c) Server-side budget parsing into structured criteria.** Not now; optional follow-up.
- PDPA outcome is identical to (b): the numbers still reach the model, in the system prompt.
- It needs a trilingual parser for every form above and reconciliation with the model's own extraction.
- Its real benefit is determinism. `quick-104/CLAIM.md:73` notes "The model reads the budget differently from run to run". That benefit is separable from this bug.

### Recommended design (b): exact changes
1. **`src/audit/pdpa.ts`**
   - New regex, applied in **all** modes. It matches case-insensitively, always consumes letters glued to the figure (so it fails closed), and allows a spaced suffix only from a known list:
     `/\bRM\s?\d[\d,]*(?:\.\d+)?(?:[a-z]+|\s(?:k|m|mil|mill|million|b|bil|billion|juta|ribu|psf)\b)?/gi`
     Node-probed: every row in the table above is fully tokenized with no leftover digits, including `rm1.5mil`, `RM1.5 Mil` and `RM700psf`. `RM1.5mil.` keeps its period, `RM800 near Cheras` only masks `RM800`, and `farm1.5` / `RMX` are untouched.
   - Add `pseudonymize(input, names, opts?: { financial?: 'all' | 'non-budget' })`. The default `'all'` keeps every existing caller and test unchanged.
     - Under `'non-budget'`, `replaceFinancial` masks a match only when it reads as income. That means either the nearest cue in the 40 characters before it is an income cue, or it is immediately followed by `/month`, `/mo`, `a|per month`, `monthly`, `sebulan`, `bulanan`, `每月` or `一个月`.
     - Income cues: `income|salary|gaji|pendapatan|earn(s|ing)|commitment|loan|pinjaman|instal(l)ment|ansuran|savings|simpanan|epf|kwsp|bank|收入|月薪|工资|薪水|贷款`.
     - Budget cues: `budget|bajet|price|harga|under|below|max|up to|around|between|range|afford|预算|价格|以下`.
     - Node-probed outcomes:
       - `RM1.5mil-RM2.5mil`, `budget around RM1.5MIL TO RM2.5MIL`, `under RM800k`, `bajet RM1.2juta` pass.
       - `I earn RM6000 a month`, `gaji RM5,000 sebulan`, `RM6000/month salary`, `monthly installment RM4,500`, `loan approved RM900k` are masked.
       - `income RM8k-RM10k, budget RM700k` masks only the income. `收入RM8000，预算RM800k` masks only the income.
     - Pinned edge cases (decide and test):
       - `Lead earns RM15k, wants RM1.5mil condo` masks both. This fails closed.
       - `Bank loan up to RM1.2mil` passes, because "up to" is nearer.
   - Add `scrubPdpaTokens(text, label)`. It replaces `/<(?:FIN|IC|EMAIL|PHONE)_HASH:[0-9a-f]{12}>/g` with a neutral label and is idempotent.
     - Do **not** scrub `<LEAD_ID:…>`. Lead labels *are* that pseudonym (`app/[lang]/(admin)/leads/lead-management.tsx:103-111`).
     - Export it from `src/audit/index.ts:19`.
2. **`app/api/chat/route.ts`**
   - Keep GATE 3 exactly where it is, in strict mode, so the existing order tests hold.
   - After `routeAsync` (`:558`), if `pillar === 'finder'`, re-run `pseudonymize({messages}, knownNames, { financial: 'non-budget' })`, call `assertRedacted` again, and use that result for `redactedMessages` (`:890`).
   - Reply and Coach keep the strict result.
3. **`src/agents/finder/prompt.ts`**
   - One rule: tokens like `<FIN_HASH:…>` are amounts hidden for privacy, usually income. Never repeat a token. If the budget itself is hidden, ask once for it without "RM" (that path should now be rare).
   - Also tell the model to set monthlyIncome to null when the income is a token. That is current behaviour, made explicit.
4. **Display safety net.** Apply `scrubPdpaTokens` to the **full accumulated string** at both client choke points:
   - live: `app/[lang]/chat/chat-input.tsx:457-459`, both `assistantContent` and `m.content + addition`. Re-scrubbing the whole string handles a token split across deltas.
   - reload: `app/[lang]/chat/conversation-messages-map.ts:65`.
   - This covers the Reply copy-to-clipboard draft as well, because it is decoded from the same `content`.
   - Use a short localized label (a next-intl key) or a language-neutral "•••". This is the planner's choice.
   - Siblings own the quick-facts UI. Coordinate if they also edit `chat-input.tsx`.
5. **Router gap (caller decision).**
   - Minimal fix: `routeAsync(rawMessages, { override, classifierMessages: redacted.messages })`, with `classifyIntent` using `classifierMessages`. That is `src/router/index.ts:67-96` plus `route.ts:558`. The heuristic stays on raw text, so routing is unchanged.
   - It is about 6 lines, but it is a separate defect. Get explicit user approval, or open its own claim (global "minimal fix" rule).

## 5. How claim 105's "real Finder" run was executed
- `quick-104/CLAIM.md:73` names it for the same reported message: "The real Finder (`scripts/diag-finder-toolpick.ts`, claude-sonnet-4-6) … applied RM1.5M-2.5M". `quick-105/CLAIM.md:79` does not name a script. It is most likely the same harness.
- **`scripts/diag-finder-toolpick.ts` does NOT pseudonymize.** It sends `messages: [{ role: 'user', content: prompt }]` raw (`scripts/diag-finder-toolpick.ts:44-53`). That is why it "applied" the budget while production masks it.
- Corroboration: `quick-104/CLAIM.md:73` says "The user's own run also showed The Cedar (RM2,946,200), so that run did not cap at RM2.5M". Through the real route, `RM1.5M-2.5M` reaches the model as `<FIN>.5M-2.5M`.
- The 101 harness `.planning/quick/quick-kayinleong-101/retest/run3.ts:33` *does* call `pseudonymize` (`LOCAL_MODEL_OVERRIDE=… tsx --env-file=.env run3.ts <queue> <results>`).
- **For local end-to-end testing:** make `diag-finder-toolpick.ts` apply the same redaction as the route, i.e. strict, then `'non-budget'` for the Finder. Ideally both call one shared helper in `src/audit` so they cannot drift. Then run:
  - `npx tsx --env-file=.env.local scripts/diag-finder-toolpick.ts "Damansara Heights, RM1.5mil-RM2.5mil, 2 or 3 bedrooms"`
  - Expect `searchProjects input {… priceMin 1500000, priceMax 2500000 …}`. Also run `"RM1.5MIL TO RM2.5MIL"` and `"I earn RM6000 a month, budget RM800k"`; for the last, expect `monthlyIncome null` and `priceMax 800000`.
  - It calls the real model, costs credits and reads Firestore without writing. Run it only with user approval.

## Test plan
- **`src/audit/pdpa.test.ts`** (12 tests, green at baseline):
  - (1) Strict mode, one case per row of the probe table: the token is present and no raw figure is left. Assert that the redacted text with tokens removed matches no `\d`. This includes the `RM1.5MIL` partial-leak regression and `rm1.5mil`/`RM1.5 Mil`/`RM700psf`.
  - (2) The default call (no opts) still masks `RM6000` and `RM 6,000/month`. The existing tests pass untouched.
  - (3) `'non-budget'`: each budget form above passes verbatim. Each income form is tokenized. Include the mixed EN/BM/ZH strings and the two pinned edge cases.
  - (4) `'non-budget'` still masks IC, email, phone and names.
  - (5) `scrubPdpaTokens`: covers all four classes, leaves `<LEAD_ID:3>` alone, is idempotent, and scrubs a token completed by a later chunk (`"<FIN_HA"` then `"SH:abc123def456>"`).
  - Synthetic data only.
- **`app/api/chat/route.test.ts`**: a new describe block whose `mockPseudonymize`/`mockAssertRedacted` delegate to `vi.importActual('@/src/audit/pdpa')`.
  - A Finder turn with `RM1.5mil-RM2.5mil` gives `streamText` messages containing the raw range.
  - A Finder turn with `I earn RM6000 a month` gives `<FIN_HASH:`.
  - Reply (with leadId) and Coach turns with `RM1.5mil` give `<FIN_HASH:`.
  - `assertRedacted` precedes `streamText` (existing Tests 3/14 still pass).
  - If the router fix is in scope: the `routeAsync` opts carry `classifierMessages` with no raw IC.
- **`app/[lang]/chat/conversation-messages-map.test.ts`**: a persisted assistant row containing `<FIN_HASH:…>` maps to scrubbed content. `<LEAD_ID:…>` is preserved.
- **Finder tools:** no schema change, so `tools.test.ts` is unaffected. Optionally assert the new prompt rule is present (`finder.test.ts`).
- **Gates:** `npx vitest run`, `npx tsc --noEmit`, `npx eslint` on the changed files, then the diag run above with approval.

## Open questions (for the user / Derek)
1. Should the Finder see **income** as plaintext, so the FIND-10 affordability gate works? Today it is always masked. (b) keeps it masked. This is a compliance call.
2. Should the router PDPA gap be fixed in this claim or in its own claim?
3. Should FIN/PHONE tokens get a per-deployment salt, given they can be brute-forced? Out of scope; noted for Phase-5 hardening.
4. Residual, unchanged by (b): figures without `RM` (`6k a month`, `MYR 1.5mil`) are not masked in any pillar.
