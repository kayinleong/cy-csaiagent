/**
 * app/api/kb/ingest/process/route.ts
 *
 * Chunked-poll ingestion worker.
 *
 * The browser calls this endpoint repeatedly (with GET or POST) until
 * `remaining: 0` is returned. Each call processes `limit` chunks:
 *   1. requireUser(req) — HARD admin gate (T-01-30).
 *   2. Read kbIngestionJobs/{jobId} to get the next batch of unembedded chunks.
 *   3. embedText each chunk (document inputType) → write to kbChunks.
 *   4. Decrement remaining on the job doc.
 *   5. Return { remaining } — client polls until 0.
 *
 * Anti-patterns AVOIDED (TSD §3.4 + RESEARCH §Anti-Patterns):
 *   - NOT embedding a large PDF in one request (Cloud Run timeout trap).
 *   - NOT using after() for embedding — the work is SYNCHRONOUS in this handler
 *     so the response reliably carries { remaining }.
 *   - NOT a mega-request — each call is bounded by `limit`.
 *
 * Node runtime required: Admin SDK, crypto, Voyage API are server-only.
 *
 * Query parameters:
 *   jobId  — the kbIngestionJobs document ID returned by shardJob().
 *   limit  — max chunks per call (optional, default: 5).
 *
 * References:
 *   - TSD §3.4 (chunked client-driven ingestion model)
 *   - RESEARCH §Anti-Patterns line 307
 *   - 01-10-PLAN.md Task 1 action (ingest/process route)
 *   - T-01-30: admin-only; T-01-31: bounded batch; T-01-32: idempotent sha256
 */

import { requireUser, UnauthorizedError } from '@/src/firebase/auth'
import { processBatch } from '@/src/kb/ingest/pipeline'

// Node runtime: Admin SDK and Voyage API are not available in the Edge runtime.
export const runtime = 'nodejs'

const DEFAULT_LIMIT = 5
const MAX_LIMIT = 20 // cap to prevent DoS via huge limit param

/**
 * GET /api/kb/ingest/process?jobId=<id>&limit=<n>
 *
 * The browser polls this endpoint after shardJob() creates the ingestion job.
 * Each poll processes up to `limit` chunks and returns { remaining }.
 * The browser continues polling until remaining === 0.
 */
export async function GET(req: Request): Promise<Response> {
  return handleIngest(req)
}

/**
 * POST /api/kb/ingest/process
 *
 * Accepts JSON body { jobId, limit? } — equivalent to the GET form.
 * Provided for clients that prefer POST semantics.
 */
export async function POST(req: Request): Promise<Response> {
  return handleIngest(req)
}

async function handleIngest(req: Request): Promise<Response> {
  // ── Auth gate (admin only) ────────────────────────────────────────────────
  let user: Awaited<ReturnType<typeof requireUser>>
  try {
    user = await requireUser(req)
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }
    return Response.json({ error: 'Internal error during auth' }, { status: 500 })
  }

  if (user.role !== 'admin') {
    return Response.json({ error: 'Forbidden: admin role required' }, { status: 403 })
  }

  // ── Parse params ─────────────────────────────────────────────────────────
  let jobId: string | null
  let limitParam: number

  const contentType = req.headers.get('content-type') ?? ''
  if (req.method === 'POST' && contentType.includes('application/json')) {
    let body: { jobId?: string; limit?: number } = {}
    try {
      body = await req.json()
    } catch {
      return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
    }
    jobId = body.jobId ?? null
    limitParam = typeof body.limit === 'number' ? body.limit : DEFAULT_LIMIT
  } else {
    const url = new URL(req.url)
    jobId = url.searchParams.get('jobId')
    limitParam = parseInt(url.searchParams.get('limit') ?? `${DEFAULT_LIMIT}`, 10)
  }

  if (!jobId) {
    return Response.json({ error: 'Missing required parameter: jobId' }, { status: 400 })
  }

  // Clamp limit to a safe range
  const limit = Math.max(1, Math.min(isNaN(limitParam) ? DEFAULT_LIMIT : limitParam, MAX_LIMIT))

  // ── Process batch ─────────────────────────────────────────────────────────
  // This runs SYNCHRONOUSLY in the handler — NOT in after() — so the response
  // reliably carries the updated remaining count (anti-pattern: after() would
  // fire after the response is sent, making remaining stale).
  try {
    const result = await processBatch(jobId, limit)
    return Response.json({ remaining: result.remaining })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return Response.json({ error: message }, { status: 500 })
  }
}
