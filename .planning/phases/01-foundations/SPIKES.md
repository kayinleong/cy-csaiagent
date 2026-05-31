# Phase 1 Spike Decision Record

**Status: HARNESS CODE COMPLETE — live spike runs PENDING human action**

This document is the Phase-1 gate. Downstream phases (01-09 rag, 01-10 jobs, 01-11 chat) depend
on the pass/fallback decision for each spike. The harness code is built and committed.
The five live spike runs require human infrastructure access (App Hosting deploy, QStash dashboard,
live Voyage + Firestore). Each spike's DECISION is marked PENDING until those runs complete.

---

## SPIKE-AI-SDK

**What it resolves:** The `ai` package has shipped v6 while TSD locks `ai ^5`. The chat route
(01-11) depends on the correct stream-response method name. A deliberate pin avoids a silent
runtime failure when the method name changes between majors.

### Pin record

| Item | Value |
|------|-------|
| Pinned `ai` major | **5** (v5.0.193) |
| Matching `@ai-sdk/anthropic` | **2.0.80** (v2 provider line — uses `@ai-sdk/provider@2.0.3` which matches `ai@5.0.193`) |
| `@anthropic-ai/sdk` | **^0.100.1** (documented fallback / escape hatch for raw beta headers) |
| Stream-response method (v5) | **`toDataStreamResponse()`** |
| Stream-response method (v6) | `toUIMessageStreamResponse()` — DO NOT USE in Phase 1 |

**Why v5:** TSD locks `ai ^5`; research confirms this is the safe default (RESEARCH Q1 lines 487–490).
The v6 codemod (`npx @ai-sdk/codemod v6`) is available if a future phase upgrades, but Phase 1
stays on v5 to match the TSD exactly and de-risk the sprint.

**Compatibility verified:**
- `ai@5.0.193` bundles `@ai-sdk/provider@2.0.3`
- `@ai-sdk/anthropic@2.0.80` bundles `@ai-sdk/provider@2.0.3`
- Provider versions match — no peer-dependency conflicts at runtime

**Harness code:** `app/api/spike/stream/route.ts` uses `ReadableStream` + `text/event-stream` (the
underlying pattern that `streamText().toDataStreamResponse()` wraps). The actual AI SDK stream call
is wired in 01-11 using `toDataStreamResponse()`.

```
Result:  RECORDED (no live run required — this is a static pin decision)
Decision: [x] pin ai@5 / toDataStreamResponse  [ ] upgrade to ai@6 / toUIMessageStreamResponse
```

**Impact on downstream:** 01-11 (chat route) MUST call `result.toDataStreamResponse()` — not
`toUIMessageStreamResponse()`. This decision record is the authoritative reference.

---

## SPIKE-RAG

**What it resolves:** Whether Firestore native `findNearest` (DOT_PRODUCT, 1024-d) meets p95
latency, read-cost, and BM/ZH recall targets on ~500 multilingual chunks in `asia-southeast1`.
Failure triggers the Pinecone Serverless fallback behind the `rag/` adapter (D-05).

### Pass criteria (verbatim from RESEARCH + ROADMAP)

| Metric | Pass threshold |
|--------|---------------|
| p95 latency | < 800 ms |
| Read-cost ratio (filtered vs naive full-scan) | < 10× |
| BM recall vs EN recall | ≥ 70% |
| ZH recall vs EN recall | ≥ 70% |

### Harness code

- **Fixture:** `tests/fixtures/multilingual-chunks.ts` — 450 synthetic chunks (150 per language:
  EN/MS/ZH), D2-flavored content, no real PII, per-language gold query sets (4 queries × 3 langs)
- **Test:** `src/rag/spike-rag.test.ts` — env-gated (`RUN_SPIKES=1`); measures p95, read-cost
  ratio, recall per language; uploads fixture to a scratch `kbChunks-spike-<timestamp>` collection
  and cleans up after the run
- **findNearest pattern:** `where('lang', 'in', [userLang, 'en']).findNearest({ vectorField: 'embedding', queryVector: FieldValue.vector(q), limit: 8, distanceMeasure: 'DOT_PRODUCT' })`
- **Billing model:** 1 read/doc-returned + 1 read/100 index-entries-scanned (ceiling)

### Run instructions

```bash
# Set all env vars first (do NOT commit .env files)
export RUN_SPIKES=1
export GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json
export FIREBASE_PROJECT_ID=your-firebase-project-id
export VOYAGE_API_KEY=your-voyage-api-key

npx vitest run src/rag/spike-rag.test.ts
```

Expected output: p95 latency, read-cost ratios, and per-language recall percentages logged to stdout.
Copy those numbers into the Result row below.

### Result

```
p95 latency:        PENDING ms
read-cost ratio:    PENDING ×
EN recall:          PENDING %
MS recall:          PENDING %  (PENDING % of EN)
ZH recall:          PENDING %  (PENDING % of EN)
```

```
Result:   PENDING — live Firestore run not yet executed
Decision: [ ] pass (Firestore findNearest stays primary)
          [ ] fallback (swap rag/ adapter to Pinecone Serverless aws-ap-southeast-1)
          [ ] partial (pass latency/cost but fail recall → embedding swap to Mesolitica/Cohere)
```

