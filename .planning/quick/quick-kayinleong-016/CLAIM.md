# Claim: quick-kayinleong-016

- owner: kayinleong
- session: claude-code
- branch: main
- started: 2026-06-15
- status: claimed
- summary: Chat-history sidebar throws "FirebaseError: Missing or insufficient permissions." (residual H2 from quick-kayinleong-010). The conversations `list` rule requires `sameTenant()`, but the client query does not constrain `tenantId`, so Firestore rejects the whole query. Add a `where('tenantId','==','d2')` filter so the list rule is satisfiable; add the missing list-rule emulator test.

## What will change

_Add tenantId equality filter to the conversation-list query + emulator-gated list rules test._

## What has changed

_TBD._

## Verification

_TBD._
