# PERF-COST.md — Phase 5 Performance + Cost Pass
## D2 Customer Service AI Agent Platform (`cy-csaiagent`)

**Requirement:** QUAL-08 (D-06)
**Status:** Documented | p95 / cache-hit numbers: LIVE-GATED (measured on deployed stack during rollout)
**Author:** AI engineering lead (Phase 5 execution, 2026-06-07)
**Evidence base:** 05-01..05-07-SUMMARY.md; `src/usage/`, `app/api/chat/route.ts`, `src/jobs/runDueJobs.ts`

---

> **PROPOSED** appears wherever a number requires Derek's final call or a live-stack run to confirm.
> **LIVE-GATED** appears wherever a number must be measured on the deployed stack during rollout prep.

---

## 1. The Single Usage + Cost Pipeline

One pipeline. No BigQuery. No external scheduler. No second capture point.

```
chat POST /api/chat (route.ts)
  GATE1 auth → GATE2 ratelimit → GATE3 PDPA → GATE4 route(pillar) → GATE5 streamText
                                                        │
                                               onFinish(final)
                                                        │
                         after(() => recordUsageEvent({ uid, pillar, … }))   ← single capture
                                        │
                              usageEvents/{id}  (append-only, tenantId, NO PII)
                                        │
                    on-visit lazy-cron usage-rollup job (24h window, DUE-gated)
                           AggregateField.sum() / count() per (day, uid, pillar)
                                        │
                           usageRollups/{day}___{uid}___{pillar}
                                    /             \
              admin usage dashboard           PERF-COST.md cost view
              (ADMIN-08, 05-07)               (QUAL-08, this doc)
```

**Key implementation facts (all from committed code):**

| Fact | Source | Commit |
|------|--------|--------|
| Single capture in `route.ts onFinish after()` | `app/api/chat/route.ts` (alongside audit.log after() at :612) | ebed5dd (05-04) |
| Token fields: `final.totalUsage.inputTokens/outputTokens/cachedInputTokens` | `src/usage/record.ts` | ebed5dd (05-04) |
| Cache-write field: `final.providerMetadata?.anthropic?.cacheCreationInputTokens ?? 0` | `src/usage/record.ts` | ebed5dd (05-04) |
| `uid` + `pillar` tag: both in scope at the route (GATE1 + GATE4) | `app/api/chat/route.ts` | ebed5dd (05-04) |
| Fire-and-forget (swallow errors): mirrors `src/audit/log.ts:76-97` exactly | `src/usage/record.ts` | ebed5dd (05-04) |
| No PII: counts only — no content, no draft text, no routeDecision | `src/usage/types.ts` (explicit destructure) | ebed5dd (05-04) |
| rollupUsage: `AggregateField.sum()`/`count()` per (day,uid,pillar); `set(merge:true)` | `src/usage/rollup.ts` | f69bba1 (05-04) |
| `usage-rollup` JOB_REGISTRY filled (24h window) | `src/jobs/runDueJobs.ts` | f69bba1 (05-04) |
| Dashboards read `usageRollups` ONLY — never raw `usageEvents` | `app/[lang]/(admin)/usage/page.tsx` | b7785e4 (05-07) |

**Anti-patterns avoided:**
- Two usage pipelines (CONTEXT.md warning): only ONE `after()` call writes `usageEvents`.
- Fetch-all-then-sum: `AggregateField` is used for all rollup aggregation (1 read-unit per aggregation — Pitfall 4).
- Dashboard reads raw events: dashboards are read-rollups-not-raw by contract (HR-7 in 05-07).

---

## 2. Prompt-Cache Hit-Rate Measurement Method

**The measurement method is code-ready. The actual NUMBERS are LIVE-GATED.**

### What is measured

| Metric | Definition | Source field |
|--------|-----------|--------------|
| Cache hit (read) | Tokens served from Anthropic's prompt cache (cost = ~0.1× full input price) | `cachedInputTokens` in `usageRollups` |
| Cache write (one-time) | Tokens stored in the prompt cache on a cache-miss turn | `cacheCreationInputTokens` in `usageRollups` |
| Cache hit rate | `cachedInputTokens / (inputTokens + cachedInputTokens)` per window | Computed from `usageRollups` fields |

### How to compute from the admin dashboard

