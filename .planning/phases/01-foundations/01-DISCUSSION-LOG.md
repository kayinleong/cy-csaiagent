# Phase 1: Foundations - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-31
**Phase:** 1-foundations
**Areas discussed:** "Thin" slice strategy, Spike sequencing & gating, Lead language for proof, Phase-1 Coach depth

---

## Gray-Area Selection

| Option | Description | Selected |
|--------|-------------|----------|
| "Thin" slice strategy | Vertical-slice-deep vs breadth-first scaffolding | ✓ |
| Spike sequencing & gating | First-as-gate vs parallel vs interleaved; failure protocol | ✓ |
| Lead language for proof | Which of EN/BM/中文 wired fully first; eval scaffolding | ✓ |
| Phase-1 Coach depth | Throwaway stub vs minimal-but-extensible; P1↔P2 seam | ✓ |

**User's choice:** All four areas.

---

## "Thin" Slice Strategy

### Q1 — Build shape

| Option | Description | Selected |
|--------|-------------|----------|
| Spine + real-but-thin cross-cutting | Vertical slice as spine; hard-to-retrofit concerns real-but-thin; deferrable surface stubbed | ✓ |
| Vertical slice first, thicken later | Thinnest path fast, stub everything else incl. audit/rules/ratelimit | |
| Breadth-first scaffolding | All module skeletons to equal thinness first, wire slice last | |

**User's choice:** Spine + real-but-thin cross-cutting.

### Q2 — Stub line (multiSelect)

| Option | Description | Selected |
|--------|-------------|----------|
| Router → heuristic stub | Always routes to Coach in P1; LLM classifier Phase 3 | ✓ |
| KB ingestion → 1 small doc | Chunked-poll loop on one seeded playbook, no admin UI | ✓ (later superseded by D-10) |
| Eval → 1 trilingual fixture | Promptfoo + Opus judge + one gold fixture + calibration plan | ✓ |
| Voice capture → schema only | Reserve `users.voiceSamples[]`; defer UX to P2 | ✓ |

**User's choice:** All four confirmed as stubs (first attempt returned empty; re-asked with empty-selection meaning clarified, then all four selected).
**Notes:** The "KB ingestion → 1 small doc, no admin UI" stub was later revised by the Area-4 seams decision (D-10) to "multi-doc-capable + minimal authenticated CRUD form."

---

## Spike Sequencing & Gating

### Q1 — Sequencing

| Option | Description | Selected |
|--------|-------------|----------|
| Week-1 parallel w/ independent scaffolding | Spikes run alongside non-dependent scaffolding; dependent modules wait for go/no-go | ✓ |
| Hard gate: all spikes before any build | No code until all 3 spikes resolve | |
| Just-in-time per module | Spike each risk right before its module | |

**User's choice:** Week-1 parallel with spike-independent scaffolding.

### Q2 — Failure protocol

| Option | Description | Selected |
|--------|-------------|----------|
| Auto-fork RAG/CRON, escalate DEPLOY | RAG→Pinecone & CRON→GitHub Actions fork in-place; DEPLOY fail → Derek (residency) | ✓ |
| Always escalate to Derek | Any failure pauses for Derek go/no-go | |
| Always auto-fork, log only | Engineering forks all 3, informs Derek after | |

**User's choice:** Auto-fork RAG/CRON, escalate DEPLOY.

### Q3 — Recommended spikes to include (multiSelect)

| Option | Description | Selected |
|--------|-------------|----------|
| SPIKE-AI-SDK | AI SDK v5 useChat/streamText + typed tools + cache_control on Next 16 | ✓ |
| SPIKE-INGEST | Chunked-poll ingests 100–200pg PDF within timeout budget | ✓ |
| Next.js 16 caching audit | Verify implicit caching removed, proxy.ts, async cookies/headers; CI lint | ✓ |

**User's choice:** All three. (PDPA TIA is non-negotiable regardless.)

---

## Lead Language for Proof

### Q1 — Proof-slice language

