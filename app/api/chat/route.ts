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
 *   3. pseudonymize + assertRedacted → 422 if PII not redacted (T-01-38)
 *   4. router.route(messages)  → always 'coach' in Phase 1
 *   5. streamText(...)         → model call (only reaches here if all gates pass)
 *   6. onFinish: appendMessage + decrement + after(() => audit.log(...))
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
 */

import { after } from 'next/server'
import { streamText } from 'ai'
import { requireUser, UnauthorizedError } from '@/src/firebase/auth'
import * as ratelimit from '@/src/ratelimit'
import { RateLimitError } from '@/src/ratelimit'
import { pseudonymize, assertRedacted, PdpaViolationError } from '@/src/audit'
import * as audit from '@/src/audit'
import { route } from '@/src/router'
import { coachAgent } from '@/src/agents/coach'
import { modelFor } from '@/src/llm/provider'
import { appendMessage } from '@/src/memory'
import { detectLang } from '@/src/i18n/detect'
import type { MessageDoc } from '@/src/firebase/collections'
import { TENANT_ID } from '@/src/firebase/collections'

// ─── Runtime configuration ────────────────────────────────────────────────────

export const runtime = 'nodejs'
export const maxDuration = 90

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
  try {
    const body = await req.json() as {
      messages?: Array<{ role: 'user' | 'assistant'; content: string }>
      cid?: string
    }
    messages = body.messages ?? []
    cid = body.cid ?? `conv-${uid}-${Date.now()}`

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

  // Detect the language of the most recent user message for RAG pre-filter
  const lastUserMessage = messages.filter((m) => m.role === 'user').at(-1)
  const userLang = lastUserMessage ? detectLang(lastUserMessage.content) : 'en'

  // ── GATE 3: PDPA pseudonymization + assertRedacted ──────────────────────────
  // Pseudonymize any PII in the message content BEFORE the prompt leaves the server.
  // assertRedacted() THROWS PdpaViolationError if pdpa_redacted !== true.
  // This gate is called immediately before streamText (T-01-38).
  const { redacted, pdpa_redacted } = pseudonymize(
    {
      messages: messages as Array<{ role: string; content: string }>,
    },
    [], // knownNames — Phase 2 will inject lead names from the leadContext doc
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

  // ── GATE 4: Route → coach ───────────────────────────────────────────────────
  // Phase 1: heuristic router always returns 'coach'.
  // The Coach is invoked THROUGH the router (not called directly — D-09).
  const { pillar } = route(
    messages.map((m) => ({ role: m.role, content: m.content })),
  )

  // Dispatch to the correct agent based on the router decision.
  // Phase 1: only coach is active. Phase 3 will add finder / reply branches.
  const agentSystemPrompt = pillar === 'coach' ? coachAgent.systemPrompt : coachAgent.systemPrompt
  const agentTools = pillar === 'coach'
    ? coachAgent.makeTools(userLang)
    : coachAgent.makeTools(userLang)

  // ── Resolve model ID from Remote Config ─────────────────────────────────────
  // modelFor() reads the model ID from Firebase Remote Config — NEVER hard-coded.
  const model = await modelFor(pillar === 'coach' ? 'coach' : 'coach')

  // ── GATE 5: streamText + onFinish ───────────────────────────────────────────
  // The model call only happens if all gates above have passed.
  // onFinish persists the message and triggers the audit write via after().
  const redactedMessages = redacted.messages as Array<{ role: 'user' | 'assistant'; content: string }>

  const result = streamText({
    model,
    system: agentSystemPrompt,
    messages: redactedMessages,
    tools: agentTools,
    onFinish: async (final) => {
      // Persist the assistant message to the subcollection
      const assistantMsg: MessageDoc = {
        tenantId: TENANT_ID,
        role: 'assistant',
        content: final.text,
        citations: [], // Phase 2: extract citations from tool results
        routeDecision: pillar,
        tokens: final.usage.totalTokens ?? 0,
        redacted: true, // PDPA gate was applied
      }

      // Persist to conversations/{cid}/messages subcollection
      await appendMessage(cid, assistantMsg)

      // Decrement the rate-limit budget atomically after the turn completes
      await ratelimit.decrement(uid, final.usage.totalTokens ?? 0)

      // Append-only audit write — fire-and-forget via after()
      // after() runs after the response is sent (no blocking the stream)
      // Stores only hashes — never raw PII or token content (T-01-41, CLAUDE.md)
      after(() =>
        audit.log({
          actorUid: uid,
          action: 'chat',
          targetRef: `conversations/${cid}`,
          raw: {
            pillar,
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
  // The AI SDK sets Content-Type: text/event-stream automatically.
  // Cache-Control and X-Accel-Buffering are added manually (SPIKE-DEPLOY headers).
  return result.toUIMessageStreamResponse({
    headers: {
      'Cache-Control': 'no-store',
      'X-Accel-Buffering': 'no',
    },
  })
}