The admin usage dashboard (`app/[lang]/(admin)/usage/page.tsx`, 05-07) already displays:

```
cacheHitRate = totalCachedInputTokens / (totalInputTokens + totalCachedInputTokens)
```

This is computed server-side in the RSC page and displayed in the KPI tiles.

### What the numbers mean for cost

```
Effective input cost per 1M tokens ≈
  inputTokens × full_price
  + cachedInputTokens × 0.10 × full_price    ← 90% discount on cache hits
  + cacheCreationInputTokens × 1.25 × full_price  ← 25% premium on cache write
```

Source: Anthropic API pricing (confirm against current pricing page before budgeting).

### Live-gated steps

Record during rollout prep:

| Metric | LIVE-GATED number |
|--------|-------------------|
| 7-day average cache hit rate | __________% |
| Cache creation input tokens (write cost) per active day | __________ |
| Effective cost per 1K agent-turns at pilot scale | ____ USD |
| Effective cost per 1K agent-turns at 400 agents | ____ USD (PROPOSED — see §5) |

---

## 3. Firestore Index + Read Audit

### Composite indexes in production

| Index | Collection | Fields | Purpose | Source |
|-------|-----------|--------|---------|--------|
| `(day, uid, pillar) ASC` | `usageEvents` | day → uid → pillar | Bounds the per-(uid,pillar) group aggregation in `rollupUsage()` without unbounded scans | `firestore.indexes.json` (05-02, b5c6046) |
| `(seniorCoachId, status) ASC` | `escalations` | seniorCoachId → status | Scope open escalations by coach | `firestore.indexes.json` |
| `(seniorCoachId, role, status)` | `agentProfiles` | existing | Dashboard funnel | `firestore.indexes.json` |
| *(additional existing indexes)* | see `firestore.indexes.json` | — | — | quick-004 made indexes deployable |

### Read-cost discipline

| Rule | Implementation | Where enforced |
|------|---------------|----------------|
| Aggregations use `AggregateField.count()/sum()` (1 read-unit) not fetch-all | `rollupUsage()` in `src/usage/rollup.ts` | Code + test assertion |
| Dashboards read `usageRollups` only (pre-aggregated docs, ≤ 400×3 per window) | `app/[lang]/(admin)/usage/page.tsx` | HR-7 acceptance grep |
| Group discovery uses `select()` projection before per-group aggregation | `rollupUsage()` mirrors `getReplyQualityMetrics :402-407` | Code pattern |
| Rollup is idempotent (set-merge, key `${day}__${uid}__${pillar}`) | `src/usage/rollup.ts` | Pitfall 3 guard |
| The `usage-rollup` lazy-cron runs at most once per 24h per visitor (DUE-gate transaction) | `src/jobs/runDueJobs.ts runJob(:229-265)` | Exactly-once-per-window |

### AggregateField cost model (at 400 agents)

At 400 agents × 3 pillars × N active per day, the rollup issues:

- **Group discovery**: 1 `select()` query over `usageEvents where day==X` (reads only projected fields)
- **Per-group aggregation**: 1 aggregation query each (1 read-unit each) = ≤ 400×3 = 1,200 read-units max for a full org-day rollup
- **Dashboard reads**: ≤ 400×3 = 1,200 rollup docs for a 1-day window; a 30-day window reads ≤ 36,000 docs (still linear in agents, not in messages — acceptable)

---

## 4. PROPOSED p95 Latency Budget

> **PROPOSED — final numbers are Derek's call (Decision A4). All values below are researcher-proposed starting points based on the v1 architecture. Derek finalizes the SLOs before rollout.**

### SSE chat endpoint (`/api/chat`)

| Metric | PROPOSED target | Notes |
|--------|----------------|-------|
| p95 first-token latency (SSE) | < 3,000 ms | From model prompt-cache miss; cached turns significantly faster |
| p50 first-token latency (SSE) | < 1,500 ms | Expected with warm cache |
| p95 full-turn latency (SSE stream complete) | < 12,000 ms | Includes multi-step Finder/Reply (stepCountIs(5)) |
| Error rate | < 1% | Measured at load test VU=400 |
| Cold-start addition | ≤ 2,000 ms | App Hosting asia-southeast1 `minInstances` setting |

Source for thresholds: `scripts/loadtest/chat.js` k6 harness (05-01, code-ready), which encodes the same PROPOSED numbers as starting thresholds.

