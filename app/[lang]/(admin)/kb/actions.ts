'use server'

/**
 * app/[lang]/(admin)/kb/actions.ts
 *
 * Server Actions for the KB CRUD form.
 *
 * Mutations (create/update/delete) go through Server Actions — NOT Route
 * Handlers (RESEARCH §Pattern 1: "Route Handler for streams, Server Action
 * for mutations"). The Server Action re-checks the admin role via requireUser
 * before calling the crud module.
 *
 * NOTE: The process/poll endpoint (/api/kb/ingest/process) is a Route Handler
 * called by the browser after shard — that is NOT a Server Action.
 *
 * References:
 *   - TSD §3.4 (Server Actions for mutations; Route Handler for streams)
 *   - T-01-30 (admin gate on Server Action)
 *   - 01-10-PLAN.md Task 2 action
 */

import { cookies } from 'next/headers'
import { requireUser } from '@/src/firebase/auth'
import { createDoc, updateDoc, deleteDoc, type CreateDocInput, type UpdateDocInput } from '@/src/kb/crud'

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Extract the authenticated user from the __session cookie in a Server Action.
 *
 * Server Actions do not have a `Request` object, so we read the session cookie
 * directly and build a synthetic request for requireUser().
 */
async function getSessionUser() {
  const cookieStore = await cookies()
  const sessionCookie = cookieStore.get('__session')
  if (!sessionCookie?.value) {
    throw new Error('Not authenticated')
  }

  // Build a minimal Request with a Bearer token for requireUser()
  const syntheticReq = new Request('https://d2.app/admin/kb', {
    headers: {
      Authorization: `Bearer ${sessionCookie.value}`,
    },
  })
  return requireUser(syntheticReq)
}

// ─── Action results ───────────────────────────────────────────────────────────

export interface ActionResult {
  ok: boolean
  error?: string
  docId?: string
  jobId?: string
  total?: number
  remaining?: number
}

// ─── createKbDoc ──────────────────────────────────────────────────────────────

export async function createKbDocAction(input: CreateDocInput): Promise<ActionResult> {
  try {
    const user = await getSessionUser()
    const result = await createDoc(user, input)
    return {
      ok: true,
      docId: result.docId,
      jobId: result.jobId,
      total: result.total,
      remaining: result.remaining,
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return { ok: false, error: message }
  }
}

// ─── updateKbDoc ──────────────────────────────────────────────────────────────

export async function updateKbDocAction(docId: string, patch: UpdateDocInput): Promise<ActionResult> {
  try {
    const user = await getSessionUser()
    const result = await updateDoc(user, docId, patch)
    return {
      ok: true,
      docId: result.docId,
      ...(result.jobId ? { jobId: result.jobId, total: result.total, remaining: result.remaining } : {}),
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return { ok: false, error: message }
  }
}

// ─── deleteKbDoc ──────────────────────────────────────────────────────────────

export async function deleteKbDocAction(docId: string): Promise<ActionResult> {
  try {
    const user = await getSessionUser()
    await deleteDoc(user, docId)
    return { ok: true, docId }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return { ok: false, error: message }
  }
}
