---
phase: "05-hardening-scale"
plan: "02"
subsystem: "data-layer"
tags: ["firestore", "collections", "rules", "indexes", "pdpa", "usage", "erasure", "wave-1", "tdd-green-partial"]
dependency_graph:
  requires:
    - "05-01 (Wave-0 test scaffold)"
  provides:
    - "UsageEventDoc/UsageRollupDoc/ErasureRequestDoc typed collections with tenantId-stamping converters + refs"
    - "Deny-by-default rules for collections 18-20 (T-05-UNRULED mitigated)"
    - "usageEvents (day,uid,pillar) composite index (Pitfall 4 bounded)"
    - "19-collection rules test enumeration (T-01-09 / T-05-UNRULED CI guard)"
    - "EscalationDoc.resolvedAt? (D-05 resolution-time metric unblocked)"
  affects:
    - "05-03-PLAN.md (PDPA erasure uses erasureRequestsRef)"
    - "05-04-PLAN.md (usage pipeline uses usageEventsRef/usageRollupsRef)"
    - "05-05-PLAN.md (role matrix — reads users, no rules change needed)"
tech_stack:
  added: []
  patterns:
    - "makeConverter<T>() tenantId-stamp on all 3 new collections (CLAUDE.md tenantId mandate)"
    - "deny-by-default: create/update/delete: if false; admin-read: hasRole('admin') && sameTenant() (mirrors auditLogs :208-216)"
    - "composite index: collectionGroup + COLLECTION scope + ordered fields (mirrors escalations index shape)"
    - "rulesSuite emulator-gate pattern: RUN_RULES = Boolean(FIRESTORE_EMULATOR_HOST) (mirrors :62-63)"
key_files:
  created: []
  modified:
    - "src/firebase/collections.ts"
    - "firestore.rules"
    - "firestore.indexes.json"
    - "src/firebase/__tests__/rules.test.ts"
decisions:
  - "ErasureRequestDoc stores subjectIdHash only (never raw subjectId) — PDPA T-05-PII mitigation enforced by schema"
  - "UsageEventDoc is counts-only by interface — no content/originalDraft/text fields; mirrors auditLogs no-PII posture"
  - "90d TTL for usageEvents documented as comment (Pitfall 4 / A5) — flagged for Derek confirmation, not enforced in code yet"
  - "resolvedAt? added to EscalationDoc; regression surface: resolveStall (dashboard/actions.ts:84) must also set it (05-PATTERNS.md flagged)"
  - "Rules + CI tests shipped in SAME plan as collections (Pitfall 6 satisfied)"
  - "Deploy is live-gated: firebase deploy --only firestore:rules,firestore:indexes (consistent with quick-004)"
metrics:
  duration: "4 minutes"
  completed: "2026-06-07T07:49:02Z"
  tasks_completed: 3
  tasks_total: 3
  files_created: 0
  files_modified: 4
---

# Phase 05 Plan 02: Data-Layer Foundation (3 New Collections + Rules + Index + 19-Collection Tests) Summary

**One-liner:** Typed collections 18-20 (usageEvents/usageRollups/erasureRequests) with tenantId-stamping converters + ref factories, deny-by-default Firestore rules, usageEvents (day,uid,pillar) composite index, and rules test extended 16→19 — Pitfall 6 (unruled-collection leak) mitigated in CI.

## What Was Built

### Task 1: 3 typed collection interfaces + converters + ref factories + resolvedAt (e2cff04)

**`src/firebase/collections.ts`** — 168 lines added:

- **`UsageEventDoc`** (collection 18): counts-only interface (`uid`, `pillar`, `inputTokens`, `outputTokens`, `cachedInputTokens`, `cacheCreationInputTokens`, `reads?`, `writes?`, `day`, `createdAt`). NO content fields by design — enforces PDPA no-PII posture. 90d TTL documented as comment for Derek's confirmation (Pitfall 4 / A5).
- **`UsageRollupDoc`** (collection 19): idempotent rollup keyed `${day}__${uid}__${pillar}` (`day`, `uid`, `pillar`, `msgCount`, `inputTokens`, `outputTokens`, `cachedInputTokens`, `cacheCreationInputTokens`, `reads?`, `writes?`, `resolutionTimeMs?`, `escalationRate?`, `updatedAt`). The single source for ADMIN-08 dashboard + QUAL-08 cost pass.
- **`ErasureRequestDoc`** (collection 20): PDPA erasure ledger (`subjectType`, `subjectIdHash` — hash only, never raw id, `status`, `requestedBy`, `requestedAt`, `slaDeadline`, `collectionsRemaining`, `completedAt?`, `error?`). Provides idempotency + resumability for the chunked sweep (D-02).
- **`usageEventConverter` / `usageRollupConverter` / `erasureRequestConverter`** via `makeConverter<T>()` — tenantId auto-stamped on every write; no caller can omit it.
- **`usageEventsRef()` / `usageRollupsRef()` / `erasureRequestsRef()`** — ref factories mirroring `replyEditsRef()` shape exactly.
- **`resolvedAt?: Date | FieldValue`** added to `EscalationDoc` — unblocks D-05 resolution-time analytics. Regression note inline: `resolveStall` in `dashboard/actions.ts:84` must also set this field when transitioning to 'resolved'.
- Collection inventory header comment updated to enumerate 20 collections.

