/**
 * app/api/kb/ingest/upload/route.ts
 *
 * File upload endpoint for the admin KB "Add document" form.
 *
 * Accepts multipart/form-data with:
 *   file   — the uploaded file (PDF, DOCX, DOC, XLSX, PPTX, TXT)
 *   title  — document title (non-empty string)
 *   lang   — 'en' | 'ms' | 'zh'
 *   pillar — 'coach' | 'finder' | 'reply'
 *
 * Security gates (mirror of /api/kb/ingest/process):
 *   - requireUser() verifies the Firebase Bearer token (401 on failure).
 *   - user.role === 'admin' guard (403 if not admin).
 *   - Extension allowlist: .pdf .docx .doc .xlsx .pptx .txt (415 if other).
 *   - Max file size: 20 MB (413 if over).
 *   - title, lang, pillar validated (400 if invalid).
 *
 * Why a Route Handler (NOT a Server Action):
 *   Server Actions enforce a 1 MB body limit. Multipart file uploads must go
 *   through a Route Handler that calls req.formData() directly.
 *
 * Node runtime required: Admin SDK, crypto, embedding API, Office parsers
 * are all server-only. Edge runtime cannot run them.
 *
 * Anti-patterns avoided (TSD §3.4):
 *   - NOT embedding inline — shardJob() creates the job doc; the browser polls
 *     /api/kb/ingest/process until remaining:0 (chunked client-driven model).
 *   - NOT a mega-request — upload + shard is bounded; embedding is deferred.
 *   - NEVER logging file contents, tokens, or PII (CLAUDE.md secrets hygiene).
 *
 * References:
 *   - TSD §3.4 (chunked client-driven ingestion model)
 *   - CLAUDE.md (secrets hygiene, no PII logging)
 *   - 01-10-PLAN.md Task 1 (ingest pipeline)
 */

import { requireUser, UnauthorizedError } from '@/src/firebase/auth'
import { createDocFromFile } from '@/src/kb/crud'

// Node runtime: Admin SDK, crypto, and Office parsers require Node.js.
export const runtime = 'nodejs'

/** Allowed file extensions for KB upload. */
const ALLOWED_EXTENSIONS = new Set(['.pdf', '.docx', '.doc', '.xlsx', '.pptx', '.txt'])

/** Maximum file size: 20 MB */
const MAX_FILE_SIZE = 20 * 1024 * 1024

/** Valid lang values */
const VALID_LANGS = new Set(['en', 'ms', 'zh'])

/** Valid pillar values */
const VALID_PILLARS = new Set(['coach', 'finder', 'reply'])

/**
 * POST /api/kb/ingest/upload
 *
 * Receives a multipart/form-data body with `file`, `title`, `lang`, `pillar`.
 * Validates, extracts text via shardJob, and returns { ok, docId, jobId, total }
 * for the browser to begin the poll loop against /api/kb/ingest/process.
 */
export async function POST(req: Request): Promise<Response> {
  // ── Auth gate (admin only) ────────────────────────────────────────────────
  let user: Awaited<ReturnType<typeof requireUser>>
  try {
    user = await requireUser(req)
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return Response.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
    }
    return Response.json({ ok: false, error: 'Internal error during auth' }, { status: 500 })
  }

  if (user.role !== 'admin') {
    return Response.json({ ok: false, error: 'Forbidden: admin role required' }, { status: 403 })
  }

  // ── Parse multipart form ──────────────────────────────────────────────────
  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return Response.json({ ok: false, error: 'Failed to parse form data' }, { status: 400 })
  }

  const file = form.get('file')
  const title = form.get('title')
  const lang = form.get('lang')
  const pillar = form.get('pillar')

  // ── Validate file presence ────────────────────────────────────────────────
  if (!file || !(file instanceof File)) {
    return Response.json({ ok: false, error: 'Missing required field: file' }, { status: 400 })
  }

  // ── Validate file extension ───────────────────────────────────────────────
  const dot = file.name.lastIndexOf('.')
  const ext = dot === -1 ? '' : file.name.slice(dot).toLowerCase()
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    return Response.json(
      {
        ok: false,
        error: `Unsupported file type "${ext || file.name}". Allowed: .pdf .docx .doc .xlsx .pptx .txt`,
      },
      { status: 415 },
    )
  }

  // ── Validate file size ────────────────────────────────────────────────────
  if (file.size > MAX_FILE_SIZE) {
    return Response.json(
      { ok: false, error: `File exceeds the 20 MB limit (received ${(file.size / 1024 / 1024).toFixed(1)} MB)` },
      { status: 413 },
    )
  }

  // ── Validate text fields ──────────────────────────────────────────────────
  if (!title || typeof title !== 'string' || title.trim().length === 0) {
    return Response.json({ ok: false, error: 'Missing required field: title' }, { status: 400 })
  }

  if (!lang || typeof lang !== 'string' || !VALID_LANGS.has(lang)) {
    return Response.json(
      { ok: false, error: 'Invalid lang — must be one of: en, ms, zh' },
      { status: 400 },
    )
  }

  if (!pillar || typeof pillar !== 'string' || !VALID_PILLARS.has(pillar)) {
    return Response.json(
      { ok: false, error: 'Invalid pillar — must be one of: coach, finder, reply' },
      { status: 400 },
    )
  }

  // ── Convert File → Buffer ─────────────────────────────────────────────────
  const buffer = Buffer.from(await file.arrayBuffer())

  // ── Shard + create doc ────────────────────────────────────────────────────
  try {
    const result = await createDocFromFile(user, {
      title: title.trim(),
      file: {
        buffer,
        name: file.name,
        mimeType: file.type,
      },
      lang: lang as 'en' | 'ms' | 'zh',
      pillar: pillar as 'coach' | 'finder' | 'reply',
    })

    return Response.json({
      ok: true,
      docId: result.docId,
      jobId: result.jobId,
      total: result.total,
    })
  } catch (err) {
    // Do NOT log file contents or user data — only the error message
    const message = err instanceof Error ? err.message : 'Unknown error during ingestion'
    return Response.json({ ok: false, error: message }, { status: 500 })
  }
}