### Admin read surfaces (`/usage`, `/conversations`, `/roles`)

| Metric | PROPOSED target | Notes |
|--------|----------------|-------|
| p95 page load (RSC) | < 2,000 ms | Reads `usageRollups` (pre-aggregated, small doc count) |

### Live-gated measurement

Run `k6 run scripts/loadtest/chat.js` against the deployed App Hosting stack during rollout prep. Record p95/p50/error-rate; update HARDENING.md §2 with the actual numbers. The k6 harness is code-ready at `scripts/loadtest/chat.js` (committed 7e61b7f, 05-01).

---

## 5. 400-Agent Cost Projection

> **PROPOSED — all numbers require live measurement to confirm. Derek to finalize before rollout.**

### Assumptions (PROPOSED, all require Derek confirmation)

| Parameter | PROPOSED value | Source |
|-----------|---------------|--------|
| Active agents simultaneously | ~400 | D-11 load profile |
| Turns per active agent per day | ~20 | Estimate for a coaching-heavy day |
| Average input tokens per turn (Coach, cache warm) | ~800 | Estimate; confirm with `usageRollups` after pilot |
| Average input tokens per turn (Finder/Reply, 5-step) | ~3,000 | Estimate for multi-step; confirm with `usageRollups` |
| Prompt-cache hit rate | ~60% (after warm-up) | LIVE-GATED: measure from `usageRollups` |
| Anthropic Sonnet pricing | See current pricing page | Confirm before budget |

### Projected monthly ranges (PROPOSED, highly approximate)

At 400 agents × 20 turns/day × 30 days = 240,000 turns/month:

| Scenario | Monthly LLM cost estimate |
|----------|--------------------------|
| All Coach (low context) | LIVE-GATED after measurement |
| Mixed Coach + Finder/Reply (realistic) | LIVE-GATED after measurement |
| All Finder/Reply (max context) | LIVE-GATED after measurement |

**Firestore cost at 400 agents:**
- `usageEvents` writes: ~240,000 docs/month → negligible at Firestore pricing
- `usageRollups` writes (rollup): ≤ 400×3 = 1,200 docs/day → negligible
- Dashboard reads: ≤ 36,000 docs per 30-day admin window → negligible
- Erasure operations: rare (on request, well within free-tier read/write for typical pilot)

---

## 6. FLAGGED FINDING: Pre-Phase-5 Multi-Step Token Undercount (Open Question 1)

> **This is a known measurement caveat. It does NOT affect Phase 5 `usageEvents` (which use `final.totalUsage`). It DOES affect the legacy `messages.tokens`, rate-limit budget, and audit `tokenCount` fields written before Phase 5.**

### What was found

The chat route reads `final.usage.totalTokens` at three pre-Phase-5 sites:

| Site | Purpose | File:line |
|------|---------|-----------|
| `:522` | `messages.tokens` write (conversation history) | `app/api/chat/route.ts:522` |
| `:607` | Rate-limit decrement against `TOKEN_CAP = 50,000` | `app/api/chat/route.ts:607` |
| `:620` | Audit log `tokenCount` field | `app/api/chat/route.ts:620` |

For **Finder** and **Reply** agents (which run `stepCountIs(5)`, `route.ts:493`), `final.usage` is the **last step only** — the 4 prior steps' tokens are NOT included.

`final.totalUsage` (sum across all steps) is the correct per-turn total and is used exclusively in the Phase 5 `usageEvents` capture.

### Impact

- `messages.tokens` in conversation history understates the true token cost of Finder/Reply turns.
- Rate-limit budget (`TOKEN_CAP=50,000`) is consumed at a **lower rate than actual** for Finder/Reply — agents may actually reach their token budget sooner than the decrement suggests.
- Audit `tokenCount` understates for multi-step turns.

### What Phase 5 did

Phase 5 captured the **correct** per-turn total in `usageEvents` using `final.totalUsage`. A `// REGRESSION-NOTE` comment was added at `route.ts:607` (commit ebed5dd, 05-04).

### What is NOT done here (separate claim required)

Fixing `:607`, `:522`, `:620` to use `final.totalUsage` is a **behavioral change** to rate-limit budget consumption (TOKEN_CAP is a product decision). It requires:

