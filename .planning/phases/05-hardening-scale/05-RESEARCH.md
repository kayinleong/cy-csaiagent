# Phase 5: Hardening + Scale-Up - Research

**Researched:** 2026-06-07
**Domain:** PDPA data erasure, LLM usage/cost instrumentation, Firestore rollup analytics, dashboard v2, admin compliance surfaces, load testing, backup/restore + handover — on a live 3-pillar Next.js 16 + Firebase platform
**Confidence:** HIGH (all claims grounded in repo code at file:line or installed type defs; no new framework assumptions)

## Summary

Phase 5 is a **brownfield hardening + handover phase** — the exit bar is "provably ready for ~400 agents + handed over," not new features. Every locked decision (D-01..D-13 in `05-CONTEXT.md`) extends an existing seam rather than building new architecture. Five of the seven REQ-IDs are code, two (load test, handover docs) are largely artifacts. The single most sensitive piece is **PDPA erasure** (QUAL-09): it is destructive, must be coverage-audited (prove every PII collection is reached), must be idempotent + chunked (lazy-cron-completable, never a mega-delete), and the **audit log must survive** as the compliance record.

The cost/usage story has exactly **one pipeline** (the CONTEXT.md "don't build two pipelines" warning): instrument `src/llm/provider.ts` + the `app/api/chat/route.ts` onFinish path → append-only `usageEvents` → DUE-gated `usage-rollup` lazy-cron job → `usageRollups` → read by BOTH the admin usage dashboard (ADMIN-08) and the cost pass (QUAL-08). The route ALREADY reads `final.usage.totalTokens` (route.ts:522, 607, 620) — Phase 5 widens that single capture point to record `inputTokens`/`outputTokens`/`cachedInputTokens` + the Anthropic `cacheCreationInputTokens` provider metadata, tagged with `pillar` + `uid` (both already in scope in the route).

The dashboard v2 (CDASH-08) + admin usage (ADMIN-08) + conversation viewer (ADMIN-02) + role matrix (ADMIN-07) all **reuse proven patterns already in the repo**: `recharts` client islands (`metrics-panel.tsx`), the `count()`/`select()` role-conditional aggregation with `auditDrilldown` (`getReplyQualityMetrics` in `dashboard/actions.ts`), and the audited `getAgentChatHistory` drilldown (quick-002, `dashboard/actions.ts:237`). Three new collections (`usageEvents`, `usageRollups`, `erasureRequests`) join the typed-ref + deny-by-default-rules + CI-rules-test discipline.

**Primary recommendation:** Build Phase 5 as a thin set of extensions over the existing audit / lazy-cron / llm-wrapper / dashboard-aggregation seams. Treat the erasure-coverage audit (prove every PII collection is reached, audit log exempt) and the deny-by-default rules tests for the 3 new collections as the security-critical gates. Use `firestore.recursiveDelete()` for the `conversations/{cid}` + `messages` subcollection cascade. Use Firestore `AggregateField.sum()`/`count()` for rollups (NOT fetch-all). The one constraint nuance to flag: the **managed Firestore export/import (D-12 backup/restore)** uses the GCP `FirestoreAdminClient` API surface, which is *adjacent to* the Firebase SDK — handle as a documented operational runbook (gcloud/console), not as app code.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| PDPA erasure cascade (D-01/02) | API / Server Action (`eraseDataSubject`) + lazy-cron job (`erasure-sweep`) | Database (recursiveDelete) | Admin-gated destructive write; chunked sweep on the existing on-visit cron — never client, never one mega-request |
| Erasure request status UI | Frontend Server (RSC admin page) | Database (`erasureRequests` read) | Read-only status surface; admin route group |
| Token/cache usage capture (D-04) | API (chat route onFinish + llm wrapper) | Database (`usageEvents` append) | Single choke point already on the `after()`/onFinish side-effect path; rides existing token read |
| Usage rollup aggregation (D-05) | Lazy-cron job (`usage-rollup`) | Database (`usageEvents`→`usageRollups`) | DUE-gated on-visit; no BigQuery, no external scheduler |
| Coach dashboard v2 (D-07) | Frontend Server (RSC) + client recharts islands | Database (count()/select aggregation) | Grows existing `(coach)/dashboard`; role-conditional scope |
| Admin usage analytics (D-10) | Frontend Server (RSC admin) + recharts | Database (`usageRollups` read) | Reads the rollups (single source w/ cost pass) |
| Conversation-log viewer (D-08) | Frontend Server (RSC admin) + Server Action | Database (messages read + audit write) | Reuses `getAgentChatHistory` drilldown, widened to admin/cross-pillar; PDPA-audited |
| Role/permission matrix (D-09) | Frontend Server (RSC admin) + Server Action (`setUserClaims`) | Auth (custom claims) + Database (rules) | Surfaces the existing claims+rules model; no new auth model |
| Load test (D-11) | Dev/CI tooling (k6 against deployed SSE) | — | Test tooling hitting the deployed endpoint — NOT app infra (constraint-safe) |
| Backup/restore (D-12) | Operational runbook (gcloud/console managed export) | — | GCP Admin API surface; documented op, not app code |
| Handover docs (D-13) | Artifact (`docs/operations/`) | — | Markdown runbooks |

<user_constraints>
## User Constraints (from 05-CONTEXT.md)

### Locked Decisions

**PDPA data erasure (QUAL-09, SC1)**
- **D-01** — Admin-triggered cascade erasure Server Action `eraseDataSubject({ subjectType: 'lead'|'agent', id })` that enumerates every PII-bearing doc keyed by that subject and hard-deletes it: `conversations/{cid}` + `messages` subcollection, `leadContext/{leadId}` (all slots), `replyEdits`, `escalations`, `knowledgeGaps`, `agentProfiles/{uid}` (agent erasure), `users/{uid}`, and any Storage objects. **Audit log is NOT erased** (hashes-only, the compliance record); an `erasure` audit event IS written.
- **D-02** — Chunked + lazy-cron-completable, **<72h target**. Server Action marks an `erasureRequests/{reqId}` doc `pending` and deletes what it can synchronously; the on-visit lazy-cron `erasure-sweep` job finishes remaining batches (mirrors chunked ingestion). UI shows request status + completion timestamp; <72h SLA tracked on the request doc.
- **D-03** — PDPA audit + sign-off: update the Phase-1 TIA with the live data-flow, run an erasure-coverage audit (prove every PII collection is reached), produce a `PDPA-SIGNOFF.md` memo for Derek.

**Cost + performance pass (QUAL-08, SC2/SC4)**
- **D-04** — Token + read/write capture at the boundaries. The `llm/` provider wrapper records token usage (input/output, cache-hit) per call; the chat route tags each with `pillar` + `uid`. Written to a lightweight append-only `usageEvents` collection (tenantId, no PII). Instrument the EXISTING llm wrapper + route, not a new tracing system.
- **D-05** — `usage-rollup` lazy-cron job → `usageRollups`. DUE-gated, aggregates `usageEvents` into per-day, per-agent, per-pillar `usageRollups` docs (token spend, read/write, message volume, resolution time, escalation rate). Read-time dashboards query the rollups, NOT raw events. No BigQuery, no external scheduler.
- **D-06** — Performance pass = measure + document, tune the cheap wins. Verify Anthropic prompt-cache hit rate, audit Firestore composite-index/read cost, set a p95 latency budget, apply low-risk tuning. Output a `PERF-COST.md`. **Exact SLO numbers are Derek's call.**

**Coach dashboard v2 (CDASH-08, SC3)**
- **D-07** — Grow the existing senior-coach dashboard, do NOT fork. Add: full funnel (training→lead→close) tied to the 60→7–10-day ramp metric, a knowledge-gap aggregation panel (over `knowledgeGaps`, now pillar-tagged), and the inline-correction→eval feedback view. Reuse `recharts` + the role-conditional scope (coach=downline, admin=org).

**Admin surfaces (ADMIN-02/07/08)**
- **D-08** — Conversation-log viewer (ADMIN-02): admin-only, PDPA-gated, `auditDrilldown`-logged read surface to review a conversation thread for compliance. Reuses the `getAgentChatHistory` drilldown (quick-002), widened to admin scope across pillars. Read-only; no editing.
- **D-09** — Role/permission controls (ADMIN-07): enforcement already exists (custom claims + deny-by-default rules). Phase 5 adds an admin-visible role/permission matrix view + a `set-claims`-backed assignment UI, and a rules-test sweep proving the matrix. No new auth model.
- **D-10** — Usage analytics (ADMIN-08): an admin dashboard reading `usageRollups` (D-05): active agents, message volume, resolution time, escalation rate, + the cost view from D-04/D-05. Role-conditional (admin org-wide).