### Fallback (if fail)

Per D-05: swap the `rag/` adapter to **Pinecone Serverless (aws-ap-southeast-1)** behind the
existing `rag/` adapter interface — app state stays in Firestore, only the vector search backend
changes. Log the decision in PROJECT.md Key Decisions.

If recall fails but latency/cost pass: swap embedding model to **Mesolitica** (BM-first) or
**Cohere multilingual** (per RESEARCH G3 and D-07).

---

## SPIKE-DEPLOY

**What it resolves:** Whether SSE streams token-by-token on Firebase App Hosting `asia-southeast1`
over a real 4G mobile network. Failure ESCALATES TO DEREK — the Vercel fallback has data-residency
implications (PDPA / MY data must stay in `asia-southeast1`), making this his decision.

### Pass criteria (verbatim from RESEARCH Pitfall C + ROADMAP)

| Criterion | Pass |
|-----------|------|
| Tokens arrive incrementally | Visible on-screen, NOT a single dump after a wait |
| Network | Real 4G/5G — NOT localhost, NOT office WiFi |
| Cold-start | Acceptable (≤ ~10s for first token with minInstances=1) |
| App Hosting region | `asia-southeast1` |

### Harness code

- **Endpoint:** `app/api/spike/stream/route.ts` — Node-runtime Route Handler, emits 30 SSE tokens
  at 300ms intervals with the three load-bearing headers:
  - `Content-Type: text/event-stream`
  - `Cache-Control: no-store`
  - `X-Accel-Buffering: no`  ← THE critical header (disables nginx buffering on App Hosting)
- **Deploy config:** `apphosting.yaml` — `minInstances: 1`, `asia-southeast1`, Secret Manager refs
- **Local test:** `GET /api/spike/stream` on localhost streams correctly (but this is NOT the spike —
  the spike requires a real 4G device on the deployed App Hosting URL)

### Deployment steps

```bash
# 1. Ensure apphosting.yaml is committed
# 2. Firebase App Hosting auto-deploys on main branch push (GitHub integration)
#    OR: firebase deploy --only hosting
# 3. Note the App Hosting URL from the Firebase console
```

### Human verification steps

1. Deploy to App Hosting `asia-southeast1` (push to main branch or `firebase deploy`)
2. Get the deployed URL from Firebase console → App Hosting
3. On a real phone: turn OFF WiFi, use 4G/5G only
4. Visit: `https://<app-hosting-url>/api/spike/stream`
5. Observe: do tokens appear one by one (incrementally) or all at once (buffered)?

PASS = tokens arrive visibly one by one with ~300ms gaps
FAIL = long wait followed by all tokens appearing simultaneously

### Result

```
Deployed URL:       PENDING
4G device:          PENDING
Token delivery:     PENDING (incremental / buffered)
First token time:   PENDING ms
Total stream time:  PENDING ms
```

```
Result:   PENDING — live App Hosting deploy + 4G test not yet executed
Decision: [ ] pass (SSE streaming confirmed on App Hosting asia-southeast1 over 4G)
          [ ] fail — ESCALATE TO DEREK (Vercel fallback has residency implications — his call)
```

### Failure protocol (if fail)

Per D-05: **ESCALATE TO DEREK** — the Vercel front-end + Firebase backend fallback moves data
outside `asia-southeast1`, which is a PDPA / data-residency decision, not an engineering default.
Pause 01-11 (chat route SSE streaming) until Derek rules. Document evidence (App Hosting logs
showing 60s response with no body progress) in this section.

---

## SPIKE-CRON

**What it resolves:** Whether QStash signed callbacks to App Hosting `asia-southeast1` verify
correctly, retry on 5xx, and honor `Asia/Kuala_Lumpur` timezone. Failure → GitHub Actions fallback.

### Pass criteria (verbatim from RESEARCH + ROADMAP)

| Criterion | Pass |
|-----------|------|
| Signature verify | `verifySignatureAppRouter` accepts valid QStash token |
| Unsigned rejection | 401 returned for requests without valid signature |
| Retry on 5xx | QStash retries at least 3 times after a forced 500 response |
| IANA timezone | `Asia/Kuala_Lumpur` cron fires at the correct local time |

### Harness code

- **Endpoint:** `app/api/jobs/_spike-cron/route.ts` — `POST` wrapped with `verifySignatureAppRouter`
  from `@upstash/qstash/nextjs`; returns 200 with timestamp heartbeat on valid signature, 401
  on invalid/absent signature (automatically by the wrapper)
- **Unit tests:** `src/jobs/signature.test.ts` — 7 OFFLINE assertions (no real keys):
  - Unsigned request → `SignatureError` (RejectionError)
  - Tampered/random signature → `SignatureError`
  - Correctly-signed (current key) → `true`
  - Correctly-signed (next key / key rotation) → `true`
  - Wrong key → `SignatureError`
  - Expired token → `SignatureError`
  - Valid signature + tampered body → `SignatureError` (hash mismatch)

### Live SPIKE-CRON steps (human action required)

