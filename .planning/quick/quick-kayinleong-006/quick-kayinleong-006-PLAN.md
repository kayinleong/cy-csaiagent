---
quick_id: quick-kayinleong-006
slug: architecture-diagram
description: Create an architecture diagram doc explaining how the platform works
mode: quick (--research)
status: planned
must_haves:
  truths:
    - The doc reflects the AS-BUILT system, not just TSD intent (uses RESEARCH.md deltas).
    - All Mermaid diagrams use only GitHub-safe types (flowchart, sequenceDiagram, erDiagram).
    - Facts corrected per research G1–G10 (20+2 collections, 6 jobs, classifier ACTIVE, toUIMessageStreamResponse, KB findNearest vs project in-memory re-rank, zero Cloud Functions).
    - Carries a "code-complete, pre-deploy" status caption (STATE: v1.0-code-complete-gaps-closed, not pushed).
  artifacts:
    - docs/ARCHITECTURE.md
  key_links:
    - .planning/quick/quick-kayinleong-006/quick-kayinleong-006-RESEARCH.md
    - .planning/TSD.md
---

# Plan — quick-kayinleong-006: Architecture diagram doc

## Decision summary

- **Format:** Mermaid embedded in Markdown. Renders natively on GitHub, diff-able, no build step. Confirmed by research §H. Use ONLY `flowchart`, `sequenceDiagram`, `erDiagram` (avoid `architecture-beta` / newer types GitHub's pinned Mermaid can't render).
- **Location:** `docs/ARCHITECTURE.md`. `docs/` already exists (has `operations/`); TSD stays the spec-of-record in `.planning/`, this is the developer-facing "how it works" companion that links back to TSD.
- **Source of truth:** the as-built RESEARCH.md (file:line cited), corrected against TSD where the code diverged (deltas G1–G10).

## Task 1 — Write docs/ARCHITECTURE.md

**files:** `docs/ARCHITECTURE.md` (new)

**action:** Author a single Markdown doc with a short orienting intro + these diagrams, each followed by a tight prose walkthrough that cites real file paths:

1. **System context / boundary** (`flowchart LR`) — Browser/PWA → Next 16 monolith on App Hosting → external boundaries {Anthropic via AI SDK v5, Gemini Developer API embeddings, Firebase Auth/Firestore/Storage/Remote Config/Secret Manager}. PDPA pseudonymization drawn as a labeled gate on the Anthropic edge. Pinecone = dashed/optional fallback.
2. **Chat request sequence** (`sequenceDiagram`) — the 5 gate-ordered hops (auth → ratelimit → PDPA → route → streamText) + `onFinish`/`after()` side effects (memory, audit hashes-only, usage). Built from research §B.
3. **Intent routing decision** (`flowchart TD`) — override → heuristic (Reply-first → Finder → Coach) → LLM classifier → confidence ≥ 0.5 ? pillar : coach-default. From §C; classifier shown ACTIVE.
4. **Core/shell module map** (`flowchart LR`) — `app/` shell entrypoints (proxy.ts, [lang] segment, api routes, _actions) on the left, `src/` core modules on the right, single import-direction arrow (app → src only, never reverse). Disambiguate the two coach-ish / two reply-ish folders.
5. **Data model** (`erDiagram`) — key collections with the `conversations → messages` subcollection and the `leadContext` 3-slot cross-pillar memory shape highlighted; note tenantId stamping + 20 typed + 2 operational docs.
6. **Lazy-cron job lifecycle** (`flowchart TD`) — page visit → triggerDueJobs (cookie verify, fail-closed) → runDueJobs loop → per-job Firestore txn on jobRuns (window due?) → run body + heartbeat. Side note lists all 6 jobs + windows; assert zero Cloud Functions / external scheduler.

Add a short "Plan vs reality" callout (the material deltas) and a top caption: **status: code-complete, pre-deploy**. Link to `.planning/TSD.md` and the RESEARCH.md as deeper references.

**verify:**
- `grep -c '```mermaid' docs/ARCHITECTURE.md` ≥ 6.
- No forbidden Mermaid types (`grep -i 'architecture-beta\|c4Context\|mindmap'` returns nothing).
- Spot-check every cited path exists.

**done:** `docs/ARCHITECTURE.md` exists, all six fenced ```mermaid blocks present, facts match RESEARCH.md, status caption present.

## Regression surface

Doc-only change in `docs/`. No source code, no config, no behavior touched. Zero runtime regression surface. Only risk is factual drift vs code → mitigated by building from the file:line-cited RESEARCH.md and a path spot-check in verify.
