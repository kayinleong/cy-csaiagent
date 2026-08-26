# Claim: quick-kayinleong-056
- owner: kayinleong
- session: claude-code
- branch: quick-kayinleong-045-whatsapp-ingest
- started: 2026-08-26
- status: done
- summary: render guardrail — a JSON envelope must ALWAYS reach the agent as formatted output, never as raw/half-broken JSON or a dangling markdown link

## What will change

User report: "can u add a guardrail to make sure every json output will render just like in
the image", with a raw SSE paste and a screenshot of a correctly-rendered card whose THIRD
collateral link is cut off mid-token and shows as literal `[End Financier Info](https://…`.

Planned:
1. Repair a TRUNCATED JSON envelope instead of giving up on it (the dominant failure).
2. Drop a provably-incomplete tail item rather than emitting a dead half-link.
3. Sanitize a dangling markdown link at one choke point so it can never render literally.
4. Show the project NAME on a match card — the image has one, a match card shows a raw ID.

## What has changed

First, a correction to my own starting assumption: I replayed the pasted SSE stream through
the real decoder and it DOES decode — narration prefix, code fence and all. So the reported
symptom is not "this envelope fails to render". It is the screenshot: the turn arrives
TRUNCATED, and everything after the cut is lost. Four changes, all on that.

**1. `repairTruncatedJson()` — `app/[lang]/chat/decode-structured-output.ts`**
A cut envelope is repaired instead of abandoned. Tried only AFTER the two intact candidates,
so a complete envelope never routes through it. Two strategies, chosen by where the cut fell:
- inside a prose string -> close the string (nearly all the text survives)
- inside a URL -> do NOT close it; fall back to the last COMPLETE value, which leaves the
  half-built item without a `url` so `normalizeCollateral` drops it.

A number cut mid-token is dropped too: `"priceMax": 90000` may well have been `900000`, and
silently under-reporting a price is worse than omitting the field. Nothing is ever invented.

**2. `dropUnrenderableMatches()` — same file**
Each match is validated against `FinderMatchSchema` individually and dropped if it fails,
so the half-built FINAL match a repair leaves behind stops costing the agent every complete
match above it. Kept OUT of `normalizeFinderShape`, whose contract is "repair container
shape, let zod reject the rest honestly" — my first attempt put it there and broke four of
that function's existing tests, which was the contract telling me so.

**3. `sanitizeMarkdown()` — new `app/[lang]/chat/sanitize-markdown.ts`**
The literal defect in the screenshot: `[End Financier Info](https://…` printed as source
because the closing paren never arrived. It is reduced to its LABEL, not repaired with a
paren — a severed URL closed into a valid-looking link is the UI asserting something false,
the same rule that makes `fetchCollateral` omit pathless items. Applied inside
`MarkdownMessage` rather than at the call sites, so it covers the plain bubble, a Finder
`answer`, a match `rationale` and a restored history turn at once; those four drifted apart
once already (quick-046).

**4. Prose-prefix salvage + the project NAME**
- When a turn is cut so early that the envelope holds only keys, `salvageStructuredText`
  now returns the narration the model wrote BEFORE it, so braces never reach the screen.
- `FinderMatchSchema.name` (optional) is rendered as the match-card header. The screenshot
  shows "Bangsar Hill Park"; a match card showed `QiQthTM3nC4SqWnST1Q6`, which is not a
  thing an agent can say to a lead. The ID stays visible as the D-04 grounding citation.

## Verification

- `npx tsc --noEmit` -> **0 errors**
- `npx vitest run` -> **1021 passed**, 197 skipped, **0 failed** (was 995; **+26**)
- `npx eslint app src` -> **0 errors** (70 pre-existing warnings, none in changed files)
- `npm run build` -> exit 0

### Replayed against the reported payloads
Reconstructed the pasted SSE stream and the screenshot's answer-cut-mid-URL case and ran
them through the real decoder:

| case | before | after |
|---|---|---|
| pasted stream (complete) | card | card, now headed **Residensi 38 Bangsar** |
| screenshot: answer cut mid-URL | rationale paragraph only | full markdown; 2 links kept, 3rd degrades to `3. End Financier Info` |
| matches cut mid-collateral-URL | RAW JSON | card + the 2 complete links, severed one dropped |
| cut inside the only match | RAW JSON | the narration prose |

No half-URL is emitted in any case.

### Regression surface
- **Complete envelopes are untouched.** Repair is the last candidate; pinned by a test that
  decodes a complete fenced envelope with narration and asserts the collateral survives.
- **`normalizeFinderShape` is behaviourally unchanged** — its four existing tests pass as
  written, which is what sent the drop-filter into its own function.
- **`salvageStructuredText`'s new fallback only fires after the in-envelope search finds
  nothing.** All ten existing salvage tests pass unchanged. Guarded so prose that merely
  contains a brace ("the shape { projectId, rationale }") is never chopped.
- **`MarkdownMessage` now sanitizes every markdown path.** Anchored to end-of-string behind
  a cheap `](`-without-`)` reject, so complete links, tables and bare URLs are returned
  identically (pinned). Mid-stream, a half-typed link shows as its label until the `)`
  arrives — deliberate, and better than showing the source.
- **`name` is optional**, so every persisted pre-056 turn still decodes and its card falls
  back to the ID exactly as before.
- Prompt edit is two bullets; the finder prompt's no-backtick assertion still passes.

## Honest gaps

1. **No live click-through.** Verified against reconstructed real payloads and unit tests,
   not an authenticated browser session.
2. **A turn cut off before the model wrote ANY prose** still shows the fragment that
   arrived — there is genuinely nothing to salvage at that point.
3. **`name` is model-supplied and not cross-checked** against the searchProjects result.
   The prompt says copy it verbatim; a server-side check would be stronger and is not done
   here. A fabricated name was already possible via `rationale`, so this adds no new class
   of risk, but it does add a new surface for one.
4. **This is a rendering guardrail, not a cure.** It does not stop turns being truncated.
   quick-055 persists them, quick-054 cut the payload 98%; the cause is still unconfirmed.
