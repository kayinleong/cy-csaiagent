# Phase 7: Console IA v2 — Net-new Surfaces - Context

**Gathered:** 2026-06-11
**Status:** Ready for planning
**Mode:** `--auto` (all gray areas auto-selected; recommended option chosen for each — review and override before planning if any decision is wrong)
**Source:** Roadmap Phase 7 scope + the Phase 6 split decision (`06-CONTEXT.md` `<deferred>`). These are the heavy net-new surfaces split out of Phase 6 — they build INTO the established 6-section IA + read-only role, neither of which is rebuilt here.

<domain>
## Phase Boundary

Phase 6 delivered the 6-section IA (Home · Knowledge Management · Agents & Cohorts · Conversations & Escalations · Analytics & Performance · System & Compliance), the read-only stakeholder role (server-side gated, least-privilege), and relocated/consolidated every working v1 surface. **Phase 7 builds the 8 net-new surfaces that were deliberately deferred**, each slotting under an existing Phase-6 section. Nothing from Phase 6 is rebuilt; the IA shell, the `requireRole()` gate, the read-only role, and the collections-registry pattern are all consumed as-is.

### IN SCOPE — the 8 net-new surfaces (each maps to a Phase-6 section)

| # | Surface | Phase-6 section | Net-new artifact |
|---|---------|-----------------|------------------|
| 1 | **Cohort management** (+ data model) | Agents & Cohorts | new `cohorts` collection + admin management UI |
| 2 | **Agent profile pages** (per-agent drill-in) | Agents & Cohorts | read-only composed profile view |
| 3 | **Coach-assignment UI** (coach→agent mapping) | Agents & Cohorts | admin reassignment surface over existing fields |
| 4 | **Conversation flagged queue** | Conversations & Escalations | new `conversationFlags` collection + flag action + queue view |
| 5 | **Audit-log viewer** | System & Compliance | read-only surface over existing `auditLogs` |
| 6 | **Model-config admin UI** (Remote Config read/write) | System & Compliance | read/write `model.{pillar}.default` |
| 7 | **PDPA-settings read-only display** | System & Compliance | static policy display + erasure link |
| 8 | **days-to-first-close metric** | Analytics & Performance | new close signal capture + derived metric |

### OUT OF SCOPE
- The 6-section IA, read-only role, consolidation, Home, KB version viewer, per-coach pivot, senior-coach KB-contribution, Integrations shell — **all DONE in Phase 6; wire into, do not rebuild.**
- WhatsApp Business API + any auto-send — **Phase 8**, graduation-gated. The v1 hard constraints "No WABA in v1" and "No auto-send, ever" **remain in force for Phase 7.**
- A full `deals`/CRM pipeline — only the single close signal needed for days-to-first-close is captured (see D-22).
</domain>

<decisions>
## Implementation Decisions

> All decisions below were auto-selected under `--auto` using the recommended (least-privilege, minimal-surface, registry-consistent) option. They are LOCKED for planning unless the user overrides.

### Cohort management (Surface 1)
- **D-01:** A cohort is a **new top-level `cohorts/{cohortId}` collection** declared in `src/firebase/collections.ts` via the existing `makeConverter` pattern (stamps `tenantId`). Fields: `tenantId`, `name`, `description`, `createdAt`, `createdBy` (admin uid). Deny-by-default Firestore rules; **server/Admin-SDK or admin-only writes**; rules-unit-test added for the new collection (every collection covered in CI — Pitfall 6 mandate).
- **D-02:** Cohort **membership is a denormalized `cohortId?: string` field added to `AgentProfileDoc`** — NOT a UID array on the cohort doc (1 MB trap) and NOT a join collection (YAGNI). Membership is **one cohort per agent** (a cohort = an onboarding intake batch / team). Cohort filtering reuses the equality pattern `where('cohortId','==',cid)`.
- **D-03:** Cohort **write = admin-only**; **read = admin (all) + senior-coach (cohorts containing their downline)**; **read-only role DENIED** (membership is agent-PII-adjacent). Cohort CRUD is audited.

