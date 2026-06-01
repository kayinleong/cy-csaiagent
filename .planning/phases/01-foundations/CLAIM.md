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

All 13 Phase-1 plans executed (12 carry SUMMARY.md; **01-01 is an open human-action gate**
with template artifacts only). Built against real Firebase via env (no emulator/mocks).
New application core under `src/` (firebase, audit, router, memory, ratelimit, rag, kb,
escalation, jobs, agents/coach, llm, eval, i18n), the `app/[lang]/` route tree, `proxy.ts`,
`firestore.rules` + indexes, `/api/chat` SSE spine, admin KB, evals + Playwright specs, CI.

Orchestrator-applied cross-plan fixes (beyond the per-plan SUMMARYs):
- `01-03` rules suite gated on `FIRESTORE_EMULATOR_HOST` so default `vitest run` stays green.
- `01-08` SPIKES.md SPIKE-AI-SDK corrected: ai@5 method is `toUIMessageStreamResponse()`
  (v4's `toDataStreamResponse()` does not exist in 5.0.193).
- `01-09` real bug: `src/rag/embed.ts` read `result.embeddings[0]`; the Voyage SDK exposes
  `data[].embedding` (mocks hid it). Fixed.
- `01-11` `src/escalation/detect.ts` unsafe `FieldValue→{toDate}` cast narrowed through `unknown`.
- Test/spec type errors + vendored `calendar.tsx` (react-day-picker v10 classNames) fixed to
  make `tsc --noEmit` clean; added a `tsc` typecheck gate to CI (vitest only transpiles).

## Verification

**Phase-level VERIFICATION.md (gsd-verifier): status `human_needed`** — 17/22 must-haves verified
at code level, 0 code-level gaps, all 19 requirement IDs accounted for. The 9 human_needed items
are the live spike runs (SPIKE-RAG/DEPLOY/CRON/INGEST), Derek's region + TIA sign-off, live Firebase/
QStash provisioning, and the live-stack proofs (Playwright E2E, Promptfoo eval). See
`01-VERIFICATION.md`.

**Automated checks (offline):**
- `npx tsc --noEmit` → 0 errors (CI now enforces this).
- `npx vitest run` → 155 passed, 81 skipped (emulator/live-gated suites), 0 failed.
- `npm run lint` → 0 errors (21 warnings, unused test vars only).
- QUAL-01 model-swap (`src/llm/swap.test.ts`) → 13/13 pass; no unredacted PII reaches a provider.

**Regression report:** `src/` is greenfield — no prior runtime features to regress. Existing files
modified: `package.json`/lock (deps), `eslint.config.mjs` (Next.js-16 anti-pattern rules + vendored
ignores), `next.config.ts` (withNextIntl), root `app/layout.tsx` minimized + page restructured into
`app/[lang]/`, `components/ui/calendar.tsx` (classNames rename for react-day-picker v10),
`.gitignore` (`!.env.sample`). Risk surface = the `app/` shell restructure + the calendar rename;
both are TypeScript-clean and the full vitest suite is green. NOT yet exercised: `next build` /
`next dev` end-to-end and any live-Firebase/Anthropic path — these are part of the live-stack
verification gate (need user-supplied `.env`).

**Status:** code execution complete + verified; phase remains **spike-gated** — `01-01` provisioning
and the four live spike runs are open human-action gates before Phase 2. Claim left `in-progress`
until those gates close.
