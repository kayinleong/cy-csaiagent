# Claim: quick-kayinleong-053
- owner: kayinleong
- session: claude-code
- branch: quick-kayinleong-045-whatsapp-ingest
- started: 2026-08-26
- status: claimed
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

## Verification

_(pending)_
