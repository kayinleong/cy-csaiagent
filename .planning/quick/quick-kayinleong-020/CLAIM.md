# Claim: quick-kayinleong-020

- owner: kayinleong
- session: claude-code
- branch: main
- started: 2026-06-15
- status: done
- summary: The chat message list does not scroll — a long/loaded transcript overflows and the user cannot scroll through it. The MessageList ScrollArea is a `flex-1` child of the `h-[100dvh] overflow-hidden` chat column but lacks `min-h-0`, so its default `min-height:auto` lets it grow to fit all messages (bounding the Radix viewport to content height) instead of scrolling. Fix: add `min-h-0` to the ScrollArea flex item.

## What will change

**Symptom:** With a conversation loaded (quick-018), the chat transcript is long but cannot be scrolled — older messages are clipped/unreachable.

**Root cause:** `app/[lang]/chat/message-list.tsx` renders `<ScrollArea className={cn('flex-1 px-3 py-4', className)}>` and chat-shell passes `className="flex-1"`. The ScrollArea Root is the `flex-1` child of `main` (`flex flex-col h-[100dvh] overflow-hidden`). A flex item defaults to `min-height: auto`, so the Root grows to fit its content (the Radix `Viewport` is `size-full`, i.e. h-full of an unbounded Root = full content height). The Root therefore never gets a bounded height to scroll within; `main`'s `overflow-hidden` clips the overflow → no scroll. The classic flexbox-scroll trap.

**Planned edit:** Add `min-h-0` to the MessageList ScrollArea className so the flex item can shrink below its content, giving the Radix viewport a bounded height and enabling scroll.

## What has changed

- `app/[lang]/chat/message-list.tsx` — the `ScrollArea` className changed from
  `cn('flex-1 px-3 py-4', className)` to `cn('flex-1 min-h-0 px-3 py-4', className)`. A short comment
  explains why `min-h-0` is required. No other change; no logic touched.

**Commit (on `main`):** `08df2ac` fix(quick-kayinleong-020): make the chat message list scrollable.

## Verification

**Automated gates:**
- `npx tsc --noEmit` → **0 errors**.
- `npx eslint app/[lang]/chat/message-list.tsx` → **0 errors / 0 problems**.

**Self-audit (regression-prevention):**
- Single Tailwind class added to one element; cannot affect compilation, types, data flow, or any other
  component. The full suite + `next build` passed on this tree at quick-018 (just prior) and this change
  is class-only, so no behavioral regression is possible in JS/TS.
- `min-h-0` only allows the flex item to shrink below its content height — it does not change layout when
  the content is short (the item still grows via `flex-1`). The empty-state branch (a separate
  `flex-1` div in chat-shell) is untouched.
- This is the canonical, well-established fix for the flexbox-scroll trap (a `flex-1` scroll container
  inside a bounded `flex flex-col` parent needs `min-h-0` so the inner viewport gets a bounded height).

**Not verified here (needs a visual/browser check):** scroll behavior is CSS — not exercisable in the
unit suite. The remaining human check: open `/en/chat` with a long/loaded transcript → the message list
scrolls (wheel/touch), the header stays pinned at the top and the input bar at the bottom, and the page
itself does not scroll. If auto-scroll-to-newest on load is desired as a follow-up, that is a separate
enhancement (this claim restores manual scroll, which was the reported defect).