1. A separate claim (with a Regression Report per the global CLAUDE.md protocol)
2. Derek sign-off on the new TOKEN_CAP consumption behavior
3. Consideration of whether agents mid-pilot would notice a sudden rate-limit tightening

**This undercount is the documented caveat for any cost analysis that relies on `messages.tokens` or the audit `tokenCount` for Finder/Reply turns. The `usageRollups` cost data (from `usageEvents`) correctly reflects `final.totalUsage` and is the authoritative source for Phase 5 cost reporting.**

---

## 7. usageEvents Retention — PROPOSED 90-Day TTL

**PROPOSED — Derek to confirm before enforcing.**

**Proposal:** Set a 90-day Firestore TTL policy on the `usageEvents` collection.

**Rationale:**
- `usageRollups` are the durable record (aggregated per-day per-agent per-pillar; not time-bounded).
- Raw `usageEvents` are only needed if a re-aggregation is required (e.g., a rollup bug retroactively fixed).
- At 400 agents × 20 turns/day, `usageEvents` grows by ~240,000 docs/month. At 90 days, the collection caps at ~720,000 docs — manageable at Firestore pricing.
- `auditLogs` is exempt from TTL (legal compliance record, per D-01).

**To enforce:** Set a TTL policy via the Firebase console on the `createdAt` field of the `usageEvents` collection (or add a `ttl` timestamp field = `createdAt + 90d` as a Firestore TTL-managed field). Do NOT add this via a scheduled Cloud Function or external scheduler (constraint).

---

## 8. Low-Risk Tuning Applied vs Deferred

### Applied (Phase 5)

| Optimization | What was done | Risk | Evidence |
|-------------|--------------|------|----------|
| Correct token accounting | `final.totalUsage` in `usageEvents` (vs `final.usage` last-step only) | Low (new capture only) | ebed5dd (05-04) |
| Aggregate reads (not fetch-all) | `AggregateField.sum/count` in `rollupUsage()` and all dashboard reads | Low (additive) | f69bba1 (05-04) |
| `(day, uid, pillar)` index | Bounds the rollup per-group queries | Low (additive index) | b5c6046 (05-02) |
| Rollup-only dashboard reads | Dashboards NEVER query `usageEvents` directly (HR-7) | Low (architecture decision) | b7785e4 (05-07) |

### Deferred (measure first — Pitfall 8 / D-06)

| Optimization | Status | Why deferred |
|-------------|--------|-------------|
| Prompt caching configuration tuning | LIVE-GATED: measure cache-hit rate first | Tuning prompts/agents in a hardening phase is scope creep (Pitfall 8/34) |
| `usageEvents` TTL enforcement | Awaiting Derek confirmation (A5) | Policy decision, not code |
| Next.js `use cache` for rollup reads | Propose for v2 if dashboard p95 > 2s | Low priority at pilot scale; avoid premature optimization |
| Rate-limit undercount fix | Separate claim + Derek sign-off | Behavioral change to TOKEN_CAP consumption |

---

## 9. Evidence Index

| Claim in this doc | Evidence |
|------------------|----------|
| Single pipeline implemented | `src/usage/record.ts`, `src/usage/rollup.ts`, `app/api/chat/route.ts` — commits ebed5dd/f69bba1 (05-04) |
| Cache-hit fields captured | `src/usage/types.ts` (`cachedInputTokens`, `cacheCreationInputTokens`) — ebed5dd (05-04) |
| No fetch-all in rollup | `src/usage/rollup.ts` uses `select()` + `AggregateField.sum/count` — f69bba1 (05-04) |
| Dashboard reads rollups only | `app/[lang]/(admin)/usage/page.tsx` comment `// NEVER raw usageEvents — HR-7` — b7785e4 (05-07) |
| Multi-step undercount documented | `REGRESSION-NOTE` at `route.ts:607` — ebed5dd (05-04) |
| Load-test harness code-ready | `scripts/loadtest/chat.js` — 7e61b7f (05-01) |
| p95 thresholds PROPOSED | `scripts/loadtest/chat.js` threshold comments: `// PROPOSED: final SLO is Derek's call` |
| (day,uid,pillar) index | `firestore.indexes.json` — b5c6046 (05-02) |

---

*Last updated: 2026-06-07 | Next update: During rollout prep (live-gated measurements recorded inline)*
