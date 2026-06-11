---
phase: 07-console-ia-v2-net-new-surfaces
plan: 04
subsystem: ui
tags: [server-actions, firestore, conversation-flags, coach-queue, next-intl, alert-dialog, rsc, wave-2]

# Dependency graph
requires:
  - phase: 07-02
    provides: "conversationFlagsRef() + ConversationFlagDoc (content-free, denormalized seniorCoachId) + deny-by-default rules + (seniorCoachId,status)/(status,createdAt) composite indexes"
  - phase: 07-01
    provides: "Wave-0 conversationFlags rules matrices (coach own-downline / cross-coach DENY / read-only DENY / client-write DENY) — GREEN via 07-02"
provides:
  - "flagConversation Server Action — content-free, denormalized, audited flag write (coach own-downline + admin; manual only; D-09/D-10/D-11)"
  - "listFlags / reviewFlag / dismissFlag Server Actions — bounded scoped queue read + audited status transitions; read-only DENIED (D-24)"
  - "(coach)/flags queue surface (S4) — table + status Badges + review/dismiss + AlertDialog confirm; deep-links to the existing audited viewer (D-10)"
  - "Content-free 'Flag conversation' button + reason Dialog on the existing admin conversation-viewer"
  - "Trilingual flagQueue.* next-intl namespace (en/ms/zh) — i18n parity preserved"
affects:
  - "07-05 (audit-log viewer surfaces the flag-conversation / flag-review / flag-dismiss audit rows)"
  - "07-06 (8-item nav — flags nav entry copy already seeded as flagQueue.navLabel)"

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Coach-or-admin Server Action gate with WRITE-TIME own-downline assertion (resolve conversation.ownerUid → agentProfiles.seniorCoachId → assert == coach uid)"
    - "Denormalized seniorCoachId stamped at flag-write so the coach read-rule matches (Pitfall D, mirrors escalations/replyEdits)"
    - "Content-free triage marker: a flag stores a conversationId REFERENCE only; the deep-link to the existing audited viewer is the single content surface (D-10)"
    - "Role-scoped bounded queue read (admin-all / coach own-downline) via the 07-02 composite indexes; limit(50), never fetch-all"
    - "requireRole allow-list EXCLUDES read-only on a (coach)-group surface (D-24)"

key-files:
  created:
    - "app/[lang]/(coach)/flags/actions.ts"
    - "app/[lang]/(coach)/flags/page.tsx"
    - "app/[lang]/(coach)/flags/flag-queue.tsx"
  modified:
    - "app/[lang]/(admin)/conversations/actions.ts"
    - "app/[lang]/(admin)/conversations/conversation-viewer.tsx"
    - "src/i18n/messages/en.json"
    - "src/i18n/messages/ms.json"
    - "src/i18n/messages/zh.json"

key-decisions:
  - "flagConversation lives in (admin)/conversations/actions.ts (the flag originates from the admin viewer) but is coach-or-admin gated so a coach can flag an own-downline conversation; own-downline is enforced at write time, never widening read access to content."
  - "When the owning agent has no assigned senior coach, seniorCoachId is stamped as '' — an admin can still flag (admins bypass the own-downline assert); no coach can ever match '' to their uid, so the flag stays admin-visible only."
  - "Added the trilingual flagQueue.* namespace to all three catalogs NOW (not deferred to 07-06) — the i18n-parity test is a REAL GREEN gate; using keys without catalog entries would break parity and the production build. 07-06 still owns the nav wiring."

patterns-established:
  - "Write-time own-downline assertion for a coach-initiated write (distinct from the read-time downline filter used elsewhere)."
  - "Reversible sensitive action → neutral-primary AlertDialog confirm (never destructive red, never bare confirm())."

requirements-completed: [FLAG-02, FLAG-03]

# Metrics
duration: 14min
completed: 2026-06-11
---

# Phase 7 Plan 04: Conversation Flagged Queue Summary

**A content-free `flagConversation` write (coach own-downline + admin, write-time downline assertion, denormalized seniorCoachId, audited) plus a bounded role-scoped `(coach)/flags` queue (review/dismiss with neutral-primary AlertDialog confirm) that deep-links to the existing audited viewer — no conversation content ever touches a flag (D-10).**

