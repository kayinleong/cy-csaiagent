/**
 * src/agents/reply/reply.test.ts — Reply agent RED tests (Wave 0, REPLY-02/03/05/06/07/11).
 *
 * Mirrors src/agents/finder/finder.test.ts: exercises the offline `run()` path with an
 * INJECTED SOP-retrieval result so the hit / no_sop_match / clarifying gates are
 * unit-testable without Firestore. The XOR invariant (draft XOR noSopMatch XOR
 * clarifyingQuestion) is enforced at the app level (RESEARCH Q1 / Pattern 4).
 *
 * STATUS: RED — `@/src/agents/reply` does not exist until Plan 04-05. Every test
 * dynamically imports the module inside an `it.fails` block, so the module-not-found
 * failure keeps the offline suite GREEN (exit 0) while documenting the contract.
 * When 04-05 lands `src/agents/reply/{index,prompt,schema,tools}.ts`, the imports
 * resolve, the assertions pass, and `it.fails` flips to a failure — the implementer
 * then removes `.fails` and wires the real mocks (mirror finder.test.ts hoisted mocks).
 *
 * Contract the reply agent MUST satisfy (RESEARCH Q1, Pattern 1/2/4; CONTEXT D-01/D-11):
 *   - replyAgent.run({ injectedSopResult: <hit> }) → output.draft with non-empty sopDocIds
 *   - replyAgent.run({ injectedSopResult: <miss> }) → output.noSopMatch (grounded refusal,
 *     NEVER a fabricated draft) — mirrors Finder's no_match refusal + Coach's kb_miss
 *   - ambiguous inbound → output.clarifyingQuestion
 *   - per-classification: cold-prospect / objection / financing draft shapes
 *   - ReplyOutputSchema.parse enforces the XOR invariant
 *   - NO Firestore write in any tool execute() (read-only tools; Pitfall 23/36)
 *   - parallel-lead isolation (REPLY-03 / SC2): Lead B's draft never contains Lead A content
 *
 * Synthetic data only — no real PII.
 *
 * Core/shell rule: this file must NOT import from app/ or next.
 */

import { describe, it, expect } from 'vitest'

// ─── Fixtures (synthetic, no PII) ─────────────────────────────────────────────

const SOP_HIT = {
  found: true,
  citations: [{ docId: 'sop-cold-001', snippet: 'Cold-prospect qualifying questions framework.' }],
  context: '[SOP:sop-cold-001]\nAsk qualifying questions before pitching: budget, timeline, area.',
}

const SOP_MISS = { found: false, reason: 'no_sop_match' as const }

const baseRunArgs = {
  userLang: 'en' as const,
  agentUid: 'uid-reply-test-001',
  leadId: 'lead-reply-001',
}

// ─── Test 1: hit → grounded draft citing SOP IDs (REPLY-02/05) ────────────────

describe('Reply agent: hit → grounded draft (REPLY-02, RED until Plan 04-05)', () => {
  it('run({ injectedSopResult: <hit> }) returns a draft with non-empty sopDocIds', async () => {
    const { replyAgent } = await import('@/src/agents/reply')
    const result = await replyAgent.run({
      ...baseRunArgs,
      messages: [{ role: 'user', content: 'lead said: "interested in Cheras, what do you have?"' }],
      classification: 'cold-prospect',
      injectedSopResult: SOP_HIT,
    })

    expect(result.output.draft).toBeDefined()
    expect(result.output.draft?.text.length).toBeGreaterThan(0)
    expect(Array.isArray(result.output.draft?.sopDocIds)).toBe(true)
    expect(result.output.draft?.sopDocIds.length).toBeGreaterThan(0)
    // Grounding: the cited SOP ID is a REAL id from the injected result, never invented
    expect(result.output.draft?.sopDocIds).toContain('sop-cold-001')
    // XOR: no refusal / clarifying when a draft is present
    expect(result.output.noSopMatch).toBeUndefined()
  })

  it('cold-prospect draft uses qualifying questions, never an auto-pitch (REPLY-05)', async () => {
    const { replyAgent } = await import('@/src/agents/reply')
    const result = await replyAgent.run({
      ...baseRunArgs,
      messages: [{ role: 'user', content: 'new lead just messaged: "saw your ad, tell me more"' }],
      classification: 'cold-prospect',
      injectedSopResult: SOP_HIT,
    })
    expect(result.output.draft).toBeDefined()
    // A qualifying-questions draft contains at least one question mark.
    expect(result.output.draft?.text).toContain('?')
  })

  it('objection-handling draft is produced from an objection inbound (REPLY-06)', async () => {
    const { replyAgent } = await import('@/src/agents/reply')
    const result = await replyAgent.run({
      ...baseRunArgs,
      messages: [{ role: 'user', content: 'lead said: "too expensive, competitor is cheaper"' }],
      classification: 'objection',
      injectedSopResult: {
        found: true,
        citations: [{ docId: 'sop-obj-001', snippet: 'Objection-handling: reframe value.' }],
        context: '[SOP:sop-obj-001]\nReframe price as value; acknowledge first.',
      },
    })
    expect(result.output.draft?.sopDocIds).toContain('sop-obj-001')
  })

  it('financing draft is grounded in the financing SOP (REPLY-07)', async () => {
    const { replyAgent } = await import('@/src/agents/reply')
    const result = await replyAgent.run({
      ...baseRunArgs,
      messages: [{ role: 'user', content: 'lead asked: "how does the loan work?"' }],
      classification: 'financing',
      injectedSopResult: {
        found: true,
        citations: [{ docId: 'sop-fin-001', snippet: 'D2 financing SOP.' }],
        context: '[SOP:sop-fin-001]\nExplain margin of finance + defer rates to bank.',
      },
    })
    expect(result.output.draft?.sopDocIds).toContain('sop-fin-001')
  })
})

