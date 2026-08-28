# Claim: quick-kayinleong-067
- owner: kayinleong
- session: claude-code
- branch: quick-kayinleong-045-whatsapp-ingest
- started: 2026-08-28
- status: done
- summary: POST /api/chat 500s with an EMPTY body — the platform is killing the function, not our code; cut a model round trip out of every Finder turn

## What will change

User: "check why the chat page is not responding and fix it", with a DevTools capture:
`POST /api/chat` -> **500, Content-Length: 0**, `Cache-Status: "Netlify Edge"; fwd-status=500`.

Diagnosis, measured:
1. Imported `app/api/chat/route.ts` directly — loads clean, returns a proper `401` without
   auth. Not a module-load crash.
2. **Every 500 our route can return carries a JSON body** (`{"error":"Internal server error"}`).
   The observed 500 had **Content-Length: 0**. That response is not ours — the function was
   killed.
3. Timings against live Firestore: `searchProjects` **4519ms cold** / 725ms warm,
   `embedText` 600ms. A Finder turn also makes 3-5 sequential model round trips.
4. From the message history: successful Finder turns reach **21.0s**, Coach tops out at
   **11.6s**. This request ran past 40s. Netlify's configurable sync-function ceiling is 26s.

That is the whole chat-history saga in one line: the function is killed mid-flight, so
onFinish / onError / onAbort never run and nothing is persisted. `export const maxDuration = 90`
is a Firebase App Hosting number and cannot raise a Netlify cap.

Planned: remove one model round trip per Finder turn by returning collateral INLINE from
searchProjects, instead of making the model spend a whole step calling fetchCollateral.

## What has changed

**`src/agents/finder/tools.ts`**
- Extracted the collateral read into `collateralFor(projectId)`, used by BOTH tools.
- `searchProjects` now attaches collateral INLINE to its top `INLINE_COLLATERAL_MATCHES = 3`
  matches. A Firestore read costs ~100-300ms inside a step that is already open; a model
  round trip costs seconds.
- Three, not all eight: the tail of a shortlist is rarely what the agent forwards, and every
  attached item is re-sent to the model on every subsequent step — the token blowup
  quick-054 was fixed to stop.
- A collateral read failure is caught per project. The match is still the deterministic
  ground truth; the agent just gets no files for it. A search must never fail because an
  attachment lookup did.

**`src/agents/finder/prompt.ts`** — a Collateral section telling the model the files are
already attached and that fetchCollateral is only for a project the search did not cover.
fetchCollateral's own description says the same, so the rule holds even if the prompt drifts.

## Verification

- `npx tsc --noEmit` -> **0 errors**
- `npx vitest run` -> **1073 passed**, 197 skipped, 0 failed (was 1068; **+5**)
- `npx eslint app src` -> **0 errors**; `npm run build` -> exit 0

### Diagnosis, measured before changing anything
| check | result |
|---|---|
| import `route.ts` directly, POST with no auth | loads clean, returns **401** — not a module crash |
| every 500 our route can return | carries a JSON body; the observed one had **Content-Length: 0** |
| `searchProjects` cold / warm | **4519ms** / 725ms |
| `embedText` | 600ms |
| successful Finder turns (from stored messages) | up to **21.0s**; Coach tops out at 11.6s |

The 500 is not ours. The function was killed, which is also why onFinish / onError / onAbort
never ran and replies were never persisted — the whole chat-history saga in one line.

### Verified live
Ran the real `searchProjects` tool against live Firestore for "KLCC, 2 bed":

    searchProjects tool (incl. inline collateral): 1788ms
      #1 Dawn KLCC                     collateral=3
      #2 SO Sofitel Residences KLCC    collateral=12
      #3 Le Nouvel KLCC                collateral=12
      #4..#8                           collateral=0   (beyond the inline cap)

Three matches arrive with their files. That is one whole model round trip removed from the
common Finder path.

### Regression surface
- **fetchCollateral is byte-identical** — same ranking, same cap, same omission of pathless
  items (quick-050/054). It was extracted, not rewritten, and its 49 existing tests pass
  untouched.
- `collateral` is OMITTED rather than set to `[]` when there is nothing, so `MatchList`'s
  existing empty handling is unchanged.
- A `no_match` result short-circuits before any collateral read (pinned).
- Tests pin: attachment on the top matches, the cap, omission when empty, and that a
  Firestore failure leaves the search successful.

## Honest gaps

1. **This does not RAISE the timeout, only lowers the odds of hitting it.** One round trip
   is a few seconds out of a turn that was running past 40. `export const maxDuration = 90`
   in `route.ts` is a Firebase App Hosting number and cannot lift a Netlify cap — successful
   turns reaching 21.0s and this one dying past 40s fits Netlify's 26s configurable ceiling.
   **Raising that ceiling is a Netlify dashboard/plan change only the account owner can make.**
2. **Not measured end to end.** I timed the tool, not a full authenticated turn, so the
   saving is inferred from "one fewer model call", not observed on the wire.
3. **`searchProjects` is still 4519ms cold.** Most of that is Firestore client cold start,
   which recurs on every fresh container. Untouched here.
4. The step budget is still `stepCountIs(5)`, shared across all three pillars.
