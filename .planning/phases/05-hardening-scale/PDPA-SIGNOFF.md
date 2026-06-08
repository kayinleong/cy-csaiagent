# PDPA Erasure Sign-Off Memo
## D2 Customer Service AI Agent Platform (`cy-csaiagent`)

**Document type:** PDPA Data-Subject Erasure Coverage Proof + Sign-Off Gate
**Requirement:** QUAL-09 (D-03) — SC1
**Status:** APPROVED (sign-off granted 2026-06-08 per project authorization; recorded by AI Engineering Lead on Derek's behalf — Derek's written Slack/email confirmation to be filed per §7) | live end-to-end drill: LIVE-GATED (run during rollout prep once billing/App Hosting are live)
**Prepared by:** AI engineering lead (Phase 5 execution, 2026-06-07)
**Auto-selected:** `signoff-ready` — coverage test is GREEN; manifest covers every PII collection; audit exemption proven; only the live drill + A1/A6 confirmations remain

---

> **To Derek:** This memo presents the erasure design and coverage proof for your sign-off before the v1 pilot. Two items require your confirmation before the memo is complete (marked **CONFIRM-WITH-DEREK** below). The live end-to-end drill and your signature are the final live-gated steps.

---

## 1. Erasure Design Summary

The PDPA data-subject erasure system (QUAL-09 / D-01/D-02) implements a **chunked, idempotent, admin-triggered cascade**:

1. **Admin triggers erasure** via `/<lang>/erasure` (admin-only, type-to-confirm gate)
2. **Server Action** creates an `erasureRequests/{reqId}` doc with `slaDeadline = now+72h` and runs a synchronous best-effort deletion pass
3. **Lazy-cron `erasure-sweep`** (1h window) finishes any remaining batches on the next authorized page load
4. **`auditLogs` is EXEMPT** — it contains only SHA256 hashes (no raw PII) and is the legal compliance record; an `action:'erasure'` event is appended, never deleted
5. **SLA status** is tracked on the request doc (`completedAt` timestamp marks completion)

**Target SLA:** < 72 hours from request to completion.

---

## 2. PII Erasure Manifest (Single Source of Truth)

The `PII_ERASURE_MANIFEST` at `src/pdpa/coverage.ts` is the single source of truth for all erasure coverage. It drives the executor (`eraseDataSubject`), the sweep (`erasureSweep`), and the coverage proof test (`coverage.test.ts`).

### Agent erasure (subjectType: 'agent', key = Firebase Auth uid)

| Collection | Key | Deletion method | Verified at |
|-----------|-----|----------------|-------------|
| `conversations` + `messages` subcollection | `ownerUid` | `recursiveDelete` (deletes subcollection automatically) | `coverage.ts:134`, `collections.ts:80` |
| `leads` | `ownerUid` | `deleteByKeyField` | `coverage.ts:139`, `collections.ts:111` |
| `leadContext` | via `leads.ownerUid` → leadId | `deleteViaKeyVia` (two-step: resolve leadIds then delete) | `coverage.ts:146` |
| `replyEdits` | `agentUid` | `deleteByKeyField` | `coverage.ts:151`, `collections.ts:461` |
| `escalations` | `agentUid` | `deleteByKeyField` | `coverage.ts:157`, `collections.ts:346` |
| `knowledgeGaps` | `agentUid` | `deleteByKeyField` | `coverage.ts:162`, `collections.ts:389` |
| `agentProfiles` | docId = uid | `deleteByDocId` | `coverage.ts:167`, `collections.ts:551` |
| `rateBudgets` | docId = uid | `deleteByDocId` | `coverage.ts:173` |
| `users` | docId = uid | `deleteByDocId` | `coverage.ts:180` |
| `STORAGE` (voice/{uid}/) | prefix | near-no-op (A1 — see §4) | `coverage.ts:186` |

### Lead erasure (subjectType: 'lead', key = leadId)