// ─── Test 2: miss → grounded refusal, NEVER a draft (REPLY-02 / D-11) ─────────

describe('Reply agent: miss → no_sop_match grounded refusal (D-11, RED until Plan 04-05)', () => {
  it('run({ injectedSopResult: <miss> }) returns noSopMatch and NO draft', async () => {
    const { replyAgent } = await import('@/src/agents/reply')
    const result = await replyAgent.run({
      ...baseRunArgs,
      messages: [{ role: 'user', content: 'lead asked something with no matching SOP at all' }],
      classification: 'other',
      injectedSopResult: SOP_MISS,
    })

    // MUST be a grounded refusal — never a fabricated draft
    expect(result.output.noSopMatch).toBeDefined()
    expect(result.output.noSopMatch?.reason).toBe('no_sop_match')
    expect(result.output.noSopMatch?.message.length).toBeGreaterThan(0)
    // XOR invariant: no draft when no SOP matched
    expect(result.output.draft).toBeUndefined()
  })
})

// ─── Test 3: ambiguous → clarifying question ──────────────────────────────────

describe('Reply agent: ambiguous → clarifyingQuestion (RED until Plan 04-05)', () => {
  it('an ambiguous inbound returns a clarifyingQuestion, not a draft', async () => {
    const { replyAgent } = await import('@/src/agents/reply')
    const result = await replyAgent.run({
      ...baseRunArgs,
      messages: [{ role: 'user', content: '?' }],
      classification: 'other',
      injectedSopResult: SOP_HIT,
      ambiguous: true,
    })
    expect(result.output.clarifyingQuestion).toBeDefined()
    expect((result.output.clarifyingQuestion ?? '').length).toBeGreaterThan(0)
    expect(result.output.draft).toBeUndefined()
  })
})

// ─── Test 4: ReplyOutputSchema XOR invariant ──────────────────────────────────

describe('ReplyOutputSchema (Plan 04-05)', () => {
  it('parses a valid draft-only output', async () => {
    const { ReplyOutputSchema } = await import('@/src/agents/reply/schema')
    const output = { draft: { text: 'Hi! What is your budget and timeline?', sopDocIds: ['sop-cold-001'] } }
    expect(() => ReplyOutputSchema.parse(output)).not.toThrow()
  })

  it('rejects a draft with an empty sopDocIds array (grounding trail required)', async () => {
    const { ReplyOutputSchema } = await import('@/src/agents/reply/schema')
    const output = { draft: { text: 'Hi! What is your budget?', sopDocIds: [] } }
    expect(() => ReplyOutputSchema.parse(output)).toThrow()
  })

  it('parses a valid noSopMatch-only output', async () => {
    const { ReplyOutputSchema } = await import('@/src/agents/reply/schema')
    const output = { noSopMatch: { reason: 'no_sop_match', message: 'No D2 reply SOP for this — draft manually.' } }
    expect(() => ReplyOutputSchema.parse(output)).not.toThrow()
  })

  it('parses a valid clarifyingQuestion-only output', async () => {
    const { ReplyOutputSchema } = await import('@/src/agents/reply/schema')
    const output = { clarifyingQuestion: 'Could you paste the full message from the lead?' }
    expect(() => ReplyOutputSchema.parse(output)).not.toThrow()
  })
})

