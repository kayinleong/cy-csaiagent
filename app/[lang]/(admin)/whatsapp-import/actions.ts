'use server'

/**
 * app/[lang]/(admin)/whatsapp-import/actions.ts
 *
 * Server Action for the WhatsApp-import admin surface.
 *
 * The browser parses the uploaded .zip (JSZip) and sends only a bounded
 * classification SAMPLE (group name + first/last messages) to this action —
 * never the whole transcript — which asks the LLM to decide whether the chat
 * belongs to an existing inventory project or warrants a new one.
 *
 * This action is CLASSIFY-ONLY. The actual side effects are performed by the
 * client via existing, already-tested Server Actions (three independent admin
 * gates preserved):
 *   - KB text ingest   → createKbDocAction   (app/[lang]/(admin)/kb/actions.ts)
 *   - new project       → createProjectAction  (app/[lang]/(admin)/inventory/actions.ts)
 *   - media collateral  → attachCollateralAction (…/inventory/actions.ts)
 *
 * Model resolution goes through modelFor('finder') — never a hard-coded model
 * ID (CLAUDE.md model-agnostic constraint).
 *
 * References:
 *   - src/router/classifier.ts (modelFor + generateObject pattern)
 *   - src/inventory/list.ts (listProjects — admin-gated candidate set)
 *   - .planning/quick/quick-kayinleong-045/CLAIM.md
 */

import { cookies } from 'next/headers'
import { generateObject } from 'ai'
import { z } from 'zod'
import { requireUser } from '@/src/firebase/auth'
import { modelFor } from '@/src/llm/provider'
import { listProjects } from '@/src/inventory/list'

// ─── Session helper (mirrors kb/actions.ts + inventory/actions.ts) ──────────────

/**
 * Resolve the authenticated user from the __session cookie inside a Server Action.
 * Server Actions have no Request object, so we build a synthetic one for requireUser().
 */
async function getSessionUser() {
  const cookieStore = await cookies()
  const sessionCookie = cookieStore.get('__session')
  if (!sessionCookie?.value) {
    throw new Error('Not authenticated')
  }
  const syntheticReq = new Request('https://d2.app/admin/whatsapp-import', {
    headers: { Authorization: `Bearer ${sessionCookie.value}` },
  })
  return requireUser(syntheticReq)
}

// ─── Types ──────────────────────────────────────────────────────────────────────

export interface ClassifyInput {
  /** Detected group name from the export (may be empty). */
  groupName: string
  /** Bounded sample text (toClassificationSample) — NOT the full transcript. */
  sample: string
}

export interface ProjectOption {
  id: string
  name: string
  status: string
}

export interface ClassifyResult {
  ok: boolean
  error?: string
  /** 'match' → chat belongs to an existing project; 'new' → propose a new project. */
  decision?: 'match' | 'new'
  /** Set when decision === 'match'. */
  matchedProjectId?: string | null
  /** The existing project name (match) or a proposed new-project name (new). */
  suggestedName?: string
  /** Model confidence in [0,1]. */
  confidence?: number
  reasoning?: string
  /** Full candidate list so the client can offer a manual override. */
  projects?: ProjectOption[]
}

// ─── Classify ─────────────────────────────────────────────────────────────────

const decisionSchema = z.object({
  decision: z
    .enum(['match', 'new'])
    .describe("'match' if the chat clearly concerns one of the existing projects; 'new' otherwise."),
  matchedProjectId: z
    .string()
    .nullable()
    .describe("The exact id of the matched existing project when decision is 'match'; otherwise null."),
  suggestedName: z
    .string()
    .describe("The existing project's name when matching, or a concise proposed project name when new."),
  confidence: z.number().min(0).max(1).describe('Confidence in the decision, 0 to 1.'),
  reasoning: z.string().describe('One or two sentences explaining the decision.'),
})

/**
 * Classify a WhatsApp export against the current inventory.
 *
 * Admin-gated (getSessionUser → requireUser; listProjects re-asserts admin).
 * Never throws — errors are returned as { ok: false, error } so the client form
 * can render them inline. The LLM call is resolved via modelFor('finder').
 */
export async function classifyWhatsAppProjectAction(input: ClassifyInput): Promise<ClassifyResult> {
  try {
    const user = await getSessionUser()

    // Candidate set — admin-gated read (listProjects calls assertAdmin).
    const projects = await listProjects(user)
    const options: ProjectOption[] = projects.map(({ id, data }) => ({
      id,
      name: data.name,
      status: data.status,
    }))

    const projectLines =
      options.length > 0
        ? options.map((p) => `- id: ${p.id} | name: ${p.name} | status: ${p.status}`).join('\n')
        : '(no existing projects)'

    const model = await modelFor('finder')
    const { object } = await generateObject({
      model,
      schema: decisionSchema,
      system:
        'You route a WhatsApp group chat (from a Malaysian real-estate brokerage) to the ' +
        'correct property project. You are given a list of existing projects and a sample of ' +
        'the chat. If the chat clearly concerns one existing project, return decision "match" ' +
        'with that project\'s exact id. If no existing project fits, return decision "new" and ' +
        'propose a concise project name derived from the chat (e.g. the development/property name). ' +
        'Be conservative: only "match" when reasonably confident.',
      prompt:
        `Existing projects:\n${projectLines}\n\n` +
        `Detected group name: ${input.groupName || '(unknown)'}\n\n` +
        `Chat sample:\n${input.sample}`,
    })

    return {
      ok: true,
      decision: object.decision,
      matchedProjectId: object.matchedProjectId,
      suggestedName: object.suggestedName,
      confidence: object.confidence,
      reasoning: object.reasoning,
      projects: options,
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return { ok: false, error: message }
  }
}

/**
 * List inventory projects for the manual-override dropdown, without running the
 * classifier. Admin-gated; never throws.
 */
export async function listProjectOptionsAction(): Promise<{ ok: boolean; error?: string; projects?: ProjectOption[] }> {
  try {
    const user = await getSessionUser()
    const projects = await listProjects(user)
    return {
      ok: true,
      projects: projects.map(({ id, data }) => ({ id, name: data.name, status: data.status })),
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return { ok: false, error: message }
  }
}
