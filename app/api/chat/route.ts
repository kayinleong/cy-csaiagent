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
import { replyAgent } from '@/src/agents/reply'
import { modelFor } from '@/src/llm/provider'
import {
  appendMessage,
  ensurePrimaryThread,
  ensureConversationOwned,
  readFinderSlot,
  readReplySlot,
  mergeFinderCriteria,
  mergeDiscussed,
  writeLeadSlot,
} from '@/src/memory'
import { recordKnowledgeGap } from '@/src/escalation'
import { detectLang } from '@/src/i18n/detect'
import type { MessageDoc } from '@/src/firebase/collections'
import { TENANT_ID, leadsRef, agentProfilesRef } from '@/src/firebase/collections'
import type { RetrieveHit } from '@/src/agents/coach/tools'
import type { FinderSlot, ReplySlot } from '@/src/memory'
import type { ParsedCriteria } from '@/src/inventory/search'
import { recordUsageEvent } from '@/src/usage/record'
import { dayKey } from '@/src/usage/types'

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

// ─── Reply SOP doc ID extraction helper ───────────────────────────────────────

/**
 * Extract cited SOP doc IDs from the AI SDK v5 streamText onFinish payload.
 *
 * Reads the `retrieveReplySop` tool results across all steps and collects the
 * `docId` of each returned citation (found: true). These IDs are the grounding
 * trail written to the replySlot in onFinish (REPLY-09) — the SOPs the draft cited.
 *
 * Mirrors extractFinderProjectIds (Finder's project-ID extraction). If no
 * retrieveReplySop call was made, or it returned found:false (a no_sop_match miss),
 * returns []. Never throws — SOP ID extraction is best-effort (docIds are not PII).
 *
 * @param final  The onFinish payload from streamText (StepResult + steps array).
 * @returns      Array of cited SOP doc ID strings.
 */
export function extractReplySopIds(
  final: { steps?: Array<{ toolResults?: Array<{ toolName?: string; result?: unknown }> }> },
): string[] {
  try {
    const sopDocIds: string[] = []
    for (const step of final.steps ?? []) {
      for (const tr of step.toolResults ?? []) {
        if (tr.toolName === 'retrieveReplySop') {
          const r = tr.result as
            | { found: boolean; citations?: Array<{ docId: string }> }
            | null
            | undefined
          if (r && r.found === true && Array.isArray(r.citations)) {
            for (const c of r.citations) {
              if (c.docId) sopDocIds.push(c.docId)
            }
          }
        }
      }
    }
    return sopDocIds
  } catch {
    // Never let extraction fail the request
    return []
  }
}

// ─── Reply no_sop_match detection helper ──────────────────────────────────────

/**
 * Detect whether a Reply turn resolved to a `no_sop_match` (D-11 kb-miss).
 *
 * Reads the `retrieveReplySop` tool results across all steps: a miss is `found:false`
 * with `reason:'no_sop_match'`. When the SOP retrieval missed, the Reply agent emits a
 * grounded refusal (never a fabricated draft) — and the route records a PDPA-safe
 * knowledgeGaps row so Derek sees the SOP gap on the dashboard.
 *
 * Returns true only when at least one retrieveReplySop call missed AND no later call
 * in the same turn found a SOP (a found hit anywhere means the turn grounded a draft —
 * not a gap). Never throws — best-effort detection (no PII inspected).
 *
 * @param final  The onFinish payload from streamText (StepResult + steps array).
 * @returns      true if the reply turn resolved to no_sop_match (no grounding hit).
 */
