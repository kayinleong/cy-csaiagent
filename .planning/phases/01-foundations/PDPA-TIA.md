# PDPA Transfer Impact Assessment (TIA)
## D2 Customer Service AI Agent Platform — `cy-csaiagent`

**Document type:** Transfer Impact Assessment  
**Purpose:** Assess and mitigate risks of cross-border personal data transfer from Malaysia to Anthropic (US) under Malaysia's Personal Data Protection Act 2010 (PDPA).  
**Status:** Team-drafted · Pending Derek sign-off  
**Prepared by:** AI engineering lead + product engineering lead  
**Date:** 2026-05-31  
**Review cycle:** 3 years from pilot go-live, or on material change to the transfer mechanism  

---

## 1. Background

The D2 Customer Service AI Agent Platform processes personal data belonging to D2 property agents and their leads in the course of providing AI-powered onboarding coaching, property matching, and reply drafting services.

A core component of the platform sends natural-language conversation messages to Anthropic's Claude API (inference endpoint operated in the United States) to generate responses. This constitutes a **cross-border transfer** of personal data under PDPA §129.

This TIA is filed to satisfy the Phase 1 gate requirement: the TIA must be on file before any real PII flows through the platform (see RESEARCH §Pitfall A — HIGH risk). During Phase 1, all data is synthetic. This TIA gates the **pilot** (real PII); pseudonymization gates the **build** (prevents real PII from reaching the model during development).

---

## 2. Data Categories and Transfer Scope

### 2.1 What personal data is involved?

| Category | Examples | Sensitivity |
|----------|----------|-------------|
| Agent identity (pseudonymized) | Lead-ID token representing an agent's name | Low (token only — never the raw name) |
| Lead phone numbers (hashed) | SHA256 hash of a Malaysian mobile number | Low (hash only — irreversible without the original) |
| Conversation content | Coaching questions, property queries, reply drafts | Medium (may contain property-search context) |
| Agent journey stage | Current checkpoint in the onboarding journey | Low |

### 2.2 What does NOT cross the border?

By design, the following **never** leave the server as plaintext:

- Raw lead names — replaced with `<LEAD_ID:n>` tokens before any prompt is assembled
- Raw phone numbers — replaced with `<PHONE_HASH:hex>` tokens before any prompt is assembled
- IC numbers — caught by the CI PII scanner; blocked at the code level
- Auth tokens, session IDs — never included in prompts (separate path)
- Raw audit log entries — audit stores SHA256 hashes only, never plaintext

The `assertRedacted()` gate (implemented in `src/audit/pdpa.ts`) **throws** before any `streamText()` call unless the payload carries `pdpa_redacted: true`. This is an enforced code-level control, not a convention.

---

## 3. Transfer Mechanism and Recipient