// ─── Test 5: read-only tools — no Firestore write in any execute() ────────────

describe('Reply tools are read-only (Pitfall 23/36, RED until Plan 04-05)', () => {
  it('replyAgent.makeTools returns retrieveReplySop / fetchVoiceSamples / fetchLeadContext', async () => {
    const { replyAgent } = await import('@/src/agents/reply')
    const tools = replyAgent.makeTools('en', 'uid-reply-test-001', 'lead-reply-001')
    expect('retrieveReplySop' in tools).toBe(true)
    expect('fetchVoiceSamples' in tools).toBe(true)
    expect('fetchLeadContext' in tools).toBe(true)
  })

  it('no reply tool description mentions a write/update/delete (read-only contract)', async () => {
    const { replyAgent } = await import('@/src/agents/reply')
    const tools = replyAgent.makeTools('en', 'uid-reply-test-001', 'lead-reply-001') as Record<
      string,
      { description?: string }
    >
    for (const tool of Object.values(tools)) {
      const desc = (tool.description ?? '').toLowerCase()
      expect(desc).not.toContain('write')
      expect(desc).not.toContain('update')
      expect(desc).not.toContain('delete')
    }
  })
})

// ─── Test 6: parallel-lead isolation (REPLY-03 / SC2) ─────────────────────────

describe('Reply parallel-lead isolation (REPLY-03 / SC2, RED until Plan 04-05)', () => {
  it("Lead B's draft never contains Lead A's content (no cross-lead bleed)", async () => {
    const { replyAgent } = await import('@/src/agents/reply')

    const leadA = await replyAgent.run({
      ...baseRunArgs,
      leadId: 'lead-A',
      messages: [{ role: 'user', content: 'lead said: "I want the SECRET-A-PENTHOUSE in Mont Kiara"' }],
      classification: 'cold-prospect',
      injectedSopResult: SOP_HIT,
    })

    const leadB = await replyAgent.run({
      ...baseRunArgs,
      leadId: 'lead-B',
      messages: [{ role: 'user', content: 'lead said: "looking for a starter unit in Cheras"' }],
      classification: 'cold-prospect',
      injectedSopResult: SOP_HIT,
    })

    // Lead B's draft must not leak Lead A's unique marker — drafts are leadId-scoped.
    expect(leadB.output.draft?.text ?? '').not.toContain('SECRET-A-PENTHOUSE')
    void leadA
  })
})

// ─── quick-kayinleong-047: the "not an inbound" branch ────────────────────────
//
// Reply had no branch for "this is not a client message", unlike the Coach prompt's
// greeting section. So a greeting typed with the Reply chip pinned ran mandatory
// grounding, missed, and returned "I don't have a D2 reply SOP for this" — which also
// recorded a false SOP gap for the senior coach.

describe('quick-047: reply prompt handles a non-inbound message', () => {
  it('instructs the agent to ask for the paste instead of grounding', async () => {
    const { buildReplySystemPrompt } = await import('./prompt')
    const prompt = buildReplySystemPrompt()

    // The branch must come BEFORE the mandatory-grounding section, or the model
    // reaches "call retrieveReplySop first" and the escape hatch never applies.
    const branchAt = prompt.indexOf('Not an inbound message')
    const groundingAt = prompt.indexOf('## Grounding')
    expect(branchAt).toBeGreaterThan(-1)
    expect(groundingAt).toBeGreaterThan(-1)
    expect(branchAt).toBeLessThan(groundingAt)

    // It must name the escape hatch the schema already provides…
    expect(prompt).toContain('clarifyingQuestion')
    // …and forbid both the tool call and the false gap signal.
    expect(prompt).toContain('do NOT call retrieveReplySop')
    expect(prompt).toContain('do NOT emit noSopMatch')
  })

  it('still keeps grounding mandatory for a real inbound', async () => {
    // The branch must not have weakened the grounding mandate (D-06 / REPLY-01).
    const { REPLY_SYSTEM_PROMPT } = await import('./prompt')
    const prompt = REPLY_SYSTEM_PROMPT
    expect(prompt).toContain('Call the retrieveReplySop tool BEFORE drafting any reply')
    expect(prompt).toContain('NEVER invent a SOP')
  })
})

describe('quick-048: reply prompt forbids tool-use narration', () => {
  it('requires the bare JSON object and bans running commentary', async () => {
    const { buildReplySystemPrompt } = await import('./prompt')
    const prompt = buildReplySystemPrompt()
    expect(prompt).toContain('Return ONLY the bare JSON object')
    expect(prompt).toContain('Do NOT narrate your tool use')
  })
})