**Load test + hardening checklist (SC4)**
- **D-11** — Scripted ~400-concurrent load test against the deployed stack. A `scripts/loadtest/` harness (default k6) simulating ~400 concurrent agents on the SSE chat endpoint + key reads; measures p95, error rate, cold-start, Firestore contention; emits `LOADTEST.md`. Live-gated (runs against deployed App Hosting) — code-ready this phase, executed during rollout prep.
- **D-12** — `HARDENING.md` checklist: SLOs, runbooks, backup/restore (Firestore export/import), security audit (rules + auth + secrets + PDPA), cost projection at 400 agents — each item linked to its evidence.

**Handover documentation (QUAL-10, SC5)**
- **D-13** — Operator handover docs: a `docs/operations/` set: architecture overview, deploy + secrets runbook, lazy-cron job catalog + watchdog, backup/restore, incident runbooks, PDPA erasure runbook, cost/SLO dashboard guide. Written for D2's 2-person team.

### Claude's Discretion
- Exact SLO/p95 numbers, cost thresholds, and the 400-agent load profile shape — researcher/planner propose; final numbers are Derek's call.
- Load-test tool (k6 vs artillery) — default k6; planner may switch if it fits the harness better.
- Whether `usageEvents` needs a TTL/retention policy — propose during planning (cost vs audit retention tradeoff).
- Backup/restore mechanism specifics (Firestore managed export schedule vs on-demand) — within the no-external-scheduler constraint, default to documented on-demand export + a lazy-cron reminder.

### Deferred Ideas (OUT OF SCOPE)
- WhatsApp Business API / auto-send — post-v1, gated by `WABA-GATE.md`.
- Public-facing property recommender + auto-assignment (PUB-01/02) — v2.
- Native mobile apps, voice/audio input, real-time multi-user collaboration — out of scope.
- Multi-tenant / white-label activation — the `tenantId` seam exists; activation is post-v1.
- Automated wall-clock scheduling (replacing lazy-cron) — documented escape hatch, not Phase-5 work.
- **BigQuery / external analytics warehouse** — excluded by no-GCP-beyond-Firebase; usage analytics stay Firestore rollups.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| **CDASH-08** | Coach dashboard v2 — full funnel metrics | Grow `app/[lang]/(coach)/dashboard/page.tsx` + `_components/metrics-panel.tsx` (recharts). Funnel sources: `src/dashboard/metrics.ts` (`trainingFunnel`, `checkpointVelocity`, `daysInJourney`), `knowledgeGaps` (now pillar-tagged), correction→eval via `kbDocs.correctedBy` + `evals`. Reuse role scope from `getReplyQualityMetrics`. |
| **ADMIN-02** | Conversation log viewer | Reuse `getAgentChatHistory` (`dashboard/actions.ts:237`) widened to admin/cross-pillar; `auditDrilldown` (`src/audit/log.ts:120`) + `loadRecent` (`src/memory/conversation.ts:142`). New admin route under `app/[lang]/(admin)/`. |
| **ADMIN-07** | Role and permission controls | Surface the existing claims model (`setUserClaims` in `src/firebase/auth.ts:148`) + deny-by-default rules (`firestore.rules`). Rules-test sweep extends `src/firebase/__tests__/rules.test.ts`. |
| **ADMIN-08** | Usage analytics dashboard | Reads new `usageRollups` (D-05). active agents / message volume / resolution time / escalation rate. Reuse recharts islands + admin route group + `assertAdmin` (`(admin)/layout.tsx:50`). |
| **QUAL-08** | Performance + cost optimization pass | `usageEvents`→`usageRollups` cost view + prompt-cache hit-rate (Anthropic `cacheCreationInputTokens`/`cachedInputTokens`) + Firestore index/read audit (`firestore.indexes.json`). Output `PERF-COST.md`. |
| **QUAL-09** | PDPA audit + sign-off | `eraseDataSubject` Server Action + `erasure-sweep` job (`recursiveDelete`); audit-exempt + `erasure` event; coverage audit; TIA update + `PDPA-SIGNOFF.md`. |
| **QUAL-10** | Internal documentation (handover) | `docs/operations/` runbook set (D-13) + `HARDENING.md` (D-12). |
</phase_requirements>

## Standard Stack

No new runtime dependencies. Everything Phase 5 code needs is on disk (CONTEXT.md §code_context). The only NEW tooling is the dev-only load-test harness (k6), installed/run outside the app bundle.

### Core (all installed — verified `package.json`)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `ai` | `^5.0.193` | `streamText`, usage object (`inputTokens`/`outputTokens`/`totalTokens`/`cachedInputTokens`), `totalUsage` on onFinish | Already the LLM seam; usage already partly consumed |
| `@ai-sdk/anthropic` | `^2.0.80` | `cacheCreationInputTokens` provider metadata for prompt-cache hit tracking | Default provider; cache-write telemetry |
| `firebase-admin` | `^13.10.0` | `recursiveDelete()`, `AggregateField.count()/sum()`, BulkWriter, Storage `bucket().deleteFiles()` | Server data plane; bulk delete + aggregation |
| `recharts` | `^3.8.0` | Dashboard v2 + usage-analytics charts (client islands) | Already vendored + used in `metrics-panel.tsx` |
| `next-intl` | `^4.13.0` | i18n for any new UI copy (EN/BM/中文) | Multilingual mandate |
| `zod` | `^4.4.3` | Validate `eraseDataSubject` input + role-assignment input | Input validation (V5 ASVS) |

