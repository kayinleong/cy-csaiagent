# Claim: phase-kayinleong-01

- owner: kayinleong
- session: claude-code
- branch: phase-kayinleong-01
- started: 2026-05-31
- status: in-progress
- summary: Execute Phase 1 (Foundations) — 13 plans across 7 waves building the shared platform core (Firebase, llm/memory/rag/audit/eval/i18n, chat shell, streaming) plus the three de-risking spikes.

## What will change

All 13 Phase-1 plans (01-01 .. 01-13). New application core under `src/`, the `app/[lang]/`
route tree, `proxy.ts`, Firestore rules + indexes, CI, test/eval scaffolding, and the
`/api/chat` SSE spine. Built against **real Firebase** via env config (no emulator, no offline
mocks) — secrets supplied by the user through `.env` (template: `.env.sample`).

Two plans are human-action checkpoints the executor cannot complete:
- **01-01** — live Firebase/QStash provisioning + Derek's written `asia-southeast1` region
  sign-off + API secrets. Executor produces doc templates only; no live resources created.
- **01-08** — real App Hosting deploy tested over 4G + live QStash signed-callback round-trip.
  Executor writes the spike harness + SPIKES.md decision-record template; live measurements
  are the user's step.

## What has changed

- [in progress] tracked per-plan via each plan's SUMMARY.md.

## Verification

- [pending] Per-plan SUMMARY.md self-checks + a phase-level VERIFICATION.md (gsd-verifier).
- [pending] Regression report before marking the claim `done`.
