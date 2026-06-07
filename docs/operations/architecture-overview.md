# Architecture Overview
## D2 Customer Service AI Agent Platform

**For operators.** Deep implementation details are in `.planning/TSD.md`.

---

## The Big Picture

The platform is a **single Next.js 16 monolith** deployed on **Firebase App Hosting** (`asia-southeast1`). There are no microservices, no external queues, no Cloud Functions, no Vertex AI. Everything runs in one Next.js process.

**Firebase is the entire backend:**
- **Firebase Auth** — identity + custom role claims
- **Firestore** — system of record, vector index, cross-agent message bus, job run ledger, audit log
- **Cloud Storage** — document collateral (KB assets, property brochures)
- **App Hosting** — the Node.js runtime (`asia-southeast1`)
- **Secret Manager** — API keys (accessed by App Hosting only)
- **Remote Config** — model IDs (never hard-coded in code)

---

## The Three Pillars

All three AI agents share the same chat UI surface at `/<lang>/chat`:

| Pillar | Purpose | How agents activate it |
|--------|---------|----------------------|
| **Onboarding Coach** | D2-grounded training Q&A, journey state machine, proactive stall nudges | Default; routing sends coach-type messages here |
| **Property Finder** | Paste lead criteria → ranked D2 project matches with collateral | Agent selects a lead and asks about properties |
| **Reply Assistant** | Paste incoming WhatsApp → drafted D2-voice reply | Agent pastes the incoming message (never auto-sent) |

The intent router (`src/router/`) decides which pillar handles each turn. Coach is the default; Finder/Reply activate when a lead is selected.

---

## Chat Data Flow

```
Browser (agent's phone/laptop)
    │
    │  POST /api/chat  (SSE streaming, Node runtime)
    │
    ▼
proxy.ts  ← auth check + locale detection (replaces middleware.ts in Next.js 16)
    │
    ▼
app/api/chat/route.ts
    GATE1: auth (requireUser — Firebase ID token)
    GATE2: rate-limit (usageWindow, TOKEN_CAP=50,000/day)
    GATE3: PDPA (assertRedacted — throws if PII not pseudonymized)
    GATE4: intent router (heuristic → pillar selection)
    GATE5: streamText (Anthropic Claude, model from Remote Config)
    │
    │  Server-Sent Events (SSE tokens streamed to browser)
    │
    ▼
onFinish side-effects (run AFTER stream completes, via after()):
    ├── src/memory/ — persist conversation messages
    ├── src/audit/log.ts — append audit event (hashes-only)
    └── src/usage/record.ts — append usageEvent (counts-only, no PII)
```

**SSE streaming:** The route returns `streamText().toUIMessageStreamResponse()` with `X-Accel-Buffering: no`. Never stream from a Server Action.

---

## Cross-Pillar Memory

Agents share a `leadContext/{leadId}` Firestore document with three agent-scoped write slots:

```
leadContext/{leadId}
  ├── coachSlot    — Onboarding Coach state (journey stage, checkpoints)
  ├── finderSlot   — Property Finder state (ranked matches, last query)
  └── replySlot    — Reply Assistant state (latest draft, SOP applied)
```

The router hands off context between pillars via this shared doc. No direct inter-pillar calls.

---

## Background Jobs (Lazy-Cron)

**There is no external scheduler.** Background work fires when an authorized user loads the app:

```
Browser (authorized user loads any page)
    │
    ▼
app/_actions/jobs.ts: triggerDueJobs()   ← called from layout
    │
    ▼
src/jobs/runDueJobs.ts: runDueJobs()
    │
    FOR EACH job in JOB_REGISTRY:
    │  └── runJob(jobName):
    │      1. Firestore transaction: check lastRun, set status='running'
    │         (exactly-once: if another visitor grabbed it first, skip)
    │      2. If DUE (lastRun + windowMs < now): call job.run()
    │      3. Update lastRun, set status='idle'
    │
    ▼
Jobs: stall-detect / escalate / eval-nightly / usage-rollup / erasure-sweep
```

See `lazy-cron-catalog.md` for the full job catalog.

---

## Data Model (20 Firestore Collections)

| Collection | Owner | Purpose | PII? |
|-----------|-------|---------|------|
| `users` | agent | Firebase Auth profile + role claims | Yes (agent identity) |
| `agentProfiles` | agent | Journey stage, checkpoints, voice calibration | Yes |
| `rateBudgets` | agent | Daily token budget window | No (counts only) |
| `conversations` | agent+lead | Message threads (keyed by cid) | Yes (message content) |
| `conversations/{cid}/messages` | agent+lead | Individual messages (subcollection) | Yes (message content) |
| `leads` | agent | Lead metadata (pseudonymized name + phone hash) | Yes (hashed) |
| `leadContext` | agent+lead | Cross-pillar memory slots per lead | Yes (draft text) |
| `kbDocs` | KB | Knowledge-base articles (D2 SOPs, property data) | No |
| `kbChunks` | KB | Embedding chunks for vector search | No |
| `evals` | system | Promptfoo eval results (scores, failures) | No |
| `knowledgeGaps` | system | Detected gaps in agent knowledge | Agent UID (pseudonymized) |
| `escalations` | system | Stall + escalation records | Agent UID (pseudonymized) |
| `replyEdits` | agent | Edit-as-signal for Reply quality analytics | Yes (draft text) |
| `auditLogs` | system | Append-only audit trail (hashes-only, no raw PII) | No (hashes only) |
| `jobRuns` | system | Lazy-cron heartbeat + DUE-gate ledger | No |
| `heartbeats` | system | Per-job last-run timestamps | No |
| `usageEvents` | system | Per-turn token counts (counts-only, no PII) | No |
| `usageRollups` | system | Pre-aggregated daily usage per agent per pillar | No |
| `erasureRequests` | system | PDPA erasure request ledger + status | No (subjectIdHash only) |
| `collateral` | KB | Document metadata for KB collateral (Storage paths) | No |

**All docs carry `tenantId: "d2"** (single-tenant now; seam for future multi-tenant).

---

## Security Architecture

- **Rule of denial:** All Firestore collections have deny-by-default rules. Clients can only read what they own, within their tenant.
- **PII boundary:** `pseudonymize()` + `assertRedacted()` gate before every LLM call. Raw PII never reaches Claude.
- **Audit:** Every privileged action (admin reads, erasures, role assignments, drilldowns) writes a hashed audit event to `auditLogs`. Audit log is permanent — never erased.
- **Admin SDK bypasses rules:** All server-side writes (usageEvents, usageRollups, erasureRequests, auditLogs) use the Firebase Admin SDK which bypasses Firestore rules. Code-level gates (role checks, assertAdmin) are the enforcement layer on the server.
- **Role hierarchy:** `new-agent < senior-coach < admin`. Claims set via `setUserClaims` only (audited).

---

## Infrastructure Constraints

These are hard constraints — violations are defects, not style choices:

- No Google Cloud Functions
- No GCP services beyond Firebase SDK surface (no Vertex AI, BigQuery, Cloud Run direct, Cloud Scheduler)
- No external scheduler (lazy-cron is the only periodic mechanism)
- No WhatsApp Business API in v1 (Reply = paste-and-draft, copy-to-clipboard)
- No auto-send ever (agents send from their own phone)
- Model IDs from Remote Config — never hard-coded
- PII pseudonymized at the Claude boundary — never raw PII in prompts
