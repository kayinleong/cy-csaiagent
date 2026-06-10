# Phase 6: Console IA v2 — Context

**Gathered:** 2026-06-10
**Status:** Ready for planning
**Source:** Stakeholder decisions (Derek/user, 2026-06-10) on top of `.planning/phases/06-console-ia-v2/SCOPE.md` (full gap audit). This file LOCKS the scope split; SCOPE.md remains the verbatim gap audit reference.

<domain>
## Phase Boundary

v1.0 is code-complete (5/5 phases). The console today is a **flat 8-item sidebar** (`app/[lang]/_components/app-sidebar.tsx`) with **3 roles** (`new-agent | senior-coach | admin`, `src/firebase/auth.ts:36`). The business asks for a **6-section IA** + a **read-only stakeholder role**.

The original Phase 6 was milestone-sized (~12 new surfaces + new role + restructure). Per a 2026-06-10 stakeholder decision it is **split**:

- **Phase 6 (THIS PHASE):** the lower-risk "relocate, gate, consolidate, + light net-new" half that delivers the visible business ask.
- **Phase 7 (new):** the heavy net-new surfaces.
- **Phase 8 (new, future):** WhatsApp Business API — graduation-gated; out of scope here.

### IN SCOPE for Phase 6
1. **6-section navigation restructure** — Home · Knowledge Management · Agents & Cohorts · Conversations & Escalations · Analytics & Performance · System & Compliance. Role-filtered. Existing v1 surfaces **relocated** under the correct section. **No regression to any v1 feature.**
2. **Read-only stakeholder role** — a 4th role tier that can reach reporting/analytics surfaces ONLY, denied every write/admin surface. Enforced **server-side** (route-group `layout.tsx` gate + Firestore rules + custom claims), never nav-only hiding.
3. **Home surface** — key metrics, alerts aggregation, recent-activity feed, quick-actions launcher. Compose from EXISTING data sources (funnel, usage rollups, stall inbox, knowledge gaps) — do not invent new pipelines.
4. **Consolidation of existing surfaces:**
   - Fold KB (`(admin)/kb`) + Inventory (`(admin)/inventory`) into **Knowledge Management**.
   - Move escalations (stall inbox, today on the coach dashboard) beside **Conversations & Escalations**.
   - Unify coach-dashboard (`(coach)/dashboard`) + org usage (`(admin)/usage`) views under **Analytics & Performance**.