| Option | Description | Selected |
|--------|-------------|----------|
| English | Cheapest end-to-end proof; cliff still measured via SPIKE-RAG + trilingual eval | ✓ |
| Bahasa Malaysia | Highest-fidelity early signal; costs native-reviewed BM seed doc | |
| 中文 (Mandarin) | Hardest retrieval, strongest technical de-risk; highest effort | |
| EN + one of BM/中文 | Two languages end-to-end; ~2x KB-seed + eval effort | |

**User's choice:** English.

### Q2 — Trilingual machinery depth

| Option | Description | Selected |
|--------|-------------|----------|
| Full scaffold real, KB content proof-lang only | 3 catalogs + proxy.ts detection + franc-min + trilingual eval fixture + native-review process; KB content EN-only | ✓ |
| Everything trilingual now | Seed KB in all 3 languages + ship UI in all 3 | |
| EN-only scaffold, defer i18n | Retrofit i18n later (rejected by research) | |

**User's choice:** Full scaffold real, KB content proof-language (EN) only.

---

## Phase-1 Coach Depth

### Q1 — Coach realness

| Option | Description | Selected |
|--------|-------------|----------|
| Minimal-but-extensible, real grounding | Thin prompt + 1 read-only retrieveKnowledge tool + real citations + Zod schema, via router | ✓ |
| Throwaway echo stub | Hardcoded prompt, no real retrieval/citations | |
| Fuller Coach (pull P2 forward) | Add journey-state-machine + handoff stubs on top | |

**User's choice:** Minimal-but-extensible with real grounding.

### Q2 — P2 deferrals (multiSelect) → escalated to a scope decision

| Option | Description | Selected |
|--------|-------------|----------|
| Journey state machine + checkpoints | COACH-03/09 | (see resolution) |
| Proactive nudges + 48h escalation | COACH-04/05, AUTH-02/06 | (see resolution) |
| KB-miss handoff to coach | CHAT-06, CDASH | (see resolution) |
| Multi-doc KB + admin CRUD | ADMIN-01/03, AUTH-03 | (see resolution) |

**User's initial response:** Free-text "all i want to be in p" (truncated/ambiguous). Clarified by user as **"keep all four in phase 1."**

**Thinking-partner intervention:** Flagged that (a) this directly contradicts the Area-1 stub-line (KB ingestion → 1 small doc, no admin UI), and (b) it cascades Phase-2 dependencies (senior-coach + admin roles, escalation queue, dashboard) into Foundations — effectively merging most of Phase 2. Presented three paths.

### Q3 — Scope resolution

| Option | Description | Selected |
|--------|-------------|----------|
| Real-but-thin SEAMS in P1 | All four present but minimal, spine-consistent; Phase 1 grows ~1 week, bounded | ✓ |
| Full depth — merge P2 Coach+Admin into P1 | Production depth; restructures roadmap; window ~doubles | |
| Defer all four to P2 (original rec.) | Pure foundations + thin grounded Coach | |

**User's choice:** Real-but-thin seams in Phase 1 (D-10/D-11/D-12 in CONTEXT.md).

---

## Remaining Gray Areas (offered, not explored)

User chose "I'm ready for context" rather than exploring further. Offered but skipped (now Claude's-discretion defaults in CONTEXT.md):
- Firebase dev environment + region confirmation (G1)
- Auth role scaffolding depth
- PDPA TIA ownership + redaction depth

## Claude's Discretion

- Firebase emulator-first vs real in-region dev project; region (G1) confirmation with Derek as a blocking pre-task.
- Auth role depth beyond claims + rules coverage.
- PDPA TIA ownership and pseudonymization-layer completeness (default: fully implemented + unit-tested; TIA gates pilot, redaction gates build).

## Deferred Ideas

- Full Coach depth, senior-coach dashboard, full admin web app, full trilingual KB content, LLM classifier activation, voice-sample capture UX, and the "full P2 merge" alternative — see CONTEXT.md `<deferred>`.
