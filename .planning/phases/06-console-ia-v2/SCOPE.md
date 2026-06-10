# Phase 6 Scope — Console IA v2

**Source:** Post-v1 stakeholder feedback (Derek) + full codebase gap audit (quick-task analysis, 2026-06-10).
**Status:** Not planned. This file is the planner's input — it captures the gap audit verbatim so no context is lost between the audit and `/gsd-plan-phase 6`.

> v1.0 is code-complete (5/5 phases). Today the console is a **flat 8-item sidebar** (Dashboard · KB · Inventory · Chat · Conversations · Roles · Usage · Erasure) with **3 roles** (`new-agent`, `senior-coach`, `admin`). Business feedback asks for a **6-section IA** + a **3-tier role model**.

---

## Target 6-section information architecture

1. **Home** — key metrics, alerts, recent activity, quick actions
2. **Knowledge Management** — project briefs, reply SOPs, training content, lead-gen playbooks, version history
3. **Agents & Cohorts** — agent list, individual profiles, cohort management, stuck-agent detection, coach assignments
4. **Conversations & Escalations** — conversation viewer, flagged queue, active escalations, audit logs
5. **Analytics & Performance** — funnel metrics, days-to-first-close, pillar usage, knowledge gaps, per-coach view
6. **System & Compliance** — model config, permissions, PDPA settings, integrations, cost monitoring

## Role-scoped views

| Role | Expectation | Today |
|------|-------------|-------|
| Admin | Full access | ✅ exists |
| Senior coach | Downline only + escalations + KB contributions | 🟡 downline + escalations exist; KB-contribution surface missing (only inline-correction panel) |
| Read-only stakeholder | Reporting access only | ❌ no such role — `Role = 'new-agent' \| 'senior-coach' \| 'admin'` (`src/firebase/auth.ts:36`, `VALID_ROLES` :46) |

---

## Gap audit (section by section)

### 1. Home — ❌ entirely new
- `app/[lang]/page.tsx:36-42` is a pure redirect (coach/admin → dashboard, agent → chat). No Home surface.
- Missing: key-metrics overview, alerts aggregation, recent-activity feed, quick-actions launcher.

### 2. Knowledge Management — 🟡 partial
- ✅ Reply SOPs (KB `pillar:reply` + `category`, `src/kb/crud.ts`, `app/[lang]/(admin)/kb/`).
- ✅ Training content (KB `pillar:coach`).
- 🟡 Project briefs live in a **separate** `/inventory` surface (projects + collateral), not unified under KM.
- ❌ Lead-gen playbooks — no first-class type/category surfaced (open `category` string only).
- 🟡 Version history — **tracked** (`version`, `supersedesId`, "superseded" badge in `kb-doc-list.tsx`) but **no history/diff viewer UI**.
- ❌ Not grouped as one "Knowledge Management" section (KB + Inventory are separate flat nav items).

### 3. Agents & Cohorts — 🟡 partial
- ✅ Stuck-agent detection — stall inbox + stall-detect lazy-cron (`stall-inbox.tsx`, `(coach)/dashboard/actions.ts`).
- 🟡 Agent list — downline table (`downline-table.tsx`), downline-scoped for coach / all for admin; not a full directory.
- ❌ Individual agent profile pages — no per-agent drill-in.
- ❌ Cohort management — **no cohort concept exists anywhere** (grep: 0 hits); needs data-model addition.
- ❌ Coach assignments — `seniorCoachId` gates reads but **no admin UI** to assign/reassign coach→agent. (`/roles` assigns role tiers, not coach mapping.)

### 4. Conversations & Escalations — 🟡 partial
- ✅ Conversation viewer — admin, read-only, audited, cross-pillar (`(admin)/conversations/conversation-viewer.tsx`).
- 🟡 Active escalations — stall inbox = escalations, but lives on the **coach dashboard**, not grouped here.
- ❌ Flagged queue — no flag/report mechanism on conversations.
- 🟡 Audit logs — **written** (audit-before-read), but **no audit-log viewer** surface.

### 5. Analytics & Performance — 🟡 partial
- ✅ Funnel metrics — `trainingFunnel` + `FunnelV2Panel`.
- ✅ Pillar usage — token-by-pillar chart (`(admin)/usage/usage-dashboard.tsx:252`).
- ✅ Knowledge gaps — feed + aggregation panel.
- ❌ Days-to-first-close — only `avgDaysToProductive` (ramp) exists; no sales first-close metric.
- 🟡 Per-coach view — scoped to logged-in coach's downline; no admin per-coach comparison/filter pivot.
- ❌ Not one Analytics section — split across coach-dashboard + usage.

### 6. System & Compliance — 🟡 partial
- ✅ Permissions — role assignment UI (`(admin)/roles/page.tsx`).
- ✅ Cost monitoring — usage + cost dashboard.
- ❌ Model config — resolves from Remote Config (`src/llm/provider.ts`), set in Firebase console; no in-app UI.
- 🟡 PDPA settings — right-to-erasure exists; no retention/redaction/residency settings.
- ❌ Integrations — none in v1 by design (no WhatsApp API). **Confirm in-scope vs N/A** under the no-WABA-v1 constraint.

---

## Summary buckets

- **❌ Entirely new:** Home · cohort management (+data-model) · coach-assignment UI · agent profile pages · flagged queue · audit-log viewer · days-to-first-close metric · model-config UI · PDPA settings · integrations surface · read-only role tier · the 6-section nav restructure.
- **🟡 Exists, needs work/consolidation:** version-history viewer · lead-gen playbook type · per-coach pivot · fold KB+Inventory into KM · move escalations beside Conversations · unify split analytics · senior-coach KB-contribution surface.
- **✅ Already implemented (wire in, do NOT rebuild):** reply SOPs, training content, conversation viewer, stuck-agent detection, funnel, pillar usage, knowledge gaps, permissions, cost monitoring, erasure, admin role.

---

## Hard constraints (carried from CLAUDE.md — apply in full)

- No Cloud Functions; Next.js Route Handlers / Server Actions / Server Components only.
- No GCP beyond the Firebase SDK surface.
- Model IDs from Remote Config, never hard-coded — a model-config UI must read/write Remote Config, not hard-code.
- PDPA: pseudonymize PII at the Claude boundary; audit-log client conversations; never log PII. New surfaces that read conversations/audit must keep audit-before-read + read-only posture.
- Core/shell split: `src/` never imports from `app/`.
- Every Firestore doc carries `tenantId` (new collections: cohorts, flags, etc.).
- Trilingual (EN/BM/中文) from the start — nav copy + new surfaces all need catalog entries.
- Next.js 16: `proxy.ts` (not `middleware.ts`), async `cookies()`/`headers()`, opt-in caching.
- Role gates are server-side (route-group `layout.tsx` + Firestore rules), never nav-only hiding.

## Open questions for planning / Derek

1. Integrations section — anything concrete in v1.x, or mark N/A until WABA graduation?
2. PDPA "settings" — which knobs are real (retention window, redaction toggles) vs. fixed-by-policy?
3. Is "days-to-first-close" sourced from existing data, or does it need a new close/deal signal captured first?
4. Should this stay one phase or split (e.g. 6 = IA restructure + read-only role; 7 = new analytics/agent surfaces)? Scope suggests milestone-sized.