### Supporting (dev / test — installed)
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `vitest` | `^4.1.7` | Unit tests (erasure coverage logic, usage aggregation, rollup math) | `npm test` |
| `@firebase/rules-unit-testing` | `^5.0.1` | Deny-by-default rules tests for the 3 new collections | `npm run test:rules` (emulator) |
| `@playwright/test` | `^1.60.0` | E2E: admin erasure click-through, conversation viewer, role matrix | `npm run test:e2e` |
| `promptfoo` | `^0.121.13` | QUAL-01 model-swap proof must still pass; eval-nightly | `npm run eval` |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| k6 (load test) | artillery (Node-native) | k6 = default per D-11; artillery is JS-native (easier SSE scripting in-repo) — planner may switch. Either is dev tooling, not app infra. |
| `recursiveDelete()` for cascade | manual batched subcollection delete loop | recursiveDelete is the Admin-SDK primitive that handles the `messages` subcollection automatically; manual loops re-implement BulkWriter (Don't Hand-Roll). Caveat: recursiveDelete is "fire all, best-effort" — pair with the `erasureRequests` ledger for idempotency/resumability. |
| `usageEvents` append + rollup | reuse `messages.tokens` directly | messages already stores per-turn tokens, but it has no `pillar`/`uid`/cache split for cost analytics and is owner-read-scoped (no admin org-wide aggregation index). A dedicated append-only `usageEvents` keeps the cost pipeline single-source (CONTEXT.md warning) and PDPA-safe (no content). |

**Installation:** none for app code. Load-test harness (dev-only, NOT a dependency):
```bash
# macOS dev machine — k6 is a standalone binary, not an npm dep
brew install k6   # or: docker run grafana/k6
```

**Version verification (registry-confirmed via installed type defs, 2026-06-07):**
- `ai@5.0.193` — `LanguageModelV2Usage` exposes `inputTokens`, `outputTokens`, `totalTokens`, `reasoningTokens?`, `cachedInputTokens?` (`node_modules/@ai-sdk/provider/dist/index.d.ts:1104-1127`). onFinish event carries `totalUsage` (sum across steps) (`node_modules/ai/dist/index.d.ts:1280`). [VERIFIED: installed type defs]
- `@ai-sdk/anthropic@2.0.80` — `AnthropicMessageMetadata.cacheCreationInputTokens: number | null` (`node_modules/@ai-sdk/anthropic/dist/index.d.ts:24`). [VERIFIED: installed type defs]
- `firebase-admin@13.10.0` — re-exports `AggregateField` (static `count()`, `sum(field)`, `average(field)`) and `recursiveDelete()` from `@google-cloud/firestore` (`firestore.d.ts:2584-2598`, `:624`). [VERIFIED: installed type defs]

## Architecture Patterns

### System Architecture Diagram

```
                          PHASE 5 — HARDENING DATA FLOWS (extends existing seams)

  ┌─────────────── USAGE / COST PIPELINE (ONE pipeline — D-04/05, QUAL-08, ADMIN-08) ──────────────┐
  │                                                                                                  │
  │  chat POST /api/chat (route.ts)                                                                  │
  │    GATE1 auth → GATE2 ratelimit → GATE3 PDPA → GATE4 route(pillar) → GATE5 streamText            │
  │                                              │                                                   │
  │                                       onFinish(final)  ◀── final.totalUsage {inputTokens,        │
  │                                              │            outputTokens, totalTokens,             │
  │                                              │            cachedInputTokens}                      │
  │                                              │            + providerMetadata.anthropic            │
  │                                              │              .cacheCreationInputTokens             │
  │                                              ▼                                                   │
  │             after(() => recordUsageEvent({ uid, pillar, tokensIn/out/cached, ... }))             │
  │                                              │  (rides the SAME after() path as audit.log)       │
  │                                              ▼                                                   │
  │                              usageEvents/{id}  (append-only, tenantId, NO PII)                   │
  │                                              │                                                   │
  │   on-visit lazy-cron (triggerDueJobs → runDueJobs)  ── usage-rollup job (DUE-gated, 24h window)  │
  │                                              │  AggregateField.sum()/count() per day/agent/pillar│
  │                                              ▼                                                   │
  │                       usageRollups/{day-agent-pillar}  (token spend, r/w, msg vol, esc rate)     │
  │                              │                                   │                               │
  │                  admin usage dashboard (ADMIN-08)        PERF-COST.md cost pass (QUAL-08)         │
  └──────────────────────────────────────────────────────────────────────────────────────────────┘

  ┌─────────────── PDPA ERASURE PIPELINE (D-01/02, QUAL-09) ──────────────────────────────────────┐
  │  admin UI → eraseDataSubject({subjectType, id})  Server Action  (assertAdmin gate)             │
  │       │                                                                                        │
  │       ├─ create erasureRequests/{reqId} status:'pending', sla deadline = now+72h               │
  │       ├─ synchronous best-effort: recursiveDelete(conversations/{cid}) [+messages subcoll],    │
  │       │   delete leadContext/{leadId}, replyEdits(where leadId/agentUid), escalations,          │
  │       │   knowledgeGaps(agentUid), agentProfiles/{uid}, users/{uid}, Storage objects            │
  │       ├─ audit.log({action:'erasure', targetRef, raw:{subjectType,idHash,collectionsHit}})      │
  │       │   ── auditLogs is NOT deleted (hashes-only compliance record)                           │
  │       └─ mark request 'sweeping' if anything remains                                            │
  │                                              │                                                  │
  │   on-visit lazy-cron ── erasure-sweep job (DUE-gated) finishes remaining batches → 'complete'   │
  │                                              ▼                                                   │
  │                       admin status UI reads erasureRequests/{reqId}  (completedAt, <72h check)  │
  └──────────────────────────────────────────────────────────────────────────────────────────────┘

  ┌─────────────── READ-ONLY ADMIN/COACH SURFACES (CDASH-08, ADMIN-02/07/08) ─────────────────────┐
  │  RSC page (role gate via requireUser) → role-conditional Admin-SDK reads (count()/select())     │
  │     → auditDrilldown(uid, collection)  → serializable data → recharts client islands            │
  │  Conversation viewer: getAgentChatHistory(agentUid, pillar?) → loadRecent → audited read        │
  │  Role matrix: read users/* roles → setUserClaims() assignment Server Action (admin-gated)        │
  └──────────────────────────────────────────────────────────────────────────────────────────────┘
```

### Recommended Project Structure (new files; everything else extends existing)
```
src/
├── usage/
│   ├── record.ts          # recordUsageEvent() — append usageEvents (called from route onFinish)
│   ├── rollup.ts          # rollupUsage() — usageEvents → usageRollups (AggregateField.sum/count)
│   └── types.ts           # UsageEvent / UsageRollup shapes (no PII)
├── pdpa/
│   ├── erasure.ts         # eraseDataSubject core (enumerate + recursiveDelete + audit erasure event)
│   ├── coverage.ts        # PII-collection coverage manifest (single source for the audit + sweep)
│   └── sweep.ts           # erasureSweep() — finish pending erasureRequests batches (idempotent)
└── firebase/collections.ts   # + usageEvents / usageRollups / erasureRequests typed refs

app/[lang]/(admin)/
├── conversations/         # ADMIN-02 conversation-log viewer (RSC + actions.ts widened drilldown)
├── roles/                 # ADMIN-07 role/permission matrix + assignment (actions.ts → setUserClaims)
├── usage/                 # ADMIN-08 usage analytics (RSC + recharts islands over usageRollups)
└── erasure/               # QUAL-09 erasure trigger + status UI (actions.ts → eraseDataSubject)

scripts/loadtest/          # D-11 k6 harness (dev tooling; NOT bundled)
docs/operations/           # D-13 handover runbooks
.planning/phases/05-hardening-scale/
├── PERF-COST.md           # D-06
├── HARDENING.md           # D-12
├── LOADTEST.md            # D-11 report (filled at live execution)
└── PDPA-SIGNOFF.md        # D-03
```

### Pattern 1: Single-choke-point usage capture (D-04)
**What:** Record token/cache usage ONCE, on the existing `onFinish` side-effect path, tagged with `pillar` + `uid` (both already in scope in the route).
**When to use:** Every chat turn. NEVER add a second capture site (CONTEXT.md "don't build two pipelines").
**Example:**
```typescript
// Source: extends app/api/chat/route.ts onFinish (currently route.ts:494-626)
// The route ALREADY reads final.usage.totalTokens at :522/:607/:620 for message tokens,
// rate-limit decrement, and audit. Phase 5 adds ONE more after() call alongside audit.log.
onFinish: async (final) => {
  // ... existing message persistence + slot writes ...

  // D-04: usage capture rides the SAME after() path as audit (route.ts:612)
  // Use final.totalUsage (sum across steps) — Finder/Reply are multi-step (stepCountIs(5));
  // final.usage is only the LAST step. totalUsage is the per-turn total (ai@5 onFinish).
  const u = final.totalUsage  // { inputTokens, outputTokens, totalTokens, cachedInputTokens }
  const cacheWrite =
    (final.providerMetadata?.anthropic as { cacheCreationInputTokens?: number } | undefined)
      ?.cacheCreationInputTokens ?? 0
  after(() =>
    recordUsageEvent({
      tenantId: TENANT_ID,
      uid,                         // already in scope (GATE 1)
      pillar,                      // already in scope (GATE 4)
      inputTokens: u.inputTokens ?? 0,
      outputTokens: u.outputTokens ?? 0,
      cachedInputTokens: u.cachedInputTokens ?? 0,   // prompt-cache READ hit (cost saved)
      cacheCreationInputTokens: cacheWrite,          // prompt-cache WRITE (one-time cost)
      // NO content, NO routeDecision string with PII — counts only
      day: dayKey(new Date()),     // 'YYYY-MM-DD' (Asia/Kuala_Lumpur) for rollup grouping
    }),
  )
}
```
**Caveat (HIGH-priority pitfall):** the route currently reads `final.usage.totalTokens` (`route.ts:522,607,620`) — for **Finder/Reply** that is the LAST step only, because those pillars run `stepCountIs(5)` (route.ts:493). The existing message-token + rate-limit + audit values are therefore already under-counting multi-step turns. Phase 5 should standardize on `final.totalUsage` and note in `PERF-COST.md` that pre-Phase-5 `messages.tokens` undercounts multi-step turns (do NOT silently change rate-limit behavior without flagging — that's a separate behavioral change; see Regression note).

### Pattern 2: Server-side aggregation for rollups + dashboards (D-05/D-10, QUAL-08)
**What:** Use `AggregateField.sum()`/`count()` — NEVER fetch-all-then-sum (Pitfall 9 / cost runaway at 400 agents).
**When to use:** `usage-rollup` job aggregation AND every dashboard read.
**Example:**
```typescript
// Source: extends the proven pattern in app/[lang]/(coach)/dashboard/actions.ts:365-432
// (getReplyQualityMetrics already uses count() aggregation + role-conditional scope).
import { AggregateField } from 'firebase-admin/firestore'

// usage-rollup: sum tokens for a (day, agent, pillar) group without reading docs
const snap = await usageEventsRef()
  .where('day', '==', day)
  .where('uid', '==', uid)
  .where('pillar', '==', pillar)
  .aggregate({
    msgCount: AggregateField.count(),
    inTok: AggregateField.sum('inputTokens'),
    outTok: AggregateField.sum('outputTokens'),
    cachedTok: AggregateField.sum('cachedInputTokens'),
  })
  .get()
const { msgCount, inTok, outTok, cachedTok } = snap.data()
await usageRollupsRef().doc(`${day}__${uid}__${pillar}`).set({ /* ... */ }, { merge: true })
```

### Pattern 3: recursiveDelete for the conversation+messages cascade (D-01)
**What:** `firestore.recursiveDelete(docRef)` deletes a doc AND all descendant subcollections in one call — the correct primitive for `conversations/{cid}` + its `messages` subcollection.
**When to use:** Inside `eraseDataSubject` and `erasure-sweep` for conversation docs.
**Example:**
```typescript
// Source: @google-cloud/firestore recursiveDelete (firestore.d.ts:624), re-exported by firebase-admin
import { adminDb } from '@/src/firebase/admin'
// Delete one conversation AND its messages subcollection (no manual subcoll loop)
await adminDb.recursiveDelete(adminDb.collection('conversations').doc(cid))
```
**Idempotency note:** recursiveDelete is best-effort and not transactional. Pair it with the `erasureRequests` ledger: record which `collectionsHit` succeeded; the `erasure-sweep` job re-queries for any subject-keyed docs still present and re-deletes (idempotent — deleting an already-gone doc is a no-op). This is the chunked/resumable contract D-02 requires.

### Pattern 4: Coverage manifest as single source of truth (D-01/D-03)
**What:** A single declarative manifest enumerating every PII-bearing collection + its subject key, consumed by BOTH the erasure executor AND the coverage audit test. This is what *proves* coverage.
**When to use:** Erasure logic + the QUAL-09 coverage audit + the rules test.
**Example:**
```typescript
// Source: src/pdpa/coverage.ts (new) — derived from grep audit of ownerUid/agentUid/leadId writers
// The audit test asserts: for a seeded synthetic subject, after eraseDataSubject, EVERY
// entry below returns 0 docs — and auditLogs still returns its rows (exemption proven).
export const PII_ERASURE_MANIFEST = {
  agent: [   // subjectType:'agent', key = uid
    { collection: 'conversations', keyField: 'ownerUid', recursive: true }, // + messages subcoll
    { collection: 'leadContext',   keyVia: 'leads.ownerUid', recursive: false },
    { collection: 'leads',         keyField: 'ownerUid' },
    { collection: 'replyEdits',    keyField: 'agentUid' },
    { collection: 'escalations',   keyField: 'agentUid' },
    { collection: 'knowledgeGaps', keyField: 'agentUid' },
    { collection: 'agentProfiles', docId: true },          // agentProfiles/{uid}
    { collection: 'rateBudgets',   docId: true },           // rateBudgets/{uid}
    { collection: 'users',         docId: true },           // users/{uid}
    { collection: 'STORAGE',       prefix: 'voice/{uid}/' }, // if any per-agent storage exists
  ],
  lead: [    // subjectType:'lead', key = leadId
    { collection: 'conversations', keyField: 'leadId', recursive: true },
    { collection: 'leadContext',   docId: true },           // leadContext/{leadId}
    { collection: 'leads',         docId: true },           // leads/{leadId}
    { collection: 'replyEdits',    keyField: 'leadId' },
  ],
  EXEMPT: ['auditLogs'],  // hashes-only — the legal record erasure occurred (D-01)
} as const
```

### Pattern 5: Role-conditional read scope (already proven — reuse, don't reinvent)
**What:** Every dashboard/admin read resolves role from the verified token, then either filters by `seniorCoachId == uid` (coach) or reads org-wide (admin), and audits the drilldown.
**Source:** `getReplyQualityMetrics` (`dashboard/actions.ts:334-453`), `getDownline`/`getOpenStalls`/`getKnowledgeGaps` (`src/dashboard/queries.ts`), `getAgentChatHistory` (`dashboard/actions.ts:237`).

### Anti-Patterns to Avoid
- **Two usage pipelines** — instrument once at the route onFinish. Do not also capture in the llm wrapper independently; the wrapper can expose usage, but the WRITE happens once on the route's `after()` path (where `uid`+`pillar` are known). [CONTEXT.md §specifics]
- **Fetch-all-then-count** for dashboards/rollups — use `AggregateField` (Pitfall 9, cost runaway at 400 agents).
- **Erasing the audit log** — `auditLogs` is EXEMPT (D-01). Erasure writes an `erasure` event INTO auditLogs; it never deletes from it.
- **Mega-delete in the Server Action** — must be chunked + lazy-cron-completable (D-02). A synchronous full cascade over a power-user's 800-message thread risks the 60s/Cloud-Run timeout (Pitfall 10).
- **Storing draft/message content in `usageEvents`** — counts only, no PII (D-04). Same hashes-only discipline as audit.
- **Client writes to the 3 new collections** — `usageEvents`/`usageRollups`/`erasureRequests` are server/Admin-SDK only; `create/update/delete: if false` for clients (mirror `auditLogs`/`knowledgeGaps`/`replyEdits` rules).
- **Tuning prompts/agents in a "hardening" phase** — D-06 is measure-first, tune only low-risk wins (cache TTL, index pruning, payload trimming). Resist scope creep (Pitfall 34).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Delete a conversation + its messages subcollection | Manual paginated subcollection delete loop | `adminDb.recursiveDelete(docRef)` | Admin SDK BulkWriter handles depth, batching, retries (`firestore.d.ts:624`) |
| Count/sum usage per day/agent/pillar | `.get()` all docs then reduce | `AggregateField.count()/sum()` server-side | Avoids 400-agent read-cost runaway (Pitfall 9); 1 read-unit per aggregation |
| Token/cache accounting | Re-parse Anthropic raw response | AI SDK `final.totalUsage` + `providerMetadata.anthropic.cacheCreationInputTokens` | SDK normalizes; cache split is provided |
| PDPA pseudonymization in erasure paths | New redaction | Existing `pseudonymize`/audit hashing (`src/audit/`) | Already the compliance spine; erasure event uses `audit.log` (hashes all `raw`) |
| Role assignment | New auth model | `setUserClaims(uid, role)` (`src/firebase/auth.ts:148`) | Sole sanctioned claim-setting path; validates role union |
| Charts | Custom SVG | `recharts` client islands | Already vendored + used (`metrics-panel.tsx`) |
| Background scheduling | External cron / QStash / Cloud Scheduler | `runDueJobs` DUE-gated jobs (`src/jobs/runDueJobs.ts`) | Hard constraint: on-visit lazy-cron only |
| Firestore backup | Custom export script writing JSON | Managed `gcloud firestore export` (operational runbook) | Native managed export; documented op, NOT app code (see constraint note) |
| Load-test SSE client | Hand-rolled concurrent fetch loop | k6 (or artillery) harness | Purpose-built concurrency + p95 histograms; dev tooling |

**Key insight:** Phase 5 adds almost no new algorithms — it composes existing primitives (recursiveDelete, AggregateField, the audit spine, the lazy-cron registry, recharts islands, the role-conditional aggregation). The value is in *coverage proof* and *constraint discipline*, not novel code.

## Runtime State Inventory

> This phase is hardening, not rename/refactor — but PDPA erasure IS a runtime-state-deletion operation, so the inventory is load-bearing here. This enumerates the runtime state that the erasure cascade must reach (the "what survives a code-only delete" question, inverted: "what runtime state holds subject PII").

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| **Stored data (subject-keyed PII collections)** | `conversations/{cid}` keyed by `ownerUid` (agent) or `leadId` (Finder/Reply) + the `messages` subcollection (content); `leadContext/{leadId}` (all 3 slots — `replySlot.latestDraft` holds redacted draft text); `leads/{leadId}` (name pseudonym, phoneHash); `replyEdits` (`originalDraft`/`editedFinal` — residual content, keyed `leadId`+`agentUid`); `escalations` (`agentUid`); `knowledgeGaps` (`agentUid`, topicLabel); `agentProfiles/{uid}`; `rateBudgets/{uid}`; `users/{uid}` | **Erasure cascade** (D-01) must hard-delete every entry. Manifest in `src/pdpa/coverage.ts` (Pattern 4). Coverage audit proves 0 docs remain. |
| **Audit-EXEMPT stored data** | `auditLogs/{alid}` — hashes-only, NO raw PII (`src/audit/log.ts` hashes every `raw` value) | **NOT deleted.** Erasure writes an `erasure` event into it (D-01). The coverage audit asserts auditLogs rows SURVIVE. |
| **Live service config** | None — no n8n/Datadog/external service holds D2 subject PII. Anthropic API retains prompts ~30d (TIA §3) but those are already pseudonymized at the boundary; erasure of the canonical Firestore record is the PDPA remedy (TIA §4.2). | Document in TIA update (D-03) that cross-border retention is out of erasure scope but mitigated by pseudonymization. |
| **OS-registered state** | None — no Task Scheduler/pm2/launchd. Background work is the on-visit lazy-cron (`runDueJobs`), a code registry, not an OS registration. | None — `usage-rollup` + `erasure-sweep` are added as JOB_REGISTRY entries (`src/jobs/runDueJobs.ts:85`), not OS jobs. |
| **Secrets / env vars** | `GOOGLE_GENERATIVE_AI_API_KEY`, Anthropic key, Firebase ADC — via App Hosting + Secret Manager. No subject PII in secrets. | None for erasure. Security-audit item in `HARDENING.md` (D-12): confirm secrets in Secret Manager, never in client bundle/logs. |
| **Build artifacts / Storage** | `collateral/{coid}.storagePath` (KB/inventory assets — NOT subject PII). Per-agent voice samples (`users.voiceSamples[]`) are stored as strings in Firestore today (Phase-2 placeholder, `setUserClaims` seeds `voiceSamples: []`), NOT Storage objects yet. | Storage erasure (D-01 "any Storage objects") is a **no-op today** for subjects unless voice samples move to Storage. State explicitly in coverage manifest; verify with Derek whether any per-agent Storage path exists at pilot time. |

**The canonical question (inverted for erasure):** *After `eraseDataSubject(subject)` runs, what Firestore/Storage location still holds that subject's PII?* The answer must be: **only `auditLogs` (hashes — by design, the legal record), and the Anthropic ~30d cross-border cache (pseudonymized).** Everything else: 0 docs. The coverage audit (D-03) proves this.

## Common Pitfalls

### Pitfall 1: Incomplete erasure coverage (a PII collection is missed)
**What goes wrong:** A subject is "erased" but `replyEdits` (or `knowledgeGaps`, or a Finder conversation keyed by `leadId` not `ownerUid`) still holds their data. PDPA breach + false sign-off.
**Why it happens:** Coverage is enumerated by memory, not by a manifest audited against the actual schema. New collections (`replyEdits` added Phase-4, `leadContext.replySlot`) get forgotten.
**How to avoid:** Single `PII_ERASURE_MANIFEST` (Pattern 4) drives both the executor and the coverage test. The coverage test seeds a synthetic subject into EVERY manifest collection, runs erasure, asserts 0 docs remain in each, and asserts `auditLogs` survives. This is the QUAL-09 / SC1 gate.
**Warning signs:** A collection writer (grep `ownerUid`/`agentUid`/`leadId`) not in the manifest; a Finder conversation (keyed by `leadId`) surviving an agent erasure because only `ownerUid` was checked.

### Pitfall 2: Audit log accidentally erased
**What goes wrong:** The cascade is written generically ("delete everything keyed by subject") and sweeps `auditLogs` (which is hashed by `actorUid` = the agent). The compliance record is destroyed.
**Why it happens:** `auditLogs.actorUid` IS the agent's uid — a naive "delete where actorUid == uid" would hit it.
**How to avoid:** `auditLogs` is in the manifest's `EXEMPT` list (Pattern 4). The executor skips EXEMPT collections by construction. The coverage test asserts auditLogs rows survive AND that an `erasure` event was appended. Firestore rules already forbid client delete (`auditLogs ... allow update, delete: if false`, `firestore.rules:212-216`) — but the Admin SDK bypasses rules, so the code-level exemption is the real guard.
**Warning signs:** auditLogs row count drops after an erasure; no `erasure` action in the audit trail.

### Pitfall 3: Usage double-counting / under-counting (multi-step turns)
**What goes wrong:** Cost numbers are wrong. Either the rollup runs twice over the same `usageEvents` (double count) or `final.usage` (last step only) is used for Finder/Reply 5-step turns (under count).
**Why it happens:** (a) lazy-cron is on-visit — two concurrent visitors could both think a rollup window is due; (b) `final.usage` ≠ `final.totalUsage` for multi-step pillars (route runs `stepCountIs(5)` for finder/reply, `route.ts:493`).
**How to avoid:** (a) The `usage-rollup` job uses the SAME transaction-guarded DUE-gate as all jobs (`runJob` in `runDueJobs.ts:229` — exactly-once-per-window under concurrency, documented at `:9-15`). Make the rollup idempotent: key `usageRollups` docs by `${day}__${uid}__${pillar}` and recompute-from-source with `set(merge)` so a re-run overwrites, never accumulates. (b) Capture `final.totalUsage`, not `final.usage` (Pattern 1 caveat).
**Warning signs:** Rollup totals exceed sum of source events; Finder/Reply per-turn tokens look implausibly low vs Coach.

### Pitfall 4: Rollup cost at 400 agents (the analytics pipeline becomes the cost problem)
**What goes wrong:** The nightly rollup reads every `usageEvents` doc for the day (400 agents × N turns) → read-cost spike; or per-agent-per-pillar aggregation issues thousands of small aggregation queries.
**Why it happens:** Naive per-(agent,pillar) loop with a full read instead of `AggregateField.sum()`; no index for `(day, uid, pillar)`.
**How to avoid:** Aggregation queries cost ~1 read-unit regardless of matched docs (vs N for fetch-all). Add a composite index `usageEvents (day ASC, uid ASC, pillar ASC)`. Bound the rollup: iterate distinct (uid,pillar) discovered from a projection (like `getReplyQualityMetrics` does with `select()`), then one aggregation per group. Consider a `usageEvents` TTL (Claude's-discretion item — propose 90d retention to cap collection growth; rollups are the durable record).
**Warning signs:** Firestore reads/day on a rollup-only window >> message volume; rollup job runtime trends up with agent count.

### Pitfall 5: Dashboard read-cost (CDASH-08 / ADMIN-08)
**What goes wrong:** The dashboard v2 funnel re-reads every downline agent's full thread to compute metrics (Pitfall 9 in PITFALLS.md), or admin org-wide usage reads all `usageEvents`.
**How to avoid:** Dashboards read `usageRollups` (pre-aggregated, D-05), NOT raw events. Funnel reuses the pure `src/dashboard/metrics.ts` functions over already-fetched profiles. Reply-quality already uses `count()` (`getReplyQualityMetrics`). For admin org-wide, read the day's `usageRollups` (≤ 400×3 small docs) or aggregate them. Consider Next.js 16 `use cache` for the rollup reads (opt-in; never on a per-conversation/LLM path) — see `node_modules/next/dist/docs/01-app/02-guides/caching-without-cache-components.md`.
**Warning signs:** Dashboard p95 > 3s; reads scale with message volume not agent count.

### Pitfall 6: Rules regression when surfacing the role matrix (ADMIN-07)
**What goes wrong:** Adding the role-matrix read surface loosens a rule (e.g., admin reading `users/*` org-wide) and accidentally opens cross-tenant or coach-escalation paths; or the 3 new collections ship without rules (the "unruled collection" leak, Pitfall 6 in PITFALLS.md).
**How to avoid:** The role matrix READS existing `users` docs (admin already has `users read if hasRole('admin') && sameTenant()`, `firestore.rules:65`) and WRITES via `setUserClaims` (Admin SDK, bypasses rules). No rule change needed for the matrix itself. The 3 new collections MUST ship with deny-by-default rules + CI rules tests in the SAME plan (mirror `auditLogs`/`replyEdits` server-only pattern). Extend `src/firebase/__tests__/rules.test.ts` (which already enumerates "every collection × 3 roles", header `:11`) — the test asserting "no unruled collection (all 16 enumerated)" (`:21`) must become "all 19".
**Warning signs:** A new collection with no `match` block; `npm run test:rules` not updated for the 3 new collections; admin read rule widened beyond `sameTenant()`.

### Pitfall 7: Treating the load test or managed export as a constraint violation
**What goes wrong:** Team avoids k6 or managed export thinking "no GCP beyond Firebase" forbids them, and ships without load-test evidence / backup runbook.
**How to avoid:** The load-test harness is **dev/CI tooling hitting the deployed endpoint** — it is NOT app infra (CONTEXT.md §domain explicitly blesses this). Managed Firestore export/import is the **native Firebase/GCP backup mechanism**, invoked operationally (gcloud/console), documented in `HARDENING.md`/`docs/operations/` — it is NOT Cloud Functions / external scheduler / BigQuery. Flag clearly: it uses the GCP `FirestoreAdminClient` API surface, so it lives in a RUNBOOK (human-run gcloud command), not in app code. The no-external-scheduler constraint means: default to documented on-demand export + a lazy-cron *reminder* (a job that surfaces "last export was N days ago"), not an automated wall-clock export.
**Warning signs:** No `LOADTEST.md`; backup described as a custom JSON dump; an automated scheduled export added (violates no-external-scheduler).

### Pitfall 8: Scope creep into v2 (Pitfall 34, PITFALLS.md)
**What goes wrong:** "Can it also auto-assign leads / add a public recommender / WABA?" mid-phase. Hardening deprioritized; launch ships with avoidable incidents.
**How to avoid:** D-12 `HARDENING.md` makes deliverables concrete checklist items gated for launch. New requests → post-v1 backlog by default (the Deferred list in CONTEXT.md is authoritative). The exit bar is "provably ready + handed over," not feature count.

## Code Examples

### Erasure Server Action skeleton (D-01/D-02) — admin-gated, chunked, audit-exempt
```typescript
// Source: composes src/firebase/auth.ts requireUser + src/audit/log.ts + recursiveDelete +
//         the (admin)/kb/actions.ts getSessionUser pattern (actions.ts:34-48)
'use server'
import { z } from 'zod'
import { adminDb } from '@/src/firebase/admin'
import * as audit from '@/src/audit'
import { erasureRequestsRef, TENANT_ID } from '@/src/firebase/collections'
import { PII_ERASURE_MANIFEST } from '@/src/pdpa/coverage'

const Input = z.object({ subjectType: z.enum(['lead', 'agent']), id: z.string().min(1) })

export async function eraseDataSubject(raw: unknown) {
  const user = await getSessionUser()                 // admin route-group gate is gate 1
  if (user.role !== 'admin') return { ok: false, error: 'Forbidden' }   // gate 2
  const { subjectType, id } = Input.parse(raw)        // gate 3 (input validation, V5)

  const reqRef = erasureRequestsRef().doc()
  const slaDeadline = Date.now() + 72 * 60 * 60 * 1000  // <72h SLA (D-02)
  await reqRef.set({
    tenantId: TENANT_ID, subjectType, subjectIdHash: hash(id),  // hash — no raw id stored
    status: 'pending', requestedBy: user.uid, requestedAt: Date.now(),
    slaDeadline, collectionsRemaining: PII_ERASURE_MANIFEST[subjectType].map(m => m.collection),
  })

  // Best-effort synchronous pass — recursiveDelete the conversations, delete the rest.
  // Whatever does not finish is left for the erasure-sweep job (D-02 chunked).
  const hit = await runErasureBatch(subjectType, id, reqRef)   // updates collectionsRemaining

  // Audit-EXEMPT: write an erasure EVENT into auditLogs (never delete from it) — D-01
  await audit.log({
    actorUid: user.uid, action: 'erasure', targetRef: `erasureRequests/${reqRef.id}`,
    raw: { subjectType, subjectIdHash: hash(id), collectionsHit: hit },  // all values hashed
  })

  return { ok: true, reqId: reqRef.id, status: hit.complete ? 'complete' : 'sweeping' }
}
```

### usage-rollup + erasure-sweep job registration (D-05/D-02)
```typescript
// Source: extends JOB_REGISTRY in src/jobs/runDueJobs.ts (:85). The 'usage-rollup' STUB
// already exists at :208 as a no-op — Phase 5 fills its body. 'erasure-sweep' is net-new.
const JOB_REGISTRY: Record<string, JobDefinition> = {
  // ... existing stall-detect / escalate / eval-nightly ...
  'usage-rollup': {
    windowMs: ONE_DAY_MS,
    run: async (now) => { await rollupUsage(dayKey(now)); await writeHeartbeat('usage-rollup') },
  },
  'erasure-sweep': {                       // NEW — finishes pending erasureRequests batches
    windowMs: 60 * 60 * 1000,              // 1h window → well inside the 72h SLA
    run: async (_now) => { await erasureSweep(); await writeHeartbeat('erasure-sweep') },
  },
}
```

### Conversation viewer (ADMIN-02) — widen the audited drilldown
```typescript
// Source: app/[lang]/(coach)/dashboard/actions.ts:237 getAgentChatHistory — currently
// scoped to the coach training thread `coach-${agentUid}`. Widen for admin/cross-pillar.
export async function getConversationForReview(cid: string) {
  const user = await getSessionUser()
  if (user.role !== 'admin') return { ok: false, error: 'Forbidden' }  // admin-only (D-08)
  await auditDrilldown(user.uid, `conversations/${cid}`)               // PDPA audit (TSD §5.1)
  const records = await loadRecent(cid, 100)        // reuse src/memory/conversation.ts:142
  return { ok: true, messages: records.map(r => ({ id: r.id, role: r.data.role,
           content: r.data.content, redacted: r.data.redacted ?? false })) }
}
```

### Role matrix assignment (ADMIN-07) — reuse setUserClaims
```typescript
// Source: src/firebase/auth.ts:148 setUserClaims — the sole sanctioned claim-setting path.
export async function assignRole(targetUid: string, role: 'new-agent'|'senior-coach'|'admin') {
  const user = await getSessionUser()
  if (user.role !== 'admin') return { ok: false, error: 'Forbidden' }
  await setUserClaims(targetUid, role)   // validates role union (InvalidRoleError) + upserts users doc
  await audit.log({ actorUid: user.uid, action: 'role-assign',
    targetRef: `users/${targetUid}`, raw: { targetUid, role } })
  return { ok: true }
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `final.usage.totalTokens` (last step) for token accounting | `final.totalUsage` (sum across steps) | ai@5 onFinish API | Multi-step Finder/Reply turns no longer undercounted |
| Fetch docs to count them | `AggregateField.count()/sum()/average()` | Firestore (GA) | 1 read-unit per aggregation; required for 400-agent scale |
| External cron (QStash/Cloud Scheduler) | On-visit lazy-cron `runDueJobs` DUE-gate | Decision override 2026-06-01 | `usage-rollup`/`erasure-sweep` are JOB_REGISTRY entries |
| Implicit Server Component fetch caching | Opt-in `use cache` (Next.js 16, stable 16.2) | Next.js 16 | Dashboard rollup reads must opt-in to caching; never cache LLM calls |
| Manual subcollection delete loops | `recursiveDelete(docRef)` | Admin SDK | Cascade deletes `messages` subcollection automatically |

**Deprecated/outdated:**
- `middleware.ts` → `proxy.ts` (Next.js 16); `cookies()`/`headers()` are async (already correct in this repo, e.g. `_actions/jobs.ts:41`).
- QStash / Cloud Scheduler / Cloud Functions / BigQuery / Vertex — forbidden by hard constraints; do NOT reintroduce for analytics or scheduling.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Per-agent voice samples are still Firestore strings (`users.voiceSamples[]`), NOT Storage objects, at pilot time — so "Storage erasure" is a near-no-op for subjects | Runtime State Inventory | If voice samples move to Storage, the manifest's STORAGE entry must be wired before sign-off, or erasure misses them. Confirm with Derek. |
| A2 | `final.totalUsage` is populated by the Anthropic provider for streamed multi-step turns (the SDK type guarantees the field; provider population is the open part) | Pattern 1 | If `totalUsage` is `undefined` for some turns, usage events record 0 — cost numbers undercount. Verify in a live/integration test before trusting `PERF-COST.md`. |
| A3 | The `escalations` collection is keyed by `agentUid` for agent erasure (confirmed schema `EscalationDoc.agentUid`, `collections.ts:344`); no lead-keyed escalations exist | Coverage manifest | A lead-keyed escalation (none today) would be missed on lead erasure. |
| A4 | Exact SLO/p95 numbers + 400-agent load profile shape are Derek's call (CONTEXT.md discretion) — research proposes; the planner should not lock numbers | D-06/D-11 | Locking arbitrary SLOs without Derek = wrong budget. Propose, don't lock. |
| A5 | `usageEvents` retention/TTL is a propose-during-planning item (CONTEXT.md discretion); default proposal = 90d (rollups are durable) | Pitfall 4 | Too-short TTL loses re-aggregation ability; too-long inflates read cost at 400 agents. |
| A6 | Managed Firestore export/import is acceptable as a documented operational runbook (not app code), within "no external scheduler" if invoked on-demand | Pitfall 7 / D-12 | If Derek/constraint reading is stricter ("no GCP Admin API at all"), backup must be re-scoped to a manual data-export Server Action — heavier. Flag for confirmation. |

## Open Questions

1. **Does the existing rate-limit decrement (`route.ts:607`) and `messages.tokens` (`:522`) intentionally undercount multi-step Finder/Reply turns?**
   - What we know: both read `final.usage.totalTokens` (last step only) while finder/reply run `stepCountIs(5)`.
   - What's unclear: whether to retroactively fix rate-limiting (behavioral change) or only fix the NEW `usageEvents` capture.
   - Recommendation: For Phase 5, capture `final.totalUsage` in `usageEvents` (correct cost). Treat the rate-limit/messages.tokens undercount as a SEPARATE, flagged finding in `PERF-COST.md` — changing rate-limit budget consumption mid-hardening is a regression-surface change requiring its own claim + Derek sign-off (TOKEN_CAP=50_000, `ratelimit/window.ts:28`).

2. **Lead erasure when a lead's `conversations` are keyed by `leadId` vs the agent's primary `coach-${uid}` thread (keyed by `ownerUid`).**
   - What we know: `ConversationDoc` has both `ownerUid` (always) and `leadId?` (Finder/Reply). Coach threads have no leadId.
   - What's unclear: whether lead erasure should delete the whole Finder/Reply conversation (it may interleave multiple leads? No — `route.ts` required-leadId fail-closed for reply, and Finder slots are per-lead) or just lead-scoped messages.
   - Recommendation: Confirm a Finder/Reply conversation maps to exactly one lead. Current code keys `leadContext` and slots per-lead, and the route passes one `leadId` per turn — so deleting `conversations where leadId == X` is correct. Validate in the coverage test with a synthetic multi-lead agent.

3. **Resolution-time + escalation-rate definitions for the rollup (D-05/ADMIN-08).**
   - What we know: escalation rate = open/total is already computed (`computeEscalationRate`, `dashboard/actions.ts:460`). "Resolution time" and "message volume" are new.
   - Recommendation: Reuse `computeEscalationRate` shape. Define "resolution time" = escalation `openedAt` → status `resolved` delta (requires a `resolvedAt` field on `EscalationDoc` — currently absent; `resolveStall` only sets `status:'resolved'`, `actions.ts:84`). Flag: adding `resolvedAt` is a small schema add needed for resolution-time analytics. "Message volume" = `usageEvents` count (msgCount) per rollup.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Firebase Admin SDK (Firestore) | All Phase-5 server code | ✓ | firebase-admin 13.10.0 | — |
| `recursiveDelete` / `AggregateField` | Erasure + rollups | ✓ | via @google-cloud/firestore | — |
| AI SDK usage/providerMetadata | Usage capture | ✓ | ai 5.0.193 / anthropic 2.0.80 | — |
| recharts | Dashboards | ✓ (vendored) | 3.8.0 | — |
| Firestore emulator | Rules tests (3 new collections) | ✓ (firebase.json :8080) | — | `npm run test:rules` skips cleanly when emulator absent (rules.test.ts emulator gate) |
| k6 | Load test (D-11, live-gated) | ✗ (dev-machine install) | — | artillery (Node-native); or `docker run grafana/k6` — dev tooling, not a blocker for code-readiness |
| gcloud CLI / FirestoreAdminClient | Managed export/import runbook (D-12) | ✗ (operator machine) | — | Documented op step; not required to be present in the build env |
| Deployed App Hosting stack (asia-southeast1) | Load-test execution (D-11), PDPA live drill | ✗ at code time | — | Live-gated: code-ready this phase, executed during rollout prep (matches Phase 2/3/4 live-gated pattern) |

**Missing dependencies with no fallback (blocking):** none for code. The deployed stack + k6 are needed only for the LIVE-GATED execution steps (load-test run, backup/restore drill, PDPA sign-off), consistent with how Phases 2–4 deferred live proofs to rollout.

**Missing dependencies with fallback:** k6 → artillery/docker; gcloud → documented runbook step.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest `4.1.7` (unit/integration) · Playwright `1.60.0` (e2e) · `@firebase/rules-unit-testing` `5.0.1` (rules) · Promptfoo `0.121.13` (eval) |
| Config files | `vitest.config.ts` (node env, includes `src/**`, `tests/**`, `app/**/*.test.ts`) · `playwright.config.ts` · `promptfooconfig.yaml` · `firebase.json` (emulators: firestore:8080, auth:9099, storage:9199) |
| Quick run command | `npm test` (vitest run, ~seconds; rules tests SKIP cleanly without emulator) |
| Full suite command | `firebase emulators:exec "npm test && npm run test:rules"` then `npm run test:e2e` + `npm run eval` |
| Rules-only | `npm run test:rules` → `vitest run src/firebase/__tests__/rules` (needs emulator) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| QUAL-09 | **Erasure coverage** — every PII collection reaches 0 docs after erasure | unit/integration (emulator) | `firebase emulators:exec "vitest run src/pdpa"` | ❌ Wave 0 |
| QUAL-09 | **Audit exemption** — erasure does NOT delete auditLogs + writes an `erasure` event | unit/integration (emulator) | `firebase emulators:exec "vitest run src/pdpa/erasure.test.ts"` | ❌ Wave 0 |
| QUAL-09 | Erasure idempotency (re-run is a no-op; sweep finishes partials) | unit (emulator) | `firebase emulators:exec "vitest run src/pdpa/sweep.test.ts"` | ❌ Wave 0 |
| QUAL-09 | Erasure Server Action admin-gate + input validation (zod) | unit | `vitest run app/[lang]/(admin)/erasure/actions.test.ts` | ❌ Wave 0 |
| QUAL-09 | **Deny-by-default rules** — `erasureRequests` client create/update/delete denied; read admin-only | rules-test (emulator) | `npm run test:rules` | ⚠️ extend `rules.test.ts` |
| QUAL-09 | Live PDPA erasure drill (<72h end-to-end) + Derek `PDPA-SIGNOFF.md` | **manual / human-gated** | live deployed stack + sign-off memo | n/a (artifact) |
| QUAL-08/ADMIN-08 | Usage event capture (`final.totalUsage` → usageEvents, no PII) | unit | `vitest run src/usage/record.test.ts` | ❌ Wave 0 |
| QUAL-08/ADMIN-08 | Rollup aggregation (sum/count, idempotent set-merge) | unit (emulator) | `firebase emulators:exec "vitest run src/usage/rollup.test.ts"` | ❌ Wave 0 |
| QUAL-08/ADMIN-08 | **Deny-by-default rules** — `usageEvents`/`usageRollups` client-write denied; usageRollups admin-read | rules-test (emulator) | `npm run test:rules` | ⚠️ extend `rules.test.ts` |
| QUAL-08 | Prompt-cache hit-rate measured + `PERF-COST.md` numbers | **manual / live measure** | live stack + documented numbers | n/a (artifact) |
| ADMIN-08 | Admin usage dashboard renders rollups (org scope) | e2e | `npm run test:e2e -- usage` | ❌ Wave 0 |
| CDASH-08 | Funnel/ramp/knowledge-gap/correction→eval panels render; role scope | unit (metrics) + e2e | `vitest run src/dashboard/*.test.ts` · `npm run test:e2e -- dashboard` | ⚠️ extend |
| ADMIN-02 | Conversation viewer admin-only + auditDrilldown written; cross-pillar | unit + e2e | `vitest run app/[lang]/(admin)/conversations/actions.test.ts` · `npm run test:e2e -- conversation-viewer` | ❌ Wave 0 |
| ADMIN-07 | Role matrix read + `setUserClaims` assignment admin-gated + audited | unit | `vitest run app/[lang]/(admin)/roles/actions.test.ts` | ❌ Wave 0 |
| ADMIN-07 | **Rules sweep proving the matrix** — coach=downline, admin=all, cross-tenant denied (all 19 collections) | rules-test (emulator) | `npm run test:rules` | ⚠️ extend `rules.test.ts` (currently 16 collections, header `:21`) |
| QUAL-01 | Model-swap proof STILL passes (carried-forward gate) | integration | existing model-swap test (Phase 1, 01-13) | ✓ (must stay green) |
| SC4 / D-11 | ~400-concurrent load test (p95, error rate, cold-start, contention) | **live-gated / human-run** | `k6 run scripts/loadtest/chat.js` against deployed stack | ❌ Wave 0 (code-ready), live exec deferred |
| SC4 / D-12 | Backup/restore drill | **manual / human-gated** | `gcloud firestore export` runbook | n/a (runbook) |

### Sampling Rate
- **Per task commit:** `npm test` (vitest, fast). For erasure/rollup tasks that need the emulator: `firebase emulators:exec "vitest run src/pdpa src/usage"`.
- **Per wave merge:** `firebase emulators:exec "npm test && npm run test:rules"` (full unit + rules).
- **Phase gate:** Full unit + rules + e2e + `npm run eval` green; QUAL-01 model-swap green; live-gated items (load test, PDPA drill, backup/restore, browser click-through) executed during rollout prep with evidence linked in `HARDENING.md`.

### Wave 0 Gaps
- [ ] `src/pdpa/erasure.test.ts` — covers QUAL-09 erasure cascade + audit exemption (emulator)
- [ ] `src/pdpa/coverage.test.ts` — covers QUAL-09 coverage manifest (every PII collection → 0 docs)
- [ ] `src/pdpa/sweep.test.ts` — covers QUAL-09 idempotent chunked sweep
- [ ] `src/usage/record.test.ts` — covers QUAL-08 usage capture (no-PII, totalUsage)
- [ ] `src/usage/rollup.test.ts` — covers QUAL-08/ADMIN-08 aggregation (emulator)
- [ ] `app/[lang]/(admin)/erasure/actions.test.ts`, `conversations/actions.test.ts`, `roles/actions.test.ts` — admin-gate + audit assertions
- [ ] Extend `src/firebase/__tests__/rules.test.ts` — add `usageEvents`, `usageRollups`, `erasureRequests` (deny-by-default + admin-read) → update the "all 16 enumerated" assertion to 19
- [ ] e2e specs: admin erasure click-through, conversation viewer, usage dashboard, dashboard v2 panels
- [ ] `scripts/loadtest/chat.js` (k6) — code-ready; live execution deferred

*(Test infra itself is present — only new test FILES are needed, not framework installs.)*

## Security Domain

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | `requireUser` verifies Firebase ID token server-side (`src/firebase/auth.ts:96`); claims from verified token only |
| V3 Session Management | yes | `__session` httpOnly cookie → `requireUser` (admin layout `:39`, dashboard actions `:39`) |
| V4 Access Control | yes | Custom claims + deny-by-default Firestore rules; admin route-group gate (`(admin)/layout.tsx:50`); role-conditional reads; **erasure is admin-only + audited** |
| V5 Input Validation | yes | `zod ^4.4.3` for `eraseDataSubject` + role-assignment input; route already validates override/leadId/langOverride enums (`route.ts:288-302`) |
| V6 Cryptography | yes | sha256 via Node `crypto` for audit hashes + erasure subjectIdHash (`src/audit/log.ts`, `src/audit/pdpa.ts`) — never hand-rolled |
| V7 Error/Logging | yes | No-PII-in-logs (CLAUDE.md); audit fire-and-forget swallows errors w/o logging entry contents (`log.ts:91`); usageEvents are counts-only |
| V9 Data Protection (PDPA) | yes | Boundary pseudonymization + `pdpa_redacted` gate (`route.ts:330`); **right-to-erasure** (QUAL-09); audit hashes-only + exempt from erasure |

### Known Threat Patterns for {Next.js 16 + Firebase + Admin SDK}
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Unruled new collection (the Sept-2025 mass-leak) | Information Disclosure | Deny-by-default rules + CI rules test for `usageEvents`/`usageRollups`/`erasureRequests` in the SAME plan (Pitfall 6) |
| Audit log destroyed by erasure | Repudiation | `auditLogs` in manifest EXEMPT list; coverage test asserts survival + `erasure` event written (Pitfall 2) |
| Incomplete erasure (residual PII) | Information Disclosure | Single coverage manifest drives executor + audit; seeded-subject coverage test (Pitfall 1) |
| Admin SDK bypasses rules on the server | Elevation of Privilege | Erasure/role/usage writes are admin-gated in code BEFORE the Admin-SDK call (rules can't protect server writes) |
| Client forging usage/rollup/erasure docs | Tampering | `create/update/delete: if false` for clients (mirror auditLogs/replyEdits) |
| PII in usageEvents | Information Disclosure | Counts only; no content; same hashes-only discipline as audit |
| Cross-tenant / cross-coach read via new surfaces | Information Disclosure | `sameTenant()` + `seniorCoachId==uid` (coach) on every read; admin org-wide but tenant-bounded; rules sweep proves matrix |
| Cost-DoS via usage capture loop | Denial of Service | Capture rides existing `after()` (post-response, non-blocking); rate-limit gate already at `route.ts:257` |

## Project Constraints (from CLAUDE.md / AGENTS.md)
- **No Cloud Functions / no GCP beyond Firebase SDK / no BigQuery / no external scheduler / no Vertex.** Usage analytics = Firestore rollups; periodic work = on-visit lazy-cron. Managed export = documented operational runbook (flagged, A6).
- **Model IDs from Remote Config** (`modelFor`, `provider.ts:70`) — QUAL-01 model-swap test must stay green.
- **PDPA**: pseudonymize at the boundary + `pdpa_redacted` gate; audit hashes-only + erasure-exempt; never log PII; `tenantId` on every doc (converter stamps it, `collections.ts:507`).
- **Multilingual** (EN/BM/中文) for any new UI copy — `next-intl`, `app/[lang]/`.
- **Core/shell split**: `src/` must NOT import from `app/`. New `src/usage`, `src/pdpa` modules stay framework-free (Admin SDK only).
- **Next.js 16**: `proxy.ts` not middleware; async `cookies()`/`headers()`; no implicit cache (opt-in `use cache` for rollup reads only, never LLM); streaming only from Route Handler via `toUIMessageStreamResponse()` (read `node_modules/next/dist/docs/` before any Next.js code).
- **No auto-send / no WABA in v1.** Reply stays paste-and-draft.
- **Claim-before-start**: a committed `phase-kayinleong-05` claim before any code (per global protocol).
- **Every fix needs a Regression Report** in CLAIM.md before `done` (esp. the rate-limit/token-count finding in Open Question 1).

## Sources

### Primary (HIGH confidence — repo code + installed type defs, read 2026-06-07)
- `app/api/chat/route.ts` (onFinish usage/audit path, gate ordering, stepCountIs) — :485-644
- `src/jobs/runDueJobs.ts` (JOB_REGISTRY, DUE-gate transaction, usage-rollup stub :208) · `src/jobs/heartbeat.ts` · `src/jobs/workingHours.ts`
- `src/llm/provider.ts` (modelFor / Remote Config) · `src/llm/types.ts`
- `src/audit/log.ts` (hashes-only writer, auditDrilldown) · `src/audit/pdpa.ts` (pseudonymize, assertRedacted)
- `src/firebase/collections.ts` (all 17 collections, converter, typed refs) · `firestore.rules` · `firestore.indexes.json`
- `src/memory/conversation.ts` (loadRecent, appendMessage) · `src/memory/leadContext.ts` (slots) · `src/memory/agentProfile.ts`
- `src/escalation/knowledgeGaps.ts` · `src/escalation/detect.ts` · `src/escalation/index.ts`
- `src/dashboard/queries.ts` · `src/dashboard/metrics.ts` (funnel sources)
- `app/[lang]/(coach)/dashboard/actions.ts` (getReplyQualityMetrics count() aggregation :334, getAgentChatHistory :237) · `dashboard/page.tsx` · `_components/metrics-panel.tsx` (recharts)
- `app/[lang]/(admin)/layout.tsx` (assertAdmin :50) · `(admin)/kb/actions.ts` (getSessionUser pattern)
- `src/firebase/auth.ts` (requireUser, setUserClaims) · `src/ratelimit/window.ts` (TOKEN_CAP) · `app/_actions/jobs.ts` (lazy-cron trigger) · `app/[lang]/chat/lead-actions.ts`
- `node_modules/@ai-sdk/provider/dist/index.d.ts:1104-1127` (LanguageModelV2Usage) · `node_modules/ai/dist/index.d.ts:1272-1281` (onFinish totalUsage) · `node_modules/@ai-sdk/anthropic/dist/index.d.ts:24` (cacheCreationInputTokens)
- `node_modules/@google-cloud/firestore/types/firestore.d.ts:624` (recursiveDelete), `:2584-2598` (AggregateField count/sum/average), `:3032-3034` (v1 FirestoreAdminClient export/import)
- `package.json` (scripts + versions) · `vitest.config.ts` · `firebase.json` · `src/firebase/__tests__/rules.test.ts` (header)
- `.planning/TSD.md` §4/§5.3/§9/§10/§11 · `.planning/phases/01-foundations/PDPA-TIA.md` · `.planning/REQUIREMENTS.md` · `.planning/ROADMAP.md` · `.planning/research/PITFALLS.md` (Pitfalls 1, 6, 7, 9, 10, 21, 34, 35)

### Secondary (MEDIUM — official docs referenced by repo, not re-fetched this session)
- `node_modules/next/dist/docs/01-app/02-guides/caching-without-cache-components.md` (use cache for rollup reads)
- Firestore aggregation + managed export behavior (firebase docs, corroborated by installed type defs)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — every library installed + version-verified against type defs; no new deps.
- Architecture / patterns: HIGH — every pattern extends a concrete existing seam at a cited file:line.
- Erasure coverage: HIGH (collection mapping grep-verified) / MEDIUM on Storage (A1 — voice-sample location to confirm with Derek).
- Usage capture: HIGH on the SDK fields / MEDIUM on `final.totalUsage` provider population for streamed multi-step turns (A2 — verify live).
- Pitfalls: HIGH — drawn from PITFALLS.md + observed repo undercount (Open Question 1).
- Backup/restore constraint reading: MEDIUM (A6 — confirm managed-export-as-runbook is constraint-acceptable with Derek).

**Research date:** 2026-06-07
**Valid until:** ~2026-07-07 (stable repo; re-verify AI SDK usage field population if `ai`/`@ai-sdk/anthropic` upgrade)
