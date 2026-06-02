'use server'

/**
 * app/[lang]/(admin)/inventory/actions.ts
 *
 * Server Actions for the inventory admin manager (ADMIN-04).
 *
 * Mirrors app/[lang]/(admin)/kb/actions.ts: getSessionUser() reads the __session
 * cookie and builds a synthetic Request for requireUser(). Each action:
 *   1. Calls getSessionUser() — re-checks admin role (defense-in-depth: the RSC
 *      page also gates, but Server Actions are callable directly).
 *   2. Calls the matching src/inventory core function (which ALSO calls assertAdmin).
 *   3. Returns ActionResult { ok, error?, ... }.
 *
 * Threat model:
 *   T-03-22: Elevation of privilege — every SA re-checks admin via getSessionUser()
 *             AND the core assertAdmin (two independent gates).
 *   T-03-23: Tampering — importProjectsAction passes raw to importProjects which
 *             validates each row before any write (per-row errors returned).
 *   T-03-25: Spoofing — role is read from the VERIFIED session token, never from
 *             the request body.
 *
 * References:
 *   - 03-08-PLAN.md Task 1
 *   - app/[lang]/(admin)/kb/actions.ts (getSessionUser pattern)
 *   - src/inventory/crud.ts (createProject/updateProject/hideProject/attachCollateral)
 *   - src/inventory/import.ts (importProjects, csvProjectSource)
 */

import { cookies } from 'next/headers'
import { requireUser } from '@/src/firebase/auth'
import {
  createProject,
  updateProject,
  hideProject,
  attachCollateral,
  type CreateProjectInput,
  type UpdateProjectPatch,
  type AttachCollateralInput,
} from '@/src/inventory/crud'
import { importProjects, csvProjectSource } from '@/src/inventory/import'

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Extract the authenticated user from the __session cookie in a Server Action.
 *
 * Mirrors kb/actions.ts getSessionUser() exactly — admin re-check pattern.
 */
async function getSessionUser() {
  const cookieStore = await cookies()
  const sessionCookie = cookieStore.get('__session')
  if (!sessionCookie?.value) {
    throw new Error('Not authenticated')
  }
  const syntheticReq = new Request('https://d2.app/admin/inventory', {
    headers: { Authorization: `Bearer ${sessionCookie.value}` },
  })
  return requireUser(syntheticReq)
}

// ─── Action result types ──────────────────────────────────────────────────────

export interface InventoryActionResult {
  ok: boolean
  error?: string
  projectId?: string
  collateralId?: string
  created?: number
  errors?: Array<{ row: number; message: string }>
}

// ─── createProjectAction ──────────────────────────────────────────────────────

/**
 * Create a new project — admin re-checked via getSessionUser() + assertAdmin
 * inside createProject (T-03-22 defense-in-depth).
 */
export async function createProjectAction(input: CreateProjectInput): Promise<InventoryActionResult> {
  try {
    const user = await getSessionUser()
    const result = await createProject(user, input)
    return { ok: true, projectId: result.projectId }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return { ok: false, error: message }
  }
}

// ─── updateProjectAction ──────────────────────────────────────────────────────

/**
 * Update an existing project. Re-embeds only when embedding-relevant fields change
 * (Pitfall 8 delta check handled inside updateProject).
 */
export async function updateProjectAction(
  projectId: string,
  patch: UpdateProjectPatch,
): Promise<InventoryActionResult> {
  try {
    const user = await getSessionUser()
    await updateProject(user, projectId, patch)
    return { ok: true, projectId }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return { ok: false, error: message }
  }
}

// ─── hideProjectAction ────────────────────────────────────────────────────────

/**
 * Soft-hide a project by setting status:'hidden'. The project is excluded from
 * searchProjects (active-only gate) but NOT deleted — recoverable via unhide.
 */
export async function hideProjectAction(projectId: string): Promise<InventoryActionResult> {
  try {
    const user = await getSessionUser()
    await hideProject(user, projectId)
    return { ok: true, projectId }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return { ok: false, error: message }
  }
}

// ─── unhideProjectAction ─────────────────────────────────────────────────────

/**
 * Restore a hidden project to status:'active'.
 * Uses updateProject so priceBand/embedding delta logic is respected.
 */
export async function unhideProjectAction(projectId: string): Promise<InventoryActionResult> {
  try {
    const user = await getSessionUser()
    await updateProject(user, projectId, { status: 'active' })
    return { ok: true, projectId }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return { ok: false, error: message }
  }
}

// ─── attachCollateralAction ───────────────────────────────────────────────────

/**
 * Attach collateral (poster/video/fact_sheet) to a project.
 *
 * D-09 / C2: Accepts a Firebase Storage path OR a plain external URL.
 * NEVER a Drive-API integration — that is enforced in crud.ts and confirmed
 * by the T-03-24 grep gate on this file.
 */
export async function attachCollateralAction(
  projectId: string,
  collateral: AttachCollateralInput,
): Promise<InventoryActionResult> {
  try {
    const user = await getSessionUser()
    const result = await attachCollateral(user, projectId, collateral)
    return { ok: true, projectId, collateralId: result.collateralId }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return { ok: false, error: message }
  }
}

// ─── importProjectsAction ─────────────────────────────────────────────────────

/**
 * Parse, validate, and bulk-create projects from a raw CSV string.
 *
 * Uses the default csvProjectSource adapter (G4 FORMAT TBD — Assumption A1,
 * flagged for Derek to confirm; see 03-08-SUMMARY.md § Flagged Decision G4).
 *
 * Per-row validation errors are returned in the result (T-03-23 / ASVS V5).
 * Invalid rows are NOT written to Firestore.
 */
export async function importProjectsAction(raw: string): Promise<InventoryActionResult> {
  try {
    const user = await getSessionUser()
    const result = await importProjects(raw, csvProjectSource, user)
    return {
      ok: true,
      created: result.created,
      errors: result.errors,
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return { ok: false, error: message }
  }
}
