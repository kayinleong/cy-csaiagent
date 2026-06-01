# Provisioning Checklist — D2 CS-AI Agent

> **STATUS: ⛔ PENDING LIVE PROVISIONING (human-action, plan 01-01).**
> Gated by [G1-REGION-SIGNOFF.md](./G1-REGION-SIGNOFF.md) — do not create any resource
> until Derek confirms `asia-southeast1`. Secrets are bound via **App Hosting + Secret Manager**
> only — never in a client bundle, never logged, never committed. Use placeholders here.

## 1. Firebase project

| Resource | Setting | Value / ID | Status |
|----------|---------|------------|--------|
| Project | — | `<PROJECT_ID>` | [ ] not created |
| Firestore | Native mode, region `asia-southeast1` | — | [ ] pending |
| Cloud Storage | region `asia-southeast1` | `<PROJECT_ID>.appspot.com` | [ ] pending |
| Firebase Auth | email/password (+ custom claims) | — | [ ] pending |
| App Hosting | backend, `minInstances=1`, region `asia-southeast1` | `<BACKEND_NAME>` | [ ] pending |

## 2. Scheduled jobs — NO external dependency

Periodic work (stall-detect, escalate, eval-nightly, usage-rollup) runs as an **on-visit
lazy-cron Server Action**, guarded by a Firestore last-run-per-window check. There is **no
QStash, no Cloud Scheduler, no Cloud Functions** to provision. (Tradeoff: jobs fire when an
authorized user loads the app, not on a fixed wall-clock schedule.)

## 3. Secret bindings (App Hosting env → Secret Manager)

Bind each via Secret Manager. Record only the **binding status**, never the value.

| Secret name | Source dashboard | Bound via Secret Manager? |
|-------------|------------------|---------------------------|
| `ANTHROPIC_API_KEY` | Anthropic Console → API Keys | [ ] not bound |
| `GOOGLE_GENERATIVE_AI_API_KEY` | Google AI Studio → API Keys (Gemini Developer API) | [ ] not bound |

Local development reads the same names from `.env.local` (template: [`.env.sample`](../../../.env.sample)).

## 4. Local toolchain prerequisites

| Tool | Required | Observed | Status |
|------|----------|----------|--------|
| Node | ≥ 22 (`firebase-admin ^13`) | `node --version` → __________ | [ ] verify |
| gcloud CLI | available (Firestore vector-index creation) | `gcloud --version` → __________ | [ ] verify |
| Firebase CLI | available (rules/index deploy, emulator for rules tests) | `firebase --version` → __________ | [ ] verify |

## 5. Firestore vector index (for `findNearest`, plan 01-09)

The 1024-d KNN index on `kbChunks.embedding` is created with `gcloud firestore indexes
composite create` (no Cloud Functions). Record the index name + state here once created.

| Index | Field | Dimension | State |
|-------|-------|-----------|-------|
| kbChunks vector | `embedding` | 1024 (DOT_PRODUCT) | [ ] not created |

---

*Drafted by execution agent 2026-05-31. All rows are PENDING; fill in real IDs and flip
statuses as you provision. No secret values belong in this file.*