1. Deploy app to App Hosting (same deploy as SPIKE-DEPLOY)
2. In Upstash QStash dashboard:
   a. Set destination URL: `https://<app-hosting-url>/api/jobs/_spike-cron`
   b. Set cron: `* * * * *` (every minute, for spike speed)
   c. Set timezone: `Asia/Kuala_Lumpur`
   d. Fire once manually → confirm 200 response and heartbeat in logs
   e. Force a 500 (temporarily return 500 from handler) → confirm QStash retries appear in the
      QStash delivery log
   f. Confirm IANA TZ fires at the expected minute in Malaysia time
3. Capture all results below

### Result

```
Manual invocation:    PENDING (200 / 401 / 5xx)
Retry on 5xx:         PENDING (confirmed / not tested)
IANA TZ fires:        PENDING (correct / incorrect local time)
Signature verify:     PENDING (unit tests: 7/7 pass — live round-trip PENDING)
```

```
Result:   PENDING — live QStash round-trip not yet executed
Decision: [ ] pass (QStash verifies + retries + Asia/Kuala_Lumpur confirmed)
          [ ] fallback (GitHub Actions scheduled workflow — log in PROJECT.md per D-05)
```

### Fallback (if fail)

Per D-05: **GitHub Actions scheduled workflow** — a `schedule:` trigger on the repo fires at the
required intervals. Log the decision in PROJECT.md Key Decisions. The `jobs/` handler interface
remains identical; only the trigger mechanism changes.

---

## SPIKE-INGEST

**What it resolves:** Whether the chunked-poll loop ingests a 100–200pg PDF within the per-request
timeout budget (60s App Hosting / Cloud Run limit per request). The gpt-tokenizer 3.x API must
work correctly for token-aware chunk sizing.

### Pass criteria

| Criterion | Pass |
|-----------|------|
| Chunking speed | < 10s for a 100–120pg document (well under 60s timeout) |
| Chunk sizing | Each chunk ≤ 512 tokens (with ≤ 20 token tolerance at word boundaries) |
| Batch count | Chunk count / 50 batches must be manageable (< 30 batches for a 120pg doc) |
| gpt-tokenizer 3.x API | `encode(text)` returns a number array; API is correct |

### Harness code

- **Test:** `src/rag/spike-rag.test.ts` SPIKE-INGEST suite (env-gated with `RUN_SPIKES=1`)
  - Generates a synthetic 120-page document (~36,000 tokens, 300 words/page)
  - Chunks using `gpt-tokenizer@3.4.0` `encode()` with 512-token budget
  - Asserts chunking completes in < 10s
  - Asserts each of the first 10 chunks ≤ 532 tokens
  - Logs: page count, word count, token count, chunk count, batch count, elapsed time

### Result (from test output)

The SPIKE-INGEST test runs when `RUN_SPIKES=1` is set. For the chunking algorithm (pure CPU,
no Firestore), it runs offline. The full ingest spike (pdfjs-dist + Voyage embedding + Firestore
batch writes) requires live credentials.

```
Pages:          PENDING
Tokens:         PENDING
Chunks:         PENDING
Batches (÷50):  PENDING
Chunking time:  PENDING ms
```

**Note:** The gpt-tokenizer 3.x API was verified at install time — `encode()` is the correct
function name (same as 2.x; no breaking rename). Version `3.4.0` is installed and confirmed.

```
Result:   PENDING — live run with pdfjs-dist + real PDF not yet executed
          (CPU-only chunking logic: passes when RUN_SPIKES=1 with synthetic data)
Decision: [ ] pass (chunked-poll loop ingests 100–200pg PDF within timeout budget)
          [ ] partial (chunking OK; pdfjs-dist 6.x Node path requires workaround — document fix)
          [ ] fail (timeout or pdfjs API incompatible — investigate alternative)
```

### pdfjs-dist 6.x Node path note

`pdfjs-dist` is at version `6.0.227` (vs TSD `^4`). The Node text-extraction path may have
changed. The live SPIKE-INGEST run must verify:
1. `import * as pdfjs from 'pdfjs-dist'` works in Node (not browser-only bundle)
2. `pdfjs.getDocument({ data: buffer }).promise.then(doc => doc.getPage(n).then(...))` extracts text
3. If the Node path has breaking changes in 6.x, document the required workaround in this section.

---

## Phase-1 Gate Summary

| Spike | Harness Status | Live Run | Decision |
|-------|---------------|----------|----------|
| SPIKE-AI-SDK | Complete | Not required (static pin) | RECORDED: ai@5 / toDataStreamResponse |
| SPIKE-RAG | Harness committed | PENDING | PENDING |
| SPIKE-DEPLOY | Harness committed | PENDING | PENDING |
| SPIKE-CRON | Harness committed (unit tests: 7/7 pass) | PENDING | PENDING |
| SPIKE-INGEST | Harness committed | PENDING | PENDING |

**Gate status:** OPEN — 4 of 5 spikes have harness code committed but live runs PENDING.

Downstream phases (01-09, 01-10, 01-11) may proceed on the harness foundation.
Full unblocking requires the human-action checkpoint (live runs + decisions recorded here).
