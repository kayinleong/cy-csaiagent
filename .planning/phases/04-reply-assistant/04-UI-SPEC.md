---
phase: 04-reply-assistant
artifact: UI-SPEC
status: draft
design_system: shadcn (vendored — 55 components in components/ui/)
mode: brownfield (grow existing Phase 2/3 surfaces; do NOT redesign)
generated: 2026-06-05
---

# Phase 4 UI Design Contract — Reply Assistant + Reply Analytics

> **This is a BROWNFIELD UI phase.** Most surfaces GROW already-shipped Phase 2/3
> components. The chat shell, dashboard, admin app, and disclosure flow EXIST and work.
> Do NOT redesign them. Every entry below is "compose from vendored shadcn + match the
> named existing pattern." Inventing a new component, page, route group, or dependency
> is a smell, not a feature (CONTEXT.md "grow, don't fork").

---

## 0. Hard Rules (the implementer CANNOT violate these)

| # | Rule | Source |
|---|------|--------|
| HR-1 | **The Reply draft card has EXACTLY ONE action: "Copy draft".** No share button, no system share-sheet, no send button, no auto-post, no "send to WhatsApp" deep-link. Copy-to-clipboard is the only path from draft → human. | D-16, ROADMAP constraint, PROJECT.md |
| HR-2 | After copy, the card collapses to a confirmation state ("Copied — go send it from WhatsApp"). It NEVER transitions to a "sent" state, because nothing is sent from the app. | D-16 |
| HR-3 | Reply turns **require a `leadId`.** If none is set, the lead selector (§2) blocks dispatch. **No auto-inferred lead linking** — a wrong-lead reply is the worst failure mode. | D-07 |
| HR-4 | `no_sop_match` renders as a **grounded refusal card** ("draft manually / check with your senior coach"). The card NEVER renders invented SOP content as a draft. | D-11 |
| HR-5 | The draft textarea is a plain controlled `<textarea>` styled with the vendored `Textarea` component. **Do NOT introduce a rich editor (Tiptap etc.) — net-new dependency.** | D-18, Discretion |
| HR-6 | **No new UI dependency.** Everything composes from the 55 vendored `components/ui/` + `recharts` + `sonner` + `cmdk` (`command.tsx`) + `lucide-react`. | CONTEXT code_context, critical_context |
| HR-7 | All new strings land in the existing `next-intl` catalogs (`src/i18n/messages/{en,ms,zh}.json`) under existing namespaces. No new copy hard-coded in JSX. Mobile-first sizing (`text-base md:text-sm`). | D-14, D-17, Phase 2 carry-forward |

---

## 1. Design System State (detected — do NOT re-specify)

| Aspect | Value | Evidence |
|--------|-------|----------|
| Component library | shadcn/ui, **fully vendored** | `components/ui/` (55 files inc. `card`, `badge`, `textarea`, `button`, `tabs`, `sheet`, `command`, `dialog`, `alert`, `empty`, `skeleton`, `spinner`, `toggle-group`, `table`) |
| `components.json` | n/a (vendored, not registry-managed) | Tool: **existing vendored — no `shadcn init`, no registry pull** |
| Styling | Tailwind 4 + `cn()` from `@/lib/utils` | every surface file |
| Charts | `recharts` (client islands only — Pitfall 7) | `_components/metrics-panel.tsx` |
| Toasts | `sonner` (`toast.*`) | `chat-input.tsx`, `stall-inbox.tsx` |
| Command palette | `cmdk` via `components/ui/command.tsx` | vendored |
| Icons | inline SVG (lucide-style) — match existing inline-icon pattern | `chat-input.tsx`, `chat-header.tsx`, `match-list.tsx` |
| i18n | `next-intl`, catalogs at `src/i18n/messages/{en,ms,zh}.json`; namespaces: `app, auth, chat, handoff, kb, inventory, nav, errors, dashboard` | confirmed |

**Design tokens (inherited from shipped surfaces — reuse verbatim, do NOT redeclare):**