| Field | Value |
|-------|-------|
| Data exporter | D2 / cy-csaiagent platform (Malaysia) |
| Data importer | Anthropic PBC, 548 Market St #61712, San Francisco, CA 94104, USA |
| Transfer mechanism | HTTPS API call to `api.anthropic.com` (TLS 1.2+) |
| Data importer's legal framework | US jurisdiction; Anthropic Privacy Policy + API Terms of Service |
| Approximate retention by importer | ~30 days (Anthropic default API retention); see Anthropic's [usage policy](https://www.anthropic.com/legal/privacy) |
| Sub-processors disclosed | AWS (Anthropic's infrastructure); governed by Anthropic's sub-processor list |

---

## 4. Risk Assessment

### 4.1 Risk: Raw PII reaches Claude cross-border

**Likelihood before mitigations:** HIGH (default if no redaction layer exists)  
**Impact:** PDPA §129 violation; regulatory fine; loss of trust  

**Mitigations:**
1. `pseudonymize()` — replaces all names and Malaysian phone numbers with opaque tokens before prompt assembly (implemented in `src/audit/pdpa.ts`, unit-tested in `src/audit/pdpa.test.ts`)
2. `assertRedacted()` — throws `PdpaViolationError` before any `streamText()` call if `pdpa_redacted !== true` (enforced code gate, not convention)
3. CI PII scanner — scans all eval fixtures and test data for MY phone patterns (`\+?60\d{9,10}`) and IC patterns; fails the build on match (implemented in 01-02)
4. Audit rows store SHA256 hashes only — never raw values (implemented in `src/audit/log.ts`)

**Residual likelihood after mitigations:** LOW  
**Residual impact:** LOW (pseudonymized tokens have negligible re-identification risk for an importer without the mapping)

### 4.2 Risk: Right-to-erasure conflict with audit log immutability

**Likelihood:** MEDIUM (an agent or lead may invoke their right to erasure)  
**Impact:** PDPA §35 obligation; potential non-compliance  

**Mitigation:** Audit rows store pseudonyms/hashes only. The canonical PII record lives in `leads/{leadId}` (separately deletable). A tested erasure pipeline (delete `leads/{id}`, clear conversation content) is scoped to Phase 5 with a <72h SLA. Accepted as Phase 1 risk per T-01-16.

### 4.3 Risk: Anthropic retains conversation history

**Likelihood:** LOW-MEDIUM (API default may retain data for model improvement)  
**Impact:** MEDIUM — agents' conversations may be used for model training without explicit consent  

**Mitigation:** Opt-out of model training via Anthropic's API terms (confirm API console setting before pilot). Pseudonymization reduces the harm even if data is retained — tokens without the server-side mapping have negligible re-identification value.

---

## 5. Adequacy and Safeguards

### 5.1 Does the destination country provide adequate protection?

The United States does not have a general adequacy decision under PDPA. The transfer relies on:

1. **Contractual safeguards** — Anthropic API Terms of Service + Data Processing Agreement (DPA, available on request from Anthropic for enterprise accounts).
2. **Technical safeguards** — boundary pseudonymization (see §4.1) ensures that even if the transfer is scrutinized, the data reaching Anthropic contains no directly identifiable Malaysian personal data.
3. **Organisational safeguards** — internal access controls; API key stored in Secret Manager; never logged or exposed to the client.

### 5.2 Documented fallback — Bedrock Singapore

If legal counsel or Derek determines that in-region inference is required (e.g. a future PDPA amendment or regulatory guidance), the platform's `llm/` abstraction layer supports a swap to **Amazon Bedrock Singapore** (`ap-southeast-1`) without changing the agent logic. This fallback is documented in TSD §14 G2 and `G1-REGION-SIGNOFF.md`. The swap requires updating the provider in `src/llm/provider.ts` and re-validating the model capability against the eval suite.

---

## 6. Consent and Transparency

| Requirement | Status |
|-------------|--------|
| Per-lead `consentFlag` field in `leads/{leadId}` | Implemented in data model (Phase 1) |
| Agent informed of AI use at onboarding | Planned for Phase 2 onboarding UI |
| Privacy notice for leads | To be drafted by Derek before pilot |
| Right-to-access implementation | Phase 5 |
| Right-to-erasure implementation | Phase 5 |

---

## 7. Conclusion

The v1 cross-border transfer path (direct Anthropic API + TIA + boundary pseudonymization) provides an adequate level of protection under PDPA provided that:

1. The `assertRedacted()` gate remains enforced in the chat route (code-level control).
2. Anthropic's model-training opt-out is activated before the pilot (configuration control).
3. A Data Processing Agreement with Anthropic is executed before the pilot (contractual control).
4. The Bedrock-Singapore fallback is activated if legal requires in-region inference (architecture control).

**This TIA gates the PILOT (real PII flowing through the platform).** The build (Phase 1 synthetic data only) proceeds without this sign-off because no real PII is processed. The sign-off below is required before any pilot participant's data enters the system.

---

## 8. Sign-off

| Role | Name | Signature | Date |
|------|------|-----------|------|
| Project Lead / Data Controller Representative | Derek | Derek sign-off: [ ] | date: __________ |
| AI Engineering Lead | (team) | Prepared | 2026-05-31 |
| Product Engineering Lead | (team) | Prepared | 2026-05-31 |

> **Derek:** To approve this TIA, confirm via Slack/email: `TIA approved — pilot may proceed`. Your approval indicates that you have reviewed the data categories, transfer mechanism, risk mitigations, and sign-off table above and agree that the described safeguards are adequate for the pilot.

---

## 9. Change Log

| Date | Change | Author |
|------|--------|--------|
| 2026-05-31 | Initial TIA drafted | AI engineering + product engineering |
| 2026-06-07 | Phase 5 update: live data flow, erasure coverage proof, lazy-cron catalog, cross-border note | AI engineering (Phase 5 execution) |

---

## Phase 5 Update — Live Data Flow + Erasure (2026-06-07)

> This section APPENDS Phase-5 findings to the existing TIA. Prior content is unchanged.
> Prepared by: AI engineering lead | Review cycle: at Phase 5 sign-off

### P5-1. Live Data Flow (17+ Collections at Pilot)

The platform's Firestore data model now comprises **20 collections**. PII-bearing collections and their erasure status:

| Collection | PII content | Subject key | Erasure mechanism |
|-----------|------------|------------|-------------------|
| `users/{uid}` | Agent identity (email, display name, role) | docId = agent uid | `deleteByDocId` in erasure cascade |
| `agentProfiles/{uid}` | Journey stage, checkpoints, voice calibration | docId = agent uid | `deleteByDocId` |
| `rateBudgets/{uid}` | Token budget counts (no content PII) | docId = agent uid | `deleteByDocId` |
| `conversations/{cid}` + `messages` subcoll | Conversation content (may contain names/context) | `ownerUid` (agent) or `leadId` (Finder/Reply) | `recursiveDelete` (deletes subcollection automatically) |
| `leads/{leadId}` | Lead metadata (pseudonymized name, phone hash) | `ownerUid` (agent) or docId (lead) | `deleteByKeyField` / `deleteByDocId` |
| `leadContext/{leadId}` | Cross-pillar state; `replySlot.latestDraft` (redacted draft) | leadId (docId) | `deleteByDocId` (lead) or `deleteViaKeyVia` (agent) |
| `replyEdits` | Original draft + edited reply text; lead + agent keyed | `agentUid` (agent) or `leadId` (lead) | `deleteByKeyField` |
| `escalations` | Stall records; agent-keyed | `agentUid` | `deleteByKeyField` |
| `knowledgeGaps` | Knowledge gap records; agent-keyed | `agentUid` | `deleteByKeyField` |
| `auditLogs` | **EXEMPT** — hashes only, the legal record | SHA256 hash of actorUid | NOT deleted; `action:'erasure'` event APPENDED |

**Non-PII collections (not in erasure scope):**
- `usageEvents`, `usageRollups`: counts-only, no content, no raw agent IDs
- `erasureRequests`: stores `subjectIdHash` only (no raw ID)
- `kbDocs`, `kbChunks`, `evals`, `collateral`: KB content, no subject PII
- `jobRuns`, `heartbeats`: system operational records

### P5-2. Right-to-Erasure Implementation (QUAL-09)

The right-to-erasure remedy described in TIA §4.2 is now implemented:

| Component | Status | Evidence |
|-----------|--------|----------|
| `PII_ERASURE_MANIFEST` (single source of truth) | Implemented | `src/pdpa/coverage.ts` (commit f8ee5a8, 05-03) |
| `eraseDataSubject()` admin-gated Server Action | Implemented | `src/pdpa/erasure.ts` + `app/[lang]/(admin)/erasure/actions.ts` (05-03/05-05) |
| `erasureSweep()` lazy-cron completer | Implemented | `src/pdpa/sweep.ts` (commit 21d4540, 05-03) |
| Type-to-confirm admin UI | Implemented | `app/[lang]/(admin)/erasure/` (05-05) |
| <72h SLA tracking | Implemented | `ErasureRequestDoc.slaDeadline` + `completedAt` (05-02/05-03) |
| Coverage proof (seeded-subject test) | Implemented | `src/pdpa/coverage.test.ts` (emulator-gated GREEN — 05-01/05-03) |
| auditLogs exemption (hashes survive, erasure event written) | Implemented | EXEMPT guard in `src/pdpa/erasure.ts`; proven by coverage.test.ts |
| Live <72h end-to-end drill | **LIVE-GATED** | Execute on deployed stack during rollout; record date in PDPA-SIGNOFF.md |
| Derek sign-off | **LIVE-GATED** | PDPA-SIGNOFF.md (produced in Phase 5 Plan 08); signature at rollout |

### P5-3. On-Visit Lazy-Cron (Periodic Work)

Background jobs (stall-detect, escalate, eval-nightly, usage-rollup, erasure-sweep) run via the **on-visit lazy-cron** (`src/jobs/runDueJobs.ts`). There is no OS-registered cron, no external scheduler, no Cloud Scheduler. The cron fires when an authorized user loads any platform page, gated by a Firestore transaction (exactly-once-per-window).

PDPA relevance: the `erasure-sweep` job runs on a 1-hour window, ensuring erasure requests are completed within 2 hours of the next authorized visit — well inside the 72h SLA.

### P5-4. Anthropic Cross-Border Retention Note (Unchanged Posture)

The Anthropic ~30-day API retention (TIA §3 / §4.3) remains unchanged:

- Conversation prompts are pseudonymized before sending (`assertRedacted()` gate — enforced in code).
- Erasure of the canonical Firestore record (via `eraseDataSubject`) is the PDPA remedy.
- The pseudonymized tokens retained by Anthropic (~30 days) do not contain raw PII — they contain opaque tokens (`<LEAD_ID:n>`, `<PHONE_HASH:hex>`) that have negligible re-identification value without the server-side mapping.
- This cross-border retention is OUT OF SCOPE for the Firestore erasure cascade. It is documented here as the known residual.
- Mitigation: Anthropic's API model-training opt-out must be activated before the pilot (TIA §5.1 contractual safeguard).

### P5-5. Storage Note (A1 — Confirm Before Sign-Off)

Per-agent voice samples (`users.voiceSamples[]`) are currently stored as Firestore strings (NOT Cloud Storage objects) at pilot time. The `STORAGE` manifest entry in `src/pdpa/coverage.ts` is a near-no-op code path.

**If voice samples move to Cloud Storage before sign-off:** the Storage erasure path (`bucket().deleteFiles({ prefix: 'voice/{uid}/' })`) must be wired before Derek signs off on PDPA-SIGNOFF.md. Confirm with Derek.

### P5-6. Sign-Off Status

| Gate | Status |
|------|--------|
| TIA updated with Phase-5 data flow | COMPLETE (this section) |
| Erasure coverage proof | COMPLETE (coverage.test.ts GREEN on emulator) |
| PDPA-SIGNOFF.md memo authored | COMPLETE (Phase 5 Plan 08) |
| Live <72h erasure drill on deployed stack | LIVE-GATED (during rollout prep) |
| Derek signature on PDPA-SIGNOFF.md | LIVE-GATED (at rollout) |

---

*This document is stored at `.planning/phases/01-foundations/PDPA-TIA.md` and is a required artifact per ROADMAP Phase 1 gate requirements and TSD §5.3.*