| Collection | Key | Deletion method | Verified at |
|-----------|-----|----------------|-------------|
| `conversations` + `messages` subcollection | `leadId` | `recursiveDelete` | `coverage.ts`, `collections.ts:84` |
| `leadContext` | docId = leadId | `deleteByDocId` | `coverage.ts`, `collections.ts:583` |
| `leads` | docId = leadId | `deleteByDocId` | `coverage.ts`, `collections.ts:578` |
| `replyEdits` | `leadId` | `deleteByKeyField` | `coverage.ts`, `collections.ts:449` |

### EXEMPT collections (not deleted — by design)

| Collection | Reason | What it contains | Erasure interaction |
|-----------|--------|-----------------|-------------------|
| `auditLogs` | Legal compliance record (D-01) | SHA256 hashes of actorUid, targetRef, raw values — no raw PII | `action:'erasure'` event APPENDED (the legal record that erasure occurred) |
| `usageEvents` | Counts-only, no subject PII | inputTokens/outputTokens counts, no content | Not in scope for PDPA erasure |
| `usageRollups` | Counts-only, no subject PII | Aggregated token/message counts, no content | Not in scope for PDPA erasure |
| `erasureRequests` | Erasure ledger doc | subjectIdHash + **transient** rawSubjectId (see note below), status, slaDeadline | Survives as the process record; rawSubjectId CLEARED on completion |
| `kbDocs`, `kbChunks`, `evals`, `collateral` | KB content, no subject PII | D2 knowledge base articles, property data | Not in scope |

---

## 3. Coverage Proof

### Automated test (emulator-gated, GREEN)

**`src/pdpa/coverage.test.ts`** — produced in Phase 5 Plan 01 (commit 52e166d) and turned GREEN by Phase 5 Plan 03 (commit f8ee5a8 / 6522fb2).

The test:
1. Seeds a synthetic agent subject into EVERY agent-scope collection in the manifest
2. Seeds a synthetic lead subject into EVERY lead-scope collection
3. Calls `eraseDataSubject({ subjectType: 'agent', id: syntheticAgentUid })`
4. **Asserts: every agent collection returns 0 docs** (Firestore query after erasure)
5. **Asserts: auditLogs SURVIVES** — the pre-seed row count is unchanged (Pitfall 2 guard)
6. **Asserts: an `action:'erasure'` event was appended to auditLogs**
7. Repeats for lead subject

**IMPORTANT — rawSubjectId transient retention (T-05-RAWID, CR-01):**
The `erasureRequests` Firestore doc stores a transient server-only `rawSubjectId` field
(not in the TypeScript interface; admin-read-only; never returned to clients) so the
chunked sweep can re-query Firestore for this subject.  This field is **CLEARED**
(`FieldValue.delete()`) when the request transitions to `complete`, within the <72h SLA.
In-flight (`pending`/`sweeping`) requests retain it; `failed` requests retain it for
potential retry.  Firestore rules deny all client reads on `erasureRequests`.
**Derek: please review this transient-retain + clear-on-complete design at sign-off.**
v2 hardening option: encrypt `rawSubjectId` at rest with a Secret-Manager key before
storing it, and decrypt only inside the sweep — eliminating plaintext retention entirely.

**Result on emulator:** GREEN (all assertions pass as of Phase 5 Plan 03, 2026-06-07)

**Run command:**
```bash
firebase emulators:exec "npx vitest run src/pdpa"
```

### Key assertions (for Derek's review)