export function replyHadNoSopMatch(
  final: { steps?: Array<{ toolResults?: Array<{ toolName?: string; result?: unknown }> }> },
): boolean {
  try {
    let sawMiss = false
    let sawHit = false
    for (const step of final.steps ?? []) {
      for (const tr of step.toolResults ?? []) {
        if (tr.toolName === 'retrieveReplySop') {
          const r = tr.result as { found?: boolean; reason?: string } | null | undefined
          if (r && r.found === true) sawHit = true
          if (r && r.found === false && r.reason === 'no_sop_match') sawMiss = true
        }
      }
    }
    // A hit anywhere in the turn means the draft was grounded — not a gap.
    return sawMiss && !sawHit
  } catch {
    return false
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
  let override: 'coach' | 'finder' | 'reply' | undefined
  let leadId: string | undefined
  try {
    const body = await req.json() as {
      messages?: Array<{ role: 'user' | 'assistant'; content: string }>
      cid?: string
      langOverride?: 'en' | 'ms' | 'zh'
      override?: 'coach' | 'finder' | 'reply'
      leadId?: string
    }
    messages = body.messages ?? []
    // langOverride: manual pin from the language-override chip (CHAT-08)
    // Only accept valid locales — discard anything else for security (T-02-12)
    langOverride = (['en', 'ms', 'zh'] as const).includes(body.langOverride as 'en' | 'ms' | 'zh')
      ? (body.langOverride as 'en' | 'ms' | 'zh')
      : undefined
    // override: manual pillar chip from the UI — validated against enum (T-03-28)
    // Only accept 'coach', 'finder', or 'reply' — invalid values are ignored for security.
    // The allow-list widens for the Reply pillar (Plan 04-06); the invalid→undefined
    // coercion is PRESERVED exactly (an injected 'admin'/garbage override still drops).
    override = (['coach', 'finder', 'reply'] as const).includes(body.override as 'coach' | 'finder' | 'reply')
      ? (body.override as 'coach' | 'finder' | 'reply')
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

  // Resolve the conversation thread (quick-033 — separate sessions).
  //   - No cid → the stable primary thread coach-${uid} (D-01 / Pitfall 2 fix).
  //   - A client-supplied cid identifies a specific session (a NEW chat or history
  //     navigation): ensureConversationOwned creates the doc for a brand-new session
  //     (so it is listable + its messages are client-readable) and verifies ownership,
  //     falling back to the primary thread if the cid belongs to another agent.
  if (!cid) {
    cid = await ensurePrimaryThread(uid, userLang)
  } else {
    cid = await ensureConversationOwned(uid, cid, userLang, 'coach', lastUserMessage?.content)
  }

  // ── GATE 3: PDPA pseudonymization + assertRedacted ──────────────────────────
  // Pseudonymize any PII in the message content BEFORE the prompt leaves the server.
  // assertRedacted() THROWS PdpaViolationError if pdpa_redacted !== true.
  // This gate is called immediately before streamText for ALL pillars (T-01-38, T-03-26).
  // Pasted lead criteria (Finder path) and pasted WhatsApp inbounds (Reply path) may
  // contain PII — the gate applies equally.
  //
  // Lead-name injection (Plan 04-06, RESEARCH §Q3 / T-04-PDPA-route): read the lead's
  // known name from the lead record whenever a leadId is present, and pass it as
  // knownNames so replaceNames actually fires (closing the previously-empty `names: []`
  // hook). This is done defensively for ANY pillar with a leadId (so Finder pastes are
  // covered too), since routeAsync (GATE 4) runs AFTER this gate — the pillar is not yet
  // known here. Combined with the Wave-1 IC/email/RM-financial regexes, this tokenizes a
  // pasted lead name before the cross-border model call. Best-effort: a lead-read failure
  // must NOT crash the request — the gate still runs with whatever names were resolved.
  const knownNames: string[] = []
  if (leadId) {
    try {
      const leadSnap = await leadsRef().doc(leadId).get()
      const leadName = leadSnap.data()?.name
      if (leadName) knownNames.push(leadName)
    } catch {
      // Lead-read failure never blocks the gate — knownNames stays as-is (no PII leak;
      // the request proceeds with phone/IC/email/financial regex coverage still active).
    }
  }
  const { redacted, pdpa_redacted } = pseudonymize(
    {
      messages: messages as Array<{ role: string; content: string }>,
    },
    knownNames,
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

  // ── Required-leadId fail-closed for the Reply pillar (D-07, T-04-BLEED-route) ─
  // A Reply turn drafts in the context of ONE specific lead. Drafting against the
  // wrong (or absent) lead is the worst failure mode — a reply could leak one lead's
  // context into another's thread. The UI prevents a leadless reply, but the server
  // MUST also fail closed: return 400 BEFORE streamText so no model spend occurs.
  // Coach/Finder keep leadId optional — this gate is Reply-only.
  if (pillar === 'reply' && !leadId) {
    return new Response(JSON.stringify({ error: 'leadId required for reply' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  // Snapshot user message content before dispatch/streaming (stable reference used by
  // the Reply dispatch branch's buildSystemPrompt and by onFinish persistence).
  const userMessageContent = lastUserMessage?.content ?? ''

  // ── Persist the user message BEFORE the model call (quick-kayinleong-046) ───
  // Was inside onFinish. onFinish is invoked from the UI-message stream's
  // TransformStream `flush`, which the AI SDK SKIPS when the consumer cancels — so a
  // browser refresh mid-stream dropped the entire turn (user message included) and the
  // transcript came back empty. The user's message is a fact the moment it passes the
  // gates, and it does not depend on the model succeeding, so it is written here.
  //
  // Tradeoff accepted: a turn whose model call then fails leaves a user message with no
  // assistant reply. That is honest (they did send it), the PDPA erasure sweep already
  // walks this subcollection, and stall-detect tolerates it. See the claim's Regression
  // Report.
  await appendMessage(cid, {
    tenantId: TENANT_ID,
    role: 'user',
    content: userMessageContent,
    citations: [],
    routeDecision, // D-02: pillar:reason on every message
    tokens: 0, // user turns have no model token cost
    redacted: true, // PDPA gate (GATE 3) already ran
  } satisfies MessageDoc)

  // ── Grounding signal for the client (quick-kayinleong-046) ──────────────────
  // Accumulated across steps because messageMetadata's `finish` part does not carry the
  // step history. The Coach prompt no longer asks the model for a {answer,citations,
  // handoff} JSON envelope (that envelope was being streamed to the browser verbatim,
  // fence and all — defect A). The authoritative citations + kb-miss signal are derived
  // HERE from the real tool results and shipped as stream metadata, which is strictly
  // more trustworthy than asking the model to restate chunk IDs it can get wrong.
  const grounding = { citations: [] as string[], retrievalAttempted: false }

  // ── Dispatch: build agent system prompt + tools based on pillar ──────────────
  // Phase 3 adds the Finder branch alongside the existing Coach branch.
  // Phase 4 (Plan 04-06) adds the Reply branch as a third dispatch arm.
  // Each branch resolves its own system prompt, tools, and model (never hard-coded).
  let agentSystemPrompt: string
  let agentTools:
    | ReturnType<typeof coachAgent.makeTools>
    | ReturnType<typeof finderAgent.makeTools>
    | ReturnType<typeof replyAgent.makeTools>
  // finderSlotForBuild: stored finderSlot to inject into the Finder system prompt
  let storedFinderSlot: FinderSlot | null = null
  // mergedCriteria: criteria to write back to finderSlot in onFinish (FIND-08)
  let mergedCriteria: ParsedCriteria | null = null
  // storedReplySlot: stored replySlot to inject into the Reply system prompt (REPLY-03)
  let storedReplySlot: ReplySlot | null = null
  // replyClassification: inbound classification for this reply turn — written to replySlot
  let replyClassification: ReplySlot['classification'] = 'other'

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
  } else if (pillar === 'reply') {
    // Reply branch (Plan 04-06) — mirrors the Finder branch shape.
    // leadId is GUARANTEED present here (the required-leadId fail-closed gate above
    // returns 400 for a leadless reply), but we still guard the read defensively.
    if (leadId) {
      // Read the stored replySlot for per-lead reply-context recall (REPLY-03 / SC2).
      // Keyed by leadId — reading lead-B never returns lead-A content (parallel-lead
      // isolation is structural).
      storedReplySlot = await readReplySlot(leadId)
      // Carry the prior classification forward as the default for this turn; the live
      // tool loop refines it. (Offline/test path leaves it at the stored or 'other'.)
      if (storedReplySlot?.classification) {
        replyClassification = storedReplySlot.classification
      }
    }

    agentSystemPrompt = replyAgent.buildSystemPrompt({
      // The builder reads the slot for context injection only (no structural mutation).
      replySlot: storedReplySlot ? (storedReplySlot as unknown as Record<string, unknown>) : undefined,
      // Pass the current inbound so the agent can draft against it; the voice doc is
      // fetched by the fetchVoiceSamples tool during the loop (one retrieval path).
      incoming: userMessageContent,
      leadId,
    })
    agentTools = replyAgent.makeTools(userLang, uid, leadId)
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

  const result = streamText({
    model,
    system: agentSystemPrompt,
    messages: redactedMessages,
    tools: agentTools,
    // All three pillars run a multi-step tool loop and MUST be allowed to answer AFTER
    // a tool call (retrieve/search → answer), so every pillar needs at least 2 steps:
    //   - Finder: parse → search → collateral → answer.
    //   - Reply:  retrieve SOP → maybe voice → draft.
    //   - Coach:  getCurrentCheckpoint → getCheckpointContent/retrieveKnowledge → answer.
    // Bounded at 5 steps to prevent unbounded cost (T-03-30 / T-04-COST / D-05).
    // (quick-kayinleong-043: Coach was previously capped at stepCountIs(1), which halted
    //  the loop the instant it called retrieveKnowledge — so every retrieval-triggering
    //  Coach turn returned an EMPTY response. Coach is a retrieve-then-answer agent, so a
    //  1-step budget is a bug, not a default.)
    stopWhen: stepCountIs(5),
    // Track tool-derived grounding as each step lands, so the response's
    // messageMetadata can report the authoritative citations + kb-miss signal to the
    // client (quick-kayinleong-046). Bookkeeping only — never fails a turn.
    onStepFinish: (step) => {
      try {
        const toolResults = (step.toolResults ?? []) as Array<{
          toolName?: string
          result?: unknown
        }>
        for (const tr of toolResults) {
          // Any KB lookup counts as "retrieval was attempted" — that is what makes a
          // zero-citation Coach turn a genuine kb_miss rather than a chat reply.
          if (tr.toolName === 'retrieveKnowledge' || tr.toolName === 'getCheckpointContent') {
            grounding.retrievalAttempted = true
          }
        }
        grounding.citations.push(...extractCitationChunkIds({ steps: [{ toolResults }] }))
      } catch {
        // Grounding bookkeeping is best-effort — never break the stream.
      }
    },
    // Surface model/stream failures. The AI SDK reports these as an `error` chunk on a
    // 200 response, so without this they were invisible server-side too (defect RC-3).
    // Log the error only — never message content or PII (CLAUDE.md).
    onError: ({ error }) => {
      console.error('[chat] stream error', {
        pillar,
        name: error instanceof Error ? error.name : typeof error,
        message: error instanceof Error ? error.message : String(error),
      })
    },
    onFinish: async (final) => {
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

        // Wrapped (quick-kayinleong-046): writeLeadSlot uses .update(), which THROWS
        // NOT_FOUND when leadContext/{leadId} does not exist. An uncaught throw here
        // skipped everything below it in onFinish — the ratelimit decrement, the audit
        // row and the usage event — for the whole turn. A missing context doc is a data
        // problem, not a reason to lose accounting.
        try {
          await writeLeadSlot(leadId, 'finderSlot', {
            criteria: criteriaToWrite,
            discussedProjectIds,
            lastRankedAt: Date.now(),
          })
        } catch (err) {
          console.error('[chat] finderSlot write failed', {
            name: err instanceof Error ? err.name : typeof err,
          })
        }
      }

      // ── Reply: write replySlot in onFinish (REPLY-09 / D-06) ─────────────
      // Only for Reply turns with a leadId — agent-scoped, per-lead-isolated slot
      // write (T-04-BLEED-route / T-04-TOOLWRITE-route). The write happens HERE in
      // onFinish, NEVER inside a tool (Reply tools are read-only). The latestDraft
      // stored is the REDACTED model output (final.text — GATE 3 already ran).
      if (pillar === 'reply' && leadId) {
        const sopDocIds = extractReplySopIds(final)
        // Wrapped (quick-kayinleong-046) — same reason as the finderSlot write above:
        // .update() throws NOT_FOUND on a lead with no leadContext doc, which used to
        // take the rest of onFinish (ratelimit/audit/usage) down with it.
        try {
          await writeLeadSlot(leadId, 'replySlot', {
            classification: replyClassification,
            latestDraft: final.text, // already PDPA-redacted (GATE 3 ran before streamText)
            sopDocIds,
            lastDraftedAt: Date.now(),
          })
        } catch (err) {
          console.error('[chat] replySlot write failed', {
            name: err instanceof Error ? err.name : typeof err,
          })
        }

        // ── Reply no_sop_match → knowledgeGaps kb-miss write (D-11) ─────────
        // When the Reply turn resolved to no_sop_match, record a PDPA-safe gap row
        // tagged pillar:'reply' so Derek sees the SOP gap on the dashboard (ADMIN-06
        // feedback loop). Reuses the existing Coach recordKnowledgeGap primitive — the
        // Reply pillar has no escalation/handoff step, so the gap feed is the only
        // target. Written HERE in onFinish, NEVER inside a tool (T-04-TOOLWRITE-route).
        // PDPA-safe (T-04-GAP-PII): the topic passed is the ALREADY-REDACTED inbound
        // (GATE-3 pseudonymized — names/IC/email/financial already tokenized), and
        // recordKnowledgeGap further hashes/truncates it to a topicHash + short label.
        // The route never hands raw client paste content to the gap feed. Wrapped in
        // try/catch so a gap-write failure never breaks stream completion (count only).
        if (replyHadNoSopMatch(final)) {
          try {
            // seniorCoachId scopes the gap row to the agent's coach (same lookup the
            // dashboard / captureReplyEdit use). Fallback to '' on a missing profile —
            // the gap still counts; no PII is ever logged.
            const profileSnap = await agentProfilesRef().doc(uid).get()
            const seniorCoachId = profileSnap.data()?.seniorCoachId ?? ''
            // Use the REDACTED inbound as the topic descriptor (never the raw paste).
            const redactedInbound =
              (redactedMessages.filter((m) => m.role === 'user').at(-1)?.content) ?? ''
            const topic = redactedInbound.length > 0 ? redactedInbound : `reply ${replyClassification}`
            await recordKnowledgeGap({
              seniorCoachId,
              agentUid: uid,
              topic,
              lang: userLang,
              pillar: 'reply',
            })
          } catch {
            // Gap-write failure must not break the stream — swallow (no PII in logs).
          }
        }
      }

      // REGRESSION-NOTE: pre-Phase-5 :607/:522 undercount multi-step turns;
      // documented in PERF-COST.md (05-06/05-08), NOT changed here.
      // final.usage.totalTokens at :522 (messages.tokens) and here (rate-limit decrement)
      // is the LAST step only — ALL pillars now run stepCountIs(5) (quick-043 fixed Coach's
      // erroneous 1-step cap), so any multi-step turn is undercounted for the rate-limit
      // decrement. Changing this is a SEPARATE behavioral change (TOKEN_CAP=50_000)
      // requiring its own claim + Derek sign-off. (Usage CAPTURE below already uses
      // final.totalUsage — the sum across ALL steps — so usage stats stay accurate.)
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

      // D-04: usage capture — fire-and-forget, counts only, ZERO PII.
      // Rides the SAME after() path as audit.log (the single choke point).
      // Uses final.totalUsage (sum across ALL steps) — Finder/Reply run stepCountIs(5),
      // so final.usage (last step only) would undercount. final.totalUsage is correct.
      // (RESEARCH Pattern 1, Anti-Pattern: "Two usage pipelines" — this is the ONE site.)
      after(() => {
        const u = final.totalUsage // LanguageModelV2Usage: sum across all steps (ai@5)
        const cacheWrite =
          (
            final.providerMetadata?.anthropic as
              | { cacheCreationInputTokens?: number | null }
              | undefined
          )?.cacheCreationInputTokens ?? 0
        return recordUsageEvent({
          tenantId: TENANT_ID,
          uid,                                        // GATE 1: already verified
          pillar: pillar as 'coach' | 'finder' | 'reply', // GATE 4: already routed
          inputTokens: u?.inputTokens ?? 0,
          outputTokens: u?.outputTokens ?? 0,
          cachedInputTokens: u?.cachedInputTokens ?? 0,   // prompt-cache READ hit
          cacheCreationInputTokens: cacheWrite,           // prompt-cache WRITE cost
          day: dayKey(new Date()),                         // 'YYYY-MM-DD' (Asia/Kuala_Lumpur)
        })
      })
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
  // Force the stream to completion server-side even if the browser goes away
  // (quick-kayinleong-046 / RC-2). onFinish runs from the UI-message stream's
  // TransformStream `flush`, which is SKIPPED on consumer cancel — so a refresh
  // mid-stream previously lost the assistant message, the ratelimit decrement, the
  // audit row and the usage event. consumeStream() removes the backpressure so flush
  // still fires. Deliberately NOT combined with abortSignal + onAbort: only one of the
  // two may own the assistant write, or the turn gets persisted twice.
  void result.consumeStream()

  return result.toUIMessageStreamResponse({
    headers: {
      'Cache-Control': 'no-store',
      'X-Accel-Buffering': 'no',
    },
    // Tell the client which pillar actually answered, plus the grounding signal.
    // Before this, chat-input.tsx guessed the pillar from the sticky `pillarOverride`
    // chip: `undefined` in Auto mode, so no decoder ran and Finder/Reply JSON leaked
    // into the bubble (defect A); and stale after a hero-card tap, so a coaching
    // question rendered as a Finder card (defect C). The server is the only thing that
    // knows the real answer — so it says so.
    messageMetadata: ({ part }) => {
      // `start` fires before any text, so the client can pick its renderer up front.
      if (part.type === 'start') {
        return { pillar, routeDecision }
      }
      if (part.type === 'finish') {
        return {
          pillar,
          routeDecision,
          citations: Array.from(new Set(grounding.citations)),
          // A Coach turn that looked something up and came back with nothing is a real
          // KB miss (D-10). Greetings/meta questions never call a retrieval tool, so
          // they can't trip this. Replaces the old substring sniff for 'kb_miss' in the
          // raw stream text, which only worked while the JSON envelope was leaking.
          kbMiss:
            pillar === 'coach' &&
            grounding.retrievalAttempted &&
            grounding.citations.length === 0,
        }
      }
      return undefined
    },
  })
}