### Task 2: Deny-by-default rules + composite index (b5c6046)

**`firestore.rules`** — 27 lines added (additive only, no existing rule modified):

Three match blocks (collections 18-20) mirroring the `auditLogs` pattern (:208-216):
```javascript
match /usageEvents/{id} { allow create, update, delete: if false; allow read: if hasRole('admin') && sameTenant(); }
match /usageRollups/{id} { allow create, update, delete: if false; allow read: if hasRole('admin') && sameTenant(); }
match /erasureRequests/{id} { allow create, update, delete: if false; allow read: if hasRole('admin') && sameTenant(); }
```

`git diff` shows ONLY additions — no existing rule widened (Pitfall 6 guard verified).

**`firestore.indexes.json`** — 1 composite index added (JSON valid):
- `usageEvents` COLLECTION scope, fields `day ASC, uid ASC, pillar ASC` — bounds the rollup's per-(uid,pillar) aggregation at 400-agent scale (Pitfall 4).

**Deploy note:** `firebase deploy --only firestore:rules,firestore:indexes` is a live-gated op — code-ready here, deployed during rollout (consistent with quick-004 pattern).

### Task 3: rules.test.ts extended 16→19 (d5d8237)

**`src/firebase/__tests__/rules.test.ts`** — 229 lines added, 1 line updated:

- Added `'usageEvents'`, `'usageRollups'`, `'erasureRequests'` to the deny-by-default collections array.
- Updated T-01-09 comment from "all 16 enumerated" to "all 19 enumerated" — the CI guard for Pitfall 6 (no unruled collection).
- Added 3 `rulesSuite` blocks (one per new collection), each proving:
  - admin CAN read (assertSucceeds) — org-wide cost/ledger view
  - new-agent CANNOT read (assertFails) — Information Disclosure guard (T-05-UNRULED)
  - client CREATE DENIED (assertFails) — Tampering guard (T-05-TAMPER)
  - client UPDATE DENIED (assertFails) — Tampering guard
  - client DELETE DENIED (assertFails) — Tampering guard
  - cross-tenant admin CANNOT read (assertFails) — sameTenant() guard (T-05-CROSS)
- `RUN_RULES = Boolean(process.env.FIRESTORE_EMULATOR_HOST)` gate preserved — offline `npm test` skips cleanly.

## Deviations from Plan

None — plan executed exactly as written.

## Threat Mitigations Shipped

| Threat ID | Mitigation Status |
|-----------|-------------------|
| T-05-UNRULED | MITIGATED — all 3 new collections have deny-by-default rules + CI test enumeration in same plan |
| T-05-TAMPER | MITIGATED — `create/update/delete: if false` for all 3 collections; per-collection assertFails in CI |
| T-05-CROSS | MITIGATED — `sameTenant()` predicate on every read; cross-tenant assertFails test per collection |
| T-05-PII | MITIGATED — UsageEventDoc has no content fields (schema-level enforcement); ErasureRequestDoc stores subjectIdHash only |

## Known Stubs

None that affect plan goals.

**Flagged for downstream plans:**
1. `resolveStall` in `app/[lang]/(coach)/dashboard/actions.ts:84` sets `status: 'resolved'` but NOT `resolvedAt` — must be updated in 05-04 (usage pipeline) or a dedicated fix when resolution-time analytics are wired.
2. 90d TTL for `usageEvents` is proposed (comment only) — confirm with Derek before enforcing via a TTL policy.

## Threat Flags

No new threat surface beyond the plan's threat model. All new collections are server-only (Admin SDK bypasses rules — server code is responsible for its own gating, noted in ErasureRequestDoc/UsageEventDoc doc comments).

## Self-Check: PASSED

All 4 modified files found on disk. All 3 task commits verified in git log:
- `e2cff04` — Task 1: 3 typed collections + converters + refs + resolvedAt
- `b5c6046` — Task 2: deny-by-default rules + usageEvents composite index
- `d5d8237` — Task 3: rules.test.ts extended 16→19 collections
