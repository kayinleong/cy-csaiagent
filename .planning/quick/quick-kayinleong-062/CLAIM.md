# Claim: quick-kayinleong-062
- owner: kayinleong
- session: claude-code
- branch: quick-kayinleong-045-whatsapp-ingest
- started: 2026-08-27
- status: done
- summary: match-card footer — three identical "whatsapp-media" pills tell the agent nothing; separate criteria from attachments and give each file a real name

## What will change

User: "update this ui instead of pills, make it look nicer", with a screenshot of a working
match card whose footer is `≤RM900k` `Bangsar` `2 bed` `↗ whatsapp-media` `↗ whatsapp-media`
`↗ whatsapp-media`.

Two real problems, not just styling:
1. **Matched criteria and collateral links render identically.** One is context, the other
   is the thing the agent taps and forwards to a lead — they should not look the same.
2. **Every attachment is labelled `whatsapp-media`**, the raw `type` off the collateral doc.
   The agent cannot tell a sales kit from a floor-plan photo without opening all three.

Planned: derive a readable name and a file kind from the URL, render attachments as a
stacked tappable list (mobile-first — a wrapping pill row is the worst case on a phone), and
demote the criteria to a quiet meta line.

## What has changed

**New `app/[lang]/chat/collateral-label.ts`** — `presentCollateral()` recovers a real name
and a file kind from the URL. A Firebase download URL percent-encodes the whole storage
path, so the filename was there all along; this reads it rather than asking anyone to re-tag
12,000 assets.
- `…/38 Bangsar(SALES KIT)-1.pdf` -> **"38 Bangsar(SALES KIT)"**, kind `pdf`, badge `PDF`
- `IMG-20250421-WA0051.jpg` is a date and a counter, so it falls back to the type —
  **"WhatsApp media"**, still tagged `JPG`. A weak label that is TRUE beats a confident one
  that is invented.
- A Drive folder link ends in an opaque ID, so it is decided first and labelled from its
  type: **"Project info"**. Any other extensionless 20+ char token without a space is
  treated the same way — showing it would be the projectId-on-the-card mistake again.

**`match-list.tsx`** — the footer is rebuilt:
- **Matched criteria** are now a quiet meta line (`≤RM900k · Bangsar · 2 bed`), not chips.
  They are what the search matched on; rendering them identically to the collateral made
  context look like actions.
- **Collateral** is a stacked list under a `N files to share` heading: kind icon, real name,
  extension badge, external-link glyph. Each row is `min-h-11` (44px, the touch-target
  floor) and full-bleed, because this is a phone surface first and a wrapping row of chips
  is its worst case.
- `overflow-hidden` on the Card so the last row's hover fill is clipped to the rounded
  corner.

## Verification

- `npx tsc --noEmit` -> **0 errors**
- `npx vitest run` -> **1051 passed**, 197 skipped, 0 failed (was 1042; **+9**)
- `npx eslint app src` -> **0 errors**; `npm run build` -> exit 0

### Actually looked at it
Server-rendered the REAL `MatchList` with `renderToStaticMarkup`, compiled the project's own
`app/globals.css` through the Tailwind 4 CLI against that markup (not a CDN approximation,
so the D2 tokens and `@theme` are the real ones), and screenshotted it at desktop and at
375x812. Five collateral items rendered as:

| label | badge |
|---|---|
| BHP Carpark Plan (Tower C) | PDF |
| Sales Incentive Package - Agent Briefing | PDF |
| WhatsApp media | JPG |
| Show unit walkthrough | MP4 |
| Project info | — |

Before, all three of these read `whatsapp-media`. At mobile width every row stays on one
line with the label truncating; nothing wraps.

### Regression surface
- **Render-only change.** No schema, no prompt, no server code. `MatchList`'s other three
  states (refusal / clarifying / answer) are untouched.
- **The `isWebUrl` filter is kept** — quick-050's second line of defence against rendering a
  bucket key as a clickable link — and now runs once into `files` rather than inline.
- `CardFooter` is no longer used by this card; the import was dropped, and lint confirms
  nothing else in the file referenced it.
- `presentCollateral` is pure and has 9 tests, including one asserting it NEVER returns an
  empty label for a malformed, empty or bare-origin URL.

## Honest gaps

1. **Not seen in the running app** — the preview is the real component with the real
   stylesheet, but it is a static render, not an authenticated Finder turn. Hover and
   focus-visible states were written, not exercised.
2. **The fallback label is still weak.** "WhatsApp media" x3 on a project whose files are
   all camera-roll exports is better than "whatsapp-media" x3, but not by much. The durable
   fix is a real `title` on the collateral document at import time, which belongs in the
   WhatsApp importer, not in the renderer.
3. **No i18n.** "files to share" and the fallback labels are hardcoded English while the
   surface is EN/BM/ZH. Consistent with the rest of `match-list.tsx` today, but it is debt.