- **Spacing:** 8-point family already in use — `gap-1.5 / gap-2 / gap-3 / gap-4 / gap-6 / gap-8`, `px-3 py-3`, `px-4 pb-4`. New surfaces reuse these exact steps. (Sub-step `gap-0.5` exists only inside the header chip group — keep it scoped there.)
- **Typography:** `text-base md:text-sm` (mobile-readable body that shrinks on desktop), `text-sm md:text-[0.8125rem]` (message body), `text-xs` / `text-[0.6875rem]` (meta), `text-[0.625rem]` (chips/badges), `text-base font-semibold` (panel titles), `text-lg font-semibold` (section headings), `text-2xl font-bold` (page title). Weights in use: `font-normal`, `font-medium`, `font-semibold`, `font-bold`. **Match these — declare no new sizes.**
- **Color:** dominant = `background` / `card`; secondary surface = `muted` / `secondary` (cards, sidebar, chip rest); accent = `primary` (the single user-bubble + primary CTA), reserved for the **Copy draft** primary action and the user bubble; `destructive` reserved for delete + stall badges only. Citation/SOP chips use `variant="secondary"`; criteria/meta chips use `variant="outline"`. Cards use `rounded-xl ring-1 ring-foreground/10 shadow-sm`. **Reuse — do not introduce new accent colors.** (Charts inherit the existing `#6366f1` primary + `#f59e0b` secondary series from `metrics-panel.tsx`.)

---

## 2. Surfaces to Build (6) — composition, states, mobile, copy keys

### Surface 1 — Inline Reply Draft Card  *(NET-NEW component; mirrors `match-list.tsx`)*

**File:** new `app/[lang]/chat/reply-draft-card.tsx`. Rendered by `message-list.tsx` as a new assistant-message variant (the way `MatchList` is rendered for Finder output). Mirror `match-list.tsx` exactly: a render component selecting between states from a typed `ReplyOutput` (define in `src/agents/reply/schema.ts`, mirroring `FinderOutput`). The textarea + copy action need interactivity, so the card itself is `'use client'` (unlike the render-only `MatchList`).

**Composition (vendored only):**
- `Card` + `CardHeader` + `CardContent` + `CardFooter` (`@/components/ui/card`) — same `rounded-xl ring-1 ring-foreground/10 shadow-sm` as `MatchCard`.
- Incoming-quoted block: a muted blockquote — `bg-muted rounded-lg px-3 py-2 text-sm border-l-2 border-foreground/20`, label chip `text-[0.6875rem] uppercase tracking-wide text-muted-foreground` ("Incoming message" / `replyDraft.incomingLabel`). **Display the de-pseudonymized-for-display incoming text the agent pasted — never the raw model payload; PII boundary is server-side, the card only shows what the agent already has.**
- Editable draft: vendored `Textarea` (`field-sizing-content`, `min-h-24 max-h-72`, `text-base md:text-sm`) — controlled, seeded with `originalDraft`. This IS the edit-capture surface (D-18).
- SOP citation chips (footer): reuse the `match-list` collateral-chip / `message-list` citation-badge pattern — `Badge variant="secondary" text-[0.625rem] font-mono` listing `sopDocIds`, prefixed by a "Sources:" label (`replyDraft.sourcesLabel`). Grounding proof (HR-4 corollary).
- Category badge (header): `Badge variant="outline"` showing `cold-prospect` / `objection-handling` / `financing` (`replyDraft.category.*`).
- **Single action:** one `Button` (default/primary variant) "Copy draft" (`chat.copyReply` — key already exists). On click: read textarea value → `navigator.clipboard.writeText` → fire the `replyEdits` diff capture (D-18, server action) → `toast.success(chat.copied)` → transition to Copied state. **No second button. (HR-1)**

**States:**

| State | data-state | Render |
|-------|-----------|--------|
| Loading / streaming | `loading` | Reuse the existing "Thinking…" pulse from `message-list.tsx` (`animate-pulse text-muted-foreground`) OR a `Skeleton` block sized to the card. Do not show an empty textarea while streaming. |
| Success (draft ready) | `draft` | Quoted incoming + editable textarea (seeded `originalDraft`) + category badge + SOP chips + **Copy draft** button. |
| Copied (post-action) | `copied` | Card **collapses**: hide textarea, replace button with a static confirmation row — check-icon + `replyDraft.copiedGoSend` ("Copied — go send it from WhatsApp") + relative timestamp ("2s ago"). **Terminal display state (HR-2). No "sent" state ever.** Optional ghost "Edit again" affordance re-expands the textarea (re-copy re-captures the diff). |
| Refusal (`no_sop_match`) | `refusal` | Mirror `match-list.tsx` refusal card exactly: `Card` + uppercase label `replyDraft.refusalLabel` ("No reply SOP found") + body `replyDraft.refusalBody`. **No textarea, no Copy button** — there is nothing to copy (HR-4). |
| Error (stream/clip fail) | n/a | Existing `sonner` toast path in `chat-input.tsx` (`chat.error`). Clipboard failure → `toast.error(replyDraft.copyFailed)`. |

