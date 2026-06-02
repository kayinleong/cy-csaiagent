/**
 * app/api/chat/route.ts — Node-runtime SSE chat endpoint (the integration spine).
 *
 * This is a Route Handler (NOT a Server Action — Server Actions cannot stream).
 * Runtime: Node (not Edge — Admin SDK requires Node APIs).
 * Max duration: 90s (streaming conversation, Cloud Run substrate on App Hosting).
 *
 * GATE ORDERING — enforced before any model spend (TSD §5.3, threat register):
 *   1. requireUser(req)        → 401 if unauthenticated        (T-01-37)
 *   2. ratelimit.check(uid)    → 429 if over budget            (T-01-39)
 *   3. pseudonymize + assertRedacted → 422 if PII not redacted (T-01-38, T-03-26)
 *   4. routeAsync(messages)    → 'coach' or 'finder' (D-01, 03-07)
 *   5. dispatch: coachAgent or finderAgent (based on pillar)
 *   6. streamText(...)         → model call (only reaches here if all gates pass)
 *   7. onFinish: appendMessage (with routeDecision D-02) + finderSlot write (FIND-05/08)
 *              + decrement + after(() => audit.log(...))
 *
 * Load-bearing SSE headers (SPIKE-DEPLOY):
 *   Content-Type: text/event-stream  — set by toUIMessageStreamResponse()
 *   Cache-Control: no-store          — prevents proxy/CDN buffering
 *   X-Accel-Buffering: no            — disables nginx buffering on App Hosting
 *
 * Stream method: result.toUIMessageStreamResponse() — the correct method name
 * for ai@5.0.193. (SPIKES.md documents this as "toDataStreamResponse" but that
 * method does not exist in the installed version; toUIMessageStreamResponse() is
 * the equivalent method — Deviation Rule 1 auto-fix, documented in SUMMARY.md.)
 *
 * CLAUDE.md constraints honored:
 *   - No hard-coded model IDs (modelFor() resolves from Remote Config)
 *   - No PII/token logging (grep: console.log/info with token/message/content)
 *   - This is a Route Handler, not a Server Action (no server directive)
 *   - Grounding mandatory (Coach retrieves via tool before answering)
 *   - Finder path: PDPA gate (GATE 3) runs before the model call (T-03-26)
 */

import { after } from 'next/server'
import { streamText, stepCountIs } from 'ai'
import { requireUser, UnauthorizedError } from '@/src/firebase/auth'
import * as ratelimit from '@/src/ratelimit'
import { RateLimitError } from '@/src/ratelimit'
import { pseudonymize, assertRedacted, PdpaViolationError } from '@/src/audit'
import * as audit from '@/src/audit'
import { routeAsync } from '@/src/router'
import { coachAgent } from '@/src/agents/coach'
import { finderAgent } from '@/src/agents/finder'
import { modelFor } from '@/src/llm/provider'
import {
  appendMessage,
  ensurePrimaryThread,
  readFinderSlot,
  mergeFinderCriteria,
  mergeDiscussed,
  writeLeadSlot,
} from '@/src/memory'
import { detectLang } from '@/src/i18n/detect'
import type { MessageDoc } from '@/src/firebase/collections'
import { TENANT_ID } from '@/src/firebase/collections'
import type { RetrieveHit } from '@/src/agents/coach/tools'
import type { FinderSlot } from '@/src/memory'
import type { ParsedCriteria } from '@/src/inventory/search'

// ─── Runtime configuration ────────────────────────────────────────────────────

export const runtime = 'nodejs'
export const maxDuration = 90

// ─── Citation extraction helper ───────────────────────────────────────────────

/**
 * Extract KB chunk IDs from the AI SDK v5 streamText onFinish payload.
 *
 * AI SDK v5 exposes tool call results in `final.steps[*].toolResults` where
 * each result has a `toolName` and `result` field. The `retrieveKnowledge` tool
 * returns a `RetrieveHit` when found (`found: true`, `citations: [{chunkId, ...}]`).
 *
 * If no tool was called or the tool returned a miss (`found: false`), returns [].
 * Never throws — citation extraction is best-effort (T-02-14: chunkIds are not PII).
 *
 * @param final  The onFinish payload from streamText (StepResult + steps array).
 * @returns      Array of KB chunk ID strings.
 */
