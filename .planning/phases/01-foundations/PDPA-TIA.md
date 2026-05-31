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

---

*This document is stored at `.planning/phases/01-foundations/PDPA-TIA.md` and is a required artifact per ROADMAP Phase 1 gate requirements and TSD §5.3.*