### Agent profile pages (Surface 2)
- **D-04:** Agent profile is a **read-only drill-in composed ONLY from existing data** — `agentProfiles/{uid}` (journeyStage, currentCheckpoint, lastActiveAt, activeLeadIds, seniorCoachId, + new cohortId/firstCloseAt) joined with `usageRollups` for that uid, that agent's `escalations`/`knowledgeGaps` counts, and funnel position. **No new write path; journey state is NOT editable here** (editing would risk the journey state machine — out of scope).
- **D-05:** Profile **access: admin sees any agent; senior-coach sees only own-downline agents** (`agentProfiles.seniorCoachId == coach.uid`), and every coach read of an agent profile writes an `auditDrilldown(coachUid, 'agentProfiles')` row (mirrors AP-01 + the existing coach-drilldown PDPA requirement). **read-only role DENIED** (carries agent PII).

### Coach-assignment UI (Surface 3)
- **D-06:** Coach→agent assignment **writes the EXISTING fields — `agentProfiles.seniorCoachId` and mirrors `users.uplineCoachId`** — no schema change. Both are updated atomically in one Server Action and the reassignment is audited.
- **D-07:** Assignment is **admin-only** (mirrors the existing role-assignment UI which is admin-only via `setUserClaims`). Coaches cannot reassign their own downline.
- **D-08:** Denormalized `seniorCoachId` already stamped on historical rows (`replyEdits`, etc.) at row-creation time is **left as-is** on reassignment — historical analytics rows keep their original coach. Only future rows pick up the new coach. (Document this; backfilling historical denorm is out of scope.)

### Conversation flagged queue (Surface 4)
- **D-09:** Flagging uses a **new top-level `conversationFlags/{flagId}` collection** (registry pattern, stamps `tenantId`). Fields: `tenantId`, `conversationId`, `flaggedByUid`, `reason`, `status: 'open' | 'reviewed' | 'dismissed'`, `seniorCoachId` (denormalized for coach read-scope, mirrors `replyEdits` Pitfall D), `createdAt`, `reviewedBy?`, `reviewedAt?`. Deny-by-default rules; **writes via Admin-SDK Server Action only** (mirrors `escalations`); rules-unit-test added.
- **D-10:** **No conversation content is stored on the flag — `conversationId` reference only** (mirrors `auditLogs`/`usageEvents` no-PII posture). The queue resolves the conversation through the EXISTING audited conversation viewer.
- **D-11:** Flagging is **manual** (a coach/admin flags a conversation from the existing viewer) — **no AI auto-flagging in v1** (YAGNI). Flag write = coach (own-downline conversations) + admin; queue read = admin (all open flags) + senior-coach (own-downline flags). **read-only role DENIED.**

### Audit-log viewer (Surface 5)
- **D-12:** A **read-only admin surface over the existing `auditLogs` collection** showing `actorUid`, `action`, `targetRef`, `ts`. **Hashes are NOT decoded** (sha256 is one-way by design — TSD §5.3); the viewer is for compliance traceability (who/what/when), not content recovery.
- **D-13:** **Admin-only** (`auditLogs` is admin-read; read-only role DENIED). Bounded query: `orderBy('ts','desc').limit(50)` with cursor pagination + filter by `action` / `actorUid` / date range (reuse the bounded-query pattern from `searchConversations`).
- **D-14:** **The audit-log viewer does NOT self-audit** (it reads hashes-only metadata, touches no PII — avoids audit-of-audit recursion). Viewing is gated server-side; that is the control.

### Model-config admin UI (Surface 6)
- **D-15:** **Read AND write** of Remote Config (Roadmap SC requirement). The UI reads current `model.{pillar}.default` for the **5 known pillars** (`coach`, `finder`, `reply`, `router`, `grader` — the `Pillar` union in `src/llm/provider.ts:29`) and lets an admin update them. Writes go through the **Admin SDK Remote Config publish path** (`getServerTemplate()` → set parameter default → `publishTemplate()`), keeping `modelFor()` the single resolution surface. **Model IDs stay free-form strings** (model-agnostic constraint) — current `REMOTE_CONFIG_FALLBACKS` values shown as hints, never a hard-coded allow-list.
- **D-16:** **Only the 5 `model.{pillar}.default` keys are editable** — the UI does NOT expose arbitrary Remote Config keys (avoid breaking unrelated config). Write uses the template **ETag/version for optimistic concurrency** (surface a conflict error rather than blind-overwrite). A lightweight confirm dialog + audit row on publish (NOT type-to-confirm — a model swap is reversible, unlike erasure).
- **D-17:** Model-config UI is **admin-only**; every publish writes an audit row (`action: 'model_config_publish'`, hashed pillar+new model id). The labeled offline `REMOTE_CONFIG_FALLBACKS` constants remain untouched (they are the cold-bootstrap fallback only).