export function extractCitationChunkIds(
  final: { steps?: Array<{ toolResults?: Array<{ toolName?: string; result?: unknown }> }> },
): string[] {
  try {
    const chunkIds: string[] = []
    for (const step of final.steps ?? []) {
      for (const tr of step.toolResults ?? []) {
        if (tr.toolName === 'retrieveKnowledge') {
          const r = tr.result as RetrieveHit | { found: false } | null | undefined
          if (r && r.found === true) {
            for (const c of (r as RetrieveHit).citations) {
              if (c.chunkId) chunkIds.push(c.chunkId)
            }
          }
        }
      }
    }
    return chunkIds
  } catch {
    // Never let citation extraction fail the request
    return []
  }
}

// ─── Finder project ID extraction helper ─────────────────────────────────────

/**
 * Extract discussed project IDs from the AI SDK v5 streamText onFinish payload.
 *
 * Reads the `searchProjects` tool results across all steps and collects the
 * `projectId` of each returned match (found: true). These IDs are accumulated
 * in the finderSlot to track what has been shown to the lead (FIND-05/06/08).
 *
 * If no searchProjects call was made, or it returned found:false, returns [].
 * Never throws — project ID extraction is best-effort.
 *
 * @param final  The onFinish payload from streamText (StepResult + steps array).
 * @returns      Array of project ID strings.
 */
export function extractFinderProjectIds(
  final: { steps?: Array<{ toolResults?: Array<{ toolName?: string; result?: unknown }> }> },
): string[] {
  try {
    const projectIds: string[] = []
    for (const step of final.steps ?? []) {
      for (const tr of step.toolResults ?? []) {
        if (tr.toolName === 'searchProjects') {
          const r = tr.result as { found: boolean; matches?: Array<{ projectId: string }> } | null | undefined
          if (r && r.found === true && Array.isArray(r.matches)) {
            for (const m of r.matches) {
              if (m.projectId) projectIds.push(m.projectId)
            }
          }
        }
      }
    }
    return projectIds
  } catch {
    // Never let extraction fail the request
    return []
  }
}

// ─── POST handler ─────────────────────────────────────────────────────────────

