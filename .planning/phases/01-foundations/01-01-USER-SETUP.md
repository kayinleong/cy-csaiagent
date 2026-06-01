# User Setup — Plan 01-01 (Provisioning)

**Status: Incomplete — human action required.**

This plan cannot be executed by the AI agent: it requires Derek's written region sign-off
and live cloud provisioning with real credentials. Complete the steps below, then the plan
can be closed.

## Step 1 — Region & residency sign-off (Derek)
- [ ] Confirm Firestore + Storage region in [G1-REGION-SIGNOFF.md](./G1-REGION-SIGNOFF.md) (default `asia-southeast1`, **immovable**).
- [ ] Confirm G2 Anthropic residency posture (`direct API + TIA` default, or `Bedrock-SG`).

## Step 2 — Provision (only after Step 1)
- [ ] Create the Firebase project in the confirmed region.
- [ ] Enable Firestore (Native), Cloud Storage, Firebase Auth.
- [ ] Create an App Hosting backend, `minInstances=1`, region `asia-southeast1`.
- [ ] (No QStash / Cloud Scheduler — scheduled jobs run as an on-visit lazy-cron Server Action.)

## Step 3 — Secrets
Bind via **App Hosting + Secret Manager** (and mirror into local `.env.local` from `.env.sample`):

| Env var | Where to get it |
|---------|-----------------|
| `ANTHROPIC_API_KEY` | Anthropic Console → API Keys |
| `GOOGLE_GENERATIVE_AI_API_KEY` | Google AI Studio → API Keys (Gemini Developer API, not Vertex) |

Plus the Firebase client config + Admin service account (see `.env.sample`).

## Step 4 — Record
- [ ] Fill resource IDs + binding statuses in [PROVISIONING.md](./PROVISIONING.md).
- [ ] Record `node --version` (≥22), `gcloud --version`, `firebase --version`.

## Verification
- `grep -l asia-southeast1 .planning/phases/01-foundations/G1-REGION-SIGNOFF.md`
- `grep -E "Secret Manager|App Hosting|minInstances" .planning/phases/01-foundations/PROVISIONING.md`
- No real secret strings under `.planning/` (placeholders only).