## Performance

- **Duration:** ~14 min
- **Started:** 2026-06-11T14:18:00Z
- **Completed:** 2026-06-11T14:32:00Z
- **Tasks:** 2
- **Files modified:** 8 (3 created, 5 modified)

## Accomplishments
- `flagConversation(conversationId, reason)` — coach-or-admin gate; resolves the conversation's `ownerUid`, looks up `agentProfiles/{ownerUid}.seniorCoachId`, asserts own-downline for a coach (admin may flag any), stamps the denormalized `seniorCoachId`, and writes a `conversationFlagsRef()` doc with status `'open'` and a `conversationId` REFERENCE only (no message content, D-10). Audited via `audit.log` (hashes only).
- `listFlags` (admin-all / coach own-downline, `limit(50)`, status filter + `createdAt` cursor, uses the 07-02 composite indexes), `reviewFlag`, `dismissFlag` (audited status transitions). read-only never admitted (D-24).
- `(coach)/flags/page.tsx` (RSC) gated via `requireRole(['admin','senior-coach'])` — read-only EXCLUDED; `flag-queue.tsx` client island renders status `Badge` variants (open=default, reviewed=secondary, dismissed=outline+muted), Mark-reviewed / Dismiss row actions, a neutral-primary "Dismiss flag?" `AlertDialog`, `Empty` + `Skeleton` states, and `sonner` toasts; each row deep-links to `/{lang}/conversations?cid={conversationId}` (the existing audited viewer).
- A content-free "Flag conversation" button + reason `Dialog` added to the existing admin `conversation-viewer.tsx` — sends only `conversationId` + reason.
- Trilingual `flagQueue.*` namespace added to en/ms/zh; i18n parity stays GREEN.

## Task Commits

1. **Task 1: flagConversation write + listFlags/reviewFlag/dismissFlag (FLAG-02, FLAG-03)** — `3198ab4` (feat)
2. **Task 2: Flagged-queue page/island + admin-viewer flag button (FLAG-03, FLAG-02)** — `c95c8b0` (feat)

## Files Created/Modified
- `app/[lang]/(admin)/conversations/actions.ts` — added `flagConversation` (content-free, denormalized, write-time own-downline assert, audited).
- `app/[lang]/(coach)/flags/actions.ts` — `listFlags` (bounded scoped read), `reviewFlag`, `dismissFlag` (audited transitions).
- `app/[lang]/(coach)/flags/page.tsx` — RSC queue shell; `requireRole(['admin','senior-coach'])`, read-only DENIED.
- `app/[lang]/(coach)/flags/flag-queue.tsx` — client queue island (table, status Badges, review/dismiss, AlertDialog, Empty/Skeleton, deep-link).
- `app/[lang]/(admin)/conversations/conversation-viewer.tsx` — "Flag conversation" button + reason Dialog (content-free).
- `src/i18n/messages/{en,ms,zh}.json` — trilingual `flagQueue.*` namespace.

## Decisions Made
- **flagConversation placement / gate split:** the action lives on the admin conversations module (where the flag originates) but is coach-or-admin gated; own-downline is enforced at write time so a coach can flag a downline conversation without ever gaining read access to its content.
- **Unassigned-coach case:** `seniorCoachId` falls back to `''` when the owning agent has no assigned coach. Admins still flag (they bypass the assert); no coach uid can equal `''`, so the flag remains admin-only-visible — consistent with the coach read-rule.
- **i18n now, not 07-06:** the `flagQueue.*` keys were added to all three catalogs in this plan because the `i18n-parity` test is a live GREEN gate and `next-intl` resolves missing keys at build/render. 07-06 still owns the nav-item wiring.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Converter type requires explicit `tenantId` on `.add()`**
- **Found during:** Task 1 (first `npx tsc --noEmit`)
- **Issue:** `conversationFlagsRef().add({...})` failed typecheck — `WithFieldValue<ConversationFlagDoc>` requires `tenantId` even though the `makeConverter` `toFirestore` stamps it.
- **Fix:** Pass `tenantId: TENANT_ID` explicitly in the write (idempotent with the converter stamp), exactly as the established `cohorts/actions.ts:92` analog does.
- **Files modified:** `app/[lang]/(admin)/conversations/actions.ts`
- **Verification:** `npx tsc --noEmit` clean for the file; `npx next build` TypeScript phase passes.
- **Committed in:** `3198ab4` (Task 1 commit)

