# Claim: phase-kayinleong-07

- owner: kayinleong
- session: claude-code
- branch: main
- started: 2026-06-11
- status: claimed
- summary: Plan Phase 7 — Console IA v2 (Net-new Surfaces). Build the 8 net-new console surfaces deferred out of Phase 6 (cohort management +data model, agent profile pages, coach-assignment UI, conversation flagged queue, audit-log viewer, model-config admin UI, PDPA-settings read-only display, days-to-first-close) INTO the established Phase-6 6-section IA + read-only role — neither rebuilt. read-only is DENIED on every Phase-7 surface (preserves the LOCKED Phase-6 least-privilege allow-list). v1 "no WABA / no auto-send" stays in force.

## What will change

This claim covers the **planning** of Phase 7 — deriving 18 NEW REQ-IDs, producing 6 PLAN.md files across 4 waves, appending the REQ-IDs + traceability to REQUIREMENTS.md, finalizing the Phase-7 placeholders in ROADMAP.md, and populating 07-VALIDATION.md's per-task verification map. Execution is a separate step (`/gsd-execute-phase 7`).

### Net-new data model (2 collections + 2 optional fields — the entire net-new model)
- `cohorts/{cohortId}` (Collection 21) — admin-write, coach/admin-read; deny-by-default + rules-test.
- `conversationFlags/{flagId}` (Collection 22) — Admin-SDK-write only, content-free (conversationId reference), denormalized seniorCoachId; deny-by-default + rules-test.
- `AgentProfileDoc.cohortId?` (membership, one-per-agent) + `AgentProfileDoc.firstCloseAt?` (close signal) — backward-compat, no backfill.

### Plan set (6 plans, waves 0-3)
- **07-01 (W0):** RED scaffold — cohorts/conversationFlags rules matrix (read-only + cross-coach + client-write DENY), field-type stubs, Server-Action contracts (coach-assignment dual-write, audit-log bounded/no-self-audit, model-config ETag/no-force, record-close idempotency), days-to-first-close math, nav read-only-blindness, CI grep guards.
- **07-02 (W1):** Data model — the 2 collections (converter+ref) + the 2 fields + deny-by-default rules + rules-tests GREEN + composite indexes; blocking deploy checkpoint (rules+indexes; index build async).
- **07-03 (W2):** Agents & Cohorts cluster — admin cohort CRUD; admin-only coach-assignment atomic dual-write (D-07); read-only agent profile under the `(coach)` group (audited downline read, no journey edit); getAgentProfile + daysToFirstClose; idempotent record-first-close.
- **07-04 (W2):** Conversation flagged queue — content-free flagConversation (coach own-downline + admin); scoped queue view under `(coach)`; "Flag conversation" button on the existing admin viewer.
- **07-05 (W2):** System & Compliance cluster — model-config RC read/publish (ETag, no force, audited; the one net-new mechanism); bounded audit-log viewer (no self-audit, hashes not decoded); static PDPA-settings; blocking RC-publish-IAM checkpoint.
- **07-06 (W3):** Cross-cutting — 8 role-filtered nav entries (read-only sees none); trilingual en/ms/zh catalogs (parity-gated); days-to-first-close aggregate tile in Analytics & Performance.

### Key planning decisions / discoveries
- **Routing correction (verified against the live layouts):** the `(admin)` route group redirects senior-coach to `/dashboard` (`(admin)/layout.tsx:70`), so the coach-or-admin surfaces (agent profile per D-05, flagged queue per D-11, record-first-close per D-21) MUST live under the `(coach)` route group (admits senior-coach + admin per `(coach)/layout.tsx:51`). Admin-only surfaces (cohorts, coach-assignment, audit-log, model-config, pdpa-settings) live under `(admin)`. This corrects the loose `(admin)/...` placement in 07-PATTERNS.md.
- **days-to-first-close onboarding-start:** default to the Admin SDK `agentProfiles` doc `snapshot.createTime` (zero-migration; `AgentProfileDoc` has no `createdAt`); NEVER `lastActiveAt`. Flagged for Derek confirm (07-RESEARCH Open Q1) but planned against createTime.
- **All 27 CONTEXT decisions (D-01..D-27) cited across the plans; all 18 derived REQ-IDs mapped to ≥1 plan; every plan carries a `<threat_model>` (security_enforcement enabled).**

### Explicitly deferred (out of scope for Phase 7)
- Full `deals`/CRM ledger; AI auto-flagging; backfilling historical denormalized `seniorCoachId`; widening read-only to the PDPA-settings display (open Derek decision); many-to-many cohort membership; editable agent journey state; WhatsApp Business API / any auto-send (Phase 8).

## What has changed

Planning artifacts produced (this claim): 6 PLAN.md files (07-01..07-06), REQUIREMENTS.md (§"Phase 7 Requirements" + 18 traceability rows + reconciled coverage 116 total), ROADMAP.md (Phase-7 Requirements line + 6-plan list + progress row), 07-VALIDATION.md (per-task verification map populated, Wave-0 requirements checked). Code execution is NOT part of this claim.

## Verification

- All 27 CONTEXT decisions (D-01..D-27) cited across the 6 plans (grep-confirmed; D-07 explicitly cited in 07-03 coach-assignment).
- All 18 derived REQ-IDs appear in ≥1 plan's `requirements` frontmatter.
- Wave-2 file-ownership audited: 07-03/07-04/07-05 own disjoint route directories (no `files_modified` overlap → safe parallel). Shared files (`collections.ts`/`rules.test.ts`) are split across sequential waves 0/1; `app-sidebar-nav.ts` + i18n catalogs owned solely by the Wave-3 plan (07-06).
- Every plan has valid frontmatter (phase/plan/type/wave/depends_on/files_modified/autonomous/requirements/must_haves) + a `<threat_model>` + an `<artifacts_this_phase_produces>` section.
- Multi-source coverage audit (GOAL/REQ/RESEARCH/CONTEXT) — every item COVERED; no unplanned items; no scope reduction; no phase split needed.
- Regression note (planning-only claim): no code changed; ROADMAP/REQUIREMENTS/VALIDATION edits are additive (Phase-7 sections appended, prior phases untouched; coverage totals reconciled 98 → 116).
