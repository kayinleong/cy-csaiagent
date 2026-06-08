# Claim: quick-kayinleong-005

- owner: kayinleong
- session: claude-code
- branch: phase-kayinleong-01
- started: 2026-06-08
- status: in-progress
- summary: Close the v1.0 milestone critical gap — wire the SSE→structured-output decode bridge so Reply (ReplyDraftCard) and Finder (MatchList) turns render their interactive cards instead of raw-JSON text bubbles.

## What will change

The Reply and Finder agents emit their structured output as a JSON object in the final
assistant text (`src/agents/{reply,finder}/prompt.ts` "Output Format"); `/api/chat` streams
that JSON as text deltas. The client never decodes it, so Reply/Finder turns render as raw-JSON
text bubbles — `ReplyDraftCard` never shows (milestone gap: REPLY-02/04/05/06/07/09 + ADMIN-06)
and `MatchList` is defined but never rendered (FIND-01/03 — the audit's "verify in same pass").

Planned edits:
- NEW `app/[lang]/chat/decode-structured-output.ts` — pure, unit-testable decode helpers
  (`decodeReplyOutput`, `decodeFinderOutput`). No React, no Firebase import.
- `app/[lang]/chat/chat-input.tsx` — on stream completion, gated by `pillarOverride`, decode the
  accumulated text and attach `replyOutput`/`finderOutput` (+ reply incoming/leadId/lang) to the
  assistant `ChatMessage`.
- `app/[lang]/chat/message-list.tsx` — add `finderOutput?` to `ChatMessage` and a `MatchList`
  render branch (mirrors the existing `replyOutput`→`ReplyDraftCard` branch).
- NEW `app/[lang]/chat/decode-structured-output.test.ts` — RED→GREEN coverage of the decode gate.

Gated by `pillarOverride` (the UI reaches Reply/Finder only via the header chip —
chat-shell.tsx:95), so the shared all-optional `clarifyingQuestion` field never cross-renders.

## What has changed

(filled on completion)

## Verification

(filled on completion)
