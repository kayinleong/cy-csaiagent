# Claim: quick-kayinleong-021

- owner: kayinleong
- session: claude-code
- branch: main
- started: 2026-06-15
- status: claimed
- summary: The last chat message sits cramped against the input bar (too little breathing room below the transcript). Increase the message list's bottom padding so the final bubble clears the composer.

## What will change

**Symptom (UAT screenshot):** the bottom-most assistant bubble is tight against the chat input bar — visually cramped/overlapping.

**Root cause:** `app/[lang]/chat/message-list.tsx` ScrollArea uses `py-4` (16px top AND bottom). With a full transcript scrolled to the bottom, the last bubble ends only 16px above the input bar — too tight. (The dark "N" square in the corner is the Next.js dev-mode indicator, not an app element.)

**Planned edit:** give the message list more bottom clearance — split `py-4` into `pt-4 pb-8` (keep 16px top, 32px bottom) on the ScrollArea.

## What has changed

_TBD._

## Verification

_TBD._
