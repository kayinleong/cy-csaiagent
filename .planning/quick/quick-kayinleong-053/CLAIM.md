# Claim: quick-kayinleong-053
- owner: kayinleong
- session: claude-code
- branch: quick-kayinleong-045-whatsapp-ingest
- started: 2026-08-26
- status: done
- summary: Runtime guardrails so a Finder turn ALWAYS renders formatted and complete. The model drifts from the output schema (collateral emitted as an object of arrays of bare strings) and still narrates before the JSON, and both defeat the decoder — so the raw envelope reaches the agent.

## User request

"the output sometimes is in complete jsonc with google drive link, but it show <rationale
text only> … then sometimes the json is not even formatted, can u add some guardrails to
check this in real time, then always make sure it get to formatted properly and completely"

## Evidence (one screenshot, three turns, three different outcomes)

1. A clarifying question — rendered fine.
2. "dont ask anything, just show" → rendered ONLY the rationale prose. That is
   `salvageStructuredText` (quick-051) working as designed, but it is a DEGRADED result:
   the collateral links and matched-criteria badges are lost.
3. "show me the details" → the full raw JSON envelope, narration and all.

## Root causes

**A. Schema drift on `collateral` — the decisive one.** The model emitted:

    "collateral": { "brochures": [ "https://…", "https://…" ] }

`FinderMatchSchema.collateral` is `z.array(CollateralItemSchema)` where an item is
`{ type, url }` (`src/agents/finder/schema.ts`). An object-of-arrays-of-strings fails
`safeParse`, so `decodeFinderOutput` returns null and the entire envelope falls through to
the text branch. The JSON in turn 3 is COMPLETE and well-formed — it is simply the wrong
shape. No amount of "return only the bare JSON" prompting fixes a shape mismatch.

**B. My quick-051 salvage bails on a prose prefix.** `salvageStructuredText` starts with
`if (!trimmed.startsWith('{')) return null`. Turn 3's content begins "Let me run the search
now.{" — narration, then JSON — so salvage declined and the raw text rendered.
`extractJsonObject` already tolerates exactly this via its first-`{`-to-last-`}` slice;
salvage should too. That inconsistency is why turn 2 degraded gracefully and turn 3 did not.

**C. Narration is back despite the quick-048 prompt rule.** "Let me run the search now."
is precisely what that rule forbids. Prompt instructions are not a guarantee, which is the
whole point of the user's request: the guardrail has to be in code, not in the prompt.

## What will change

- A normalization pass applied BEFORE schema validation, repairing known model drift into
  the canonical shape (collateral as object-of-arrays, as bare strings, or missing `type`).
- `salvageStructuredText` to tolerate a prose prefix, matching `extractJsonObject`.
- Server-side observability: record when a Finder turn failed schema validation, so drift
  is measurable rather than anecdotal — the "check this in real time" half of the request.
- Tests pinning the exact shapes from this screenshot.

## What has changed

One commit (`72ed340`).

- `normalizeFinderShape()` in `decode-structured-output.ts`, applied inside
  `decodeFinderOutput` BEFORE `safeParse`. Repairs collateral supplied as an object keyed
  by category, as bare url strings, or with `href`/`link` instead of `url`; singularises
  the key for the chip label. **Deliberately narrow** — never invents a url, a projectId,
  or any field the model did not supply. Unknown shapes pass through untouched for zod to
  reject honestly.
- `salvageStructuredText()` now tolerates a prose PREFIX, matching `extractJsonObject`.
- Server-side health check in `onFinish`: decodes every Finder/Reply turn with the SAME
  decoder the client renders with, and warns when it fails — recording whether the model
  narrated and whether the text was salvageable.

## Verification

- `npx tsc --noEmit` → **0 errors**
- `npx vitest run` → **980 passed**, 197 skipped, 0 failed (was 969; **+11**)
- `npx eslint app src` → **0 errors**; `npm run build` → exit 0

### What the tests pin
The VERBATIM envelope from the report decodes — both as-is and with the narration prefix
`"Let me run the search now."` prepended. Plus: key singularisation, flat string arrays,
`href`/`link` aliases, dropping `collateral` entirely when nothing survives (rather than
emitting `[]`, which would render an empty chip row), and the **never-invent-a-url**
invariant — an item with no url is dropped, not fabricated.

### Regression surface
- Normalization runs only on the `matches[].collateral` key; every other field is passed
  through by object spread.
- An already-canonical envelope is asserted to come out byte-identical.
- The widening is one-directional: nothing that decoded before stops decoding.
- The health check is wrapped in try/catch and only reads — it can never fail a turn.
- Importing the decoder into the route is app→app (allowed; the ban is src→app), and the
  module is verified to have no `'use client'` and no imports beyond zod schemas, so it is
  safe server-side. Sharing it is the point: the health check cannot drift from what the
  agent actually sees.

## Honest gaps — NOT verified

1. **No live model call.** The repaired shape is the one observed in production, but the
   model can drift in ways not yet seen. The health-check warn is what will surface those —
   that is its purpose.
2. **The narration itself is unfixed**, and deliberately so. The quick-048 prompt rule
   already forbids it and the model does it anyway; the decoder now tolerates narration
   instead of depending on its absence. If narration turns out to waste step budget, that
   is a separate concern.
3. **No authenticated click-through** — the rendered card for the repaired envelope is
   unverified in a browser.
