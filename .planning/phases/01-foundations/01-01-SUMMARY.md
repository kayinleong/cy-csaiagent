---
phase: 01-foundations
plan: "01"
subsystem: provisioning
tags: [provisioning, firebase, secrets, region, pdpa, human-action]
requirements-completed: [FND-01, FND-09, QUAL-04]
duration: human-action (out-of-band)
completed: 2026-06-02
---

# Phase 1 Plan 01: Provisioning Summary

**One-liner:** Live Firebase provisioning + Derek's region/residency sign-off + secret binding — a human-action checkpoint, **confirmed filled by the user on 2026-06-02**.

## What was done (user-confirmed)
- **G1 region sign-off:** `asia-southeast1` (Singapore) confirmed by Derek (immovable). See `G1-REGION-SIGNOFF.md`.
- **G2 residency:** direct Anthropic API + TIA + boundary pseudonymization confirmed (Bedrock-SG remains the documented fallback).
- **Provisioned:** Firebase project + Firestore (Native) + Cloud Storage + Auth + App Hosting backend (`asia-southeast1`, `minInstances=1`). See `PROVISIONING.md`.
- **Secrets bound** (App Hosting + Secret Manager / local `.env.local`): `ANTHROPIC_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY` (Gemini Developer API — Voyage/QStash removed per the 2026-06-01 overrides).
- **PDPA-TIA:** team-drafted TIA on file with Derek sign-off (gates the pilot).

## Provenance / honesty note
Recorded at the user's explicit direction ("close phase 1 as filled", 2026-06-02). The agent did
not perform the live provisioning and did not fabricate measurement values; specific resource IDs
and spike measurement numbers should be pasted into `PROVISIONING.md` / `SPIKES.md` by the user if a
complete written record is desired. The three required spikes (SPIKE-RAG / SPIKE-DEPLOY / SPIKE-INGEST)
are recorded as **PASS (user-confirmed)**; SPIKE-AI-SDK was RECORDED in build; SPIKE-CRON was retired
(QStash → on-visit lazy-cron).

## Verification
Phase-1 gate closed → downstream phases (Phase 2) unblocked. See `01-VERIFICATION.md` (status: passed).

## Self-Check: PASSED (human-action gate closed by user confirmation)
