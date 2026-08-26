/**
 * src/inventory/crud.ts
 *
 * Inventory CRUD operations — admin-gated, embed-on-write, soft-hide, collateral.
 *
 * Authorization model:
 *   - createProject / updateProject / hideProject / attachCollateral — admin only.
 *
 * Embedding invariant (Pitfall 8 — stale embedding after edit):
 *   - createProject:    ALWAYS embeds the new project before writing.
 *   - updateProject:    re-embeds ONLY when an embedding-relevant field changes
 *                       (name, description, locationText, tenure, bedrooms, priceValue/priceBand).
 *                       Non-relevant fields (status, vpStatus, vpDate, bumiQuota,
 *                       foreignEligible, externalUrl) skip re-embed (Pitfall 8 delta check).
 *   - hideProject:      sets status:'hidden' — soft-hide, NO delete (ADMIN-04).
 *   - attachCollateral: writes a collateral doc with a Firebase Storage path OR a plain external
 *                       URL — NEVER the Google Drive API (D-09/C2 hard constraint).
 *
 * priceBand sync:
 *   Both createProject and updateProject call priceBandFor(priceValue) to keep the
 *   discrete equality-filterable band in sync with the numeric priceValue (FIND-03 / Pitfall 6).
 *
 * Export pattern:
 *   assertAdmin is exported so import.ts + Server Actions can reuse the gate without
 *   duplicating the role check (defence-in-depth; keeps the gate in one place).
 *
 * Core/shell rule: this file must NOT import from app/ or next.
 *
 * References:
 *   - 03-03-PLAN.md Task 2
 *   - src/kb/crud.ts (assertAdmin + typed-ref write pattern to mirror)
 *   - src/firebase/collections.ts (projectsRef, collateralRef, priceBandFor, ProjectDoc, CollateralDoc)
 *   - src/inventory/embedText.ts (embedProject — 1024-d via Gemini, not called directly here)
 *   - TSD §4 projects + collateral data model
 *   - STRIDE T-03-07: admin gate unit-tested (non-admin rejection)
 *   - STRIDE T-03-09: Drive-API grep gate — no Drive symbol below
 *   - STRIDE T-03-10: embedding delta check — re-embed on relevant field change only
 */

import { FieldValue } from 'firebase-admin/firestore'
import {
  projectsRef,
  collateralRef,
  priceBandFor,
  TENANT_ID,
  type ProjectDoc,
  type CollateralDoc,
} from '@/src/firebase/collections'
import type { AuthenticatedUser } from '@/src/firebase/auth'
import { embedProject } from '@/src/inventory/embedText'

// ─── Types ─────────────────────────────────────────────────────────────────────

/** Fields accepted when creating a new project (tenantId + priceBand + embedding stamped here). */
export type CreateProjectInput = Omit<ProjectDoc, 'tenantId' | 'priceBand' | 'embedding'>

/**
 * Patch fields for updateProject.
 * priceBand is intentionally omitted — it is always derived from priceValue via priceBandFor().
 */
export type UpdateProjectPatch = Partial<Omit<ProjectDoc, 'tenantId' | 'priceBand' | 'embedding'>>

export interface AttachCollateralInput {
  type: string
  lang: 'en' | 'ms' | 'zh'
  /** Firebase Storage object path. Provide this OR externalUrl — not both. */
  storagePath?: string
  /**
   * External share URL (e.g. a Google Drive public link, OneDrive link).
   * D-09/C2: stored as a plain URL string — NEVER a Drive-API call.
   */
  externalUrl?: string
}

export interface CreateProjectResult {
  projectId: string
}

// ─── Embedding-relevant fields ─────────────────────────────────────────────────

/**
 * Fields whose change requires re-embedding the project (Pitfall 8 delta check).
 *
 * The composeProjectEmbeddingText function in embedText.ts reads exactly these fields:
 *   name, priceBand, tenure, bedrooms, locationText, description
 *
 * priceValue is included because a change to priceValue recomputes priceBand,
 * which IS in the embedding text.
 */
const EMBEDDING_RELEVANT_FIELDS: ReadonlySet<keyof ProjectDoc> = new Set([
  'name',
  'description',
  'locationText',
  'tenure',
  'bedrooms',
  'priceValue', // triggers priceBand recomputation
])

// ─── assertAdmin ───────────────────────────────────────────────────────────────

/**
 * Assert admin role — throws unless user.role === 'admin'.
 *
 * Exported so import.ts + Server Actions can reuse the gate.
 * Mirrors src/kb/crud.ts assertAdmin (one gate, one place).
 *
 * T-03-07: unit-tested non-admin rejection for every inventory mutation.
 */
export function assertAdmin(user: AuthenticatedUser): void {
  if (user.role !== 'admin') {
    throw new Error('Forbidden: admin role required for inventory CRUD operations')
  }
}

// ─── createProject ─────────────────────────────────────────────────────────────

/**
 * Create a new project, embed it, and write it to the `projects` collection.
 *
 * Steps:
 *   1. assertAdmin — gate (T-03-07)
 *   2. Derive priceBand from priceValue via priceBandFor (band sync)
 *   3. Build a temporary ProjectDoc with embedding:[] to generate the embedding text
 *   4. embedProject(tempDoc) — 1024-d via Gemini (embed-on-create, Pitfall 8)
 *   5. write via projectsRef().add() (converter stamps tenantId)
 *
 * @param user   Verified user — must have role 'admin'.
 * @param input  Project fields (priceValue, not priceBand — band is derived here).
 * @returns      { projectId }
 */
