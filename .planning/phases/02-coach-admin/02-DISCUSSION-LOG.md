# Phase 2: Coach + Admin v1 - Discussion Log

> **Audit trail only.** Do not use as input to planning/research/execution agents.
> Decisions are captured in `02-CONTEXT.md`; this log preserves the alternatives considered.

**Date:** 2026-06-01
**Phase:** 02-coach-admin
**Mode:** `--auto` (no interactive questions — recommended defaults auto-selected)
**Areas discussed (auto):** Chat/conversation model · AI disclosure & handoff · Journey & Coach depth · Playbooks/walkthroughs · Stall nudges & escalation · Senior-coach dashboard · Admin KB app · Auth surfaces · Eval/QUAL-06

---

## Chat surface & conversation model (→ D-01, D-02, D-03)
| Option | Description | Selected |
|--------|-------------|----------|
| Single rolling thread | One ongoing thread, simplest | |
| Primary thread + history list/search | Persistent Coach thread + browsable history (CHAT-07) | ✓ |
| Thread-per-topic | Auto-created topic threads | |
**Auto-choice:** primary-thread-plus-history-list. Trilingual = auto-detect + manual override chip (CHAT-08). Spine (SSE/persist/audit) reused from P1 unchanged.

## AI disclosure & human handoff (→ D-04, D-05)
| Option | Description | Selected |
|--------|-------------|----------|
| First-run modal + persistent badge | One-time disclosure + header "AI" badge | ✓ |
| Persistent banner only | Always-on notice | |
| First-message system notice | Disclosure as first chat message | |
**Auto-choice:** first-run modal + badge; handoff = header action bundling context into an escalation via the P1 `emitHandoffSignal` seam (KB-miss reuses it).

## Onboarding journey & Coach depth (→ D-06)
| Option | Description | Selected |
|--------|-------------|----------|
| Coarse stages | ~5 milestones, no checks | |
| Config/KB-driven checkpoints + comprehension gates | Named checkpoints, KB-referenced content, checks (COACH-09) | ✓ |
| Hard-coded detailed checklist | Code-defined steps | |
**Auto-choice:** config/KB-driven checkpoint journey; day-one pairing kicks off the KB-driven PowerBoost playlist.

## Playbooks & walkthroughs (COACH-07/08) (→ D-07)
| Option | Description | Selected |
|--------|-------------|----------|
| KB-grounded conversational guidance | Playbooks/walkthroughs are KB docs the Coach walks through | ✓ |
| Bespoke interactive UI per playbook | Custom flows per channel | |
**Auto-choice:** KB-grounded conversational walkthroughs (honors grounding mandate; Derek-editable).

## Stall nudges & escalation (COACH-04/05, CDASH-02/06) (→ D-08, D-09)
| Option | Description | Selected |
|--------|-------------|----------|
| In-app nudges via on-visit lazy-cron | runDueJobs writes nudge to thread + escalation row | ✓ |
| External scheduler (GitHub Actions) push | True wall-clock nudges | (flagged as revisit) |
| Email/SMS | Out-of-app channel | |
**Auto-choice:** in-app-on-visit nudges (consistent with the QStash→lazy-cron override). **Flagged tension (D-09):** lazy-cron is visit-triggered, softening "proactive 11pm" — escalate the scheduler choice to the user if the pilot needs true overnight push.

## Senior-coach dashboard v1 (CDASH-01..07, AUTH-02/06) (→ D-10, D-11, D-12)
| Option | Description | Selected |
|--------|-------------|----------|
| Focused single dashboard (all 7 CDASH) | Downline list + stall inbox + gap feed + inline correction + metrics (recharts) | ✓ |
| Minimal (list + alerts only) | Defer correction/metrics | |
**Auto-choice:** focused single dashboard; downline scoping double-gated (claims + rules, rules-tested); inline correction → versioned KB re-ingest (CDASH-04 loop closed).

## Admin KB app (ADMIN-01/03, AUTH-03) (→ D-13)
| Option | Description | Selected |
|--------|-------------|----------|
| Grow the existing P1 admin KB surface | Same Next app, admin route group | ✓ |
| Separate web app/deployment | Standalone admin app | |
**Auto-choice:** grow in-app (reuses the P1 CRUD + multi-format upload).

## Auth surfaces (AUTH-02/03) (→ D-14)
**Auto-choice:** add real sign-in for senior-coach + admin on the existing `requireUser`/session machinery; `set-claims` stays the provisioning path.

## Eval / QUAL-06 (→ D-15)
**Auto-choice:** expand the trilingual gold set to Phase-2 Coach capabilities with grounding/tone/hallucination/language rubrics; CI changed-prompt + lazy-cron nightly; run human calibration with Derek + a coach.

## Claude's Discretion
- Checkpoint taxonomy / number of journey stages; dashboard IA/component composition; whether voice-sample capture UX starts in P2 onboarding (low priority).

## Deferred Ideas
- Finder/Reply pillars + LLM classifier (P3/P4); WhatsApp/auto-send (v1 constraint); email/SMS nudges (pilot-dependent); funnel automation/CRM; voice-sample consumption (P4); multi-tenant/native/public recommender (v2).
