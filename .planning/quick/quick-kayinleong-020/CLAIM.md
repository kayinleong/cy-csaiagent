# Claim: quick-kayinleong-020

- owner: kayinleong
- session: claude-code
- branch: main
- started: 2026-06-15
- status: claimed
- summary: The chat message list does not scroll — a long/loaded transcript overflows and the user cannot scroll through it. The MessageList ScrollArea is a `flex-1` child of the `h-[100dvh] overflow-hidden` chat column but lacks `min-h-0`, so its default `min-height:auto` lets it grow to fit all messages (bounding the Radix viewport to content height) instead of scrolling. Fix: add `min-h-0` to the ScrollArea flex item.

## What will change

**Symptom:** With a conversation loaded (quick-018), the chat transcript is long but cannot be scrolled — older messages are clipped/unreachable.

**Root cause:** `app/[lang]/chat/message-list.tsx` renders `<ScrollArea className={cn('flex-1 px-3 py-4', className)}>` and chat-shell passes `className="flex-1"`. The ScrollArea Root is the `flex-1` child of `main` (`flex flex-col h-[100dvh] overflow-hidden`). A flex item defaults to `min-height: auto`, so the Root grows to fit its content (the Radix `Viewport` is `size-full`, i.e. h-full of an unbounded Root = full content height). The Root therefore never gets a bounded height to scroll within; `main`'s `overflow-hidden` clips the overflow → no scroll. The classic flexbox-scroll trap.

**Planned edit:** Add `min-h-0` to the MessageList ScrollArea className so the flex item can shrink below its content, giving the Radix viewport a bounded height and enabling scroll.

## What has changed

_TBD._

## Verification

_TBD._
