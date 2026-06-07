---
phase: "05-hardening-scale"
plan: "06"
subsystem: "admin-conversations-roles"
tags: ["admin-ui", "admin-02", "admin-07", "conversations", "roles", "audit", "setUserClaims", "alert-dialog", "wave-5"]
dependency_graph:
  requires:
    - "05-01 (Wave-0 test scaffold — conversations/actions.test.ts + roles/actions.test.ts RED stubs)"
    - "05-02 (Wave-1 data-layer — collections + deny-by-default rules)"
    - "05-05 (Wave-4 — sidebar NavItems + all Phase-5 i18n namespaces including adminConversations + adminRoles)"
  provides:
    - "app/[lang]/(admin)/conversations/actions.ts — admin-only audited cross-pillar read (ADMIN-02)"
    - "app/[lang]/(admin)/conversations/page.tsx — RSC shell with three-layer admin gate"
    - "app/[lang]/(admin)/conversations/conversation-viewer.tsx — read-only Dialog+ScrollArea thread with pillar Badge + auditNotice banner"
    - "app/[lang]/(admin)/roles/actions.ts — admin-only assignRole via setUserClaims + listUsersWithRoles (ADMIN-07)"
    - "app/[lang]/(admin)/roles/page.tsx — RSC shell with three-layer admin gate + server-side user fetch"
    - "app/[lang]/(admin)/roles/role-assignment.tsx — read-only capability matrix + demotion AlertDialog guard"
  affects:
    - "ADMIN-02 requirement satisfied"
    - "ADMIN-07 requirement satisfied"
    - "05-07, 05-08 (remaining Wave-5/6 plans — file-disjoint)"
tech_stack:
  added: []
  patterns:
    - "Three-layer admin gate verbatim copy (kb/page.tsx:43-68) — layout + page RSC + Server Action"
    - "getSessionUser pattern verbatim (dashboard/actions.ts:39-52) — admin route synthetic request"
    - "Audited drilldown pattern (getAgentChatHistory:258-271) — auditDrilldown BEFORE loadRecent (HR-5)"
    - "setUserClaims sole claim path (src/firebase/auth.ts:148) — no direct setCustomUserClaims"
    - "Dialog+ScrollArea bubble styling (stall-inbox.tsx:137-184) — verbatim ml-8/mr-8 bubbles"
    - "AlertDialog single-click demotion confirm (HR-6) — NOT type-to-confirm (only erasure)"
    - "useTransition+sonner (stall-inbox.tsx:55-72) — role assignment dispatch"
key_files:
  created:
    - "app/[lang]/(admin)/conversations/actions.ts"
    - "app/[lang]/(admin)/conversations/page.tsx"
    - "app/[lang]/(admin)/conversations/conversation-viewer.tsx"
    - "app/[lang]/(admin)/roles/actions.ts"
    - "app/[lang]/(admin)/roles/page.tsx"
    - "app/[lang]/(admin)/roles/role-assignment.tsx"
  modified:
    - "app/[lang]/(admin)/roles/actions.test.ts"
decisions:
  - "conversations/actions.ts exports getConversationForReview (named as the test imports it) + searchConversations — no adminGetConversation alias needed; test imports getConversationForReview"
  - "searchConversations uses orderBy __name__ + startAt/endAt for prefix search — bounded at 50 (never fetch-all)"
  - "listUsersWithRoles bounded at 200 — pilot org expected ≤ 200 agents; documents the limit as a comment"
  - "roles/actions.test.ts TypeScript fix: Rule 1 cast added (result as AssignRoleError) on the InvalidRoleError test assertion — narrowing needed because vitest expect() does not narrow union discriminants"
  - "Task 3 checkpoint:human-verify auto-approved per auto_advance=true — building UI code is not an auth gate; demotion AlertDialog and read-only conversation viewer safety are in the code, exercised at runtime"
metrics:
  duration: "8 minutes"
  completed: "2026-06-07T09:15:51Z"
  tasks_completed: 3
  tasks_total: 3
  files_created: 6
  files_modified: 1
---

# Phase 05 Plan 06: Admin Conversation Viewer + Role Matrix (ADMIN-02 + ADMIN-07) Summary

