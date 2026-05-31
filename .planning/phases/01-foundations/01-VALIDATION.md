---
phase: 1
slug: foundations
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-31
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Test infrastructure below is from RESEARCH.md; the Per-Task Verification Map and Wave 0
> list are filled by the planner once PLAN.md task IDs exist.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | `vitest` (unit/integration, with `llm/` fake provider) · `@firebase/rules-unit-testing` (rules) · `@playwright/test` (E2E) · `promptfoo` (eval) |
| **Config file** | none — Wave 0 installs (`vitest.config.ts`, `playwright.config.ts`, `firebase.json`/emulator config, `promptfooconfig.yaml`) |
| **Quick run command** | `npx vitest run` |
| **Full suite command** | `npx vitest run && npm run test:rules && npx playwright test && npx promptfoo eval` |
| **Estimated runtime** | ~quick <30s; full a few minutes (rules emulator + Playwright dominate) |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run` (quick)
- **After every plan wave:** Run the full suite
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** ~30 seconds (quick run)

---

## Per-Task Verification Map

> Filled by the planner — one row per PLAN.md task, mapping each Phase-1 task to its
> requirement, secure behavior, test type, and automated command. Anchored to the
> observable signals in RESEARCH.md §Validation Architecture and the 5 ROADMAP success criteria.

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| {to be filled by planner} | | | | | | | | | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Observable Signals (from RESEARCH.md §Validation Architecture — anchor the map above)

- **SC1 (sign-in → stream → token-by-token):** Playwright E2E asserts incremental SSE chunks arrive (not one buffered dump); unit test asserts `X-Accel-Buffering: no` + `text/event-stream` headers on the chat route.
- **SC2 (persist + audit):** integration test asserts a `conversations/{cid}/messages/{mid}` doc exists after a turn and a create-only `auditLogs` row (hashes only) is written; refresh-reload re-renders history.
- **SC3 (one language E2E + recall bar):** Promptfoo trilingual fixture scores EN end-to-end; SPIKE-RAG asserts BM/中文 recall ≥70% of EN on ~500 chunks (gate, not in-suite).
- **SC4 (model swap, no unredacted PII):** QUAL-01 integration test runs the same chat call against a second provider via `llm/`; a unit test asserts the `pdpa_redacted:true` gate refuses an unredacted production model call.
- **SC5 (spikes resolved + TIA):** documented pass/fallback decision committed per spike; TIA artifact on file (manual verification).
- **Rules:** `@firebase/rules-unit-testing` proves deny-by-default for all three roles (new-agent / thin senior-coach / thin admin) across every collection — cross-agent and cross-tenant reads denied.

---

## Wave 0 Requirements

> Filled by the planner. Expected Wave-0 installs (no framework present in repo today):

- [ ] `vitest.config.ts` + first `src/**/*.test.ts` stubs (llm fake provider harness)
- [ ] `@firebase/rules-unit-testing` setup + emulator config for rules tests
- [ ] `playwright.config.ts` + sign-in→stream→persist E2E skeleton
- [ ] `promptfooconfig.yaml` + the single trilingual gold fixture
- [ ] Test scripts wired in `package.json`

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| SSE streams on App Hosting over real 4G | QUAL/SC1 (SPIKE-DEPLOY) | Needs a real device on a real mobile network in `asia-southeast1` | Deploy minimal streaming endpoint; observe token-by-token arrival on a phone off-WiFi |
| PDPA Transfer Impact Assessment on file | FND-09 / QUAL-03/04 (SC5) | Legal/compliance artifact, not code | TIA drafted + Derek sign-off committed before any real PII flows (gates pilot) |
| Firestore region confirmed (G1) | FND-01 / QUAL-04 | Immovable human decision with Derek | `asia-southeast1` confirmed before any Firebase resource is created |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
