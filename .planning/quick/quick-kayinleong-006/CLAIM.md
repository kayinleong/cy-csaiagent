# Claim: quick-kayinleong-006

- owner: kayinleong
- session: claude-code
- branch: phase-kayinleong-01
- started: 2026-06-09
- status: done
- summary: Create an architecture diagram doc (docs/ARCHITECTURE.md) explaining how the platform works — Mermaid diagrams for system/deployment, chat request data-flow, core/shell module map, intent routing, the Firestore data model + cross-pillar memory bus, and the on-visit lazy-cron job model — grounded in the actual codebase, not just the plan.

## What will change

- **NEW** `docs/ARCHITECTURE.md` — a developer-facing "how it works" companion to `.planning/TSD.md`, built from the as-built codebase (RESEARCH.md, file:line cited), not just TSD intent. Six GitHub-safe Mermaid diagrams: (1) system context / external boundaries, (2) chat request sequence (5 gates + onFinish side effects), (3) intent routing decision, (4) core/shell module map, (5) Firestore data model, (6) on-visit lazy-cron lifecycle. Carries a "code-complete, pre-deploy" status caption.
- Doc-only change. No source code, config, or behavior touched.

## What has changed

- **NEW** `docs/ARCHITECTURE.md` (334 lines, 6 Mermaid diagrams). Built from the as-built RESEARCH.md
  (file:line cited), corrected against TSD where the code diverged. Sections:
  1. System context / boundary (`flowchart LR`) — PWA → Next monolith → Anthropic / Gemini / Firebase, PDPA gate on the Anthropic edge, Pinecone dashed/optional.
  2. Chat request (`sequenceDiagram`) — 5 gate-ordered hops (auth → ratelimit → PDPA → route → streamText) + onFinish/after() side effects.
  3. Intent routing (`flowchart TD`) — override → heuristic (Reply-first) → LLM classifier (shown ACTIVE) → confidence gate.
  4. Core/shell module map (`flowchart LR`) — app→src one-direction import, two-coach/two-reply naming traps called out.
  5. Data model (`erDiagram`) — conversations→messages subcollection + leadContext 3-slot cross-pillar memory; tenantId stamping; 20+2 collections.
  6. Lazy-cron lifecycle (`flowchart TD`) — visit → triggerDueJobs (cookie verify) → per-window jobRuns txn → body + heartbeat; 6 jobs table; "zero Cloud Functions" asserted.
  Plus a "Plan vs reality" delta table and a top **status: code-complete, pre-deploy** caption.
- Also created (planning artifacts, not product code): `quick-kayinleong-006-RESEARCH.md`, `quick-kayinleong-006-PLAN.md`.

## Verification

**What was tested:**
- Mermaid block count = 6; code-fence lines = 12 (6 open + 6 close, balanced). ✓
- Diagram types are GitHub-safe only: `flowchart`, `sequenceDiagram`, `erDiagram`. Grep for forbidden
  types (`architecture-beta`, `c4context`, `mindmap`, `timeline`, `quadrantchart`) → none. ✓
- Fragile-syntax hardening: all flowchart edge labels converted to canonical pipe form
  (`-->|...|`, `==>|...|`, `-.->|...|`); the one label containing parentheses is quoted; the two
  brace-entity (`&#123;…&#125;`) workaround nodes were reworded to plain text → 0 brace entities remain. ✓
- Factual fidelity: every cited path spot-checked to exist (`app/api/chat/route.ts`, `src/router/*`,
  `src/memory/leadContext.ts`, `src/jobs/runDueJobs.ts`, `src/firebase/collections.ts`, `src/audit/pdpa.ts`,
  `src/rag/{index,embed}.ts`, `proxy.ts`, `app/_actions/jobs.ts`, `app/[lang]/chat/decode-structured-output.ts`,
  `.planning/{TSD,PROJECT,REQUIREMENTS}.md`) → all OK. ✓
- Plan-vs-reality deltas from research applied (NOT copied blindly from the stale TSD): 20+2 collections
  (not 14), 6 jobs (not 4), classifier ACTIVE, `toUIMessageStreamResponse()` (not `toDataStreamResponse()`),
  KB `findNearest` vs project in-memory re-rank. ✓

**What was ruled out (not verified) and why:**
- *Live Mermaid render:* no `mmdc` / `mermaid` package installed locally, so diagrams were validated by
  manual syntax review against GitHub-supported constructs rather than an actual render. Risk is low
  (only standard flowchart/sequence/er constructs used; fragile constructs removed). The author should
  glance at the GitHub preview after push to confirm visual layout.

**Regression surface:** ZERO runtime regression surface. This is a documentation-only addition of a single
new file under `docs/`. No source code, config, dependency, build, route, or behavior was touched —
`git status` shows only the new `docs/ARCHITECTURE.md` plus the quick-task planning artifacts under
`.planning/quick/quick-kayinleong-006/`. The only failure mode for a doc is factual drift vs code, which
was mitigated by building from the file:line-cited RESEARCH.md and spot-checking every cited path.
