# Quick Task quick-kayinleong-085 — Locked Decisions

**Gathered:** 2026-09-03
**Status:** Ready for planning
**Source:** user answers to the four open questions in `RESEARCH.md` §6

<domain>
## Task Boundary

Property Finder must return **all relevant matches in one detailed table** (not 5 cards), showing
important attributes (price, size, rooms, etc.), with a per-row
**"show more detailed with supporting documents"** button that prompts the chat to expand that
one property.

Driving example prompt: *"show me a list of 1mil property within Klang Valley"*.
</domain>

<decisions>
## Implementation Decisions — LOCKED, do not revisit

### D1 — Size column: do BOTH the regex extraction AND the real schema fields
User answer: *"do both first and second"*.

These compose rather than conflict — the deterministic regex extraction is the **mechanism** that
populates the real fields. Therefore, in THIS claim:
- Add real `sizeMinSqft` / `sizeMaxSqft` (nullable numbers) to `ProjectDoc`.
- Write a **one-off backfill** that regex-extracts sqft ranges out of each project's
  `description` and persists them into the new fields (61/82 records mention sqft; the rest stay
  null).
- The table renders from the **real fields**, never re-parsing prose at render time.
- Extraction must be deterministic (regex, not model-authored) and covered by fixture tests.
  The corpus is a fixed 82 records — every extraction is eyeballable, so verify all of them and
  report the count that parsed, the count left null, and any that parsed *wrongly*.

**Re-embed:** do NOT add the new size fields to `EMBEDDING_RELEVANT_FIELDS`
(`src/inventory/crud.ts`). The sqft text already lives inside `description`, which is embedded, so
the semantic content is present; adding numeric mirrors would force a needless re-embed of 82
projects. Flag this in the summary rather than silently deciding it.

`developer` (73/82 in prose) and `bathrooms` (absent entirely) are **out of scope**.

### D2 — Unpriced projects: mix them into the one flat table with a blank price cell
User answer: *"Mix them in with a blank price"*.

32/82 projects have `priceValue: 0`. Today `src/inventory/search.ts:415-427` hard-excludes them
whenever a budget is stated, and its comment says *"the remedy is to backfill `priceValue`, not to
loosen the gate."* **The user has been shown this and chosen to loosen it anyway** — implement the
user's choice, and update that comment so it no longer contradicts the code.

Hard requirement: an unpriced row must **never** claim to satisfy the budget. Its price cell
renders empty (not `0`, not "RM0"), and its `matchedCriteria` must not report a price match.
`priceBandFor(0) === 'under_500k'`, so `priceBand` must NOT be used as a price fallback anywhere.

### D3 — Features column: model-authored per-row highlight
User answer: recommended option.

Add a short `highlight` string per match to the Finder output schema and prompt for it, grounded
in retrieved content. Accept run-to-run wording variance. Apply the lesson from quick-071
(the collateral instability): the highlight is **presentation only** — it must not be load-bearing
for filtering, ranking, or `matchedCriteria`, and a missing/empty highlight must degrade to an
empty cell rather than breaking the row.

### D4 — "Klang Valley" is a non-discriminating region qualifier
User answer: recommended option.

Treat it like the existing `Kuala Lumpur` / `KL` / `Selangor` handling: the location gate is
**skipped** (all candidates survive) and `matchedCriteria.locationPref` stays `null` so no row
claims a location match it cannot back up. Add it as an alias alongside the existing qualifiers.
Do **not** build a region→area mapping table — explicitly out of scope.

### Claude's discretion
- Rows per page: use the existing `usePagination` default (10/page,
  `app/[lang]/_components/paginator.tsx`) rather than inventing a new convention.
- Exact column set and mobile presentation, within the constraints below.
</decisions>

<constraints>
## Non-negotiables carried from RESEARCH.md and CLAUDE.md

- **The region gate is the actual bug.** `MAX_MATCHES = 8` never engages for the example prompt;
  "Klang Valley" survives only 5/82, and 3/82 once a budget is applied. Fixing the table without
  D4 ships a 3-row table. D4 is the load-bearing change.
- **Split the cap, don't just raise it.** Full rows go to the client; the model's context stays
  bounded (~8). `toModelOutput` is confirmed available in the installed `ai@5.0.193`. Tool results
  are re-sent across all 5 steps — uncapped this measured ~50k tokens/turn against a 300,000/24h
  `TOKEN_CAP`.
- **Attributes must survive the tool boundary.** `FinderMatchSchema` currently carries only
  `projectId, name?, rationale, matchedCriteria, collateral?`; `ProjectMatch` has the attributes
  but that shape dies at the boundary. Zod `z.object` strips unknown keys — new fields are
  invisible unless added to the schema.
- **440px mobile is the primary surface.** The chat bubble is `max-w-[90%]` (~380px usable).
  Vendored `components/ui/table.tsx` already self-wraps in `overflow-x-auto`. Heed the quick-081
  warning at `app/[lang]/chat/chat-header.tsx:199-202`: `justify-center` on an `overflow-x-auto`
  container clips BOTH ends. `tests/mobile-layout.test.ts` and `tests/dialog-mobile-width.test.ts`
  are live guards that must stay green.
- **i18n:** `app/[lang]/chat/match-list.tsx` is currently not internationalized at all (hardcoded
  English at `:97, :148, :249`). Every new string — column headers, the button label, the
  "price unknown" treatment — needs EN/BM/中文 parity or `i18n-parity.test.ts` fails on the
  single-catalog key.
- **Reuse the existing one-shot prompt path** for the row button:
  `app/[lang]/chat/chat-shell.tsx:211` → `chat-input.tsx:606-615`. Do not invent a new mechanism.
- **Supporting documents are cheap — use them.** `CollateralDoc` carries `projectId` and
  `type: 'whatsapp-media'` and is already rendered per card. KB chunks have **no `projectId`**
  (fuzzy project-name string only) — do not attempt a KB-chunk join in this claim.
- **Grounding rules hold:** `status:'active'` enforcement stays; source-ID citations stay; no
  hard-coded model IDs; `tenantId` on every doc. A "return everything" change must not weaken
  the active-status filter.
- **No new dependency.** `@tanstack/react-table` is absent and unnecessary; the vendored
  `components/ui/table.tsx` suffices.
- **No new Firestore index needed** — scoring is an in-memory dot product and
  `projects.embedding` is a plain array.
</constraints>

<canonical_refs>
## Canonical References

- `.planning/quick/quick-kayinleong-085/RESEARCH.md` — full cited findings, measured corpus probe
- `./CLAUDE.md` — hard constraints, Next.js 16 gotchas
- `.planning/TSD.md` §3–§4 — component map, Firestore data model
</canonical_refs>

---

## D3 addendum — confirmed 2026-09-03

The model can only author a `highlight` for the matches it actually sees, and the token cap holds
that at `MAX_MATCHES` (~8). On a larger table the Highlight/Features column is therefore populated
for the top-ranked handful and **empty below**.

User was shown this and chose **"leave them empty"** over a deterministic description-snippet
fallback: an empty cell honestly reads as "not assessed", whereas filler would mix curated
highlights and truncated blurbs in one column. The concrete attribute columns (price, size, rooms,
tenure, location) still carry **every** row. This ratifies the behaviour already specified in
PLAN.md — no plan change required.