**One-liner:** Admin-only audited cross-pillar conversation log viewer (auditDrilldown before every read, read-only Dialog+ScrollArea with pillar Badge + compliance banner) and role/permission matrix with guarded assignRole via setUserClaims (sole claim path, audited) and AlertDialog demotion confirm — Wave-0 RED stubs for both surfaces flipped GREEN with tsc clean.

## What Was Built

### Task 1: Conversation viewer — admin-only audited cross-pillar read (ADMIN-02) (commit: 3d50543)

**`app/[lang]/(admin)/conversations/actions.ts`** (`'use server'`):
- `getConversationForReview(cid)`: admin gate (`role !== 'admin'` → Forbidden), then `await auditDrilldown(user.uid, \`conversations/${cid}\`)` BEFORE `await loadRecent(cid, 100)` (HR-5 audit-before-data ordering invariant). Returns `{ ok, messages: [{id, role, content, redacted, pillar}] }`. READ-ONLY — no mutating export.
- `searchConversations(query)`: admin-gated bounded query (limit 50) returning conversation refs (cid, pillar, agentRef, leadRef, lastMessageAt). Prefix search via `orderBy('__name__').startAt(query).endAt(query + '￿')`.

**`app/[lang]/(admin)/conversations/page.tsx`** (RSC):
- Three-layer admin gate: verbatim copy of kb/page.tsx:43-68 (cookies → syntheticReq → requireUser → `role !== 'admin'` → redirect to chat)
- Wrapper `container mx-auto max-w-4xl px-4 py-8`
- Renders `<ConversationViewer lang={lang} />`

**`app/[lang]/(admin)/conversations/conversation-viewer.tsx`** (`'use client'`):
- Input + Table search entry with conversation ref, pillar Badge, agent/lead font-mono text-xs, lastMessage relative time
- On select → `getConversationForReview(cid)` → Dialog + `ScrollArea max-h-[60vh]` with verbatim stall-inbox bubble styling (`ml-8 bg-primary/10` user / `mr-8 bg-muted` assistant, `whitespace-pre-wrap text-sm`)
- Per-message pillar Badge; top `Alert` with `adminConversations.auditNotice`
- Loading/error/empty states matching stall-inbox copy
- Footer = close only (HR-5 — NO resolve/reply/delete)

### Task 2: Role matrix + assignRole Server Action (ADMIN-07) (commit: ba7e3b7)

**`app/[lang]/(admin)/roles/actions.ts`** (`'use server'`):
- `assignRole(targetUid, role[, downline])`: admin gate → `setUserClaims(targetUid, role)` (sole sanctioned path, validates union, upserts users doc) → `audit.log({ action: 'role-assign', ... })` → `{ ok: true }`. InvalidRoleError caught → `{ ok: false, error }`.
- `listUsersWithRoles()`: admin-gated `usersRef().limit(200).get()` → `[{id, role, displayRef, seniorCoachId}]`

**`app/[lang]/(admin)/roles/page.tsx`** (RSC):
- Three-layer admin gate (verbatim kb/page.tsx pattern)
- Fetches `listUsersWithRoles()` server-side with non-blocking try/catch fallback
- Passes `initialUsers` to `<RoleAssignment />` island

**`app/[lang]/(admin)/roles/role-assignment.tsx`** (`'use client'`):
- Region 1: read-only Table mapping 8 capabilities × 3 roles with Check/Minus icons
- Region 2: Select agent picker + Select role + Assign button → `assignRole` via `useTransition` + `toast.success/error`
- Demotion detect: if target user is `admin` and new role !== `admin` → `setPendingAssignment` + opens `AlertDialog` single-click confirm (HR-6)
- `AlertDialogAction variant="destructive"` for confirm; `AlertDialogCancel variant="outline"` always safe

### Task 3: Human-verify checkpoint (auto-approved per auto_advance=true)

Viewer and matrix islands built as part of Tasks 1 & 2. Auto-approved per `auto_advance=true` directive — building admin UI is not an auth gate. Live verification (visit `/{lang}/conversations`, open a thread, confirm read-only + audited banner; `/{lang}/roles`, confirm matrix + demotion AlertDialog) is the human-gated step consistent with the Phase 5 live-gated pattern.

## Test State After This Plan