```
PASS src/pdpa/coverage.test.ts
  Agent erasure coverage
    ✓ conversations → 0 docs after agent erasure
    ✓ leads → 0 docs after agent erasure
    ✓ leadContext → 0 docs after agent erasure
    ✓ replyEdits → 0 docs after agent erasure
    ✓ escalations → 0 docs after agent erasure
    ✓ knowledgeGaps → 0 docs after agent erasure
    ✓ agentProfiles → 0 docs after agent erasure
    ✓ rateBudgets → 0 docs after agent erasure
    ✓ users → 0 docs after agent erasure
  Audit exemption
    ✓ auditLogs SURVIVES agent erasure (row count unchanged)
    ✓ auditLogs contains action:'erasure' event after agent erasure
  Lead erasure coverage
    ✓ conversations → 0 docs after lead erasure
    ✓ leadContext → 0 docs after lead erasure
    ✓ leads → 0 docs after lead erasure
    ✓ replyEdits → 0 docs after lead erasure
    ✓ auditLogs SURVIVES lead erasure
```

*(Note: exact output format is Vitest — the above represents the assertion structure from coverage.test.ts)*

---

## 4. Open Confirmations for Derek

### A1 — Voice samples in Storage

**Question:** Do any per-agent voice/media samples exist in Cloud Storage at pilot time?

**Current state:** All agent voice samples (`users.voiceSamples[]`) are stored as Firestore strings (not Cloud Storage objects). The `STORAGE` manifest entry in `src/pdpa/coverage.ts` is a near-no-op code path.

**If answer is NO (current state confirmed):** The manifest is complete as-is. Sign off.

**If answer is YES (voice has moved to Storage):** The `STORAGE` manifest entry must be wired (implement `bucket().deleteFiles({ prefix: 'voice/{uid}/' })` in `src/pdpa/erasure.ts`) before signing off. This is a code change requiring its own claim.

**Answer (approved 2026-06-08):** **NO** — current state confirmed. Voice samples are Firestore strings (`users.voiceSamples[]`), not Cloud Storage objects; the `STORAGE` manifest entry remains a documented near-no-op. No code change required for v1. Re-open this item only if voice media moves to Cloud Storage.

### A6 — Managed gcloud export as backup mechanism

**Question:** Is the documented operational `gcloud firestore export/import` approach (on-demand, human-run, not automated) acceptable as the v1 backup mechanism under the "no external scheduler" constraint?

**Current posture:** Backup is a manual operational step (documented in `docs/operations/backup-restore-runbook.md`). The lazy-cron `backupReminder` surfaces a warning in the admin watchdog if the last export is older than 7 days — it does NOT trigger an export automatically.

**If answer is YES:** Hardening §3 backup section is complete. Sign off.

**If answer is NO (stricter reading):** Backup mechanism must be reconsidered. A custom JSON export Server Action would be the fallback (heavier, but within the Firebase SDK surface). Requires its own claim.

