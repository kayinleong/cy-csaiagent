---
status: testing
phase: 07-console-ia-v2-net-new-surfaces
source: [07-VERIFICATION.md]
started: 2026-06-11T15:05:00Z
updated: 2026-06-11T15:05:00Z
---

## Current Test

number: 1
name: Deploy Firestore rules + indexes and confirm composite index build (07-02 live-gate)
expected: |
  firebase deploy --only firestore:rules,firestore:indexes completes; all 4 new composite indexes
  (conversationFlags seniorCoachId,status; conversationFlags status,createdAt; auditLogs action,ts;
  auditLogs actorUid,ts) reach status Enabled in the Firebase console.
awaiting: user response

## Tests

### 1. Deploy Firestore rules + indexes (07-02 live-gate)
expected: `firebase deploy --only firestore:rules,firestore:indexes` completes; the 4 new composite indexes (conversationFlags ×2, auditLogs ×2) reach "Enabled" in the Firebase console; deployed rules include the cohorts + conversationFlags blocks. (Code correct — 171/171 emulator rules tests GREEN locally.)
result: [pending]

### 2. Remote Config publish IAM + end-to-end model swap (07-05 live-gate)
expected: App Hosting service account has `firebaseremoteconfig.remoteConfig.update`; publishing a `model.coach.default` change via the admin UI is reflected in `modelFor('coach')` on the next chat turn. (Publish path unit-tested — 6/6 MODEL-02 GREEN, ci-guard 4 no-{force} GREEN.)
result: [pending]

### 3. BM / 中文 native sign-off on the 8 surfaces' copy
expected: A native BM speaker and a native Mandarin speaker review the machine-assisted catalog translations (flagged `_note`/`_review` in ms.json and zh.json) and approve the copy. (Parity enforced — i18n-parity.test.ts 6/6 GREEN.)
result: [pending]

### 4. Browser: read-only role denied on all 8 Phase-7 surfaces
expected: A read-only user browsing to /[lang]/{cohorts,coach-assignment,agents,agents/[uid],flags,audit-log,model-config,pdpa-settings} is redirected (not shown the surface, not a 404), and the sidebar shows none of the 8 nav items.
result: [pending]

### 5. Browser: senior-coach scope enforcement
expected: A senior-coach sees only agentProfiles + flags nav entries (not cohorts/coachAssignment/auditLog/modelConfig/pdpaSettings/daysToFirstClose); an out-of-downline agents/[uid] is denied; the flag queue shows only own-downline flags.
result: [pending]

### 6. Admin end-to-end: publish model-config + ETag conflict
expected: Admin at /[lang]/model-config changes a pillar model ID, confirms the neutral-primary publish dialog, and modelFor() returns the new ID after propagation; a stale-ETag concurrent publish surfaces the conflict error copy instead of a silent overwrite.
result: [pending]

## Summary

total: 6
passed: 0
issues: 0
pending: 6
skipped: 0
blocked: 0

## Gaps
