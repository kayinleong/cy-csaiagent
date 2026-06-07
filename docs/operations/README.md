# Operations Runbooks — D2 Customer Service AI Agent Platform

**Platform:** `cy-csaiagent`
**Audience:** D2's 2-person engineering/operations team
**Maintained by:** AI engineering lead + product engineering lead

---

## How to Use These Runbooks

This directory contains the complete operator documentation for the D2 AI Agent platform. Each runbook is self-contained and designed to be read without access to the codebase.

**Conventions used throughout:**
- `<PROJECT_ID>` — your Firebase project ID (e.g. `cy-csaiagent`)
- `<API_KEY>` — a secret key (retrieve from Firebase Console → App Hosting → Secrets)
- `<APP_HOSTING_URL>` — your App Hosting deployment URL (e.g. `https://cy-csaiagent.web.app`)
- `<BUCKET_NAME>` — your Cloud Storage bucket (e.g. `cy-csaiagent.appspot.com`)
- Never paste real secret values into these docs — always use placeholders

---

## Runbook Index

| Runbook | When to use |
|---------|------------|
| [`architecture-overview.md`](architecture-overview.md) | Onboarding, debugging, understanding data flow |
| [`deploy-secrets-runbook.md`](deploy-secrets-runbook.md) | Deploying code, rotating secrets, updating model IDs |
| [`lazy-cron-catalog.md`](lazy-cron-catalog.md) | Understanding background jobs, debugging a stalled job |
| [`backup-restore-runbook.md`](backup-restore-runbook.md) | Before a risky operation, after a data incident |
| [`pdpa-erasure-runbook.md`](pdpa-erasure-runbook.md) | Processing a data-subject erasure (right to be forgotten) |
| [`incident-runbooks.md`](incident-runbooks.md) | Platform outage, rate-limit exhaustion, model provider down |
| [`cost-slo-dashboard-guide.md`](cost-slo-dashboard-guide.md) | Reading the usage dashboard, monitoring cost and SLOs |

---

## On-Call Basics

### Who to call

| Issue | First contact | Escalate to |
|-------|--------------|-------------|
| Platform down (all agents can't chat) | AI engineering lead | Product engineering lead |
| PDPA erasure request from a data subject | Product engineering lead | Derek (data controller) |
| Model provider outage (Anthropic down) | AI engineering lead — swap model via Remote Config | — |
| Data breach / unauthorized access | Derek immediately | External legal counsel |
| Stale lazy-cron (watchdog alert) | AI engineering lead | — |

### Health check

1. Visit the admin usage dashboard (`<APP_HOSTING_URL>/<lang>/usage`) as an admin.
2. Confirm the stale watchdog does NOT show "No rollup in 25+ hours".
3. If the platform appears up but no rollup has run, trigger it by navigating to the app — the lazy-cron fires on an authorized page visit.

### Monitoring

There is no external uptime monitor in v1 (constraint: no external scheduler). The lazy-cron watchdog is the primary health signal. Add Firebase Alerting rules in the Firebase Console for:
- Excessive Firestore write errors
- App Hosting service degradation alerts

---

## Security Posture

- **Admin access**: Firebase Auth custom claims. Role assignment via `/<lang>/roles` (admin only).
- **Secrets**: All API keys in Firebase Secret Manager (App Hosting integration). Never in environment variables visible to clients.
- **PDPA**: All PII pseudonymized before reaching the AI model. Erasure completes within 72 hours. See `pdpa-erasure-runbook.md`.
- **Audit log**: Every admin action is logged (hashes-only, no PII). Audit log is permanent — never erased.

---

## Reference

- **Planning artifacts:** `.planning/TSD.md` (full technical spec), `.planning/REQUIREMENTS.md` (85 v1 requirements)
- **Hardening checklist:** `.planning/phases/05-hardening-scale/HARDENING.md`
- **PDPA memo:** `.planning/phases/05-hardening-scale/PDPA-SIGNOFF.md`
- **Cost/perf pass:** `.planning/phases/05-hardening-scale/PERF-COST.md`
