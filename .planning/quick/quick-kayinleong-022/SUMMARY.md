---
quick_id: quick-kayinleong-022
status: complete
date: 2026-06-15
---

# Summary — quick-kayinleong-022

**Fix:** the last chat message rendered behind the input bar (user-confirmed). quick-020 (`min-h-0`) and
quick-021 (`pb-8`) did not resolve it — confirmed those were live on disk and served by the dev server,
so the overlap was a real layout gap, not a stale build.

**Root cause:** the chat is a `flex flex-col h-[100dvh] overflow-hidden` column (header / scroll / input).
The header and input bar lacked `shrink-0`, and the Radix ScrollArea root was not clipped, so the scroll
content could bleed past its box and the input could be overlapped.

## What changed

- **`chat-header.tsx`** — `shrink-0` on the header.
- **`chat-input.tsx`** — `shrink-0` on the input-bar container (always reserves its height).
- **`message-list.tsx`** — ScrollArea root `flex-1 min-h-0 overflow-hidden px-3 pt-4` (added
  `overflow-hidden`, removed root `pb-8`); bottom spacing moved inside the scroll content (inner div gains
  `pb-8`) so it scrolls with the messages and the last bubble clears the composer.

This is the canonical fixed-header / scroll-body / fixed-footer flex pattern.

## Verification

| Gate | Result |
|------|--------|
| `npx tsc --noEmit` | 0 errors |
| `npx eslint <3 files>` | 0 errors (2 pre-existing warnings) |
| Dev server (:3000) recompile of `/en/chat` | HTTP 200, no error |

CSS layout — the loaded-conversation overlap needs a browser confirm (auth-gated, not reproducible in this
environment). Hard-refresh `/en/chat`, load a conversation, scroll to the bottom, confirm the last bubble
clears the input. Full regression report in `CLAIM.md`.

## Commit

- `676bbc4` fix(quick-kayinleong-022): stop the last message rendering behind the input bar

## Series context

quick-010 (list) → 016 (list permission) → 018 (load transcript) → 020 (scroll) → 021 (spacing) →
022 (stop the input overlapping the last message — the robust shrink-0 + clipped-scroll fix).
