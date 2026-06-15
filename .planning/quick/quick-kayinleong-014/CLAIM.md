# Claim: quick-kayinleong-014

- owner: kayinleong
- session: claude-code
- branch: main
- started: 2026-06-15
- status: in-progress
- summary: Conversation Log (/en/conversations) has three issues — (1) the search bar cannot search by agent email, (2) the Agent column shows raw Firebase uids instead of emails, and (3) the conversation-detail modal is not responsive (long routeDecision pillar badges blow out the dialog width). Fix all three.

## What will change

_TBD after research + planning._

Known leads (pre-research):
- search: `searchConversations` (app/[lang]/(admin)/conversations/actions.ts:167) only does a
  conversation-ID prefix query on `__name__`. No email path. Need email→uid resolution
  (Firebase Auth `getUserByEmail`) → filter conversations by `ownerUid`.
- agent column: `conversation-viewer.tsx:205-207` renders `conv.agentRef.slice(0,8)…` (the raw
  `ownerUid`). Resolve uid→email server-side via chunked `adminAuth.getUsers` (≤100/call) —
  same pattern as quick-kayinleong-011. Email is PII: server-side only, never logged/audited.
- modal responsiveness: per-message pillar `Badge` (conversation-viewer.tsx:277-281) renders the
  full `routeDecision` string (can be a long sentence) with `whitespace-nowrap`, forcing the
  `DialogContent max-w-lg` wider than the viewport. Constrain dialog width responsively + wrap/
  truncate long badge content.

## What has changed

_TBD._

## Verification

_TBD._
