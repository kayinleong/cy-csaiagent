---
quick_id: quick-kayinleong-020
status: complete
date: 2026-06-15
---

# Summary — quick-kayinleong-020

**Fix:** the chat message list would not scroll — a long/loaded transcript overflowed and older messages
were unreachable.

**Root cause:** `message-list.tsx` renders the `ScrollArea` as a `flex-1` child of the chat column
(`flex flex-col h-[100dvh] overflow-hidden`) but without `min-h-0`. A flex item defaults to
`min-height: auto`, so the Root grew to fit all messages (the Radix `Viewport` is `size-full` of an
unbounded Root = full content height) instead of bounding the viewport — and `overflow-hidden` on the
parent clipped it. Classic flexbox-scroll trap.

## What changed

- **`app/[lang]/chat/message-list.tsx`** — added `min-h-0` to the ScrollArea className
  (`flex-1 px-3 py-4` → `flex-1 min-h-0 px-3 py-4`). One-line CSS fix, no logic touched.

## Verification

| Gate | Result |
|------|--------|
| `npx tsc --noEmit` | 0 errors |
| `npx eslint app/[lang]/chat/message-list.tsx` | 0 errors / 0 problems |

CSS scroll behavior is not exercisable in the unit suite — needs a browser check: open `/en/chat` with a
long transcript → the list scrolls, header pinned top, input pinned bottom, page itself does not scroll.
Full regression report in `CLAIM.md`.

## Commit

- `08df2ac` fix(quick-kayinleong-020): make the chat message list scrollable

## Series context

quick-010 (sidebar lists conversations) → quick-016 (fix list permission denial) → quick-018 (selecting a
conversation loads its transcript) → quick-020 (the loaded transcript scrolls).
