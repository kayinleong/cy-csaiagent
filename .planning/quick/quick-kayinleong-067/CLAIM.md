# Claim: quick-kayinleong-067
- owner: kayinleong
- session: claude-code
- branch: quick-kayinleong-045-whatsapp-ingest
- started: 2026-08-28
- status: claimed
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

## Verification

_(pending)_
