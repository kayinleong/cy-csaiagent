# Claim: quick-kayinleong-022

- owner: kayinleong
- session: claude-code
- branch: main
- started: 2026-06-15
- status: claimed
- summary: The last chat message slides BEHIND the input bar (confirmed) — the input overlaps the scroll area. quick-020's `min-h-0` + quick-021's `pb-8` did not resolve it, so the three-part flex column (header / scroll / input) needs the canonical robust pattern: `shrink-0` on the header and input bar so they always reserve their height, plus clipping the scroll container so its content cannot bleed past into the input.

## What will change

**Symptom (user-confirmed):** scrolled to the bottom, the final message bubble is partly hidden underneath the chat input bar.

**Root cause:** `app/[lang]/chat/page.tsx` lays the chat out as a `flex flex-col h-[100dvh] overflow-hidden` column with three children: `ChatHeader`, `MessageList` (flex-1 min-h-0 scroll), `ChatInput`. The header and input bar have NO `shrink-0`, so the flex algorithm can let them be overlapped / fail to reserve space, and the scroll container can paint content past its box into the input region. `min-h-0` (quick-020) and `pb-8` (quick-021) addressed scroll + spacing but not the overlap.

**Planned edit (canonical fixed-header / scroll-body / fixed-footer flex pattern):**
- `app/[lang]/chat/chat-header.tsx` — add `shrink-0` to the header.
- `app/[lang]/chat/chat-input.tsx` — add `shrink-0` to the input bar container so it always reserves its full height below the scroll area.
- `app/[lang]/chat/message-list.tsx` — add `overflow-hidden` to the ScrollArea root so its content is clipped to the flex-bounded box and cannot bleed under the input.

## What has changed

_TBD._

## Verification

_TBD._
