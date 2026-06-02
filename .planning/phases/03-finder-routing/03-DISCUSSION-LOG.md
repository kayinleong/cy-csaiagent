# Phase 3: Finder + Intent-Routing Activation - Discussion Log

> **Audit trail only.** Decisions captured in `03-CONTEXT.md`. Mode: `--auto` (no interactive Q&A — recommended defaults auto-selected).

**Date:** 2026-06-02 · **Phase:** 03-finder-routing

| Gray area | Auto-selected default → decision |
|-----------|----------------------------------|
| Intent classifier activation (FIND-11) | Activate dormant classifier.ts; heuristic→LLM-classifier→override chip; model from Remote Config (haiku); record routeDecision → D-01/D-02 |
| Finder matching (FIND-01/03) | Hybrid vector (Gemini 1024-d findNearest) + structured filters; `status:'active'` always enforced → D-03 |
| Match rationale (FIND-01) | Grounded "why this match" from real project fields, cite project IDs → D-04 |
| Eligibility/financing (FIND-09/10, SC3) | Investment-vs-ownstay + financing + bumi/foreign gate; grounded refusal over a bad match → D-05 |
| Per-lead context + re-rank (FIND-05/06/08) | leadContext.finderSlot (mirrors coachSlot); re-rank from updated context, no re-typing → D-06 |
| Filtered inventory queries (FIND-07) | Structured query path over `projects` alongside vector match → D-07 |
| Inventory ingestion (FIND-02) | Admin CRUD + CSV import adapter; source format (G4) flagged for Derek → D-08 |
| Collateral (FIND-04) | `collateral` collection → Firebase Storage path / URL (NOT Drive API — no-GCP) → D-09 |
| Inventory admin (ADMIN-04) | Grow the Phase-2 admin app with a project manager → D-10 |

**Claude's discretion:** criteria-parsing schema + ranking weights; classifier confidence threshold; project-embedding field composition.
**Deferred:** Reply Assistant + WhatsApp (P4); public recommender (v2); Drive-API collateral sync (excluded by no-GCP).
