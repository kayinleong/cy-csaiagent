# Claim: quick-kayinleong-005

- owner: kayinleong
- session: claude-code
- branch: phase-kayinleong-01
- started: 2026-06-08
- status: done
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

- **NEW** `app/[lang]/chat/decode-structured-output.ts` — pure `decodeReplyOutput` /
  `decodeFinderOutput` helpers. Each extracts a JSON object from the model's final text
  (tolerant of a ```json fence + leading/trailing prose via a first-`{`-to-last-`}` slice),
  `safeParse`s against the pillar schema, and returns the output ONLY if a real branch is
  populated (Reply: draft|noSopMatch|clarifyingQuestion; Finder: matches|refusal|
  clarifyingQuestion). Empty `{}` / non-matching objects → null (text-bubble fallback).
- `app/[lang]/chat/chat-input.tsx` — accumulate the streamed assistant text into a local
  `assistantContent`; on stream completion, gated by `pillarOverride`, decode it and attach
  `replyOutput` (+ `replyIncoming`=pasted text, `replyLeadId`, `replyLang`=`langOverride ?? 'en'`)
  for a Reply turn, or `finderOutput` for a Finder turn, to the assistant `ChatMessage`.
- `app/[lang]/chat/message-list.tsx` — added `finderOutput?: FinderOutput` to `ChatMessage`
  and a `MatchList` render branch (mirrors the existing `replyOutput`→`ReplyDraftCard` branch),
  so the previously-orphaned `MatchList` component now renders for Finder turns.
- **NEW** `app/[lang]/chat/decode-structured-output.test.ts` — 14 tests (reply draft/noSopMatch/
  clarifying, finder matches/refusal/clarifying, code-fence + prose tolerance, prose/empty/`{}`
  fallback → null, and Finder-JSON-not-decoded-as-Reply non-collision).

This closes the milestone gap (REPLY-02/04/05/06/07/09 + ADMIN-06) and the audit's "verify
Finder MatchList in the same pass" (FIND-01/03 — MatchList was defined but never rendered).

## Verification

**Automated gates (HEAD):**
- `npx tsc --noEmit` → 0 errors.
- `npx vitest run` → 555 passed | 141 skipped | 0 failed (was 541 pass; +14 = the new decode suite).
- `npx eslint` on the 4 touched files → 0 errors. 2 warnings remain on `chat-input.tsx`
  (`onAuthStateChanged` unused import L29, unused eslint-disable L131) — both PRE-EXISTING
  (documented out-of-scope in 04-08-SUMMARY), neither introduced by this change. New files lint clean.

**Regression surface + audit:**
- *Coach / Auto turns:* the decode block is gated `pillarOverride === 'reply' | 'finder'`, so
  Coach (and undefined/Auto) turns are completely untouched — they still render as plain text
  bubbles via the unchanged delta-append path. ✓
- *Reply turns:* a populated `ReplyOutput` now attaches → `message-list` renders `ReplyDraftCard`
  (the existing branch, unchanged). The raw-JSON `content` is hidden because the card branch wins.
  During streaming `replyOutput` is unset, so partial JSON shows transiently (pre-existing
  structured-output-as-text artifact), then the card replaces it on completion. ✓
- *Finder turns:* new branch renders `MatchList` (render-only; `className` prop supported). The
  schemas share an all-optional `clarifyingQuestion`, but per-pillar gating + the populated-branch
  guard mean a Finder object never decodes as a Reply card (covered by a dedicated test). ✓
- *Persistence / server:* no route or `onFinish` change — the server still streams `final.text`
  and persists it as before. Decode is purely client-side display. ✓
- *useCallback deps:* decode uses only already-listed deps (`pillarOverride`, `leadId`,
  `langOverride`, `input`→`text`) + locals; no new dependency, no exhaustive-deps warning. ✓
- *Bundle safety:* `decode-structured-output.ts` imports only the two zod schema modules
  (pure, no firebase/server) — safe in the client bundle; `message-list` already imported the
  reply schema (precedent). ✓

**NOT verified (live-gated):** browser click-through of the rendered ReplyDraftCard / MatchList
against a deployed Firebase stack (no creds locally) — folds into the existing Phase 3/4 live
browser-verification gate. The decode contract itself is unit-covered.
