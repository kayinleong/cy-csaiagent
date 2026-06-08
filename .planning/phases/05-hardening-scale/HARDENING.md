# HARDENING.md — SC4 Hardening Checklist
## D2 Customer Service AI Agent Platform (`cy-csaiagent`)

**Requirement:** SC4 (D-12) — provably ready for ~400 agents + handed over
**Status:** Phase 5 code-complete. Live-gated items execute during rollout prep.
**Author:** AI engineering lead (Phase 5 execution, 2026-06-07)

---

> **CODE-READY** = artifact exists and is committed; gate does not require a live deploy.
> **LIVE-GATED** = executes against the deployed stack during rollout prep; evidence link filled then.
> **PROPOSED** = numbers pending Derek's final call.

---

## 1. Service Level Objectives (SLOs)

> **APPROVED 2026-06-08 (per project authorization, A4 finalized).** The researcher-proposed starting points are accepted as the v1 SLO TARGETS. The actual MEASURED values remain LIVE-GATED — a `k6 run` at ~400 VUs against the deployed stack must confirm the targets are met (live-gate #3); record measured p95/p50/error-rate in `LOADTEST.md` and tick the "Met?" column.

| SLO | Target (APPROVED) | Measurement | Evidence |
|-----|----------------|--------|----------|
| SSE first-token p95 | < 3,000 ms | LIVE-GATED (k6 at 400 VUs) | `scripts/loadtest/chat.js` threshold (7e61b7f, 05-01) |
| SSE first-token p50 | < 1,500 ms | LIVE-GATED (k6 at 400 VUs) | `scripts/loadtest/chat.js` threshold (7e61b7f, 05-01) |
| Error rate under load (400 VUs) | < 1% | LIVE-GATED (k6 at 400 VUs) | `scripts/loadtest/chat.js` threshold (7e61b7f, 05-01) |
| PDPA erasure completion | < 72 hours | CODE-READY | `ErasureRequestDoc.slaDeadline = now+72h` (05-02, e2cff04); erasure-sweep 1h window (05-03, 21d4540) |
| Admin page load p95 | < 2,000 ms | LIVE-GATED | Reads `usageRollups` only (pre-aggregated) — b7785e4 (05-07) |

**Targets finalized 2026-06-08; measurement confirmation is live-gated. See also:** `PERF-COST.md §4` for the full p95 budget rationale.

---

## 2. Runbooks

| Runbook | Status | Link |
|---------|--------|------|
| Architecture overview | CODE-READY | `docs/operations/architecture-overview.md` |
| Deploy + secrets | CODE-READY | `docs/operations/deploy-secrets-runbook.md` |
| Lazy-cron catalog | CODE-READY | `docs/operations/lazy-cron-catalog.md` |
| Backup + restore | CODE-READY | `docs/operations/backup-restore-runbook.md` |
| PDPA erasure | CODE-READY | `docs/operations/pdpa-erasure-runbook.md` |
| Incident runbooks | CODE-READY | `docs/operations/incident-runbooks.md` |
| Cost + SLO dashboard guide | CODE-READY | `docs/operations/cost-slo-dashboard-guide.md` |

**Runbook set complete (QUAL-10 / D-13).** Written for D2's 2-person team; all secret values are placeholders.

---

## 3. Backup + Restore

**Mechanism: managed `gcloud firestore export` / `gcloud firestore import`.**

This is the native Firestore backup mechanism, invoked as a documented operational step — NOT app code, NOT a Cloud Function, NOT an automated external scheduler (no-GCP-beyond-Firebase-SDK constraint for app code; Pitfall 7 / A6).

### Default operating posture

| Mode | Description |
|------|------------|
| On-demand export | Admin runs `gcloud firestore export` manually (or via the Firebase Console) before any significant operation (deploy, bulk delete, migration). |
| Lazy-cron reminder | The `backupReminder` (see lazy-cron catalog) surfaces "last export was N days ago" in the admin watchdog. This is a UI indicator only — it does NOT trigger an export automatically. |

### Status

| Item | Status | Evidence |
|------|--------|----------|
| Backup runbook authored | CODE-READY | `docs/operations/backup-restore-runbook.md` (incl. §0 no-gcloud SDK path) |
| Lazy-cron reminder (stale export warning) | CODE-READY (UI watchdog) | `docs/operations/lazy-cron-catalog.md` §Backup Reminder |
| **Live backup (export) drill** | **DONE 2026-06-08** | Managed export, operationState **SUCCESSFUL**, → `gs://cy-csaiagent-backups/firestore-backups/2026-06-08T11-07-18/` (dedicated backups bucket created in asia-southeast1, same region as Firestore). Verified: `overall_export_metadata` + `all_namespaces/all_kinds/output-0` present. Ran via `gcloud firestore export` as the owner (`sosleong365@gmail.com`) after Blaze was enabled. |
| Restore drill | LIVE-GATED | Import the above prefix into a SCRATCH project via `gcloud firestore import` / `FirestoreAdminClient.importDocuments` — NEVER onto prod. Record restore time here. |

> **Note (2026-06-08):** The no-gcloud SDK export (`scripts/firestore-export.ts`) is also wired, but its service account (`firebase-adminsdk-fbsvc@cy-csaiagent.iam.gserviceaccount.com`) still needs `roles/datastore.importExportAdmin` before it can run; the successful export above used the owner's gcloud creds. Grant that role to make the SDK path usable too.

### Live-gated drill (record during rollout prep)

```
Date of drill:      __________
Export bucket path: gs://<PROJECT_ID>-backups/exports/YYYY-MM-DD/
Export duration:    __________ minutes
Restore test env:   __________
Restore duration:   __________ minutes
Data validated by:  __________
```

**Confirm with Derek (A6):** That the managed `gcloud firestore export/import` operational approach is constraint-acceptable. If a stricter "no GCP Admin API at all" reading applies, the backup mechanism must be re-scoped to an in-app JSON export Server Action — document Derek's decision here before rollout.

---

## 4. Security Audit

### 4.1 Firestore Security Rules

| Item | Status | Evidence |
|------|--------|----------|
| All 20 collections have deny-by-default rules | CODE-READY | `firestore.rules` (19 collections in 05-02 + existing); CI rules test enumerates all 19 (b5c6046, 05-02) |
| 3 new collections (usageEvents / usageRollups / erasureRequests): `create/update/delete: if false`; `read: if hasRole('admin') && sameTenant()` | CODE-READY | `firestore.rules`, assertions in `src/firebase/__tests__/rules.test.ts` (d5d8237, 05-02) |
| Rules CI test: "all 19 enumerated" (T-01-09 guard — no unruled collection) | CODE-READY | `src/firebase/__tests__/rules.test.ts:21` — 16→19 update (d5d8237, 05-02); Pitfall 6 mitigated |
| `gcloud firestore deploy` is live-gated (rules + indexes) | LIVE-GATED | `firebase deploy --only firestore:rules,firestore:indexes` (consistent with quick-004) |

### 4.2 Authentication + Authorization

| Item | Status | Evidence |
|------|--------|----------|
| Firebase Auth with ID token verification on every server request | CODE-READY | `src/firebase/auth.ts:96` `requireUser` — used on every server action |
| Custom claims: `new-agent / senior-coach / admin` | CODE-READY | `src/firebase/auth.ts:148` `setUserClaims` (sole sanctioned setter) |
| Three-layer admin gate (layout → page RSC → Server Action) | CODE-READY | `app/[lang]/(admin)/layout.tsx:50` + `kb/page.tsx:43-68` pattern replicated in all 5 admin surfaces (05-05/06/07) |
| Role-conditional read scope (coach=downline, admin=org-wide) | CODE-READY | `dashboard/actions.ts` `getDownline`; `getReplyQualityMetrics` scope; `usage/page.tsx` adminAll flag |
| Erasure is admin-only (not senior-coach) | CODE-READY | `erasure/actions.ts` gate: `role !== 'admin'` (05-05, 05671e1) |
| Role assignment admin-only, via `setUserClaims` only | CODE-READY | `roles/actions.ts assignRole` (05-06, ba7e3b7) |
| sameTenant() predicate on every data read | CODE-READY | `firestore.rules` (all read rules carry `sameTenant()`); converter stamps `tenantId` on every write |

### 4.3 Secrets Hygiene

| Item | Status | Evidence |
|------|--------|----------|
| Secrets via Firebase App Hosting + Secret Manager | CODE-READY | `apphosting.yaml` secret refs (never in client bundles) |
| No secret values in logs or audit events | CODE-READY | `src/audit/log.ts` hashes all `raw` values (`:48-63`); `src/usage/record.ts` counts-only |
| No secrets in docs/operations/ (placeholders only) | CODE-READY | All runbooks use `<PROJECT_ID>`, `<API_KEY>`, `<BUCKET_NAME>` — no real values |
| ANTHROPIC_API_KEY + GOOGLE_GENERATIVE_AI_API_KEY never client-accessible | CODE-READY | Server Components / Route Handlers / Server Actions only; never in `NEXT_PUBLIC_*` |
| Model IDs from Remote Config (never hard-coded) | CODE-READY | `src/llm/provider.ts:70` `modelFor()` resolves from Remote Config (QUAL-01) |

### 4.4 PDPA Compliance

| Item | Status | Evidence |
|------|--------|----------|
| Boundary pseudonymization (`pseudonymize()`) | CODE-READY | `src/audit/pdpa.ts`; `assertRedacted()` gate before every `streamText()` call (01-02) |
| `pdpa_redacted: true` gate enforced | CODE-READY | `app/api/chat/route.ts:330` `assertRedacted()` — throws before LLM call |
| `auditLogs` hashes-only (no PII in logs) | CODE-READY | `src/audit/log.ts` `hashAll()` (:48-63); `usageEvents` counts-only (ebed5dd, 05-04) |
| PII_ERASURE_MANIFEST covers all PII-bearing collections | CODE-READY | `src/pdpa/coverage.ts` — 9 agent collections + 4 lead collections + STORAGE near-no-op + EXEMPT auditLogs (f8ee5a8, 05-03) |
| Coverage test: every PII collection → 0 docs after erasure; auditLogs survives | CODE-READY | `src/pdpa/coverage.test.ts` (emulator-gated GREEN, 05-03) |
| auditLogs exempt from erasure (compliance record survives) | CODE-READY | `EXEMPT: ['auditLogs']` in manifest; erasure.ts skips EXEMPT by construction (6522fb2, 05-03) |
| Admin-only PDPA erasure surface with type-to-confirm gate | CODE-READY | `app/[lang]/(admin)/erasure/*` (05-05) |
| <72h SLA tracked on `erasureRequests` doc | CODE-READY | `ErasureRequestDoc.slaDeadline = now+72h`; sweep marks `completedAt` (21d4540, 05-03) |
| Derek PDPA sign-off memo | CODE-READY | `PDPA-SIGNOFF.md` (this Phase 5 plan, 05-08); Derek sign-off + live drill: LIVE-GATED |
| TIA updated with live data flow + erasure | CODE-READY | `.planning/phases/01-foundations/PDPA-TIA.md` Phase-5 update section (05-08) |

**See also:** `PDPA-SIGNOFF.md` for the erasure coverage proof and Derek's sign-off gate.

---

## 5. Load Test

**D-11: ~400-concurrent load test.**

| Item | Status | Evidence |
|------|--------|----------|
| k6 harness code-ready | CODE-READY | `scripts/loadtest/chat.js` (7e61b7f, 05-01) |
| LOADTEST.md report template | CODE-READY (shell) | See `LOADTEST.md` in this directory (fill during rollout) |
| Live execution against deployed stack | LIVE-GATED | `k6 run scripts/loadtest/chat.js --env TARGET=<APP_HOSTING_URL> --env TOKEN=<ADMIN_JWT>` |
| p95 / error-rate / cold-start results | LIVE-GATED | Record in `LOADTEST.md` and update SLO table (§1 above) |

**The k6 harness is dev/CI tooling** — it hits the deployed App Hosting endpoint from a developer machine or CI runner. This is NOT app infra and does NOT violate the no-GCP constraint (Pitfall 7). k6 installation: `brew install k6` or `docker run grafana/k6`.

---

## 6. Cost Projection at 400 Agents

**PROPOSED — see `PERF-COST.md §5` for the full projection model.**

| Item | Status | Reference |
|------|--------|-----------|
| Cost model documented | CODE-READY | `PERF-COST.md §1-§5` |
| Cache-hit rate measurement method | CODE-READY | `PERF-COST.md §2` |
| Firestore read-cost model | CODE-READY | `PERF-COST.md §3` |
| Actual p95 + cache-hit numbers | LIVE-GATED | Record in `PERF-COST.md §2 / §4` during rollout |
| Monthly LLM cost estimate (PROPOSED) | LIVE-GATED | Record in `PERF-COST.md §5` after pilot measurement |

---

## 7. v2 Scope Boundary (Pitfall 8 guard)

The following items are confirmed OUT OF SCOPE for v1 hardening. Any request to include them requires a new claim and Derek prioritization:

- WhatsApp Business API / auto-send (WABA-GATE.md, post-v1)
- Public-facing property recommender / auto-assignment (PUB-01/02, v2)
- Native mobile apps, voice/audio input (out of scope)
- Multi-tenant white-label activation (tenantId seam exists; activation is v2)
- Automated wall-clock scheduling (replacement for lazy-cron — document escape hatch, not v1)
- BigQuery / external analytics warehouse (excluded by hard constraint)

---

## 8. Live-Gated Completion Criteria

Mark these during rollout prep:

| Gate | Criterion | Date | Owner |
|------|-----------|------|-------|
| Load test run | p95 < 3,000 ms AND error rate < 1% at 400 VUs | __________ | Engineering |
| Backup drill | Export + restore verified on a test Firestore project | __________ | Engineering |
| PDPA drill | End-to-end erasure completes < 72h on deployed stack | __________ | Engineering + Derek |
| Derek PDPA sign-off | Signature on `PDPA-SIGNOFF.md` | __________ | Derek |
| Rules deploy | `firebase deploy --only firestore:rules,firestore:indexes` successful | __________ | Engineering |
| SLO finalization | Derek reviews PROPOSED numbers → sets final SLOs | __________ | Derek |

---

*Last updated: 2026-06-07 | Next update: During rollout prep (live-gated evidence recorded inline)*
