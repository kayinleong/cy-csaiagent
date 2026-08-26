# Claim: quick-kayinleong-052
- owner: kayinleong
- session: claude-code
- branch: quick-kayinleong-045-whatsapp-ingest
- started: 2026-08-26
- status: done
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

## What has changed

- `app/[lang]/chat/conversation-list.tsx:218` — `flex-1` → `flex-1 min-h-0`, with the
  reasoning comment inline so it is not stripped as noise later.

## Verification

- `npx tsc --noEmit` → 0 errors; `npx vitest run app/[lang]/chat` → 73 passed.
- **Mechanism proven in a real browser**, not assumed. Replicated the exact Radix
  structure (bounded flex column → Root with no overflow → Viewport `h-full overflow:auto`)
  and measured both cases:

  | | Root height | viewport client | viewport scroll | scrollable |
  |---|---|---|---|---|
  | `min-height: auto` (before) | 2000px | 2000 | 2000 | **no** |
  | `min-height: 0` (after) | 300px | 300 | 2000 | **yes** |

  A first probe was UNSOUND and I discarded it: it put `overflow:auto` on the flex item
  itself, and the CSS spec sets the automatic minimum size to 0 for scroll containers, so
  both cases scrolled and the test proved nothing. Radix splits Root from Viewport — the
  Root has no overflow, so the Root is what clamps. Also confirmed the Tailwind utilities
  resolve on the page (`flex-grow: 1`, `flex-basis: 0%`, `min-height: 0px`).

### Regression surface
- One class added to one element; no logic, props or markup changed.
- Other ScrollAreas checked and deliberately left alone: `conversation-viewer.tsx:269` and
  `stall-inbox.tsx:167` bound themselves with `max-h-[60vh]` rather than flex sizing, so
  their Root is already constrained. `message-list.tsx` already carries the quick-020 fix.

### Honest gap
No authenticated click-through of the actual drawer — it sits behind auth. The mechanism is
proven and the class is applied; the end-to-end interaction is not visually confirmed.
