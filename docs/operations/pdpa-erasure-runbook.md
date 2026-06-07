# PDPA Erasure Runbook
## D2 Customer Service AI Agent Platform

**Legal basis:** Malaysia Personal Data Protection Act 2010 (PDPA) §35 — right to erasure.
**SLA:** < 72 hours from request to completion.
**Who can trigger:** Admin-role users only (three-layer gate enforced in code).

---

## Overview

When a data subject (agent or lead) invokes their right to be forgotten under PDPA, follow this runbook to process the erasure request. The platform enforces:

1. **Admin-only gate**: only users with the `admin` custom claim can trigger erasure.
2. **Type-to-confirm**: the admin must type the subject reference before the destructive action enables.
3. **<72h SLA**: tracked on the `erasureRequests` Firestore document.
4. **Audit survives**: the `auditLogs` collection is EXEMPT from erasure — it contains only hashes (no PII) and is the legal record that erasure occurred.
5. **Anthropic cross-border note**: pseudonymized conversation tokens sent to Anthropic's API may be retained by Anthropic for ~30 days (their default API retention). This data is pseudonymized (no raw PII), so erasure of the canonical Firestore record is the PDPA remedy. See the PDPA-TIA for the full cross-border transfer assessment.

---

## Step 1: Receive the Erasure Request

A data subject contacts D2 requesting erasure of their personal data. Gather:
- Subject type: **agent** (a D2 agent/employee) or **lead** (a property lead/prospect)
- Subject identifier: the agent's Firebase UID (for agents) or the lead ID in the system (for leads)

Do NOT transmit the subject identifier over email/Slack in plaintext — use an internal secure channel.

---

## Step 2: Create a Backup

Before triggering any erasure, create a Firestore export:
```bash
gcloud firestore export gs://<BUCKET_NAME>-backups/exports/erasure-$(date +%Y-%m-%d)/
```
See `backup-restore-runbook.md` for the full export procedure.

---

## Step 3: Trigger the Erasure via the Admin UI

1. Log in to the platform as an admin: `<APP_HOSTING_URL>/<lang>/erasure`
2. **Stage A: Subject selection**
   - Select subject type: Agent or Lead
   - Enter the subject identifier
   - Review the blast-radius preview (per-collection doc counts shown)
3. **Stage B: Type-to-confirm gate**
   - Click "Erase…" to open the confirmation dialog
   - Read the irreversibility notice (shown in EN/BM/中文)
   - Type the exact subject reference shown in the dialog
   - The "Confirm Erasure" button enables only when the typed text matches exactly
4. Click "Confirm Erasure"

The system:
- Creates an `erasureRequests/{reqId}` doc with `status: 'pending'`, `slaDeadline: now+72h`
- Runs a synchronous best-effort deletion pass (conversations, leads, leadContext, replyEdits, escalations, knowledgeGaps, agentProfiles, rateBudgets, users)
- Writes an `action:'erasure'` event to `auditLogs` (hashes only — the compliance record)
- If anything remains: marks the request `sweeping` for the lazy-cron to finish

---

## Step 4: Monitor Completion

Check the erasure status list at `<APP_HOSTING_URL>/<lang>/erasure` (scroll to the status panel below the form):

| Status | Meaning |
|--------|---------|
| `pending` | Initial synchronous pass queued; sweep not yet run |
| `sweeping` | Lazy-cron erasure-sweep job is finishing remaining batches (runs every 1 hour) |
| `complete` | All PII collections reached 0 docs; `completedAt` timestamp recorded |
| `failed` | An error occurred; see `error` field on the request doc in Firestore |

The lazy-cron `erasure-sweep` runs every time an authorized user visits the platform (up to once per hour). If no one visits within 1 hour: log in as admin to trigger it.

**SLA check:** If status is not `complete` within 48 hours of the request, escalate to the engineering lead immediately (buffer before the 72h deadline).

---

## Step 5: Verify Completion

When status is `complete`:

1. **Spot-check in Firebase Console:**
   - Search `conversations` for docs with `ownerUid == <agentUid>` or `leadId == <leadId>` — should return 0
   - Search `users` for `<agentUid>` — should return 0
   - Search `leads` for `<leadId>` — should return 0

2. **Verify audit survival:**
   - Search `auditLogs` for `targetRef` containing the `erasureRequests/{reqId}` — should return the erasure event (action='erasure', hashes only)
   - This is EXPECTED and correct — auditLogs is the compliance record

3. **Record the verification:**
   - Note the `completedAt` timestamp from the `erasureRequests` doc
   - Confirm `completedAt < requestedAt + 72h` (SLA met)

---

## Step 6: Communicate Completion

Notify Derek and, if required by D2's privacy policy, notify the data subject that their right-to-erasure request has been fulfilled. Include:
- Date of request
- Date of completion
- Confirmation that data has been removed from the system
- Note about the cross-border Anthropic retention (pseudonymized, ~30 days, out of erasure scope)

---

## What the Erasure Covers

| Collection | Agent erasure | Lead erasure |
|-----------|--------------|-------------|
| `conversations` + `messages` (subcollection) | Deleted (keyed by ownerUid) | Deleted (keyed by leadId) |
| `leads` | Deleted (keyed by ownerUid) | Deleted (by docId) |
| `leadContext` | Deleted (via agent's lead IDs) | Deleted (by docId) |
| `replyEdits` | Deleted (keyed by agentUid) | Deleted (keyed by leadId) |
| `escalations` | Deleted (keyed by agentUid) | Not applicable |
| `knowledgeGaps` | Deleted (keyed by agentUid) | Not applicable |
| `agentProfiles` | Deleted (docId = agentUid) | Not applicable |
| `rateBudgets` | Deleted (docId = agentUid) | Not applicable |
| `users` | Deleted (docId = agentUid) | Not applicable |

**EXEMPT (not deleted — by design):**
- `auditLogs`: hashes-only, the legal compliance record. An `action:'erasure'` event is ADDED (not deleted).
- `usageEvents` / `usageRollups`: counts-only, no subject PII — not in scope for PDPA erasure.
- `erasureRequests`: the ledger doc itself survives as the process record (subjectIdHash only — no raw ID).

**Storage note (A1):** Per-agent voice samples, if any exist, are currently stored as Firestore strings (not Cloud Storage objects) at pilot time. If voice samples move to Cloud Storage before sign-off, the Storage erasure path must be wired. Confirm with Derek.

---

## What Is NOT Within the Erasure Scope

- **Anthropic cross-border cache (~30 days):** Conversation prompts sent to Anthropic's API are pseudonymized before sending (no raw PII crosses the border). Anthropic may retain API inputs for ~30 days. This is documented in the PDPA Transfer Impact Assessment (TIA). Erasure of the canonical Firestore record is the PDPA remedy; the pseudonymized tokens have negligible re-identification risk without the server-side mapping.

- **Firebase Auth user record:** The `users/{uid}` Firestore doc is erased. The Firebase Auth account itself (the login record) should also be deleted via the Firebase Console → Authentication → Users (manual step; requires Firebase admin access — not automated by the platform's Server Action in v1).

---

## Coverage Test (for Engineering)

The PDPA erasure coverage is proven by the automated test at `src/pdpa/coverage.test.ts` (emulator-gated). This test:
- Seeds a synthetic agent and lead into every PII collection
- Runs `eraseDataSubject` for each
- Asserts every PII collection reaches 0 docs
- Asserts `auditLogs` SURVIVES (with the erasure event)

Run with: `firebase emulators:exec "npx vitest run src/pdpa"`