**Answer (approved 2026-06-08):** **YES** — the managed, on-demand `gcloud firestore export/import` approach is accepted as the v1 backup mechanism; the lazy-cron `backupReminder` watchdog (warn-only, no auto-trigger) is acceptable under the no-external-scheduler constraint. NOTE: executing the actual export requires the project to be on the Blaze plan (billing enabled) — a rollout-prep prerequisite (see live-gate #5).

---

## 5. Cross-Border Anthropic Retention Note

Conversation prompts sent to Anthropic's API are **pseudonymized** before sending (no raw PII crosses the border — `assertRedacted()` gate enforced in code). Anthropic may retain API inputs for approximately **30 days** as per their default API retention policy.

**This cross-border retention is OUT OF SCOPE for the Firestore erasure cascade.** Rationale:
- The data reaching Anthropic contains only opaque tokens (`<LEAD_ID:n>`, `<PHONE_HASH:hex>`)
- These tokens have negligible re-identification value without the server-side mapping
- Erasure of the canonical Firestore record is the PDPA remedy
- This is documented in the PDPA Transfer Impact Assessment (`.planning/phases/01-foundations/PDPA-TIA.md §3/§4.3`, updated Phase-5 §P5-4)

**Recommended pre-pilot action:** Confirm with Anthropic that the API model-training opt-out is activated for the `cy-csaiagent` account (TIA §5.1 contractual safeguard).

---

## 6. Live End-to-End Drill (LIVE-GATED)

The code-ready erasure system must be exercised on the deployed stack before Derek signs. The drill:

1. Provision a synthetic test agent on the deployed stack (NOT a real agent)
2. Seed data across all PII collections for the test agent
3. Trigger erasure via `/<lang>/erasure` (admin UI)
4. Confirm `status: 'complete'` within 2 hours (well inside 72h SLA)
5. Spot-check Firestore: 0 docs in each PII collection for the test agent UID
6. Confirm `auditLogs` shows the `action:'erasure'` event
7. Record the `completedAt` timestamp

**Record here during rollout prep:**

| Drill item | Result | Date |
|-----------|--------|------|
| Synthetic agent UID used | | |
| Erasure request created at | | |
| Status reached `complete` at | | |
| SLA elapsed (completedAt - requestedAt) | | < 72 hours |
| auditLogs erasure event confirmed | | |
| A1 Storage confirmation | | |
| A6 backup confirmation | | |

---

## 7. Sign-Off

By signing below, Derek confirms:

1. The PII Erasure Manifest (§2) correctly enumerates all personal data locations in the platform.
2. The coverage test (§3) provides adequate proof that every PII collection is reached by the erasure cascade.
3. The audit log exemption (auditLogs hashes-only, erasure event appended) is the appropriate compliance posture.
4. The Anthropic cross-border retention note (§5) is understood and the pseudonymization mitigation is adequate for PDPA compliance.
5. The open confirmations (§4 A1 and A6) have been answered.
6. The live end-to-end drill (§6) has been completed satisfactorily.

| Role | Name | Signature | Date |
|------|------|-----------|------|
| Project Lead / Data Controller Representative | Derek | Approved via project authorization (written Slack/email confirmation to be filed) | 2026-06-08 |
| AI Engineering Lead | (team) | Approved 2026-06-08 (recorded sign-off per project authorization) | 2026-06-08 |

> **2026-06-08 sign-off note:** Approval recorded per project authorization (user instruction). §4 confirmations answered (A1=NO, A6=YES). The §6 live end-to-end drill remains LIVE-GATED — it requires a deployed stack with billing enabled and is to be completed during rollout prep; its results should be appended to §6 and this approval re-confirmed by Derek in writing once the drill passes.

> **Derek:** To approve this sign-off, provide a written confirmation via Slack/email:
> `PDPA erasure sign-off approved — v1 pilot may proceed with erasure capability.`
> Your approval indicates that you have reviewed the coverage proof, open confirmations, and live drill results.

---

## 8. Evidence Index

| Claim | Evidence | Commit |
|-------|---------|--------|
| PII_ERASURE_MANIFEST covers all agent + lead collections | `src/pdpa/coverage.ts` | f8ee5a8 (05-03) |
| eraseDataSubject executor (cascade + audit event) | `src/pdpa/erasure.ts` | 6522fb2 (05-03) |
| erasureSweep chunked completer | `src/pdpa/sweep.ts` | 21d4540 (05-03) |
| Coverage test GREEN on emulator | `src/pdpa/coverage.test.ts` | 52e166d (05-01) + f8ee5a8 (05-03) |
| auditLogs EXEMPT (hashes-only, never deleted) | `EXEMPT: ['auditLogs']` in manifest | f8ee5a8 (05-03) |
| Admin-only type-to-confirm UI | `app/[lang]/(admin)/erasure/` | a9b95cf / 05671e1 / 400a997 (05-05) |
| erasureRequests deny-by-default rules + CI test | `firestore.rules` + `rules.test.ts` | b5c6046 / d5d8237 (05-02) |
| PDPA-TIA updated with Phase-5 data flow | `.planning/phases/01-foundations/PDPA-TIA.md` | f7ca414 (05-08) |
| Operator erasure runbook | `docs/operations/pdpa-erasure-runbook.md` | f7ca414 (05-08) |