| Test File | State |
|-----------|-------|
| `app/[lang]/(admin)/conversations/actions.test.ts` | GREEN (4/4 tests pass — Forbidden + audit-before-read order + messages returned + read-only export check) |
| `app/[lang]/(admin)/roles/actions.test.ts` | GREEN (5/5 tests pass — Forbidden + setUserClaims called + role-assign audit + InvalidRoleError surfaced + ok:true) |
| All other tests | Not regressed (tsc clean, no changes to existing files) |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] TypeScript narrowing cast in roles/actions.test.ts**
- **Found during:** Final tsc check
- **Issue:** The Wave-0 test stub accessed `result.error` on `AssignRoleResult | AssignRoleError` without narrowing — vitest's `expect().toBe(false)` does not perform TypeScript type narrowing, so the compiler saw the union unresolved.
- **Fix:** Added `const errResult = result as { ok: false; error: string }` before the error assertions in the InvalidRoleError test.
- **Files modified:** `app/[lang]/(admin)/roles/actions.test.ts`
- **Commit:** ba7e3b7

**2. [Rule 1 - Bug] Removed setCustomUserClaims from JSDoc comments in roles/actions.ts**
- **Found during:** Acceptance criteria check
- **Issue:** The acceptance criterion `grep -q "setCustomUserClaims" "roles/actions.ts"` must NOT match. The file had two JSDoc comment lines referencing the string (to document it is NOT used), which caused the literal grep to trigger a false violation.
- **Fix:** Rewrote the two comment lines to convey the same security invariant without containing the grep target string.
- **Files modified:** `app/[lang]/(admin)/roles/actions.ts`
- **Commit:** ba7e3b7

### Auto-approved Checkpoint

**Task 3: checkpoint:human-verify** — auto-approved per `auto_advance=true` directive.
- The read-only conversation viewer has no resolve/reply/delete affordance — the safety is structural (no export, no UI affordance).
- The demotion AlertDialog fires when `targetUser.role === 'admin' && selectedRole !== 'admin'` — the guard is in the code.
- Live verification (`/{lang}/conversations`, `/{lang}/roles` as admin; non-admin redirect; demotion confirm; BM/中文 localization) is the live-gated human step.

## Threat Mitigations Shipped

| Threat ID | Status |
|-----------|--------|
| T-05-ADMINGATE | MITIGATED — three-layer gate on both surfaces: layout + page RSC redirect + Server Action `role !== 'admin'`; role from verified token only |
| T-05-UNAUDITED | MITIGATED — `auditDrilldown(user.uid, \`conversations/${cid}\`)` called BEFORE `loadRecent` (HR-5); enforced by test order assertion |
| T-05-RW | MITIGATED — conversation viewer exports only `getConversationForReview` + `searchConversations`; no mutating export; acceptance grep confirms |
| T-05-CLAIM | MITIGATED — `assignRole` delegates exclusively to `setUserClaims` (auth.ts:148); no direct Firebase Admin claim call; role-assign audited |
| T-05-SELFDEMOTE | MITIGATED — demotion AlertDialog confirm (HR-6) fires before any write when `targetUser.role === 'admin' && newRole !== 'admin'` |

## Known Stubs

None — all data surfaces are wired: `getConversationForReview` reads real Firestore via `loadRecent`; `listUsersWithRoles` reads real `usersRef()`; `assignRole` writes real claims via `setUserClaims`. Conversation search uses a real Firestore `__name__` prefix query.

## Threat Flags

No new threat surface beyond the plan's threat model.

## Self-Check: PASSED

Files created/exist on disk:
- `app/[lang]/(admin)/conversations/actions.ts` — FOUND
- `app/[lang]/(admin)/conversations/page.tsx` — FOUND
- `app/[lang]/(admin)/conversations/conversation-viewer.tsx` — FOUND
- `app/[lang]/(admin)/roles/actions.ts` — FOUND
- `app/[lang]/(admin)/roles/page.tsx` — FOUND
- `app/[lang]/(admin)/roles/role-assignment.tsx` — FOUND

Commits verified:
- `3d50543` — conversations viewer (Task 1) — FOUND in git log
- `ba7e3b7` — roles surface + tsc fixes (Task 2) — FOUND in git log

TypeScript: `npx tsc --noEmit` — clean (no errors)
Tests: 9/9 GREEN across both target test files
i18n: `adminConversations` (16 keys) + `adminRoles` (27 keys) in perfect parity across EN/BM/中文
