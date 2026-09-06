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
import { ReplyOutputSchema, LEAD_REQUIRED_ERROR } from '@/src/agents/reply/schema'
// Shared decoders — the SAME code the client renders with, so the server-side health
// check cannot drift from what the agent actually sees (quick-kayinleong-053).
import {
  attachCollateral,
  attachFinderRows,
  decodeFinderOutput,
  decodeReplyOutput,
  salvageStructuredText,
} from '@/app/[lang]/chat/decode-structured-output'
import type { FinderRow } from '@/src/agents/finder/schema'
import { modelFor } from '@/src/llm/provider'
import {
  appendMessage,
  updateMessage,
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

/**
 * Mid-generation checkpoint thresholds (quick-kayinleong-070).
 *
 * Both must be satisfied before a flush, so a fast short reply writes once at the end while
 * a long one is checkpointed a handful of times. A 3184-char Finder envelope generated over
 * ~28s costs roughly 5-8 extra updates — cheap next to losing the answer.
 */
/**
 * Ceiling on model output tokens per turn (quick-kayinleong-089).
 *
 * Explicit because the Anthropic API REQUIRES `max_tokens`, so leaving it unset does not
 * mean "unlimited" — it means whatever `@ai-sdk/anthropic` picks for the model id, and the
 * ids this project resolves from `appConfig/modelConfig` are not in the SDK's known-model
 * table. Pinning it removes that dependency on a provider default we do not control.
 *
 * ⚠ HONEST SCOPE: this was NOT the cause of the reported truncation. Measured on the live
 * model with the cap unset, a deliberately long prompt produced 9,450 output tokens and
 * finished with `stop` — so the inherited default was already generous. The value here is
 * that the budget is now stated rather than inherited, not that it fixed the bug.
 *
 * Generous on purpose: these answers carry per-unit price tables and Quick-Facts blocks
 * that are legitimately long. `@ai-sdk/anthropic` clamps this to the real per-model ceiling
 * for any model it knows, so a value above a model's limit is corrected, not rejected.
 */
const MAX_OUTPUT_TOKENS = 32_000

const FLUSH_EVERY_MS = 2000
const FLUSH_EVERY_CHARS = 600

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
/** The shape of a step's tool result, across SDK versions. */
export interface ToolResultLike {
  toolName?: string
  /** AI SDK v5 name for the tool's return value. */
  output?: unknown
  /** Pre-v5 name, still accepted so an older payload keeps working. */
  result?: unknown
  /** The tool's INPUT — typed loosely so a typed StepResult still assigns structurally. */
  input?: unknown
  args?: unknown
}

/**
 * Read a tool's return value from a step result (quick-kayinleong-071).
 *
 * **AI SDK v5 calls this field `output`; every extractor in this file read `result`.**
 * `result` is not present on a v5 `TypedToolResult` (see StaticToolResult in
 * ai/dist/index.d.ts — toolCallId, toolName, input, output), so all four extractors have
 * been silently returning nothing since the v5 upgrade:
 *   - extractCitationChunkIds  -> Coach turns carried NO citations, and because kbMiss is
 *     `retrievalAttempted && citations.length === 0`, a Coach turn that DID retrieve was
 *     still reported as a knowledge gap.
 *   - extractFinderProjectIds  -> finderSlot never recorded a discussed project.
 *   - extractReplySopIds       -> the reply grounding trail was always empty.
 * Every one of them was wrapped in try/catch and returned [] on anything unexpected, which
 * is why it never surfaced as an error.
 *
 * Falls back to `result` so nothing breaks if a payload predates v5.
 */
function toolOutput(tr: ToolResultLike): unknown {
  return tr.output !== undefined ? tr.output : tr.result
}

export function extractCitationChunkIds(
  final: { steps?: Array<{ toolResults?: Array<ToolResultLike> }> },
): string[] {
  try {
    const chunkIds: string[] = []
    for (const step of final.steps ?? []) {
      for (const tr of step.toolResults ?? []) {
        if (tr.toolName === 'retrieveKnowledge') {
          const r = toolOutput(tr) as RetrieveHit | { found: false } | null | undefined
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
  final: { steps?: Array<{ toolResults?: Array<ToolResultLike> }> },
): string[] {
  try {
    const projectIds: string[] = []
    for (const step of final.steps ?? []) {
      for (const tr of step.toolResults ?? []) {
        if (tr.toolName === 'searchProjects') {
          const r = toolOutput(tr) as { found: boolean; matches?: Array<{ projectId: string }> } | null | undefined
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
  final: { steps?: Array<{ toolResults?: Array<ToolResultLike> }> },
): string[] {
  try {
    const sopDocIds: string[] = []
    for (const step of final.steps ?? []) {
      for (const tr of step.toolResults ?? []) {
        if (tr.toolName === 'retrieveReplySop') {
          const r = toolOutput(tr) as
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
  final: { steps?: Array<{ toolResults?: Array<ToolResultLike> }> },
): boolean {
  try {
    let sawMiss = false
    let sawHit = false
    for (const step of final.steps ?? []) {
      for (const tr of step.toolResults ?? []) {
        if (tr.toolName === 'retrieveReplySop') {
          const r = toolOutput(tr) as { found?: boolean; reason?: string } | null | undefined
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

// ─── Reply "agent concluded a real SOP gap" helper ────────────────────────────

/**
 * Did the Reply agent itself conclude this was a genuine SOP gap?
 *
 * quick-kayinleong-047. `replyHadNoSopMatch` above reads the TOOL result, which answers
 * a different question: "did retrieveReplySop miss?" Those diverge whenever the turn was
 * never a client inbound at all. Typing "hi" with the Reply chip pinned made the agent
 * search for a greeting SOP, miss, and the route recorded a `knowledgeGaps` row with the
 * topic "hi" — polluting the very feed that is supposed to tell the senior coach which
 * SOPs to write. The more anyone tested Reply, the worse that signal got.
 *
 * A knowledge gap is only real when the AGENT decided it lacked an SOP for a genuine
 * client message. The Reply agent signals that by emitting `noSopMatch` in its output;
 * for a non-inbound it now emits `clarifyingQuestion` instead (src/agents/reply/prompt.ts
 * "Not an inbound message"). So gate the gap write on the agent's own conclusion.
 *
 * Fails CLOSED (returns false) when the output cannot be parsed: a malformed turn is not
 * evidence of a missing SOP, and a missed gap row is far cheaper than a false one.
 */
export function replyAgentReportedSopGap(final: { text?: string }): boolean {
  try {
    const text = final.text
    if (typeof text !== 'string' || text.trim().length === 0) return false

    const unfenced = text
      .trim()
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/, '')
      .trim()

    const first = unfenced.indexOf('{')
    const last = unfenced.lastIndexOf('}')
    const candidates = [unfenced]
    if (first !== -1 && last > first) candidates.push(unfenced.slice(first, last + 1))

    for (const candidate of candidates) {
      let parsed: unknown
      try {
        parsed = JSON.parse(candidate)
      } catch {
        continue
      }
      const result = ReplyOutputSchema.safeParse(parsed)
      if (!result.success) continue
      // A clarifyingQuestion turn is the agent asking for the client's message — not a gap.
      if (result.data.clarifyingQuestion) return false
      return result.data.noSopMatch?.reason === 'no_sop_match'
    }
    return false
  } catch {
    return false
  }
}

// ─── Full-turn text helper ────────────────────────────────────────────────────

/**
 * Reassemble the COMPLETE assistant text for a turn (quick-kayinleong-050).
 *
 * `onFinish`'s `final.text` is the LAST STEP's text only, not the whole turn — the AI SDK
 * builds the payload as `const finalStep = recordedSteps[recordedSteps.length - 1]` and
 * passes `finalStep.text` (ai@5.0.193, dist/index.mjs:4822-4824; the type doc at
 * index.d.ts:2060 says "generated by the last step").
 *
 * Every pillar runs a multi-step tool loop (`stopWhen: stepCountIs(5)`), and a turn that
 * writes text, calls a tool, then writes more text produces TWO text blocks. quick-048
 * shipped TEXT_BLOCK_SEPARATOR precisely because those two blocks were welding together
 * in the client — so multi-block turns provably happen.
 *
 * The client accumulates every block, so the message looked complete while it streamed;
 * only the PERSISTED copy lost its opening. That is the reported "some part of the
 * response is truncated" — and why the reporter could not tell whether it was a UI or a
 * backend problem. It is neither: it is what we wrote down.
 *
 * Joined with a blank line to match the client's TEXT_BLOCK_SEPARATOR, so a reloaded
 * transcript reads identically to the live one.
 */
export function fullTurnText(final: {
  text?: string
  steps?: Array<{ text?: string }>
}): string {
  const parts = (final.steps ?? [])
    .map((s) => s.text)
    .filter((t): t is string => typeof t === 'string' && t.length > 0)

  // No steps recorded (or none carried text) — fall back to the last-step text rather
  // than persisting an empty message.
  if (parts.length === 0) return final.text ?? ''

  return parts.join('\n\n')
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
    return new Response(JSON.stringify({ error: LEAD_REQUIRED_ERROR }), {
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

  /**
   * projectId -> the collateral the TOOLS returned for it (quick-kayinleong-071).
   *
   * The model used to transcribe these URLs into its own output and picked a different
   * subset every time — 19, then 10, then 9 across three identical queries. This is the
   * deterministic list, derived from the tool results exactly as `grounding.citations` is,
   * and it is what the client and the persisted transcript both use.
   */
  const collateralByProject: Record<string, Array<{ type: string; url: string }>> = {}

  /**
   * The COMPLETE Finder result table for this turn (quick-kayinleong-085).
   *
   * Filled by the searchProjects tool, which is constructed per request — so this is
   * request-scoped and cannot leak between conversations. Read twice: once into
   * `messageMetadata` for the live turn, and once in `doPersistAssistant` so a reloaded
   * thread still has a table. The model never sees this array; `toModelOutput` bounds its
   * view at MAX_MATCHES.
   */
  const finderRowSink = { rows: [] as FinderRow[] }
  /**
   * finishReason of the completed turn, captured for the CLIENT (quick-kayinleong-089).
   *
   * onFinish already logs a non-'stop' reason, which only ever helped someone reading
   * server logs. The person who needs it is the agent looking at a price table that
   * stopped mid-row: a truncated JSON envelope fails to decode, the UI falls back to the
   * salvaged prose, and a broken turn is indistinguishable from a complete one.
   *
   * Read defensively at the emit site: whichever of onFinish / the finish part lands
   * first, the flag is correct.
   */
  let lastFinishReason: string | null = null

  // ── Guaranteed assistant-message persistence (quick-kayinleong-055) ─────────
  // onFinish used to be the ONLY path that wrote an assistant message, so any turn that
  // errored or aborted saved the user's question and nothing else. Measured: 19 lost
  // responses across 26% of conversations — the agent revisits a chat and sees their own
  // messages with no replies. quick-046's RC-3 fix renders an error bubble CLIENT-side,
  // which made this worse to diagnose: something appeared at the time, then vanished.
  //
  // Text is accumulated per step so a failed turn can still persist what the model
  // actually produced. `persisted` makes the write idempotent — whichever callback fires
  // first wins and the rest are no-ops, which is what quick-046 was rightly worried about
  // when it declined to pair consumeStream() with onAbort.
  /**
   * How a turn ended, recorded in routeDecision (D-02) so an incomplete transcript is
   * honest without showing the agent scaffolding. 'partial' is written at every step
   * boundary and replaced by 'ok' if the turn finishes; a row still marked ':partial'
   * means the process died mid-turn (quick-kayinleong-061).
   */
  type AssistantOutcome = 'ok' | 'error' | 'aborted' | 'partial'

  const turnText: string[] = []

  /**
   * Text streamed so far in the CURRENT step, and the checkpoint bookkeeping that decides
   * when to flush it (quick-kayinleong-070).
   *
   * Step-boundary writes (quick-061/063) cannot save a Finder turn. Measured on a real
   * 34.2s turn: the assistant row's createTime and updateTime were 95ms apart — both at
   * the very end. Finder's step sequence is searchProjects (no text, the quick-048
   * anti-narration rule forbids it) -> fetchCollateral (no text) -> the whole JSON envelope.
   * EVERY character arrives in the final step, so there is nothing to checkpoint until
   * generation has already finished. That is why Coach never lost a reply and Finder always
   * did: not speed, but one late burst.
   */
  let liveText = ''
  let lastFlushAt = Date.now()
  let lastFlushLen = 0

  /** Message id once a reply HAS been written. Null means nothing is on disk yet. */
  let persistedMid: string | null = null
  /** Length of the text on disk, so a fuller version can replace a partial one. */
  let persistedLen = 0
  /** Outcome recorded on the row, so a mid-flight ':partial' can be finalised. */
  let persistedOutcome: AssistantOutcome | null = null
  /**
   * Serialises every call. onAbort/onError/onFinish are independent callbacks and two can
   * be in flight at once; without this the check-then-write below is a race that appends
   * the reply twice.
   */
  let writeChain: Promise<void> = Promise.resolve()

  async function doPersistAssistant(
    text: string,
    outcome: AssistantOutcome,
    extra?: { citations?: string[]; tokens?: number },
  ): Promise<void> {
    let body = text.trim()

    // Attach the server's collateral to whatever is being stored, INCLUDING a
    // mid-generation checkpoint (quick-kayinleong-072). quick-071 did this only in
    // onFinish, so a turn killed before it finished stored an envelope with no files at
    // all — worse than before 071, when the model had at least transcribed some.
    //
    // quick-056's repair means a truncated envelope usually still decodes, so the stored
    // partial comes out as complete, enriched JSON. Best-effort: if it does not decode, the
    // raw text is stored exactly as before.
    //
    // quick-kayinleong-085 widens the condition to fire when EITHER collateral or rows
    // exist, and attaches both. This is load-bearing, not tidiness: `messageMetadata` only
    // fires on `start` and `finish` (see the note at the messageMetadata callback), so a
    // truncated turn's rows must already be in the persisted row or a reloaded thread
    // renders an empty table and falls back to the cards.
    if (
      pillar === 'finder' &&
      body.length > 0 &&
      (Object.keys(collateralByProject).length > 0 || finderRowSink.rows.length > 0)
    ) {
      try {
        const decoded = decodeFinderOutput(body)
        if (decoded && decoded.matches.length > 0) {
          body = JSON.stringify(
            attachFinderRows(attachCollateral(decoded, collateralByProject), finderRowSink.rows),
          )
        }
      } catch {
        // Never lose a reply over formatting.
      }
    }

    // Nothing was generated. Recording an empty bubble would be worse than recording
    // nothing — it reads as the assistant having answered with silence.
    //
    // CRITICALLY, this does NOT latch (quick-kayinleong-057). The 055 version set its
    // `persisted` flag BEFORE this check, so an early callback carrying no text claimed
    // the write and then refused the completed turn that arrived after it — the exact
    // "revisit and the reply is gone" the flag was added to prevent.
    if (body.length === 0) {
      // 'partial' fires at every step boundary, and a tool-only step legitimately has no
      // text — warning there would be noise on every healthy Finder turn.
      if (outcome !== 'ok' && outcome !== 'partial') {
        console.warn('[chat] turn produced no text; nothing persisted', { pillar, outcome })
      }
      return
    }

    // Already have this much (or more) on disk — a partial must never overwrite a fuller
    // reply, and the same text must never be appended twice.
    //
    // One exception: a row still marked ':partial' must be finalised even when the text did
    // not grow, or a turn that ended on its last step would stay flagged as interrupted
    // forever (and an errored turn would lose its ':error'). Terminal-to-terminal is NOT an
    // exception — that is the shorter-onFinish case, which must not truncate the row.
    const finalisesPartial = persistedOutcome === 'partial' && outcome !== 'partial'
    if (persistedMid !== null && body.length <= persistedLen && !finalisesPartial) return

    const doc = {
      tenantId: TENANT_ID,
      role: 'assistant',
      content: body,
      // MessageDoc.citations is a string[] of chunk IDs (not {chunkId} objects).
      citations:
        extra?.citations ??
        (pillar === 'coach' ? Array.from(new Set(grounding.citations)) : []),
      // Mark an incomplete turn in the observable routeDecision (D-02) rather than in
      // the content, so the agent is not shown scaffolding but the transcript is honest.
      routeDecision: outcome === 'ok' ? routeDecision : `${routeDecision}:${outcome}`,
      tokens: extra?.tokens ?? 0,
      redacted: true,
    } satisfies MessageDoc

    try {
      if (persistedMid === null) {
        persistedMid = await appendMessage(cid, doc)
      } else {
        // A partial landed first and the turn recovered. Upgrade it in place rather than
        // appending a second bubble; createdAt is untouched so it keeps its position.
        await updateMessage(cid, persistedMid, doc)
      }
      persistedLen = body.length
      persistedOutcome = outcome
    } catch (err) {
      console.error('[chat] assistant message write FAILED', {
        pillar,
        outcome,
        upgrade: persistedMid !== null,
        name: err instanceof Error ? err.name : typeof err,
      })
    }
  }

  function persistAssistantOnce(
    text: string,
    outcome: AssistantOutcome,
    extra?: { citations?: string[]; tokens?: number },
  ): Promise<void> {
    writeChain = writeChain.then(() => doPersistAssistant(text, outcome, extra))
    return writeChain
  }

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
    agentTools = finderAgent.makeTools(userLang, uid, leadId, finderRowSink)
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
    // Raised 5 -> 12 (quick-kayinleong-089).
    //
    // onFinish above already warns that exhausting this budget finishes a turn as
    // 'tool-calls' rather than 'stop', "meaning the model was cut off mid-loop and never
    // wrote its closing text". That is precisely the reported symptom: a detail answer
    // stopping mid-table.
    //
    // 5 was sized when the Finder had three tools. quick-088 added a fourth
    // (`projectDetail`), so a single detail request can now spend steps on searchProjects
    // -> projectDetail -> fetchCollateral before it has written a word of the answer,
    // leaving almost no budget for a reply that carries a full unit-price table.
    //
    // This also explains the Finder rendering CARDS instead of the result table, which
    // looked like a separate defect: the complete row set reaches the client on
    // `messageMetadata`, and the AI SDK emits that only on `start` and `finish`. A turn
    // that halts on step exhaustion never emits `finish`, so `finderRows` never arrives,
    // `rows` stays empty, and MatchList falls back to the cards BY DESIGN. The rows are
    // still attached to the PERSISTED envelope, which is why a reloaded thread shows the
    // table and the live turn did not — the table was never broken, the turn was.
    //
    // Cost is still bounded, just less tightly. The original 5 was chosen to prevent
    // unbounded cost (T-03-30 / T-04-COST / D-05), and 12 keeps a hard ceiling while
    // leaving room for a four-tool answer. Revisit if a pillar grows more tools again.
    stopWhen: stepCountIs(12),
    // Output budget, stated rather than inherited — see MAX_OUTPUT_TOKENS.
    maxOutputTokens: MAX_OUTPUT_TOKENS,
    // Track tool-derived grounding as each step lands, so the response's
    // messageMetadata can report the authoritative citations + kb-miss signal to the
    // client (quick-kayinleong-046). Bookkeeping only — never fails a turn.
    // NO abortSignal here, deliberately (quick-kayinleong-057). 055 passed req.signal so a
    // client that goes away mid-stream would fire onAbort — but that CANCELS the model
    // call, which is the exact thing consumeStream() below exists to prevent. 046 chose
    // finish-the-turn-and-save-it; 055 silently reversed that and turned every refresh
    // into a lost reply. Losing the answer costs the agent more than finishing a turn
    // nobody is watching costs in tokens.
    //
    // onAbort is kept as a net for an abort from any OTHER source, and now writes through
    // the non-latching writer, so a partial it saves is upgraded by onFinish.
    onAbort: () => {
      console.warn('[chat] turn aborted', { pillar, steps: turnText.length })
      after(() => persistAssistantOnce(turnText.join('\n\n'), 'aborted'))
    },
    // Checkpoint the reply WHILE it is being generated (quick-kayinleong-070).
    //
    // Awaited deliberately: the SDK documents that "the stream processing will pause until
    // the callback promise is resolved", which is the same guarantee that made quick-063's
    // onStepFinish write survive. A floating write here would be dropped on teardown.
    //
    // Throttled so a long reply costs a handful of writes, not one per token: flush when at
    // least FLUSH_EVERY_MS has passed AND at least FLUSH_EVERY_CHARS of new text exists.
    // The writer is upgrade-only, so a flush that adds nothing is a no-op.
    onChunk: async ({ chunk }) => {
      if (chunk.type !== 'text-delta') return
      liveText += chunk.text

      const grown = liveText.length - lastFlushLen
      if (grown < FLUSH_EVERY_CHARS) return
      if (Date.now() - lastFlushAt < FLUSH_EVERY_MS) return

      lastFlushAt = Date.now()
      lastFlushLen = liveText.length
      await persistAssistantOnce([...turnText, liveText].join('\n\n'), 'partial')
    },
    onStepFinish: async (step) => {
      try {
        const toolResults = (step.toolResults ?? []) as ToolResultLike[]
        for (const tr of toolResults) {
          // Any KB lookup counts as "retrieval was attempted" — that is what makes a
          // zero-citation Coach turn a genuine kb_miss rather than a chat reply.
          if (tr.toolName === 'retrieveKnowledge' || tr.toolName === 'getCheckpointContent') {
            grounding.retrievalAttempted = true
          }
        }
        grounding.citations.push(...extractCitationChunkIds({ steps: [{ toolResults }] }))

        // Harvest collateral from the tool results (quick-071). searchProjects attaches it
        // inline per match (quick-067); fetchCollateral returns a bare array for one project.
        for (const tr of toolResults) {
          if (tr.toolName === 'searchProjects') {
            const matches = (toolOutput(tr) as { matches?: Array<{ projectId?: string; collateral?: Array<{ type: string; url: string }> }> })?.matches
            for (const m of matches ?? []) {
              if (m?.projectId && m.collateral?.length) collateralByProject[m.projectId] = m.collateral
            }
          } else if (tr.toolName === 'fetchCollateral') {
            // The projectId is on the CALL, not the result.
            const call = (tr.input ?? tr.args) as { projectId?: string } | undefined
            const pid = call?.projectId
            const items = toolOutput(tr) as Array<{ type: string; url: string }> | undefined
            if (pid && Array.isArray(items) && items.length > 0) collateralByProject[pid] = items
          }
        }
        // Keep the text per step so onError/onAbort can persist a partial turn
        // (quick-055). onFinish still assembles the authoritative copy via fullTurnText.
        const stepText = (step as { text?: unknown }).text
        if (typeof stepText === 'string' && stepText.length > 0) turnText.push(stepText)
      } catch {
        // Grounding bookkeeping is best-effort — never break the stream.
      }

      // The step's text is now in turnText, so start the live buffer fresh for the next
      // step. Without this the final step's text would be counted twice (quick-070).
      liveText = ''
      lastFlushLen = 0

      // Persist what exists SO FAR, at every step boundary (quick-kayinleong-061).
      //
      // Measured: 25 lost replies, ALL of them Finder, and usageEvents (written at the end
      // of onFinish) matches the stored assistant count — so onFinish never ran. No
      // :error and no :aborted markers either, so onError and onAbort did not run. When no
      // callback fires at all the process is being killed, and no amount of callback
      // plumbing can save the turn: the text has to already be on disk.
      //
      // AWAITED, not fire-and-forget (quick-kayinleong-063). The AI SDK awaits this
      // callback — `await onStepFinish(currentStepResult)` in ai/dist/index.mjs — so
      // awaiting here puts the write INSIDE the stream's own lifecycle, while the
      // invocation is provably alive.
      //
      // That distinction is the whole bug. A Finder turn the user watched render a
      // complete card left the user message (awaited in the request path) and NOTHING
      // else: no usageEvent, no assistant row, not even the ':partial' quick-061 was
      // supposed to leave. Every write that was a floating promise inside an SDK callback
      // was dropped when the serverless invocation ended at response close. `after()` is
      // no better here — it is explicitly post-response.
      //
      // Costs one Firestore write per step (<=5, bounded by stopWhen) on a turn that
      // already runs for seconds. Cheap next to losing the answer.
      await persistAssistantOnce(turnText.join('\n\n'), 'partial')
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
      // Persist whatever the model produced before it failed (quick-055). onFinish does
      // NOT run on this path, so without this the turn vanishes from the transcript
      // entirely — the agent sees an error bubble live, then nothing on revisit.
      // after() rather than a bare floating promise: the response may already be closing,
      // and an unawaited write is not guaranteed to survive teardown (quick-057).
      after(() => persistAssistantOnce(turnText.join('\n\n'), 'error'))
    },
    onFinish: async (final) => {
      // A turn that halts because it exhausted `stopWhen: stepCountIs(5)` finishes with
      // 'tool-calls' rather than 'stop', meaning the model was cut off mid-loop and never
      // wrote its closing text. The SDK reports it; nothing here read it, which made that
      // failure mode unfalsifiable. Counts only, no content (quick-050).
      lastFinishReason = final.finishReason ?? null
      if (final.finishReason && final.finishReason !== 'stop') {
        console.warn('[chat] turn did not finish cleanly', {
          pillar,
          finishReason: final.finishReason,
          steps: final.steps?.length ?? 0,
        })
      }

      // ── Extract citation chunk IDs from tool results (Coach path) ─────────
      // AI SDK v5 exposes tool results on the finish payload via `steps[*].toolResults`.
      // For the Coach path: map retrieveKnowledge tool results into citationIds.
      // For the Finder path: citations come from projectIds (separate extraction below).
      const citationIds = pillar === 'coach' ? extractCitationChunkIds(final) : []

      // ── Structured-output health check (quick-kayinleong-053) ─────────────
      // The agent asked for a guardrail that runs in real time. This is the observability
      // half: assert server-side that a Finder/Reply turn actually produced output the
      // client can render, and say so loudly when it does not.
      //
      // Why it matters: the model emitted a COMPLETE, well-formed envelope whose
      // `collateral` was an object of arrays instead of the schema's array of {type,url}.
      // zod rejected it, the decoder returned null, and the raw JSON reached the agent —
      // with nothing anywhere recording that it had happened. Drift was invisible, so it
      // could only be found by a user screenshotting it.
      //
      // Counts and flags only — never message content (CLAUDE.md).
      if (pillar === 'finder' || pillar === 'reply') {
        try {
          const text = fullTurnText(final)
          const decoded =
            pillar === 'finder' ? decodeFinderOutput(text) : decodeReplyOutput(text)
          if (!decoded) {
            console.warn('[chat] structured output did NOT decode', {
              pillar,
              routeDecision,
              length: text.length,
              startsWithBrace: text.trimStart().startsWith('{'),
              hasBrace: text.includes('{'),
              // A prose prefix means the model narrated despite the prompt rule.
              narrated: text.includes('{') && !text.trimStart().startsWith('{'),
              salvageable: salvageStructuredText(text) !== null,
            })
          }
        } catch {
          // Health check must never break a turn.
        }
      }

      // ── Persist the assistant message ────────────────────────────────────
      // Routed through the same idempotent writer as onError/onAbort (quick-055) so the
      // message lands exactly once no matter which callback fires first. The normal path
      // still uses fullTurnText(final) — the authoritative assembly (quick-050) — and the
      // real token count.
      // One writer for all three callbacks (quick-kayinleong-057). 055 left onFinish with
      // its own copy of the guard, which is how the empty-latch bug came to exist in two
      // places at once. This call still supplies the authoritative assembly
      // (fullTurnText — quick-050), the real citations and the real token count; the
      // writer upgrades a partial row in place if onAbort/onError got there first.
      // Enrichment now lives in the writer (quick-kayinleong-072) so that every checkpoint
      // gets it, not just this one.
      await persistAssistantOnce(fullTurnText(final), 'ok', {
        citations: citationIds, // real KB chunk IDs (coach) or [] (finder)
        tokens: final.usage.totalTokens ?? 0,
      })

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
            // Full turn (quick-050): a truncated draft here silently degraded Reply's
            // cross-turn memory, since this is what the next turn reads back.
            latestDraft: fullTurnText(final), // already PDPA-redacted (GATE 3 ran pre-stream)
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
        // BOTH must hold (quick-kayinleong-047): the tool missed AND the agent itself
        // concluded a real SOP gap. The tool alone fired for greetings and coach
        // questions typed with the Reply chip pinned, recording false gaps.
        if (replyHadNoSopMatch(final) && replyAgentReportedSopGap(final)) {
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
      // decrement. Changing this is a SEPARATE behavioral change (TOKEN_CAP is now 300_000,
      // raised in quick-050; this undercount was deliberately NOT fixed alongside it)
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
            contentHash: fullTurnText(final), // full turn (quick-050) — hashing one block misrepresents the turn
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
      // Tried and removed (quick-kayinleong-072): emitting the collateral on 'finish-step',
      // which is the earliest point it is known. The SDK does NOT call this on step
      // boundaries — its own comment says "Called on `start` and `finish` events" and a live
      // test confirmed no metadata arrived before the kill. So a truncated turn cannot get
      // the map this way; the client reloads the persisted row instead.
      if (part.type === 'finish') {
        return {
          pillar,
          routeDecision,
          // Tell the CLIENT the turn was cut off (quick-kayinleong-089). onFinish already
          // logs this server-side, which helped nobody looking at the screen: a truncated
          // JSON envelope fails to decode, so the UI renders the salvaged prose and a
          // half-written price table is indistinguishable from a complete one.
          truncated: (() => {
            const fromPart = (part as { finishReason?: unknown }).finishReason
            const reason = typeof fromPart === 'string' ? fromPart : lastFinishReason
            return reason !== null && reason !== undefined && reason !== 'stop'
          })(),
          citations: Array.from(new Set(grounding.citations)),
          // A Coach turn that looked something up and came back with nothing is a real
          // KB miss (D-10). Greetings/meta questions never call a retrieval tool, so
          // they can't trip this. Replaces the old substring sniff for 'kb_miss' in the
          // raw stream text, which only worked while the JSON envelope was leaking.
          kbMiss:
            pillar === 'coach' &&
            grounding.retrievalAttempted &&
            grounding.citations.length === 0,
          // The authoritative collateral, keyed by projectId (quick-071). The client merges
          // this into the decoded matches instead of trusting what the model wrote out.
          collateralByProject:
            pillar === 'finder' && Object.keys(collateralByProject).length > 0
              ? collateralByProject
              : undefined,
          // The COMPLETE result table, derived from the tool result rather than from what
          // the model chose to retype (quick-085). Same argument as collateralByProject
          // above; the model only ever saw MAX_MATCHES of these.
          finderRows:
            pillar === 'finder' && finderRowSink.rows.length > 0
              ? finderRowSink.rows
              : undefined,
        }
      }
      return undefined
    },
  })
}