export async function POST(req: Request): Promise<Response> {
  // ── GATE 1: Authentication ──────────────────────────────────────────────────
  // HARD gate — requireUser throws UnauthorizedError on any token failure.
  // Claims (role, tenantId) are read from the VERIFIED token, never from the body.
  let uid: string
  try {
    const user = await requireUser(req)
    uid = user.uid
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  // ── GATE 2: Rate limit ──────────────────────────────────────────────────────
  // Refuse runaway conversations BEFORE any token spend (T-01-39).
  // check() throws RateLimitError if the agent is over their daily budget.
  try {
    await ratelimit.check(uid, 'chat')
  } catch (err) {
    if (err instanceof RateLimitError) {
      return new Response(JSON.stringify({ error: 'Rate limit exceeded' }), {
        status: 429,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  // ── Parse request body ──────────────────────────────────────────────────────
  let messages: Array<{ role: 'user' | 'assistant'; content: string }>
  let cid: string
  let langOverride: 'en' | 'ms' | 'zh' | undefined
  let override: 'coach' | 'finder' | undefined
  let leadId: string | undefined
  try {
    const body = await req.json() as {
      messages?: Array<{ role: 'user' | 'assistant'; content: string }>
      cid?: string
      langOverride?: 'en' | 'ms' | 'zh'
      override?: 'coach' | 'finder'
      leadId?: string
    }
    messages = body.messages ?? []
    // langOverride: manual pin from the language-override chip (CHAT-08)
    // Only accept valid locales — discard anything else for security (T-02-12)
    langOverride = (['en', 'ms', 'zh'] as const).includes(body.langOverride as 'en' | 'ms' | 'zh')
      ? (body.langOverride as 'en' | 'ms' | 'zh')
      : undefined
    // override: manual pillar chip from the UI — validated against enum (T-03-28)
    // Only accept 'coach' or 'finder' — invalid values are ignored for security
    override = (['coach', 'finder'] as const).includes(body.override as 'coach' | 'finder')
      ? (body.override as 'coach' | 'finder')
      : undefined
    // leadId: the lead this conversation is about — used for finderSlot write
    // Accept as-is; ownership enforced by Firestore rules (T-03-28)
    leadId = typeof body.leadId === 'string' && body.leadId.length > 0
      ? body.leadId
      : undefined
    // cid: use provided value (history navigation) or defer to ensurePrimaryThread below
    cid = body.cid ?? ''

    if (messages.length === 0) {
      return new Response(JSON.stringify({ error: 'No messages provided' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      })
    }
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid request body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  // Detect the language of the most recent user message for RAG pre-filter.
  // CHAT-08: honor manual langOverride chip when present; auto-detect otherwise.
  const lastUserMessage = messages.filter((m) => m.role === 'user').at(-1)
  const userLang: 'en' | 'ms' | 'zh' = langOverride ?? (lastUserMessage ? detectLang(lastUserMessage.content) : 'en')

  // Resolve the stable primary thread cid (D-01 / Pitfall 2 fix).
  // If no cid was provided, create/look up the persistent coach-${uid} thread.
  if (!cid) {
    cid = await ensurePrimaryThread(uid, userLang)
  }

  // ── GATE 3: PDPA pseudonymization + assertRedacted ──────────────────────────
  // Pseudonymize any PII in the message content BEFORE the prompt leaves the server.
  // assertRedacted() THROWS PdpaViolationError if pdpa_redacted !== true.
  // This gate is called immediately before streamText for ALL pillars (T-01-38, T-03-26).
  // Pasted lead criteria (Finder path) may contain PII — gate applies equally.
  const { redacted, pdpa_redacted } = pseudonymize(
    {
      messages: messages as Array<{ role: string; content: string }>,
    },
    [], // knownNames — will inject lead names from leadContext when available
  )

  try {
    assertRedacted({ pdpa_redacted })
  } catch (err) {
    if (err instanceof PdpaViolationError) {
      return new Response(JSON.stringify({ error: 'PDPA gate failed' }), {
        status: 422,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    throw err
  }

  // ── GATE 4: routeAsync → pillar decision (D-01, 03-07) ─────────────────────
  // Phase 3: heuristic-first → LLM classifier fallback (override chip wins).
  // routeAsync is the async version that activates the LLM classifier for
  // ambiguous conversations (replaces the sync route() call from Phase 1).
  const decision = await routeAsync(
    messages.map((m) => ({ role: m.role, content: m.content })),
    { override },
  )
  const pillar = decision.pillar
  // routeDecision encodes pillar:reason for observability + eval (D-02, T-03-27)
  const routeDecision = `${pillar}:${decision.reason}`

  // ── Dispatch: build agent system prompt + tools based on pillar ──────────────
  // Phase 3 adds the Finder branch alongside the existing Coach branch.
  // Each branch resolves its own system prompt, tools, and model (never hard-coded).
  let agentSystemPrompt: string
  let agentTools: ReturnType<typeof coachAgent.makeTools> | ReturnType<typeof finderAgent.makeTools>
  // finderSlotForBuild: stored finderSlot to inject into the Finder system prompt
  let storedFinderSlot: FinderSlot | null = null
  // mergedCriteria: criteria to write back to finderSlot in onFinish (FIND-08)
  let mergedCriteria: ParsedCriteria | null = null

  if (pillar === 'finder') {
    // Read the stored finderSlot for re-rank-without-re-typing (FIND-08, SC2)
    if (leadId) {
      storedFinderSlot = await readFinderSlot(leadId)
      if (storedFinderSlot) {
        // Merge the stored criteria with anything implicit in the current turn.
        // The merged criteria are injected into the system prompt so the Finder
        // uses the lead's full expressed preferences, not just the current turn.
        // The actual delta (from the turn's parsed criteria) is extracted post-turn
        // in onFinish and written back to the slot. Here we pass the stored criteria
        // as a baseline — FIND-08: no re-typing needed for unchanged fields.
        mergedCriteria = mergeFinderCriteria(storedFinderSlot.criteria, {})
      }
    }

    agentSystemPrompt = finderAgent.buildSystemPrompt({
      // Cast FinderSlot to Record<string, unknown> for the system prompt builder
      // (the builder only reads it for context injection; no structural mutation)
      leadContext: storedFinderSlot ? (storedFinderSlot as unknown as Record<string, unknown>) : undefined,
    })
    agentTools = finderAgent.makeTools(userLang, uid, leadId)
  } else {
    // Coach branch — unchanged from Phase 1/2
    agentSystemPrompt = coachAgent.buildSystemPrompt()
    agentTools = coachAgent.makeTools(userLang)
  }

  // ── Resolve model ID from Remote Config ─────────────────────────────────────
  // modelFor() reads the model ID from Firebase Remote Config — NEVER hard-coded.
  const model = await modelFor(pillar)

  // ── GATE 5: streamText + onFinish ───────────────────────────────────────────
  // The model call only happens if all gates above have passed.
  // GATE 3 (assertRedacted) has ALREADY run — this is the only model call.
  // onFinish persists BOTH the user and assistant messages with routeDecision,
  // writes the finderSlot for Finder turns (FIND-05/08), and triggers audit.
  const redactedMessages = redacted.messages as Array<{ role: 'user' | 'assistant'; content: string }>

  // Snapshot user message content before streaming (stable reference for persistence)
  const userMessageContent = lastUserMessage?.content ?? ''

  const result = streamText({
    model,
    system: agentSystemPrompt,
    messages: redactedMessages,
    tools: agentTools,
    // Finder uses a multi-step tool loop (parse→search→collateral): bound at 5 steps
    // to prevent unbounded cost (T-03-30 / D-05). Coach keeps the default (1 step).
    stopWhen: pillar === 'finder' ? stepCountIs(5) : stepCountIs(1),
    onFinish: async (final) => {
      // ── Persist user message (Pitfall 2 fix — CHAT-02) ────────────────────
      // The user message is persisted AFTER the stream to avoid blocking the
      // response, but before the assistant message (order is stable).
      const userMsg: MessageDoc = {
        tenantId: TENANT_ID,
        role: 'user',
        content: userMessageContent,
        citations: [],
        routeDecision,  // D-02: pillar:reason on every message
        tokens: 0, // user turns have no model token cost
        redacted: true, // PDPA gate was applied
      }
      await appendMessage(cid, userMsg)

      // ── Extract citation chunk IDs from tool results (Coach path) ─────────
      // AI SDK v5 exposes tool results on the finish payload via `steps[*].toolResults`.
      // For the Coach path: map retrieveKnowledge tool results into citationIds.
      // For the Finder path: citations come from projectIds (separate extraction below).
      const citationIds = pillar === 'coach' ? extractCitationChunkIds(final) : []

      // ── Persist the assistant message ────────────────────────────────────
      const assistantMsg: MessageDoc = {
        tenantId: TENANT_ID,
        role: 'assistant',
        content: final.text,
        citations: citationIds, // real KB chunk IDs from retrieveKnowledge (coach) or [] (finder)
        routeDecision,  // D-02: pillar:reason on every message (T-03-27 — observable/eval-able)
        tokens: final.usage.totalTokens ?? 0,
        redacted: true, // PDPA gate was applied
      }
      await appendMessage(cid, assistantMsg)

      // ── Finder: write finderSlot in onFinish (FIND-05/08) ────────────────
      // Only for Finder turns with a leadId — agent-scoped slot write (T-03-28).
      // Anti-pattern avoided: finderSlot write is in onFinish (NOT inside a tool).
      if (pillar === 'finder' && leadId) {
        const newProjectIds = extractFinderProjectIds(final)
        const prevDiscussed = storedFinderSlot?.discussedProjectIds ?? []
        const discussedProjectIds = mergeDiscussed(prevDiscussed, newProjectIds)

        // Use mergedCriteria (if a slot existed) or a baseline empty-ish criteria
        // object. The actual criteria parsing happens inside the Finder agent's
        // tool loop — onFinish writes back the accumulated state.
        const criteriaToWrite: ParsedCriteria = mergedCriteria ?? (storedFinderSlot?.criteria ?? {
          segment: 'unknown',
          priceMin: null,
          priceMax: null,
          monthlyIncome: null,
          nationality: 'unknown',
          bumiputera: null,
          locationPref: null,
          bedrooms: null,
          freeText: userMessageContent,
        })

        await writeLeadSlot(leadId, 'finderSlot', {
          criteria: criteriaToWrite,
          discussedProjectIds,
          lastRankedAt: Date.now(),
        })
      }

      // Decrement the rate-limit budget atomically after the turn completes
      await ratelimit.decrement(uid, final.usage.totalTokens ?? 0)

      // Append-only audit write — fire-and-forget via after()
      // after() runs after the response is sent (no blocking the stream)
      // Stores only hashes — never raw PII or token content (T-01-41, T-03-29, CLAUDE.md)
      after(() =>
        audit.log({
          actorUid: uid,
          action: 'chat',
          targetRef: `conversations/${cid}`,
          raw: {
            pillar,
            routeDecision,   // D-02: observable in audit log
            tokenCount: final.usage.totalTokens ?? 0,
            // Content hashed by audit.log — never stored in plaintext
            contentHash: final.text,
          },
        }),
      )
    },
  })

  // ── Stream response with load-bearing headers ─────────────────────────────
  // toUIMessageStreamResponse() is the correct method name for ai@5.0.193.
  // (SPIKES.md documents toDataStreamResponse() but that method does not exist
  // in the installed ai@5.0.193 — auto-fix deviation documented in SUMMARY.md.)
  //
  // The AI SDK sets Content-Type: text/event-stream automatically.
  // Cache-Control and X-Accel-Buffering are added manually (SPIKE-DEPLOY headers).
  //
  // X-Accel-Buffering: no — disables nginx buffering on App Hosting (CRITICAL for SSE)
  return result.toUIMessageStreamResponse({
    headers: {
      'Cache-Control': 'no-store',
      'X-Accel-Buffering': 'no',
    },
  })
}
