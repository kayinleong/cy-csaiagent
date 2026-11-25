---
status: complete
---

## Goal
Let the Property Finder read a typed property budget (RM1.5mil-RM2.5mil) while income and all other PII stay masked, and never show a raw PDPA token on screen.

## Changes Made
- `src/audit/pdpa.ts` — case-insensitive FINANCIAL_REGEX that consumes the whole figure incl. suffix (fixes the RM1.5MIL half-mask leak); `pseudonymize(input, names, opts?: {financial:'all'|'non-budget'})`, default 'all'; income-cue rules (`looksLikeIncome`) documented in the doc comment; re-exports `scrubPdpaTokens`.
- `src/audit/scrub.ts` (new) — crypto-free `scrubPdpaTokens(text,label)` so the client bundle does not pull node:crypto; leaves `<LEAD_ID:n>`; idempotent.
- `src/audit/index.ts` — exports `scrubPdpaTokens`, `PseudonymizeOptions`, `FinancialMode`.
- `app/api/chat/route.ts` (after routeAsync, ~:566-592; streamText input ~:910) — strict GATE 3 unchanged; for pillar finder a second `pseudonymize(..., {financial:'non-budget'})` + `assertRedacted`, its messages go to streamText. Reply/Coach/audit keep strict result.
- `app/[lang]/chat/chat-input.tsx` — accumulate raw text, scrub the full accumulated text each delta (token split across chunks caught); reload path passes localized label.
- `app/[lang]/chat/conversation-messages-map.ts` — scrubs persisted content before structured decoders; optional `hiddenLabel` arg (default "[hidden]").
- `app/[lang]/chat/load-conversation-messages.ts` — (outside owned list, 3 lines) optional `hiddenLabel` passthrough.
- `src/i18n/messages/{en,ms,zh}.json` — `chat.hiddenAmount`.
- Tests: `src/audit/pdpa.test.ts`, `app/api/chat/route.test.ts`, `app/[lang]/chat/conversation-messages-map.test.ts`.

## Verification
- `npx vitest run src/audit app/api/chat app/`: 34 files, 567 tests passed.
- `npx tsc --noEmit`: no output (clean). `npx eslint` on changed files: 0 errors, 5 pre-existing warnings.

## Regression
Default pseudonymize callers unchanged (existing tests pass); Reply/Coach still send FIN_HASH (tested); assertRedacted-before-streamText ordering tests pass; audit stores hashes only (unchanged).

## Blockers
- chat-shell.tsx calls `loadConversationMessages(cid)` twice (:155, :189) without a label, so history reload there shows "[hidden]" in English. Pass `t('hiddenAmount')` there (not my file).
- Router PDPA gap (raw text to classifier) untouched, per instructions.