**2. [Rule 3 - Blocking] `next build --no-lint` flag removed in Next.js 16**
- **Found during:** Task 2 (verify command)
- **Issue:** The plan's verify used `npx next build --no-lint`; Next.js 16 rejects `--no-lint` as an unknown option (AGENTS.md: this is not the Next.js in training data).
- **Fix:** Ran plain `npx next build` — compiled successfully, registered the `/[lang]/flags` route, generated 54/54 static pages.
- **Files modified:** none (tooling-only).
- **Verification:** Build exited successfully with `/[lang]/flags` in the route table.
- **Committed in:** n/a (no file change).

---

**Total deviations:** 2 auto-fixed (both Rule 3 — blocking).
**Impact on plan:** Both were required to complete the planned verification. No behavioral change, no scope creep.

## Issues Encountered
None beyond the two blocking items above.

## Threat Coverage Realized

| Threat | Realized by |
|--------|-------------|
| T-07-12 (content leaks onto a flag) | `flagConversation` writes a `conversationId` reference only; no content field exists on `ConversationFlagDoc`; queue rows render the id, never content. |
| T-07-13 (cross-coach flag read) | `listFlags` filters `seniorCoachId == user.uid` for a coach (app gate 1); 07-02 rule is gate 2. |
| T-07-14 (read-only reaching the queue) | `requireRole` allow-list excludes `'read-only'`; every action's gate is coach-or-admin only. |
| T-07-15 (client forges a flag) | All writes go through the Admin-SDK `conversationFlagsRef()`; client writes are DENIED in firestore.rules (07-02). |
| T-07-16 (coach flags a non-downline conversation) | Write-time assertion: owning-agent `seniorCoachId` must equal the verified coach uid. |
| T-07-SC (package installs) | accept — no new packages added this plan. |

## Known Stubs
None. All actions are wired to live Firestore via the Admin SDK; the surface renders real scoped data. The `listFlags` scoped/filtered query depends on the 07-02 composite indexes being live (built at the rollout deploy checkpoint) — until then Firestore throws `FAILED_PRECONDITION` (Pitfall 6), surfaced gracefully via the queue's error toast.

## Verification
- `npx tsc --noEmit` — clean for all plan files; only the two documented pre-existing Wave-0 RED stubs (`(admin)/audit-log/actions.test.ts`, `(admin)/model-config/actions.test.ts` — land in 07-05) remain unresolved.
- `npx next build` — compiled successfully; `/[lang]/flags` route registered; TypeScript phase passed; 54/54 static pages generated.
- `npx vitest run` (conversations ADMIN-02 + ci-guards + i18n-parity) — 16/16 GREEN. No regressions.
- No send/connect/WhatsApp/auto-reply affordance in any new or modified file (constraint scan clean — only a documenting comment).

## Next Phase Readiness
- FLAG-02 / FLAG-03 realized. 07-05 (audit-log viewer) can surface the `flag-conversation` / `flag-review` / `flag-dismiss` audit rows. 07-06 can wire the `flags` nav entry (copy already seeded as `flagQueue.navLabel`).
- Live-gated: the 07-02 `conversationFlags` composite indexes must finish building at the rollout deploy checkpoint before the scoped/filtered `listFlags` query runs in production.

## Self-Check: PASSED

- All 3 created files verified present on disk (`(coach)/flags/actions.ts`, `page.tsx`, `flag-queue.tsx`).
- Both task commits verified in git history (`3198ab4`, `c95c8b0`).

---
*Phase: 07-console-ia-v2-net-new-surfaces*
*Completed: 2026-06-11*
