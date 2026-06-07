---
phase: 05-hardening-scale
artifact: UI-SPEC
status: draft
design_system: shadcn (vendored — 55 components in components/ui/)
mode: brownfield (grow existing Phase 2/4 surfaces; do NOT redesign)
generated: 2026-06-07
---

# Phase 5 UI Design Contract — Hardening + Scale-Up

> **This is a BROWNFIELD UI phase, and the FINAL v1 phase.** Most surfaces GROW the
> already-shipped Phase 2/4 senior-coach dashboard and admin console. The chat shell,
> dashboard chrome, role-conditional scope, admin route group, console sidebar, and
> the audited chat-history drilldown all EXIST and work. **Do NOT redesign them.**
> Every entry below is "compose from vendored shadcn + match the named existing
> pattern." Inventing a new component, page, route group, dependency, or accent color
> is a smell, not a feature (CONTEXT.md "grow, don't fork").
>
> The ONE genuinely net-new and safety-critical surface is the **PDPA data-erasure
> request flow** (§Surface 5) — a destructive, irreversible admin action. Its
> confirmation UX is governed by hard rules HR-8…HR-12 below.

---

## 0. Hard Rules (the implementer CANNOT violate these)

| # | Rule | Source |
|---|------|--------|
| HR-1 | **No new UI dependency.** Everything composes from the 55 vendored `components/ui/` + `recharts` + `sonner` + `cmdk` (`command.tsx`) + `lucide-react`. The load-test harness (k6) is dev/CI tooling, not app UI. | CONTEXT code_context, critical_context |
| HR-2 | All new strings land in the existing `next-intl` catalogs (`src/i18n/messages/{en,ms,zh}.json`) under existing or new sub-namespaces. **No copy hard-coded in JSX.** Mobile-first sizing (`text-base md:text-sm`). EN canonical; BM + 中文 in the same catalogs, day one. | D-07, Phase 2/4 carry-forward |
| HR-3 | **All new charts are `'use client'` islands** rendered with `recharts`, fed plain serializable props from the RSC. NO recharts/client import in a Server Component (Pitfall 7). Reuse the exact `metrics-panel.tsx` chart conventions (`ResponsiveContainer width="100%" height={220}`, `margin={{ top: 4, right: 8, left: -16, bottom: 4 }}`, tick `fontSize: 12`, series `#6366f1` primary / `#f59e0b` secondary). | D-07/D-10, Pitfall 7 |
| HR-4 | **Role-conditional scope is reused, never re-invented.** Coach = downline-only; admin = org-wide. The scope is decided **server-side** via the existing `adminAll` flag (`dashboard/page.tsx`) and the `assertAdmin`/role-gate layout. Client islands only DISPLAY counts — they never re-query or widen scope. | D-07/D-09/D-10, AUTH-06 |
| HR-5 | **The admin conversation-log viewer is READ-ONLY.** No edit, no delete, no reply, no resend. It reuses the audited `getAgentChatHistory` drilldown pattern, widened to admin/cross-pillar scope, and EVERY open writes an `auditDrilldown` audit event server-side before messages return. | D-08, ADMIN-02 |
| HR-6 | **The role-assignment write is GUARDED and admin-only.** It is backed by the existing `set-claims` mechanism (no new auth model). A self-demotion or admin→non-admin change requires the §Surface 3 confirmation step. The matrix VIEW is read-only; only the assignment control writes. | D-09, ADMIN-07 |
| HR-7 | **Usage/cost analytics read `usageRollups` only** (the rollup docs produced by the lazy-cron `usage-rollup` job) — never raw `usageEvents`, never a second pipeline. One source feeds both ADMIN-08 and the QUAL-08 cost pass. | D-04/D-05/D-10 |
| **HR-8** | **PDPA erasure is IRREVERSIBLE and the most safety-critical UI in the platform.** The flow has TWO mandatory gates before any deletion fires: (1) explicit subject selection (search → confirm the exact subject identity), (2) a **type-to-confirm** `AlertDialog` where the admin must type a confirmation token (the subject's display ref) — a single click NEVER triggers erasure. | D-01/D-02, QUAL-09, critical_context |
| **HR-9** | **The erasure confirm control uses `AlertDialogAction variant="destructive"`** and stays **disabled until the typed token matches**. The `AlertDialogCancel` is the visually default/safe choice. No primary-styled "Erase" button anywhere outside this guarded dialog. | D-01, HR-8 |
| **HR-10** | **Irreversibility must be stated in words, not implied.** The confirm dialog body must say, in all three languages, that this permanently deletes the subject's PII across all collections, cannot be undone, and that the audit log (hashes-only) is retained as the legal record. | D-01/D-03, PDPA posture |
| **HR-11** | **No bulk/multi-select erasure in v1.** Exactly one data subject per request. No "erase all", no list-checkbox bulk action. | CONTEXT scope (resist v2 creep) |
| **HR-12** | **The erasure trigger is admin-only at THREE layers:** the route-group layout gate, the page-level role check, and the Server Action's own admin assertion. The UI never assumes the gate above it; it renders nothing erasure-related for a non-admin. | D-01, HR-6, T-02-31 pattern |

---

## 1. Design System State (detected — do NOT re-specify)

| Aspect | Value | Evidence |
|--------|-------|----------|
| Component library | shadcn/ui, **fully vendored (55 files)** | `components/ui/` inc. `alert-dialog`, `table`, `tabs`, `chart`, `badge`, `sheet`, `card`, `dialog`, `command`, `input`, `select`, `scroll-area`, `skeleton`, `spinner`, `empty`, `progress`, `breadcrumb`, `pagination` |
| `components.json` | n/a (vendored, not registry-managed) | Tool: **existing vendored — no `shadcn init`, no registry pull** |
| Styling | Tailwind 4 + `cn()` from `@/lib/utils` | every surface file |
| Charts | `recharts` (client islands only — Pitfall 7) | `_components/metrics-panel.tsx`, `_components/reply-quality-panel.tsx` |
| Toasts | `sonner` (`toast.*`) | `stall-inbox.tsx`, `inline-correction-dialog.tsx` |
| Command palette | `cmdk` via `components/ui/command.tsx` | vendored |
| Icons | `lucide-react` | `app-sidebar.tsx` (`LayoutDashboard`, `MessageSquare`, `BookOpen`, `Building2`) |
| i18n | `next-intl`, catalogs at `src/i18n/messages/{en,ms,zh}.json`; namespaces: `app, auth, chat, handoff, kb, inventory, nav, errors, dashboard` | confirmed |
| Console shell + nav | `app/[lang]/_components/console-shell.tsx` + `app-sidebar.tsx` (role-filtered `NavItem[]`) | confirmed — new admin routes add `NavItem` entries here |
| Admin route gate | `(admin)/layout.tsx` redirects non-admins; per-page role re-check (`kb/page.tsx`) | confirmed — defense-in-depth, reuse verbatim |
| Audited drilldown | `getAgentChatHistory` Server Action + `Dialog`+`ScrollArea` message thread (`stall-inbox.tsx`) | confirmed — the conversation-viewer analog |

**Design tokens (inherited from shipped surfaces — reuse verbatim, do NOT redeclare):**

- **Spacing:** 8-point family already in use — `gap-1.5 / gap-2 / gap-3 / gap-4 / gap-6 / gap-8`, `px-3 py-3`, `px-4 py-8`, `mb-4 / mb-8 / mb-10`. New surfaces reuse these exact steps. Page wrappers: `container mx-auto max-w-6xl px-4 py-8` (dashboard) / `max-w-4xl px-4 py-8` (admin pages).
- **Typography:** `text-2xl font-bold tracking-tight` (page title), `text-lg font-semibold` (section heading), `text-base font-semibold` (panel/card title), `text-sm` (body), `text-xs text-muted-foreground` (meta/subtitle), `text-2xl font-bold` (scalar KPI numbers), `font-mono text-xs` (IDs/refs). Weights: `font-normal`, `font-medium`, `font-semibold`, `font-bold`. **Match these — declare no new sizes.**
- **Color:** dominant = `background` / `card`; secondary surface = `muted` / `secondary` (cards, sidebar, stat tiles); accent = `primary`, reserved for primary CTAs and active nav; `destructive` reserved for **delete/erasure actions + stall/alert badges only**. Cards = `rounded-xl ring-1 ring-foreground/10 shadow-sm` (vendored `Card` default). Charts inherit `#6366f1` primary + `#f59e0b` secondary series from `metrics-panel.tsx`. **Reuse — do not introduce new accent colors.** The erasure flow leans hard on the existing `destructive` token (HR-9) — no new red.

---

## 2. Surfaces to Build (5) — composition, states, mobile, copy keys

> Surface count note: the brief lists 6 items, but item 6 ("cost/usage figures") is **folded into Surface 4** per CONTEXT D-10 ("single source with the cost pass") and the §Specifics "ONE source" rule. There is exactly one usage/cost dashboard. See Surface 4.

---

### Surface 1 — Coach Dashboard v2 Panels  *(GROW `(coach)/dashboard` — new client islands)*  (D-07, CDASH-08)

**File:** add up to three new client islands in `app/[lang]/(coach)/_components/`, each rendered as a NEW `<section>` in `dashboard/page.tsx` mirroring the existing `MetricsPanel` / `ReplyQualityPanel` section blocks exactly (a `<section>` with an `<h2 className="mb-4 text-lg font-semibold">` heading + the island). Data is fetched server-side in `page.tsx` (or a co-located `dashboard/actions.ts` action), role-scoped via the existing `adminAll` flag (HR-4), and passed as plain serializable props. **Do NOT fork the dashboard page** — append sections to the existing `<div className="grid gap-8">`.

The three v2 panels (all extend the existing recharts conventions, HR-3):

1. **Full funnel panel** — `funnel-v2-panel.tsx`. The existing `MetricsPanel` is intentionally training-stages-only (Pitfall 8 in P2). v2 extends the funnel to the **full training→lead→close** chain tied to the 60→7–10-day ramp. Reuse the `BarChart` funnel pattern; add the ramp-compression KPI as a scalar stat card ("avg days to productive" vs the 7–10-day target). **Do not duplicate** the existing training-only funnel — either widen `MetricsPanel`'s data in place or render the lead/close extension as an adjacent card in the same `md:grid-cols-2` grid.
2. **Knowledge-gap aggregation panel** — `knowledge-gap-agg-panel.tsx`. The dashboard already has a per-row `KnowledgeGapFeed` (CDASH-03). v2 adds an **aggregated view over the now-pillar-tagged `knowledgeGaps` collection**: a `BarChart` of gap volume by topic, with a pillar dimension (Coach/Finder/Reply) shown as either grouped bars or a `Tabs`/`ToggleGroup` pillar filter (reuse the Phase-4 pillar-filter pattern from `(admin)/kb`). Counts only — no PII.
3. **Inline-correction → eval feedback panel** — `correction-eval-panel.tsx`. Shows corrections that were re-ingested (the existing `inline-correction-dialog.tsx` flow, CDASH-04) and their eval impact — a simple `Table` of recent corrections (doc ref, corrected-by-you, re-ingest status) plus a `LineChart` of eval-score trend post-correction. Read-only display of the existing correction signal; **no new correction control** (the correction dialog already exists).

**Composition (vendored only):** `Card` + `CardHeader` + `CardContent` (titles `text-base font-semibold`, subtitles `text-xs text-muted-foreground`); `recharts` `BarChart`/`LineChart` in `ResponsiveContainer`; scalar KPI stat tiles = `Card` + `text-2xl font-bold` number + `text-xs text-muted-foreground` label (mirror `reply-quality-panel.tsx` KPI tiles); `Table` for the correction list (vendored `table.tsx`); optional `Tabs`/`ToggleGroup` for the pillar filter.

**States:**

| State | Render |
|-------|--------|
| Loading | RSC awaits data before render (no client fetch); if a panel must stream, use `Skeleton` blocks sized to the chart (mirror existing). |
| Empty (no agents / no gaps / no corrections) | Per-chart centered muted copy reusing the `metrics-panel` pattern: `<p className="py-8 text-center text-sm text-muted-foreground">{dashboard.v2.noData…}</p>`. |
| Populated | Charts + KPI tiles + table. |
| Role scope | Coach → downline (subtitle `dashboard.viewingDownline`, reused); admin → org-wide (`dashboard.viewingAll`, reused). Single component, server-decided scope (HR-4). |
| Error | Non-blocking: a panel that fails to load renders its empty state (mirror `kb/page.tsx` try/catch → empty fallback). |

**Mobile:** `md:grid-cols-2` collapses to single column < md (same as `MetricsPanel`). Charts are fluid `ResponsiveContainer`. Tables scroll horizontally within their card on narrow screens (vendored `table` wrapper). No layout restructure of the dashboard chrome.

**i18n keys — namespace `dashboard.v2`:**
```
funnelTitle · funnelSubtitle · rampTargetLabel · rampActualLabel · avgDaysToProductive
gapAggTitle · gapAggSubtitle · gapByPillar
correctionEvalTitle · correctionEvalSubtitle · correctionColDoc · correctionColBy · correctionColStatus · evalTrendTitle
noData
```
(Reuse existing `dashboard.viewingAll`, `dashboard.viewingDownline`, `dashboard.noAgents`.)

---

### Surface 2 — Admin Conversation-Log Viewer  *(GROW `(admin)` — new admin page reusing the drilldown pattern)*  (D-08, ADMIN-02)

**File:** new `app/[lang]/(admin)/conversations/page.tsx` (RSC shell + admin gate, mirror `kb/page.tsx`) + a `'use client'` island `app/[lang]/(admin)/conversations/conversation-viewer.tsx`. Add a `NavItem` to `app-sidebar.tsx` (`key: 'conversations'`, `roles: ['admin']`, icon `MessagesSquare` from lucide). **Reuse the `stall-inbox.tsx` drilldown UX verbatim** — a `Dialog` + `ScrollArea` rendering a message thread, the same user/assistant bubble styling (`ml-8 bg-primary/10` / `mr-8 bg-muted`).

**Key differences from the coach drilldown (all server-side, the UI only displays):**
- Scope widened to **admin/cross-pillar** (the coach version is downline + coach-pillar only). Backed by a NEW admin-only Server Action `adminGetConversation(cid)` (mirrors `getAgentChatHistory`), **PDPA-gated** and writing an `auditDrilldown` audit event on every open (HR-5).
- Entry point is a **search/lookup** (by conversation id, agent ref, or lead ref) rather than a stall-row button — vendored `Command` (cmdk) inside the page, or an `Input` + results `Table`.
- **READ-ONLY** — no resolve/edit/reply/delete actions in the dialog (HR-5). The footer holds only a close affordance.

**Composition (vendored only):** RSC shell with admin gate (copy `kb/page.tsx` lines 43–68). Search = `Command`/`CommandInput` + `CommandList` OR `Input` + `Table` of results (conversation ref, pillar `Badge`, agent ref `font-mono text-xs`, last-message relative time). Thread dialog = `Dialog` + `DialogHeader` + `ScrollArea max-h-[60vh]` + the existing bubble pattern + a `Badge` per message showing its pillar (Coach/Finder/Reply). A compliance banner (`Alert variant="default"`) at the top of the dialog: "Read-only compliance view. This access is audited." (`adminConversations.auditNotice`).

**States:**

| State | Render |
|-------|--------|
| Idle (no search) | `Empty` component prompt: "Search a conversation, agent, or lead to review." (`adminConversations.idle`). |
| Searching | `Skeleton` result rows. |
| No results | `CommandEmpty` / `Empty` → `adminConversations.noResults`. |
| Thread loading | Dialog open, `<p>{adminConversations.loading}</p>` (mirror `stall-inbox` `chatHistoryLoading`). |
| Thread loaded | Audited banner + scrollable bubbles + per-message pillar badge. |
| Thread empty | `adminConversations.threadEmpty` (mirror `chatHistoryEmpty`). |
| Error | `sonner` `toast.error` (mirror `stall-inbox` `chatHistoryError`) + `<p className="text-destructive">`. |

**Mobile:** Dialog is `max-w-lg` (matches `stall-inbox`); on narrow screens the dialog goes near-full-width (vendored default). Search results table scrolls within its container. Bubbles wrap (`whitespace-pre-wrap`).

**i18n keys — namespace `adminConversations`:**
```
navLabel · pageTitle · pageSubtitle · searchPlaceholder · idle · noResults · loading · threadEmpty · error
auditNotice · colConversation · colAgent · colLead · colPillar · colLastMessage · close
```

---

### Surface 3 — Role / Permission Matrix + Assignment  *(GROW `(admin)` — new admin page over the existing claims model)*  (D-09, ADMIN-07)

**File:** new `app/[lang]/(admin)/roles/page.tsx` (RSC shell + admin gate) + `'use client'` island `app/[lang]/(admin)/roles/role-assignment.tsx`. Add a `NavItem` (`key: 'roles'`, `roles: ['admin']`, icon `ShieldCheck` from lucide). **No new auth model** — this SURFACES and VERIFIES the existing custom-claims + deny-by-default rules (HR-6).

**Two regions on the page:**
1. **Permission matrix (read-only).** A static `Table` mapping the three roles (`new-agent`, `senior-coach`, `admin`) × capability rows (chat, see-downline, see-org, manage KB, manage inventory, view conversations, run erasure, assign roles). Cells = a check/dash glyph or `Badge`. This is a transparency view of the locked model — purely informational.
2. **Assignment control (guarded write, HR-6).** Select an agent (vendored `Command`/`Combobox`), choose a target role (`Select` / `RadioGroup`), and for `senior-coach`/downline assignment, set their senior-coach/downline linkage. Submit → an admin-only `assignRole(uid, role, downline)` Server Action backed by `set-claims`. **A role change that removes admin from a user, or demotes the current admin, must pass an `AlertDialog` confirmation** (reuse the destructive-confirm pattern from Surface 5, but a SINGLE-CLICK confirm is acceptable here — only erasure needs type-to-confirm).

**Composition (vendored only):** `Table` for the matrix; `Card` wrappers; `Combobox`/`Command` agent picker; `Select` or `RadioGroup` for role; `Button` (default) submit; `AlertDialog` for the demotion confirm; `sonner` toast on success/failure; `Badge` for current-role display.

**States:**

| State | Render |
|-------|--------|
| Matrix | Always shown (static). |
| Picker empty | `CommandEmpty` → `adminRoles.noAgents`. |
| Assigning | submit `Button` `disabled` + spinner (mirror `inline-correction-dialog` `isSubmitting`). |
| Success | `toast.success(adminRoles.assigned)`; optimistic row update. |
| Demotion guard | `AlertDialog` ("This removes admin access from {ref}. Continue?") before write. |
| Error / forbidden | `toast.error(adminRoles.assignError)`; the rules-test sweep is the backstop (server). |

**Mobile:** matrix `Table` scrolls horizontally within its card; the assignment form stacks vertically (`grid gap-4`). Pickers use `text-base` inputs (no iOS zoom).

**i18n keys — namespace `adminRoles`:**
```
navLabel · pageTitle · pageSubtitle
matrixTitle · capChat · capDownline · capOrg · capManageKb · capManageInventory · capViewConversations · capRunErasure · capAssignRoles
roleNewAgent · roleSeniorCoach · roleAdmin
assignTitle · agentLabel · roleLabel · downlineLabel · assign · noAgents · assigned · assignError
demoteConfirmTitle · demoteConfirmBody · demoteConfirm · cancel
```

---

### Surface 4 — Usage + Cost Analytics Dashboard  *(NET-NEW admin page; reuses dashboard chart conventions)*  (D-10/D-04/D-05, ADMIN-08 + QUAL-08)

**File:** new `app/[lang]/(admin)/usage/page.tsx` (RSC shell + admin gate) + `'use client'` island `app/[lang]/(admin)/usage/usage-dashboard.tsx`. Add a `NavItem` (`key: 'usage'`, `roles: ['admin']`, icon `BarChart3` from lucide). **Reads `usageRollups` ONLY** (HR-7) — the RSC queries the rollup docs server-side and passes plain serializable props. **Org-wide, admin-only** (HR-4/HR-12). This single dashboard satisfies BOTH ADMIN-08 (usage) and the QUAL-08 cost pass — there is no separate cost page (folds in brief item 6).

**Metrics (D-04/D-05/D-10):**
- **Operational KPIs:** active agents, message volume, resolution time, escalation rate (scalar stat tiles + a time-series `LineChart` for volume-over-day).
- **Cost / token KPIs:** token spend (input/output, cache-hit rate) and Firestore read/write counts, broken down **per agent and per pillar** (a `BarChart` grouped by pillar + a `Table` for the per-agent breakdown).
- A date-range scope (reuse a simple `Select` of preset windows — "last 7 days" / "last 30 days" — over the per-day rollup docs; no custom date-picker needed in v1).

**Composition (vendored only):** stat tiles = `Card` + `text-2xl font-bold` + `text-xs text-muted-foreground` (mirror `reply-quality-panel.tsx`); `recharts` `LineChart` (volume trend) + `BarChart` (token/cost by pillar), HR-3 conventions; `Table` for per-agent rows; `Select` for the window; `Tabs` optional to split "Usage" / "Cost" if the page is dense.

**States:**

| State | Render |
|-------|--------|
| Loading | RSC awaits rollups; `Skeleton` tiles/charts if streamed. |
| Empty (no rollups yet — lazy-cron hasn't run) | Centered muted copy per chart + a hint tile: "No usage rolled up yet — analytics populate after the first usage-rollup window." (`adminUsage.noRollups`). **This is expected on a fresh deploy** — the lazy-cron runs on visit. |
| Populated | Stat tiles + trend + pillar-cost chart + per-agent table. |
| Window switch | Re-query server-side (or filter pre-fetched range) on `Select` change. |
| Stale rollup watchdog | If the latest rollup `lastRunAt` is older than its window, show an `Alert variant="default"` "Usage data may be stale (last rolled up {relative})." (reuses the lazy-cron watchdog convention noted in CLAUDE.md). |
| Error | Non-blocking empty fallback (mirror `kb/page.tsx`). |

**Mobile:** stat tiles `grid gap-6 grid-cols-2 md:grid-cols-4`; charts fluid; per-agent `Table` scrolls horizontally. Window `Select` full-width on narrow screens.

**i18n keys — namespace `adminUsage`:**
```
navLabel · pageTitle · pageSubtitle
kpiActiveAgents · kpiMessageVolume · kpiResolutionTime · kpiEscalationRate
volumeTrendTitle · tokenSpendTitle · cacheHitLabel · readWriteTitle · byPillarLabel · byAgentTitle
colAgent · colPillar · colTokensIn · colTokensOut · colReads · colWrites · colCost
windowLast7 · windowLast30 · noRollups · staleWatchdog · tabUsage · tabCost
```

---

### Surface 5 — PDPA Data-Erasure Request Flow  *(NET-NEW admin page — DESTRUCTIVE / IRREVERSIBLE; HR-8…HR-12)*  (D-01/D-02, QUAL-09)

> **⚠️ HARD-RULE DESTRUCTIVE FLOW. This is the single most safety-critical UI in the
> platform.** Erasure permanently hard-deletes a data subject's PII across every
> PII-bearing collection. It cannot be undone. The confirmation UX exists to make
> accidental triggering effectively impossible (HR-8/HR-9) and irreversibility
> unmistakable (HR-10). Treat every rule in this surface as a defect gate, not a style
> preference.

**File:** new `app/[lang]/(admin)/erasure/page.tsx` (RSC shell + admin gate, mirror `kb/page.tsx`) + `'use client'` islands `app/[lang]/(admin)/erasure/erasure-request-form.tsx` and `app/[lang]/(admin)/erasure/erasure-status-list.tsx`. Add a `NavItem` (`key: 'erasure'`, `roles: ['admin']`, icon `Trash2` from lucide — the ONLY destructive-iconed nav item). Backed by the admin-only `eraseDataSubject({ subjectType, id })` Server Action (D-01) writing an `erasureRequests/{reqId}` doc and an `erasure` audit event; the lazy-cron `erasure-sweep` finishes batches (D-02).

**The flow has two stages — search/select, then a type-to-confirm gate — followed by a status view.**

**Stage A — Subject selection (no destructive action yet):**
- Pick subject type: `RadioGroup` or `Tabs` — `lead` | `agent` (HR-11: exactly one of each, no bulk).
- Search the subject: vendored `Command`/`Combobox` (cmdk) or `Input` + results `Table`. Each result shows the subject's display ref (the **confirmation token** the admin will later type) + a count summary ("N conversations, N leadContext slots, …" — read-only preview so the admin sees the blast radius).
- Selecting a subject opens **Stage B**. Selection alone does NOT delete anything.

**Stage B — Type-to-confirm `AlertDialog` (the destructive gate, HR-8/HR-9/HR-10):**
- Vendored `AlertDialog` (`alert-dialog.tsx`). `AlertDialogMedia` slot holds a destructive-tinted `Trash2`/`AlertTriangle` icon.
- `AlertDialogTitle`: "Permanently erase this data subject?" (`adminErasure.confirmTitle`).
- `AlertDialogDescription` (HR-10 — irreversibility in words): "This permanently deletes {ref}'s personal data across all collections (conversations, messages, lead context, reply edits, escalations, knowledge gaps, profile, storage). **This cannot be undone.** The audit log is retained (hashes only) as the legal record that erasure occurred." (`adminErasure.confirmBody`).
- A vendored `Input` labeled "Type `{ref}` to confirm" (`adminErasure.typeToConfirmLabel`). The `AlertDialogAction` (`variant="destructive"`, label `adminErasure.confirmErase`) is **`disabled` until the typed value === the subject ref exactly** (HR-9). `AlertDialogCancel` (`variant="outline"`, the safe default) is always enabled.
- On confirm → call `eraseDataSubject(...)`; close dialog; the request appears in the Stage-C status list as `pending`. `toast.success(adminErasure.requestQueued)`.

**Stage C — Request status view (`erasure-status-list.tsx`):**
- A `Table` (or `Card` list) of `erasureRequests` docs (admin-scoped, server-fetched). Columns: subject ref (`font-mono text-xs`), subject type `Badge`, status `Badge`, requested-at, completed-at, the **<72h SLA** countdown/marker.
- Status `Badge` variants: `pending` → `secondary`; `in-progress` → `default`; `complete` → an "ok" styling (`secondary` + check glyph; do NOT reuse `destructive` for success); `failed` → `destructive`.
- SLA display: show remaining time to the <72h target while pending/in-progress; on `complete`, show the completion timestamp and whether it met SLA. A `Progress` bar MAY visualize batch completion (sweep progress) — optional.

**States (the erasure lifecycle is the spine of this surface):**

| State | data-state | Render |
|-------|-----------|--------|
| Idle | — | Subject-type selector + search; `Empty` prompt "Search a lead or agent to begin an erasure request." (`adminErasure.idle`). |
| Subject selected | `selected` | Blast-radius preview card (read-only counts) + an "Erase…" `Button variant="destructive"` that OPENS the Stage-B dialog (it does NOT erase). |
| Confirm gate | `confirming` | `AlertDialog` open; destructive action `disabled` until token matches (HR-9). |
| Pending | `pending` | New `erasureRequests` row, `secondary` badge, SLA countdown, "Queued — the sweep will complete remaining batches." (`adminErasure.statusPending`). |
| In-progress | `in-progress` | `default` badge + optional `Progress` bar of sweep batches. (`adminErasure.statusInProgress`). |
| Complete | `complete` | success-styled badge + completion timestamp + SLA-met marker. (`adminErasure.statusComplete`). Audit-retained note. |
| Failed | `failed` | `destructive` badge + reason + a guarded "Retry" that re-opens the **same type-to-confirm gate** (a retry is not a one-click action). (`adminErasure.statusFailed`). |
| Forbidden (non-admin) | — | Page never renders for non-admins (HR-12, three-layer gate). |

**Mobile:** subject search + selector stack vertically. `AlertDialog` is `max-w-xs`/`sm:max-w-sm` (vendored default) — small, focused, hard to dismiss by accident; the type-to-confirm `Input` is `text-base`. Status `Table` scrolls horizontally within its card. The destructive "Erase…" button is full-width on narrow screens but only ever OPENS the dialog (HR-8).

**i18n keys — namespace `adminErasure`:**
```
navLabel · pageTitle · pageSubtitle · idle
subjectTypeLead · subjectTypeAgent · searchPlaceholder · noResults
blastRadiusTitle · blastRadiusHint · eraseButton
confirmTitle · confirmBody · typeToConfirmLabel · typeToConfirmMismatch · confirmErase · cancel
requestQueued
statusTitle · colSubject · colType · colStatus · colRequestedAt · colCompletedAt · colSla
statusPending · statusInProgress · statusComplete · statusFailed · slaMet · slaRemaining · retry · auditRetainedNote
```

---

## 3. Navigation Growth (one change, shared by Surfaces 2–5)

All four new admin pages add a single `NavItem` each to `app/[lang]/_components/app-sidebar.tsx` `items[]`, with `roles: ['admin']` and a lucide icon. **No new sidebar component, no restructure** — the role filter already hides them from non-admins (UX layer; the layout gate is the security layer).

| key | href | icon (lucide) | roles |
|-----|------|---------------|-------|
| `conversations` | `/${lang}/conversations` | `MessagesSquare` | `['admin']` |
| `roles` | `/${lang}/roles` | `ShieldCheck` | `['admin']` |
| `usage` | `/${lang}/usage` | `BarChart3` | `['admin']` |
| `erasure` | `/${lang}/erasure` | `Trash2` | `['admin']` |

**i18n keys — namespace `nav`:** `conversations · roles · usage · erasure` (EN: "Conversations" · "Roles" · "Usage" · "Erasure"; BM/中文 in the same catalogs).

The coach dashboard v2 panels (Surface 1) need NO nav change — they grow the existing Dashboard page.

---

## 4. Copywriting Contract (trilingual — EN canonical, BM + 中文 in same catalogs)

| Element | EN (canonical) | Notes |
|---------|----------------|-------|
| **Primary CTA — assign role** | "Assign role" | Surface 3 guarded write (HR-6). |
| **Primary CTA — erasure (opens gate)** | "Erase…" | Surface 5. `variant="destructive"`; OPENS the dialog, never erases (HR-8). |
| **Destructive confirm — erasure** | "Erase permanently" | Surface 5 `AlertDialogAction`, disabled until token typed (HR-9). |
| **Irreversibility statement** | "This permanently deletes {ref}'s personal data across all collections. This cannot be undone. The audit log is retained (hashes only) as the legal record." | HR-10 verbatim intent; must appear in all three languages. |
| **Type-to-confirm prompt** | "Type `{ref}` to confirm" | Surface 5 (HR-8). |
| **Audited-access notice** | "Read-only compliance view. This access is audited." | Surface 2 (HR-5). |
| Empty — no usage rollups | "No usage rolled up yet — analytics populate after the first usage-rollup window." | Surface 4; expected on fresh deploy. |
| Empty — conversation search idle | "Search a conversation, agent, or lead to review." | Surface 2. |
| Empty — erasure idle | "Search a lead or agent to begin an erasure request." | Surface 5. |
| Empty — dashboard v2 (no data) | reuse "No agents in your downline yet." / per-chart "No data yet." | Surface 1; reuse `dashboard.noAgents`. |
| Error — generic action fail | "Something went wrong. Please try again." | reuse `errors.*` / `dashboard.*Error`. |
| Status — pending | "Queued — the sweep will complete remaining batches." | Surface 5. |
| Status — complete | "Erasure complete — {timestamp}. Audit log retained." | Surface 5. |
| SLA marker | "Within 72h target" / "{n}h remaining" | Surface 5. |

**Destructive actions in this phase:**

| Action | Surface | Confirmation | Reversible? |
|--------|---------|--------------|-------------|
| **PDPA data erasure** | Surface 5 | **Type-to-confirm `AlertDialog`, destructive action disabled until token matches (HR-8/HR-9/HR-10)** | **NO — permanent, irreversible. The defining safety-critical flow of this phase.** |
| Role change that removes admin / demotes | Surface 3 | single-click `AlertDialog` confirm | Reversible (re-assign), but guarded (HR-6) |
| Existing KB/SOP delete | `(admin)/kb` (unchanged) | existing `window.confirm` guard — **reused as-is, not re-specced** | n/a (versioned) |

The admin conversation viewer (Surface 2) and usage dashboard (Surface 4) have **no destructive actions** — both are read-only.

---

## 5. Pre-Population Provenance

| Source | Decisions used |
|--------|----------------|
| 05-CONTEXT.md | D-01, D-02, D-04, D-05, D-07, D-08, D-09, D-10 (+ D-03 informs HR-10 audit-retention copy) — 8 directly drive UI |
| ROADMAP.md (Phase 5) | goal + 5 success criteria; "grow, don't fork"; resist v2 creep (HR-11) |
| Existing code (Phase 2/4) | `dashboard/page.tsx`, `metrics-panel.tsx`, `reply-quality-panel.tsx`, `stall-inbox.tsx` (drilldown), `inline-correction-dialog.tsx`, `knowledge-gap-feed.tsx`, `(admin)/layout.tsx`, `(admin)/kb/page.tsx`, `console-shell.tsx`, `app-sidebar.tsx` — patterns matched verbatim |
| `components/ui/` | vendored shadcn (55) confirmed on disk — `alert-dialog`, `table`, `tabs`, `chart`, `command`, `select`, `radio-group`, `progress`, `scroll-area`, `empty` all present; no init, no registry |
| `src/i18n/messages/*.json` | existing namespaces (`app, auth, chat, handoff, kb, inventory, nav, errors, dashboard`); new sub-namespaces `dashboard.v2`, `adminConversations`, `adminRoles`, `adminUsage`, `adminErasure` + `nav` additions |
| User input this session | none required — all answered by upstream artifacts (auto mode) |

## 6. Registry Safety
shadcn is **vendored**, not registry-managed. No `shadcn init`, no `shadcn add`, no third-party registry. **Registry safety gate: not applicable.** No new UI dependency is introduced (HR-1). The k6 load-test harness is dev/CI tooling, not app UI, and introduces no UI dependency.

---

## UI-SPEC COMPLETE
