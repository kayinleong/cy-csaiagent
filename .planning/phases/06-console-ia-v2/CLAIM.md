# Claim: phase-kayinleong-06

- owner: kayinleong
- session: claude-code
- branch: main
- started: 2026-06-10
- status: in-progress
- summary: Plan (and, per --auto, execute) Phase 6 — Console IA v2. Restructure the admin/coach console into the 6-section IA, add a read-only stakeholder role, and consolidate/relocate existing surfaces — WITHOUT rebuilding any working v1 feature. Scope narrowed by a stakeholder split decision (2026-06-10): the heavy net-new surfaces move to a new Phase 7; WhatsApp Business API becomes its own future Phase 8 (v1 "no WABA / never auto-send" constraint stays in force for 6/7).

## What will change

This claim covers the **planning** of Phase 6 (CONTEXT/RESEARCH/UI-SPEC/PATTERNS/PLAN docs) and, because the command was invoked with `--auto`, the **execution** of the resulting plans.

### Scope decisions locked with the user (2026-06-10) — drive the split
1. **Structure:** Split the milestone-sized gap audit. **Phase 6 = IA restructure + read-only role + consolidation of existing surfaces** (lower-risk "relocate & gate" work that delivers the visible business ask). **Phase 7 (new) = net-new surfaces** (cohorts +data model, agent profile pages, coach-assignment UI, flagged queue, audit-log viewer, model-config UI, PDPA-settings read-only display, days-to-first-close).
2. **Integrations:** Build the Integrations **management shell** (console registry under System & Compliance) in Phase 6. The actual **WhatsApp Business API = its own future Phase 8** with the reply-quality graduation gate. The v1 hard constraints ("No WABA in v1", "No auto-send, ever") REMAIN in force for Phases 6 and 7.
3. **days-to-first-close:** Requires a new close/deal signal captured first → **Phase 7** (net-new).
4. **PDPA settings:** **Read-only policy display** (retention/redaction/residency shown as policy-fixed) + link to the existing erasure flow → **Phase 7** (net-new). No new configurable knobs.

### Phase 6 boundary (THIS claim)
- The 6-section navigation restructure (Home · Knowledge Management · Agents & Cohorts · Conversations & Escalations · Analytics & Performance · System & Compliance), role-filtered, with existing v1 surfaces relocated under the correct section — **no regression to any v1 feature**.
- A **read-only stakeholder role** (4th role tier) that can reach reporting/analytics surfaces only, denied every write/admin surface, enforced **server-side** (route-group layout gate + Firestore rules), not just hidden in nav.
- **Home** surface (key metrics / alerts / recent activity / quick actions — composed from existing data sources where possible).
- **Consolidation:** fold KB + Inventory into Knowledge Management; move escalations beside Conversations; unify coach-dashboard + usage into Analytics & Performance.
- **Version-history viewer** UI for KB docs (data already tracked: version/supersedesId).
- **Senior-coach KB-contribution surface** (downline-scoped, audited) — beyond today's inline-correction panel.
- **Per-coach analytics pivot** (admin comparison/filter across coaches).
- **Integrations management shell** under System & Compliance (registry/placeholder; no WABA wiring).
- Trilingual (EN/BM/中文) nav + new copy; all v1 hard constraints honored.

### Explicitly deferred (recorded with rationale per Phase-6 success criterion #5)
- Net-new surfaces → **Phase 7** (cohorts, agent profiles, coach-assignment, flagged queue, audit-log viewer, model-config UI, PDPA-settings display, days-to-first-close).
- WhatsApp Business API integration → **Phase 8** (graduation-gated).

## What has changed

(filled as planning + execution proceed)

## Verification

(Regression Report required before this claim is marked `done` — per global CLAUDE.md. Must confirm the IA restructure relocates surfaces without breaking any v1 route, the read-only role is server-side-gated + rules-tested, and no working feature was rebuilt.)
