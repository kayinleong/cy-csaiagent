# Claim: phase-kayinleong-04

- owner: kayinleong
- session: claude-code
- branch: phase-kayinleong-01
- started: 2026-06-05
- status: in-progress
- summary: Execute Phase 4 (Reply Assistant + Reply Analytics) — 10 plans across waves 0-6. Third pillar (Reply) mirrors the Finder shape; 3-pillar router activation; reply SOP KB + admin; edit-as-signal analytics; copy-only paste-and-draft (no auto-send). Grow-don't-fork throughout.

## What will change

All 10 Phase-4 plans (04-01..04-10), executed SEQUENTIALLY on `phase-kayinleong-01` (global CLAUDE.md: no worktree isolation for agents):

- **04-01 (Wave 0)** — failing-test stubs (RED) for every requirement: PDPA coverage, reply agent, diff, router 3-pillar, replyEdits rules, rag/kb pillar, route dispatch, Reply gold sets, e2e.
- **04-02 (Wave 1)** — close the PDPA false-positive gate: inject lead names + IC/email/RM-financial regexes; make `pdpa_redacted` reflect real coverage (security blocker).
- **04-03 (Wave 1)** — `kbChunks.pillar` migration + pipeline write + backfill + composite vector index; `retrieveReplySop` pillar filter.
- **04-04 (Wave 1)** — router 3-pillar: heuristic Reply patterns (precedence over finder keywords) + classifier ternary; fix `classifier.test.ts:95`.
- **04-05 (Wave 2)** — `src/agents/reply/*` (mirror Finder) + read-only tools (`retrieveReplySop`/`fetchVoiceSamples`/`fetchLeadContext`) + `ReplySlot`/`readReplySlot`.
- **04-06 (Wave 3)** — 3-pillar chat-route dispatch + required-`leadId` fail-closed (400) + GATE-3 lead-name injection + replySlot onFinish + `no_sop_match → knowledgeGaps` kb-miss write.
- **04-07 (Wave 4)** — `replyEdits` collection + downline-scoped rules + indexes + `src/reply/diff.ts` + `captureReplyEdit` Server Action.
- **04-08 (Wave 5)** — Reply draft card (copy-only egress + thumbs-down feedback) + lead selector + override chip widening + disclosure copy + all Phase-4 i18n (en/ms/zh).
- **04-09 (Wave 6)** — Reply SOP admin pillar filter (ADMIN-05) + judge rubric extension + Reply gold sets (REPLY-05/06/07/08).
- **04-10 (Wave 6)** — Reply Quality dashboard panel (REPLY-11/ADMIN-06) + `WABA-GATE.md` (REPLY-12, documented gate only).

Built against the locked overrides (Gemini 1024-d embeddings, on-visit lazy-cron, AI SDK v5). Hard constraints honored: no Cloud Functions / no GCP beyond Firebase / no WABA code / no auto-send (copy-only) / model-from-Remote-Config / PDPA boundary / core-shell split / trilingual.

Continues on branch `phase-kayinleong-01`; not pushed (standing user hold).

## What has changed

(pending — updated per wave as plans complete; per-plan detail in each `04-0{1..10}-SUMMARY.md`)

## Verification

(pending — gsd-verifier goal-backward verification → `04-VERIFICATION.md` after all waves; quality gates `tsc`/`vitest`/`lint`; regression report)
