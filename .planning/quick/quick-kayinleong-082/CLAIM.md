# Claim: quick-kayinleong-082
- owner: kayinleong
- session: claude-code
- branch: quick-kayinleong-045-whatsapp-ingest
- started: 2026-08-29
- status: done
- summary: the pillar tabs still clip below ~360px — stop tuning breakpoints and let the strip wrap to its own row

## What is wrong

quick-081 fixed 375px. The user reports it "still same", so I checked narrower.

First I confirmed the fix is actually live: the deployed CSS bundle
(`/_next/static/chunks/10jj-ozcgfds8.css`, 176 KB) contains both `sm:justify-center` and
`85vw`. My earlier probe said ABSENT because it looked in `/_next/static/css/` — Next puts
CSS under `/_next/static/chunks/`. The probe was wrong, not the deploy.

At **320x700**, signed in as a real agent:

    [history] [AI]  Auto  Coach  Finde|  (*)  [signout]

"Finder" is cut mid-word and Reply is off-screen entirely. Same class of failure as before,
just at a narrower width — which means quick-081 bought one breakpoint, not a fix.

## What will change

Stop trading header items against tab space. Let the container **wrap**, so on narrow screens
the tab strip takes its own full-width row and always fits at any width. One render, pure
CSS, no duplicated ARIA.

## What has changed

`chat-header.tsx` — the header wraps below `sm`, and the pillar strip takes row 2.

- container: `min-h-14 flex-wrap … sm:h-14 sm:flex-nowrap`. A fixed `h-14` would clip the
  second row rather than make room for it.
- tab strip: `order-last basis-full justify-center` on mobile, `sm:order-none sm:basis-0
  sm:flex-1` from `sm` up — which is the original `flex-1` behaviour, so desktop is byte-for-
  byte the same layout.
- left group: `flex-1 sm:flex-none` so it fills row 1 on mobile and pushes the right group to
  the edge.

One render, no duplicated ARIA, pure CSS.

## Verification

- `npx tsc --noEmit` -> **0 errors**
- `npx vitest run` -> **1145 passed**, 197 skipped, 0 failed (was 1143; **+2**)
- `npx eslint app src` -> **0 errors**; `npm run build` -> exit 0

### Looked at three widths, signed in as a real agent
| width | before | after |
|---|---|---|
| **320x700** | `Auto Coach Finde|` — Reply off-screen | **Auto · Coach · Finder · Reply** on their own row |
| **375x812** | all four fitted (quick-081) | same, now on their own row |
| desktop | single centred row | **unchanged** — logo, wordmark, chips, full coach pill |

### I also checked the deploy before assuming anything
The user said "still same", so the first question was whether quick-081 was even live. It was:
the deployed CSS bundle `/_next/static/chunks/10jj-ozcgfds8.css` (176 KB) contains both
`sm:justify-center` and `85vw`.

**My earlier probe said ABSENT and was wrong** — it looked under `/_next/static/css/`, but
Next emits CSS under `/_next/static/chunks/`. Worth remembering: that probe also reported a JS
marker as absent when it was present, so its verdicts before this were unreliable.

### Regression surface
- Everything is `sm:`-gated; desktop was re-checked by looking at it, not assumed.
- `sm:basis-0 sm:flex-1` is equivalent to the previous `flex-1`, so the desktop centring maths
  is unchanged.
- The two quick-081 assertions that described the left-align approach were replaced, because
  the approach changed for a better reason — not to make a failing test pass. The guards now
  pin both the mobile wrap AND the desktop restore.

## Honest gaps

1. **Two rows costs ~40px of vertical space on mobile.** On a chat surface that is a fair
   trade for four always-readable tabs, but it is a trade.
2. **The user may have meant something else.** Their screenshot showed the AI disclosure
   modal, and I could not reproduce a problem with it — it fits with margins at 320px and
   375px. If "still same" was about the modal, or about a width I have not tried, I still need
   to know which.
3. **Only the chat surface.** Admin and dashboard pages at mobile width remain unchecked.