**Mobile:** Card is `max-w-[90%]` left-aligned (same as `assistant-message`). Textarea `field-sizing-content` grows with content; `text-base` prevents iOS zoom-on-focus. Copy button full-width-friendly on narrow screens (`w-full sm:w-auto`), thumb-reachable. The "11pm on a phone" path is primary.

**i18n keys to add — namespace `chat.replyDraft`:**
```
incomingLabel · sourcesLabel · copiedGoSend · copyFailed · refusalLabel · refusalBody
category.coldProspect · category.objectionHandling · category.financing
editAgain
```
(Reuse existing `chat.copyReply`, `chat.copied`, `chat.error`, `chat.thinking`, `chat.citations`.)

---

### Surface 2 — Lead Selector Flow  *(NET-NEW; mobile-first picker)*  (D-07)

**Trigger:** Reply dispatch attempted with no active `leadId`. Block the send and surface the picker. Threaded from `chat-shell.tsx` (owns lead state, sibling to `pillarOverride`) → `chat-input.tsx` (already accepts a `leadId` prop for Finder — reuse that thread).

**Composition:** vendored `Command` (`cmdk`) inside a `Sheet` (bottom sheet on mobile) — `components/ui/sheet.tsx` + `components/ui/command.tsx`. `CommandInput` (search), `CommandList`, `CommandGroup` ("Recent leads"), `CommandItem` per lead (downline-scoped list, server-fetched). `CommandEmpty` for no-leads. This is the mobile-friendly picker D-07 asks for; `cmdk` is already vendored.

**States:**

| State | Render |
|-------|--------|
| Default-to-recent (< 24h) | If the agent's most-recent lead is < 24h old, show it pre-highlighted at the top of "Recent leads" with a one-tap confirm affordance — an **affordance, not auto-selection** (HR-3). |
| Stale / no recent (≥ 24h) | No pre-highlight; force an explicit pick. Search + scroll the downline-scoped lead list. |
| Empty | `CommandEmpty` → `leadSelector.empty` ("No leads yet — add one before drafting a reply."). |
| Loading | `Skeleton` rows inside `CommandList`. |

**Mobile:** `Sheet` opens from the bottom (`side="bottom"`), large tap targets (`CommandItem` min-h-11 ≈ 44px touch target). Search input `text-base` (no iOS zoom). Dismiss = cancel (no lead picked → no dispatch).

**i18n keys — namespace `chat.leadSelector`:**
```
title · searchPlaceholder · recentGroup · recentBadge (e.g. "recent") · empty · loading · confirmRecent · pickExplicit (hint when ≥24h)
```

---

### Surface 3 — Pillar Override Chip widening  *(GROW `chat-header.tsx` — minimal)*  (D-02)

**Change:** add a third `ToggleGroupItem value="reply"` to the existing pillar `ToggleGroup` (lines 137–168), **styled identically** to the `coach`/`finder` items (`h-6 px-1.5 text-[0.625rem] font-medium`). Widen the `PillarOverride` type `'coach' | 'finder'` → `'coach' | 'finder' | 'reply'` in `chat-header.tsx`, `chat-input.tsx`, and `chat-shell.tsx`. No layout change, no new component.

**States:** unchanged toggle semantics (single-select, `auto` = router decides). Selecting "Reply" with no `leadId` triggers Surface 2.

**Mobile:** the chip group already lives in a `shrink-0 gap-0.5` row in the sticky header — adding one item keeps the existing horizontal behavior. (If the header overflows on the smallest screens, that is a pre-existing condition; do NOT restructure the header in this phase.)

**i18n key — add to existing `chat.pillarOverride`:**
```
reply  (en: "Reply" · ms: "Balas" · zh: "回复")
```

---

### Surface 4 — Reply Quality Dashboard Panel  *(GROW `(coach)/dashboard` — new client island)*  (D-21/D-22)