### PDPA-settings read-only display (Surface 7)
- **D-18:** A **static, read-only policy display** (no editable knobs — locked in `06-CONTEXT.md`). Shows policy-fixed values: residency region (`asia-southeast1`), PII-pseudonymized-at-boundary, `usageEvents` 90d TTL, audit hashes-only, <72h erasure SLA — sourced from a **single policy-constants module** (mirroring `PDPA-SIGNOFF.md` / the TIA), plus a **link to the existing admin erasure flow**.
- **D-19:** **Admin-only** for Phase 7 (consistent with the System & Compliance surfaces and the Phase-6 least-privilege lock: "widening read-only requires an explicit user/Derek decision"). Widening the PDPA-settings display to the read-only role is recorded as an **open Derek decision** (see `<deferred>`), not assumed.

### days-to-first-close metric (Surface 8)
- **D-20:** Capture a **minimal new close signal — a `firstCloseAt?: Date` field added to `AgentProfileDoc`** (NOT a full `deals` collection — YAGNI for a single metric; no CRM/WABA pipeline exists in v1 to derive it automatically).
- **D-21:** `firstCloseAt` is set by an **audited "record first close" Server Action** invoked by the **senior-coach (own downline) or admin** — the coach knows when their agent closes their first deal. The action is idempotent (records the FIRST close only; subsequent calls no-op or require admin override).
- **D-22:** **days-to-first-close = `firstCloseAt − onboarding start`** (onboarding start = `agentProfiles` creation / journey start), computed **read-time** in the Analytics & Performance aggregation — shown as a cohort/org aggregate (avg/median) AND per-agent on the agent profile page (Surface 2). This wires the real signal behind the existing CDASH-05 "training → first lead → first close" funnel stage. A full `deals` ledger (deal value, project, multi-close history) is **deferred** (see `<deferred>`).

### Cross-cutting (apply to every surface)
- **D-23:** **Two new collections only** — `cohorts` and `conversationFlags` — both via `makeConverter` in `src/firebase/collections.ts` (stamps `tenantId`), both deny-by-default in `firestore.rules`, both with rules-unit-tests added in the SAME plan that introduces them (Pitfall 6: no unruled collection ships). `firstCloseAt`/`cohortId` are field additions to `AgentProfileDoc` (no new collection). All collection refs accessed via named factories — never string literals.
- **D-24:** **Every new surface is gated server-side via the existing `requireRole()` helper** (`app/[lang]/_lib/require-role.ts`) — never nav-only hiding. Default posture: **read-only role is DENIED on ALL Phase-7 surfaces** (each is admin/coach config or carries agent/conversation PII). Phase 7 adds NO new read-only-visible surface (preserves the Phase-6 least-privilege allow-list). Nav filtering is UX-only.
- **D-25:** **Section placement (into the Phase-6 IA, hrefs unchanged):** cohorts + agent profiles + coach-assignment → **Agents & Cohorts**; flagged queue → **Conversations & Escalations**; audit-log viewer + model-config + PDPA-settings → **System & Compliance**; days-to-first-close → **Analytics & Performance**.
- **D-26:** **Trilingual EN/BM/中文 from the start** — every new surface string + nav label added to all three `next-intl` catalogs; the existing `i18n-parity.test.ts` (added in Phase 6) enforces key-set equality in CI.
- **D-27:** **Wave sequencing mirrors Phase 6:** Wave 0 = failing-test scaffold (new-collection rules matrix, field-add types, gate-denial tests, model-config write contract, close-action idempotency, i18n parity). Then data-model/rules (cohorts, conversationFlags, field additions) BEFORE the surfaces that consume them.

### Claude's Discretion
- Exact UI composition of each surface within the vendored shadcn primitives + the Phase-6 section layout conventions (`app-sidebar.tsx`, existing page patterns).
- Whether cohort management and coach-assignment share one "Agents & Cohorts" management page or are separate routes — planner decides (keep deep links stable).
- Pagination cursor mechanics for the audit-log viewer (startAfter vs offset) — bounded at 50 either way.
- Whether the model-config conflict-handling surfaces a retry or a reload — as long as it never blind-overwrites a newer template.
- Per-agent vs cohort-level rollup math for days-to-first-close presentation (both required; layout is open).
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents (researcher, planner, checker) MUST read these before planning or implementing.**

