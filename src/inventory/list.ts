/**
 * src/inventory/list.ts
 *
 * Admin-gated project listing — separate from crud.ts (ADMIN-04).
 *
 * Reads the full projects collection for the admin inventory manager.
 * Non-admin users cannot call this: assertAdmin() throws.
 *
 * Core/shell rule: this file must NOT import from app/ or next.
 *
 * References:
 *   - 03-08-PLAN.md Task 1 (admin inventory shell)
 *   - src/inventory/crud.ts (assertAdmin)
 *   - src/firebase/collections.ts (projectsRef, ProjectDoc)
 */

import { projectsRef, type ProjectDoc } from '@/src/firebase/collections'
import type { AuthenticatedUser } from '@/src/firebase/auth'
import { assertAdmin } from '@/src/inventory/crud'

export interface ProjectWithId {
  id: string
  data: ProjectDoc
}

/**
 * List all projects (all statuses) for the admin inventory manager.
 *
 * Returns projects ordered by name. Includes hidden/sold_out — the admin
 * needs to see everything; the search path enforces status:'active' separately.
 *
 * @param user  Verified admin user (assertAdmin throws for non-admin).
 */
export async function listProjects(user: AuthenticatedUser): Promise<ProjectWithId[]> {
  assertAdmin(user)

  const snap = await projectsRef().orderBy('name').get()
  return snap.docs.map((doc) => ({ id: doc.id, data: doc.data() }))
}