5. **Version-history viewer UI** for KB docs — data already tracked (`version`, `supersedesId`, "superseded" badge); add a history/diff view. No schema change needed.
6. **Senior-coach KB-contribution surface** — downline-scoped, audited; beyond today's inline-correction-only panel.
7. **Per-coach analytics pivot** — admin comparison/filter across coaches (today scoped to the logged-in coach's downline only).
8. **Integrations management shell** under System & Compliance — a registry/placeholder console panel only. **No WABA wiring.**

### OUT OF SCOPE for Phase 6 (deferred — see `<deferred>`)
- Net-new surfaces (cohorts, agent profiles, coach-assignment UI, flagged queue, audit-log viewer, model-config UI, PDPA-settings display, days-to-first-close) → **Phase 7**.
- WhatsApp Business API → **Phase 8**.

### DO NOT REBUILD (wire existing into new IA)
reply SOPs, training content, conversation viewer, stuck-agent detection, funnel metrics, pillar usage, knowledge gaps, permissions/roles, cost monitoring, erasure, admin role. (See SCOPE.md §"Already implemented".)
</domain>

<decisions>
## Implementation Decisions (LOCKED with user, 2026-06-10)

### Phase structure
- Split into Phase 6 (this) + Phase 7 (net-new). Phase 8 = WABA (future).

### Integrations
- Build only the Integrations **management shell** under System & Compliance (registry/placeholder). Actual WhatsApp Business API is Phase 8, gated on a reply-quality graduation bar.
- **The v1 hard constraints "No WhatsApp Business API in v1" and "No auto-send, ever" REMAIN IN FORCE for Phases 6 and 7.** The shell must not imply or enable any auto-send behavior.

### days-to-first-close — DEFERRED to Phase 7
- No close/deal signal exists today (only `avgDaysToProductive` ramp). Requires capturing a new close signal first → net-new, Phase 7.

### PDPA settings — DEFERRED to Phase 7
- When built (Phase 7): **read-only policy display** (retention/redaction/residency shown as policy-fixed) + link to the existing erasure flow. No new configurable knobs (residency/redaction are policy-bound and changing redaction touches the PII boundary).

### Read-only role (Phase 6)
- 4th role added to `Role` union + `VALID_ROLES` (`src/firebase/auth.ts`). Custom-claim driven (same path as existing roles via `setUserClaims`). Reporting/analytics read access only; all write/admin Server Actions and routes denied server-side; Firestore rules updated + rules-tested (extend the existing per-collection rules-unit-tests — every collection covered in CI).

### Resolved during research (2026-06-10) — LOCKED (least-privilege default; user may widen later)
- **Read-only collection allow-list (narrowest):** read-only MAY read `usageRollups`, `usageEvents`, `evals` (analytics aggregates, counts-only) + the KB read collections it already shares as a signed-in tenant user (`projects`, `collateral`, `kbDocs`, `kbChunks`). It is **DENIED** read on every PII/owner-scoped collection — `conversations`, `messages`, `leads`, `leadContext`, `auditLogs`, `erasureRequests`, `rateBudgets`, `users`, `agentProfiles` — and **DENIED** read on `knowledgeGaps`/`escalations` (they carry `agentUid`). **DENIED write everywhere.** Rationale: least-privilege for a new role touching PDPA data; matches the research rules matrix. (Open Q1 → default-narrowest; widening any of these requires an explicit user/Derek decision.)
- **Read-only does NOT see the coach dashboard** (funnel/ramp/knowledge-gap panels carry downline agent PII). Read-only sees Home + the org usage/cost analytics + the read-only KB version-history viewer only.
- **Read-only landing:** lands on **Home** post-login (not chat). (Open Q3 resolved.)
- **Fix the latent broken KB deep-link bug** (`/${lang}/admin/kb/...` → should be `/${lang}/kb/...`; `(admin)` is a route group and never appears in the URL) whenever KB is touched — `kb-doc-list.tsx:188`, `kb/[docId]/page.tsx:138,178`.
- **Add an i18n parity CI test** (en/ms/zh key-set equality) — CONTEXT mandates trilingual parity in CI and none exists today. In scope for Phase 6.
- **Nav restructure = regroup the sidebar into 6 sections OVER the existing routes; do NOT physically move route folders** (avoids URL/deep-link breakage + layout-gate mismatch). Existing `href`s unchanged.
- **Role-gate de-duplication (Open Q2):** planner's discretion — either extend each of the ~24 role-branch sites in place using the research checklist, OR introduce a `requireRole(allowed: Role[])` helper as its **own dedicated task with regression coverage** before layering the IA change. Either way the research checklist (06-RESEARCH.md "Role-branch sites") is the acceptance gate so no site is missed.

### Claude's Discretion
- Exact nav component shape (collapsible groups vs sections) within shadcn `sidebar.tsx` patterns — match existing `app-sidebar.tsx` conventions.
- Home surface layout/widget composition (as long as it reads existing data only).
- Whether consolidation is a route move (new route-group folders) or a nav-only regroup with existing routes kept — planner decides, but **must not break existing deep links / must not duplicate logic**.
- Version-history viewer presentation (timeline vs diff) — data contract is fixed.
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents (researcher, planner, checker) MUST read these before planning or implementing.**

### Phase scope + project rules
- `.planning/phases/06-console-ia-v2/SCOPE.md` — the verbatim gap audit (section-by-section, with file:line evidence). The single most important input.
- `CLAUDE.md` / `AGENTS.md` — project rules + Next.js 16 gotchas (proxy.ts, async cookies/headers, opt-in caching).
- `.planning/TSD.md` §3–§4 — architecture, 14-collection data model, security model.
- `.planning/REQUIREMENTS.md` — existing REQ-IDs (Phase 6 derives NEW REQ-IDs for IA/role/consolidation).
- `docs/ARCHITECTURE.md` — as-built diagrams.

### Role + auth (read-only role tier)
- `src/firebase/auth.ts:36` (`Role` union) + `:46` (`VALID_ROLES`) — where the 4th role is added.
- `app/[lang]/(admin)/layout.tsx`, `app/[lang]/(coach)/layout.tsx` — server-side route-group role gates (the pattern to extend).
- `firestore.rules` + the rules-unit-tests — role-based read/write gates (must add read-only role coverage).

### Navigation + shell
- `app/[lang]/_components/app-sidebar.tsx` — the flat 8-item sidebar to restructure into 6 sections.
- `app/[lang]/layout.tsx`, `app/[lang]/page.tsx` — locale shell + role-redirect (Home lands here).
- `components/ui/sidebar.tsx`, `components/ui/navigation-menu.tsx` — vendored shadcn primitives.

### Surfaces being relocated/consolidated (DO NOT rebuild)
- KB: `app/[lang]/(admin)/kb/`, `src/kb/crud.ts` (+ `kb-doc-list.tsx` superseded badge → version-history viewer).
- Inventory: `app/[lang]/(admin)/inventory/`.
- Conversations: `app/[lang]/(admin)/conversations/conversation-viewer.tsx` (audited, read-only).
- Escalations/stall: `(coach)/dashboard` stall-inbox + `(coach)/dashboard/actions.ts`.
- Usage/cost: `app/[lang]/(admin)/usage/usage-dashboard.tsx`.
- Roles/permissions: `app/[lang]/(admin)/roles/page.tsx` (+ `setUserClaims`).
- Coach dashboard panels: funnel (`FunnelV2Panel`), knowledge-gap feed, correction-eval.

### i18n
- `next-intl` catalogs (en/ms/zh) — all new nav copy + surfaces need trilingual entries (EN/BM/中文 parity in CI).
</canonical_refs>

<specifics>
## Specific Ideas

- The 6 section names are FIXED (business-requested): Home · Knowledge Management · Agents & Cohorts · Conversations & Escalations · Analytics & Performance · System & Compliance.
- "Agents & Cohorts" in Phase 6 = the existing downline/agent list relocated; the *cohort* concept (new data model) + agent profile drill-ins are Phase 7. The section can exist with just the relocated agent list now.
- Read-only role denial must be proven server-side (layout gate returns/redirects AND Firestore rules deny), verified by an integration/rules test — not just a hidden nav item.
- Home/alerts/recent-activity must reuse existing aggregations (funnel, usageRollups, stall inbox, knowledge gaps); no new lazy-cron jobs in Phase 6.
</specifics>

<deferred>
## Deferred Ideas (recorded with rationale — Phase-6 success criterion #5)

| Item | Deferred to | Rationale |
|------|-------------|-----------|
| Cohort management (+ data model) | Phase 7 | New collection + tenantId model; net-new, not a relocate. |
| Agent profile pages (per-agent drill-in) | Phase 7 | Net-new surface. |
| Coach-assignment UI (coach→agent mapping) | Phase 7 | Net-new admin surface beyond role assignment. |
| Conversation flagged queue | Phase 7 | New flag/report mechanism + collection. |
| Audit-log viewer surface | Phase 7 | New read surface over existing audit writes. |
| Model-config admin UI (Remote Config read/write) | Phase 7 | Net-new; must read/write Remote Config, never hard-code. |
| PDPA-settings surface (read-only display) | Phase 7 | Net-new display; no new knobs. |
| days-to-first-close metric | Phase 7 | Needs a new close/deal signal captured first. |
| WhatsApp Business API integration | Phase 8 | Overrides v1 "no WABA / no auto-send"; graduation-gated; large standalone integration. |

</deferred>

---

*Phase: 06-console-ia-v2*
*Context gathered: 2026-06-10 via stakeholder decisions on the SCOPE.md gap audit*