### Phase scope + project rules
- `.planning/ROADMAP.md` §"Phase 7: Console IA v2 — Net-new Surfaces" — the 8-surface scope + 5 success criteria.
- `.planning/phases/06-console-ia-v2/06-CONTEXT.md` — the split decision + the `<deferred>` table (each Phase-7 surface's rationale) + the LOCKED read-only least-privilege allow-list (do not widen without Derek).
- `.planning/phases/06-console-ia-v2/SCOPE.md` — the verbatim gap audit (file:line evidence for every surface).
- `CLAUDE.md` / `AGENTS.md` — hard constraints (No WABA / No auto-send still in force) + Next.js 16 gotchas (`proxy.ts`, async cookies/headers, opt-in caching).
- `.planning/TSD.md` §3–§4 (architecture + data model — the collection inventory the 2 new collections extend) + §5 (security/audit/PDPA model).
- `.planning/REQUIREMENTS.md` §"Phase 6 Requirements" — the REQ-ID derivation style + the "Out of Scope → deferred to Phase 7" rows (Phase 7 derives its own NEW REQ-IDs during planning).

### Data model (new collections + field additions)
- `src/firebase/collections.ts` — the SINGLE source of truth + `makeConverter` pattern; `AgentProfileDoc` (:75, gets `cohortId?` + `firstCloseAt?`); `AuditLogDoc` (:367, backs Surface 5); the ref-factory + numbered-comment convention to extend for `cohorts` + `conversationFlags`.
- `firestore.rules` + `src/firebase/__tests__/rules.test.ts` — deny-by-default rules + the per-collection rules-unit-test matrix to extend for the 2 new collections.

### Role + auth + server-side gating
- `app/[lang]/_lib/require-role.ts` — the centralized server-side gate (Phase 6); EVERY new surface routes its gate through this.
- `src/firebase/auth.ts:36` (`Role` union incl. `read-only`) + `roles/actions.ts` (`AssignableRole`, `setUserClaims`) — coach-assignment (Surface 3) parallels this admin-only claim path.

### Model-config (Remote Config read/write)
- `src/llm/provider.ts` — `modelFor()` read path (`getServerTemplate → evaluate → getString('model.{pillar}.default')`), the `Pillar` union (:29), and `REMOTE_CONFIG_FALLBACKS` (:39); Surface 6 adds the WRITE path (`publishTemplate`) over the SAME keys.
- `src/firebase/admin.ts` — exports `remoteConfig()`; Surface 6's write path uses the Admin SDK Remote Config template API here.

### Audit (viewer + write-on-read)
- `src/audit/log.ts` — `log()` (hashes-only, fire-and-forget) + `auditDrilldown(actorUid, targetRef)`; Surface 2 uses `auditDrilldown` on coach profile reads; Surface 5 reads the rows `log()` writes.

### Surfaces to drill into / wire (do NOT rebuild)
- `app/[lang]/(admin)/conversations/conversation-viewer.tsx` + `actions.ts` — the existing audited viewer the flagged queue (Surface 4) hangs off.
- `app/[lang]/(coach)/dashboard/` + `src/dashboard/queries.ts` — funnel/ramp/knowledge-gap aggregations; days-to-first-close (Surface 8) extends the funnel; agent-profile (Surface 2) reuses these queries.
- `app/[lang]/(admin)/roles/page.tsx` — the admin-only assignment-UI pattern coach-assignment (Surface 3) mirrors.
- `app/[lang]/_components/app-sidebar.tsx` — the 6-section nav to add the new role-filtered entries under (D-25).
- `app/[lang]/(admin)/usage/usage-dashboard.tsx` — the Analytics & Performance host for the days-to-first-close metric.

### i18n
- `next-intl` en/ms/zh catalogs + `i18n-parity.test.ts` (Phase 6) — every new string trilingual; parity enforced in CI.
</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `makeConverter<T>()` + named ref-factory convention (`collections.ts`) — the `cohorts` and `conversationFlags` collections drop straight in; `tenantId` stamping is automatic.
- `requireRole({ lang, allowed, fallback })` (`require-role.ts`) — every new surface's server-side gate; read-only denial is one helper call.
- `auditDrilldown(actorUid, targetRef)` (`audit/log.ts`) — coach reads of agent profiles (Surface 2) are one call; the same `log()` rows back the audit-log viewer (Surface 5).
- `modelFor()` + `Pillar` union + `REMOTE_CONFIG_FALLBACKS` (`llm/provider.ts`) — read side of model-config (Surface 6) already exists; only the publish path is net-new.
- `AgentProfileDoc.seniorCoachId` + `UserDoc.uplineCoachId` — the coach→agent mapping fields ALREADY exist; coach-assignment (Surface 3) is a write surface over them, no schema change.
- The bounded-query patterns (`searchConversations` limit 50, `listUsersWithRoles` limit 200) — reuse for the audit-log viewer pagination.

### Established Patterns
- **Server-only collections file:** `collections.ts` uses `adminDb`; never import it from a client component (read client-side via `clientDb`). New surfaces' reads go through Server Components / Server Actions.
- **Deny-by-default + rules-test-in-same-plan** (Pitfall 6): a collection and its Firestore rules + rules-unit-test ship together.
- **Server/Admin-SDK-only writes** for sensitive collections (escalations, knowledgeGaps, replyEdits, usage*, erasureRequests) — `conversationFlags` follows the same `create/update/delete: if false`-for-clients posture.
- **Denormalized `seniorCoachId` for coach read-scope** (replyEdits Pitfall D) — `conversationFlags` repeats this so the coach read-rule can match.
- **Server-side gate is the authorization boundary; nav filtering is UX-only** (IA-01 / RO-02) — carried into every Phase-7 surface.

### Integration Points
- `AgentProfileDoc` gains `cohortId?` + `firstCloseAt?` — the touch-point for cohorts (Surface 1) AND days-to-first-close (Surface 8); both surfaces and the agent-profile view (Surface 2) read these fields.
- `firestore.rules` + `rules.test.ts` — extended for `cohorts` + `conversationFlags` (and the new read scopes).
- `app-sidebar.tsx` — 8 new role-filtered nav entries distributed across 4 Phase-6 sections (D-25).
- `remoteConfig()` template publish — the only write to GCP config surface; stays within the Firebase Admin SDK (no forbidden GCP service).
</code_context>

<specifics>
## Specific Ideas

- The 8 surfaces are a FIXED list from the Roadmap + the Phase-6 `<deferred>` table — discussion clarified HOW to build each, not WHETHER to add more.
- "Agents & Cohorts" already exists as a Phase-6 section with the relocated agent list; Phase 7 fills in the *cohort* concept + agent drill-ins + coach-assignment that the section name promised.
- Model-config must read/write Remote Config (never hard-code a model ID) — this is the one surface that writes to a Firebase-managed config service; it must stay inside the Admin SDK surface (no Vertex/forbidden GCP).
- days-to-first-close is the one surface that needs a NET-NEW signal captured before the metric can exist — everything else reads or lightly extends existing data. Keep the close-signal capture minimal (one field + one audited action).
- The read-only stakeholder role gains NOTHING in Phase 7 by default (every surface is admin/coach or PII-bearing) — this is intentional and preserves the Phase-6 least-privilege allow-list.
</specifics>

<deferred>
## Deferred Ideas

| Item | Deferred to | Rationale |
|------|-------------|-----------|
| Full `deals`/CRM ledger (deal value, project, multi-close history) | Future phase | days-to-first-close needs only a single `firstCloseAt` signal (D-20); a full deal pipeline is net-new scope unto itself. |
| AI auto-flagging of conversations (quality/risk heuristics) | Future phase | Phase 7 flagged queue is manual-flag only (D-11); auto-detection is a separate capability. |
| Backfilling historical denormalized `seniorCoachId` on reassignment | Future / on-demand | Historical analytics rows keep their original coach (D-08); a backfill is its own migration task. |
| Widening the **read-only** role to see the PDPA-settings display | **Open Derek decision** | Phase-6 locked read-only to a least-privilege allow-list; any widening "requires an explicit user/Derek decision" (D-19). PDPA policy text is PII-free, so it is a plausible widening — but not auto-assumed. |
| Many-to-many cohort membership / nested cohorts | Future phase | D-02 fixes one-cohort-per-agent (intake-batch semantics); richer membership is YAGNI for the pilot. |
| Editable agent journey state from the profile page | Out of scope | Profile is read-only (D-04); editing journey state risks the journey state machine and belongs with the Coach pillar, not an IA surface. |
| WhatsApp Business API / any auto-send | **Phase 8** | Graduation-gated; overrides v1 "No WABA / No auto-send" which stays in force through Phase 7. |

</deferred>

---

*Phase: 07-console-ia-v2-net-new-surfaces*
*Context gathered: 2026-06-11 via `/gsd-discuss-phase 7 --auto` (recommended option auto-selected per gray area)*