**File:** new `app/[lang]/(coach)/_components/reply-quality-panel.tsx` (`'use client'` — recharts, Pitfall 7). Add a new `<section>` to `dashboard/page.tsx` mirroring the existing `MetricsPanel` section block (heading + island). Data fetched server-side in `page.tsx` (downline-scoped via existing `adminAll` flag — D-22 role-conditional scope), passed as plain serializable props (same contract as `MetricsPanel`/`StallInbox`).

**Composition (mirror `metrics-panel.tsx` exactly):**
- `Card` + `CardHeader` (`text-base font-semibold` title + `text-xs text-muted-foreground` subtitle) + `CardContent`.
- `recharts` `ResponsiveContainer` (`width="100%" height={220}`), `LineChart` for **edit-rate-per-SOP trend** (trend DOWN = good — `replyQuality.editRateSubtitle`), `BarChart` for **top-edited SOPs**. Reuse the existing series colors (`#6366f1` primary, `#f59e0b` secondary) + axis tick `fontSize: 12` + `margin={{ top: 4, right: 8, left: -16, bottom: 4 }}`.
- Scalar KPIs (thumbs-down rate, escalation rate, drafts-per-agent) as small stat cards: `Card` + big number (`text-2xl font-bold`) + label (`text-xs text-muted-foreground`), in a `grid gap-6 md:grid-cols-2` (same grid as `MetricsPanel`).

**Metrics (D-21):** edit-rate per SOP (trend chart) · thumbs-down rate · top-edited SOP (bar) · escalation rate · drafts-per-agent. Computed read-time (D-20) — no rollup job.

**States:**

| State | Render |
|-------|--------|
| Empty (no `replyEdits` yet) | Per-chart empty copy reusing the `metrics-panel` pattern: `<p className="py-8 text-center text-sm text-muted-foreground">{replyQuality.noData}</p>`. |
| Populated | Charts + KPI stat cards. |
| Role scope | Coach → downline-scoped (heading subtitle `replyQuality.scopeDownline`); admin → org-wide (`replyQuality.scopeOrg`). Single component, role-conditional query (D-22). Reuses dashboard's existing `viewingAll`/`viewingDownline` convention. |

**Mobile:** `md:grid-cols-2` collapses to single column < md (same as `MetricsPanel`). Charts are `ResponsiveContainer` (fluid width). No horizontal scroll.

**i18n keys — namespace `dashboard.replyQuality`:**
```
title · editRateTitle · editRateSubtitle · topEditedTitle · thumbsDownLabel · escalationRateLabel · draftsPerAgentLabel · noData · scopeDownline · scopeOrg
```
(Put under the existing `dashboard` namespace, matching `funnelChartTitle`, `rampChartTitle`, `noAgents`, etc.)

---

### Surface 5 — Reply SOP Admin Filter  *(GROW `(admin)/kb` — minimal)*  (D-10)

**Change:** add a pillar filter/tab to `(admin)/kb/page.tsx` + `kb-doc-list.tsx`. The list **already renders a `Pillar` column with a `Reply` label** (`kb-doc-list.tsx` lines 57–61, 146) — only a filter control is net-new. Reuse the plain-language editor (`kb-doc-form.tsx`), upload, versioning, publish toggle **unchanged** (ADMIN-05 = a filter view on the existing manager).

**Composition:** vendored `Tabs` (`components/ui/tabs.tsx`) above the list — `TabsList` with `TabsTrigger` "All" / "Coach" / "Reply" — OR a `ToggleGroup` matching the header chip if a lighter control is preferred. Filter is client-side over the already-fetched `docs` array (same `useState` filter pattern as the existing `showSuperseded` toggle, lines 71–77). The create form (`kb-doc-form.tsx`) gains a `pillar` select (vendored `Select` / `native-select`) defaulting to `reply` when the Reply tab is active, plus the `category` field (`cold-prospect`/`objection-handling`/`financing`/`voice` — open-string with seeded enum, D-09/D-12).

**States:**

| State | Render |
|-------|--------|
| Tab: All | full list (current behavior). |
| Tab: Reply | `docs.filter(d => d.data.pillar === 'reply')`. |
| Reply tab + zero Reply SOPs | reuse the existing empty copy pattern (`kb-doc-list` line 99) → `kb.noReplySops` ("No Reply SOPs yet. Add one above."). |

**Mobile:** `Tabs` are horizontally scrollable on narrow screens (vendored default). Table is the existing pattern (already shipped on mobile in Phase 2).

