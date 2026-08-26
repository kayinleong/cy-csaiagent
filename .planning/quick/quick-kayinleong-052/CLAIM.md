# Claim: quick-kayinleong-052
- owner: kayinleong
- session: claude-code
- branch: quick-kayinleong-045-whatsapp-ingest
- started: 2026-08-26
- status: claimed
- summary: The conversation-history Sheet does not scroll — its ScrollArea is a flex-1 child with the default min-height:auto, so it grows to fit every thread instead of scrolling. Identical root cause to quick-020, different surface.

## Symptom

Opening the history drawer with more threads than fit the viewport: the list cannot be
scrolled, so older conversations are unreachable.

## Root cause

`app/[lang]/chat/conversation-list.tsx:210` — `<ScrollArea className="flex-1">`.

`SheetContent` is height-bounded and a flex column (`components/ui/sheet.tsx:65`:
`flex flex-col` + `data-[side=left]:inset-y-0` + `data-[side=left]:h-full`), so the
container is correct. The bug is the child: `flex-1` sets `flex: 1 1 0%` but leaves
`min-height: auto`, and a flex item's automatic minimum size refuses to shrink below its
content. The ScrollArea therefore grows to the full height of the thread list, which bounds
the Radix Viewport to content height, and a viewport that is already as tall as its content
has nothing to scroll.

This is the SAME defect quick-kayinleong-020 fixed on the message list. That fix is still
in place at `message-list.tsx:69-76` and carries the explanatory comment; the drawer was
simply never given the same treatment.

Verified not-a-problem on the other ScrollAreas: `(admin)/conversations/conversation-viewer.tsx:269`
and `(coach)/_components/stall-inbox.tsx:167` both use an explicit `max-h-[60vh]` rather
than flex sizing, so their Root is bounded independently and they scroll correctly.

## What will change

- `app/[lang]/chat/conversation-list.tsx`: add `min-h-0` to the ScrollArea, with the same
  reasoning comment quick-020 left on the message list so the next reader does not strip it.

## Verification

_(pending)_