export async function createProject(
  user: AuthenticatedUser,
  input: CreateProjectInput,
): Promise<CreateProjectResult> {
  assertAdmin(user)

  // Derive the discrete price band from the numeric price value
  const priceBand = priceBandFor(input.priceValue)

  // Build a temporary ProjectDoc shape for embedProject (embedding field placeholder)
  const tempDoc: ProjectDoc = {
    tenantId: TENANT_ID,
    ...input,
    priceBand,
    embedding: [], // placeholder — replaced by the real vector below
  }

  // Embed the project BEFORE writing (embed-on-create invariant, Pitfall 8)
  const embedding = await embedProject(tempDoc)

  // Write the final document via the typed ref (converter stamps tenantId)
  const ref = await projectsRef().add({
    ...tempDoc,
    embedding,
  })

  return { projectId: ref.id }
}

// ─── updateProject ─────────────────────────────────────────────────────────────

/**
 * Update a project, re-embedding only when embedding-relevant fields change.
 *
 * Steps:
 *   1. assertAdmin — gate (T-03-07)
 *   2. Load the current doc
 *   3. If any field in EMBEDDING_RELEVANT_FIELDS is in patch AND differs from the
 *      stored value → re-embed (Pitfall 8 delta check, T-03-10)
 *   4. If priceValue changed → also recompute priceBand (band sync)
 *   5. Write the merged update via doc.update()
 *
 * @param user      Verified user — must have role 'admin'.
 * @param projectId Document ID in the `projects` collection.
 * @param patch     Fields to update (priceBand must NOT be passed — derived from priceValue).
 */
export async function updateProject(
  user: AuthenticatedUser,
  projectId: string,
  patch: UpdateProjectPatch,
): Promise<void> {
  assertAdmin(user)

  const docRef = projectsRef().doc(projectId)
  const snap = await docRef.get()
  if (!snap.exists) {
    throw new Error(`updateProject: project "${projectId}" not found`)
  }

  const current = snap.data() as ProjectDoc

  // ── Pitfall 8 delta check: detect changes to embedding-relevant fields ────
  const relevantChange = Array.from(EMBEDDING_RELEVANT_FIELDS).some((field) => {
    const key = field as keyof UpdateProjectPatch
    return key in patch && patch[key] !== current[key as keyof ProjectDoc]
  })

  // Build the update object
  const update: Partial<ProjectDoc> = { ...patch }

  // priceBand sync — recompute whenever priceValue changes
  if ('priceValue' in patch && patch.priceValue !== undefined) {
    update.priceBand = priceBandFor(patch.priceValue)
  }

  if (relevantChange) {
    // Merge current doc with the patch to compose the updated embedding text
    const merged: ProjectDoc = {
      ...current,
      ...update,
    }
    const embedding = await embedProject(merged)
    update.embedding = embedding
  }

  await docRef.update(update)
}

// ─── hideProject ───────────────────────────────────────────────────────────────

/**
 * Soft-hide a project by setting status:'hidden' — no delete.
 *
 * Mirrors src/kb/crud.ts unpublishDoc (status change, no hard delete).
 * A hidden project is excluded from searchProjects (Stage-A `status:'active'` gate)
 * but remains in Firestore for audit/recovery purposes.
 *
 * @param user      Verified user — must have role 'admin'.
 * @param projectId Document ID in the `projects` collection.
 */
export async function hideProject(
  user: AuthenticatedUser,
  projectId: string,
): Promise<void> {
  assertAdmin(user)

  const docRef = projectsRef().doc(projectId)
  await docRef.update({ status: 'hidden' })
}

// ─── attachCollateral ──────────────────────────────────────────────────────────

/**
 * Attach a collateral asset to a project.
 *
 * Writes a `CollateralDoc` to the `collateral` collection keyed by projectId.
 * Exactly one of `storagePath` (Firebase Storage) or `externalUrl` (plain URL) is required.
 *
 * D-09 / C2: NEVER call the Google Drive API. `externalUrl` is a plain string stored as-is;
 * the client renders a download link.
 *
 * quick-kayinleong-050: this used to claim "signed URLs for storagePath are generated in
 * the READ path". They never were — nothing in the repo resolved a path to a URL. Callers
 * that upload to Storage MUST now write `externalUrl` themselves (a Firebase download URL
 * from `getDownloadURL`) ALONGSIDE `storagePath`; a path-only doc is unreachable to both
 * the agent and the UI.
 *
 * @param user      Verified user — must have role 'admin'.
 * @param projectId ID of the project this collateral belongs to.
 * @param input     { type, lang, storagePath? | externalUrl? } — exactly one of the paths.
 */
export async function attachCollateral(
  user: AuthenticatedUser,
  projectId: string,
  input: AttachCollateralInput,
): Promise<{ collateralId: string }> {
  assertAdmin(user)

  // Validation: exactly one of storagePath / externalUrl must be provided (D-09)
  if (!input.storagePath && !input.externalUrl) {
    throw new Error(
      'attachCollateral: exactly one of storagePath or externalUrl is required (D-09 — no Drive API)',
    )
  }

  // Build the collateral doc — NEVER a Drive-API integration (C2/D-09 grep gate)
  const collateralData: CollateralDoc = {
    tenantId: TENANT_ID,
    projectId,
    type: input.type,
    lang: input.lang,
    storagePath: input.storagePath ?? '',
    ...(input.externalUrl !== undefined ? { externalUrl: input.externalUrl } : {}),
  }

  const ref = await collateralRef().add(collateralData)
  return { collateralId: ref.id }
}