**i18n keys — namespace `kb`:**
```
pillarFilter.all · pillarFilter.coach · pillarFilter.reply
category.label · category.coldProspect · category.objectionHandling · category.financing · category.voice
noReplySops
pillarSelectLabel
```

---

### Surface 6 — AI Disclosure Copy Extension  *(GROW — COPY ONLY, no new component)*  (D-17)

**Change:** **NO new modal, NO new badge.** Append one Reply-specific line to the existing first-run disclosure body (`disclosure-modal.tsx` renders `t('body')` from `chat.disclosure.body`) and keep the existing persistent `aiBadge` in `chat-header.tsx` unchanged. The added sentence: *"Drafts are AI suggestions — review before sending from your phone."* (D-17, exact intent).

**Implementation options (planner's choice, both copy-only):**
- (a) Extend `chat.disclosure.body` to include the Reply sentence inline, OR
- (b) Add `chat.disclosure.replyLine` rendered as a second `<p>` inside the existing `DialogDescription`.

Prefer (b) — keeps the Coach/Finder disclosure stable and makes the Reply line trilingually traceable.

**States:** unchanged disclosure gate (localStorage + `disclosureAckAt` server gate). No behavior change.

**i18n key — namespace `chat.disclosure`:**
```
replyLine  (en: "Drafts are AI suggestions — review before sending from your phone." · ms · zh)
```

---

## 3. Copywriting Contract (trilingual — EN canonical, BM + 中文 in same catalogs)

| Element | EN (canonical) | Notes |
|---------|----------------|-------|
| **Primary CTA** (draft card) | "Copy draft" | reuse `chat.copyReply`. The ONLY action (HR-1). |
| Post-copy confirmation | "Copied — go send it from WhatsApp" | terminal display state (HR-2); never says "sent". |
| Empty — no leads | "No leads yet — add one before drafting a reply." | lead selector (Surface 2). |
| Empty — no Reply SOPs (admin) | "No Reply SOPs yet. Add one above." | Surface 5. |
| Empty — no reply analytics | "No reply edits captured yet." | Surface 4 charts. |
| Refusal — no SOP match | "I don't have a D2 reply SOP for this — please draft manually, or check with your senior coach." | D-11, HR-4 verbatim. |
| Error — generic stream | "Something went wrong. Please try again." | reuse `chat.error`. |
| Error — clipboard fail | "Couldn't copy. Select the text and copy manually." | clipboard fallback. |
| Disclosure (Reply line) | "Drafts are AI suggestions — review before sending from your phone." | D-17 verbatim. |
| Pillar chip label | "Reply" / "Balas" / "回复" | Surface 3. |

**Destructive actions in this phase:** none net-new on the user-facing Reply surface. The only destructive action is the **existing** admin KB delete (`kb-doc-list.tsx` `window.confirm` guard) — reused unchanged for Reply SOPs. `replyEdits` is **append-only / immutable** (D-19) — no delete UI, no edit-of-edit. **There is deliberately no "discard"/"delete draft" destructive control on the draft card** (closing the card = discard; nothing is persisted as a send).

---

## 4. Pre-Population Provenance

| Source | Decisions used |
|--------|----------------|
| 04-CONTEXT.md | D-02, D-07, D-09, D-10, D-11, D-12, D-15, D-16, D-17, D-18, D-19, D-20, D-21, D-22 (14) |
| ROADMAP.md (Phase 4) | goal + 5 success criteria, copy-only / no-auto-send constraint |
| Existing code (Phase 2/3) | `match-list.tsx`, `message-list.tsx`, `chat-header.tsx`, `chat-input.tsx`, `chat-shell.tsx`, `disclosure-modal.tsx`, `metrics-panel.tsx`, `dashboard/page.tsx`, `kb/page.tsx`, `kb-doc-list.tsx`, `stall-inbox.tsx` — patterns matched verbatim |
| `components/ui/` | vendored shadcn (55) confirmed on disk — no init, no registry |
| `src/i18n/messages/*.json` | existing namespaces + reserved `chat.copyReply`/`chat.copied` keys; `PILLAR_LABEL.reply` already present in `kb-doc-list.tsx` |
| User input this session | none required — all answered by upstream artifacts (auto mode) |

## 5. Registry Safety
shadcn is **vendored**, not registry-managed. No `shadcn init`, no `shadcn add`, no third-party registry. **Registry safety gate: not applicable.** No new UI dependency is introduced (HR-6).

---

## UI-SPEC COMPLETE
