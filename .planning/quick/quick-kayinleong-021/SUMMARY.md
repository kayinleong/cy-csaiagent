---
quick_id: quick-kayinleong-021
status: complete
date: 2026-06-15
---

# Summary — quick-kayinleong-021

**Fix:** the last chat message sat cramped against the input bar.

**Root cause:** `message-list.tsx` ScrollArea used `py-4` (16px top AND bottom), so a transcript scrolled
to the bottom left only 16px between the final bubble and the composer. (The dark "N" square in the
screenshot corner is the Next.js dev-mode indicator, not an app element.)

## What changed

- **`app/[lang]/chat/message-list.tsx`** — `flex-1 min-h-0 px-3 py-4` → `flex-1 min-h-0 px-3 pt-4 pb-8`
  (bottom padding 16px → 32px). One-line CSS change.

## Verification

| Gate | Result |
|------|--------|
| `npx tsc --noEmit` | 0 errors |
| `npx eslint app/[lang]/chat/message-list.tsx` | 0 errors / 0 problems |

CSS spacing — needs a browser check: open `/en/chat` with a transcript, scroll to bottom → the last
bubble clears the input bar. Full regression report in `CLAIM.md`.

## Commit

- `a96aff8` fix(quick-kayinleong-021): add bottom spacing below the last chat message

## Series context

quick-010 (list) → quick-016 (list permission) → quick-018 (load transcript) → quick-020 (make it scroll)
→ quick-021 (space the last bubble above the input).
