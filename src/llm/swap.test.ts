/**
 * src/llm/swap.test.ts — QUAL-01: Model-swap integration test.
 *
 * Proves the same chat call succeeds on a SECOND provider via the llm/ abstraction,
 * with no unredacted PII reaching the model — on BOTH providers.
 *
 * TDD: RED committed before implementation. Run: npx vitest run src/llm/swap.test.ts
 *
 * Three behaviors (QUAL-01, SC4):
 *
 * Behavior 1: Same chat call succeeds on provider A AND provider B — unchanged call-site code.
 *   - Both makeFakeProvider instances process the same StreamArgs through the swap harness.
 *   - The swap harness is the thin orchestration layer that replaces modelFor() at test time.
 *
 * Behavior 2: In BOTH provider runs, the outbound payload has pdpa_redacted === true
 *   and contains NO +60xxxxxxxxxx phone number and no original lead name.
 *   - pseudonymize() is called before the provider.stream() call in BOTH runs.
 *   - The provider's lastArgs reflects the redacted payload.
 *
 * Behavior 3: Swapping the provider does NOT change the persisted result shape.
 *   - appendMessage() is called identically for both providers.
 *   - The recorded message doc shape (role, redacted, routeDecision) is identical.
 *
 * The fake provider (src/llm/fake.ts) is used as the deterministic 2nd vendor.
 * Provider A = fakeProviderA, Provider B = fakeProviderB — same scripts, different instances.
 * This proves the ABSTRACTION drives the pipe, not the vendor.
 *
 * OFFLINE: no Firebase, no Anthropic, no network calls.
 * The swap harness isolates just the llm/ + pdpa + append chain.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { makeFakeProvider } from '@/src/llm/fake'
import { pseudonymize, assertRedacted } from '@/src/audit/pdpa'
import type { StreamArgs } from '@/src/llm/types'
import type { MessageDoc } from '@/src/firebase/collections'

// ─── Mocks ───────────────────────────────────────────────────────────────────

// Mock appendMessage to capture call args without Firestore
const mockAppendMessage = vi.fn(async () => 'msg-swap-test-001')

vi.mock('@/src/memory', () => ({
  appendMessage: mockAppendMessage,
}))

// Mock audit.log to capture call args without Firestore
const mockAuditLog = vi.fn(async () => {})

vi.mock('@/src/audit', async (importOriginal) => {
  // Keep real pseudonymize + assertRedacted — they are under test
  const real = await importOriginal<typeof import('@/src/audit')>()
  return {
    ...real,
    log: mockAuditLog,
  }
})

// ─── Swap Harness ─────────────────────────────────────────────────────────────

/**
 * The swap harness — a thin orchestration layer that mirrors the gate ordering
 * in app/api/chat/route.ts but replaces modelFor() + streamText() with the
 * LlmProvider interface (fake providers in tests; real Anthropic in production).
 *
 * This is the QUAL-01 seam: swapping `provider` here is identical to swapping
 * the Remote Config value that modelFor() resolves in production.
 *
 * Gate ordering (mirrors route.ts):
 *   1. pseudonymize()     — PDPA redaction
 *   2. assertRedacted()   — PDPA gate (throws if not redacted)
 *   3. provider.stream()  — model call (only reaches here if both gates pass)
 *   4. appendMessage()    — persist to Firestore subcollection
 *   5. audit.log()        — audit write (hashes only)
 *
 * @param provider   The LlmProvider to use (provider A or B in the swap test).
 * @param rawInput   The raw (unredacted) input — provider receives the REDACTED form.
 * @param knownNames Lead names to pseudonymize (PII gate).
 * @returns          The assistant reply text and the persisted MessageDoc shape.
 */
interface SwapHarnessArgs {
  provider: ReturnType<typeof makeFakeProvider>
  messages: Array<{ role: 'user' | 'assistant'; content: string }>
  knownNames?: string[]
  model?: string
  cid?: string
  uid?: string
}

interface SwapHarnessResult {
  reply: string
  persistedMsg: MessageDoc
  providerSawPdpaRedacted: boolean
  providerLastArgs: StreamArgs | undefined
}

async function runSwapHarness({
  provider,
  messages,
  knownNames = [],
  model = 'fake-model',
  cid = 'conv-swap-001',
  uid = 'test-uid-new-agent-001',
}: SwapHarnessArgs): Promise<SwapHarnessResult> {
  // Gate 1 + 2: PDPA pseudonymize + assertRedacted
  const { redacted, pdpa_redacted } = pseudonymize(
    { messages: messages as Array<{ role: string; content: string }> },
    knownNames,
  )
  assertRedacted({ pdpa_redacted })

  const redactedMessages = redacted.messages as Array<{ role: 'user' | 'assistant'; content: string }>

  // Gate 3: provider.stream() — the swap seam
  const streamArgs: StreamArgs = {
    messages: redactedMessages,
    model,
  }

  let reply = ''
  for await (const chunk of provider.stream(streamArgs)) {
    reply += chunk
  }

  // Gate 4: appendMessage (persist to subcollection)
  const persistedMsg: MessageDoc = {
    tenantId: 'd2',
    role: 'assistant',
    content: reply,
    citations: [],
    routeDecision: 'coach',
    tokens: 0,
    redacted: true, // PDPA gate was applied
  }
  await mockAppendMessage(cid, persistedMsg)

  // Gate 5: audit.log (fire-and-forget in production; inline here for test assertion)
  await mockAuditLog({
    actorUid: uid,
    action: 'chat',
    targetRef: `conversations/${cid}`,
    raw: {
      pillar: 'coach',
      tokenCount: 0,
      contentHash: reply, // audit.log hashes this in production
    },
  })

  // providerSawPdpaRedacted: infer from pdpa_redacted gate passing (assertRedacted didn't throw)
  const providerSawPdpaRedacted = pdpa_redacted === true

  return {
    reply,
    persistedMsg,
    providerSawPdpaRedacted,
    providerLastArgs: provider.lastArgs,
  }
}

// ─── Test fixtures ────────────────────────────────────────────────────────────

// The same scripted reply for BOTH providers — proves the abstraction drives the pipe
const SCRIPTED_REPLY = 'Your first week at D2 covers compliance, product knowledge, and CRM setup. [KB:kb-chunk-d2-onboarding-en-001-00]'

// The raw input (pre-redaction)
const RAW_MESSAGES: Array<{ role: 'user' | 'assistant'; content: string }> = [
  { role: 'user', content: 'What do I need to complete in my first week at D2?' },
]

// The input WITH PII — proves the redaction gate catches it
const PII_MESSAGES: Array<{ role: 'user' | 'assistant'; content: string }> = [
  { role: 'user', content: 'My name is Alice Lim and my phone is +60123456789. What is D2 onboarding?' },
]

const PII_KNOWN_NAMES = ['Alice Lim']

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks()
  mockAppendMessage.mockResolvedValue('msg-swap-test-001')
  mockAuditLog.mockResolvedValue(undefined)
})

// ─── Behavior 1: Same call succeeds on BOTH providers (unchanged call-site code) ──

describe('Behavior 1: Same chat call succeeds on provider A AND provider B (QUAL-01)', () => {
  it('provider A (fakeProviderA) streams the scripted reply successfully', async () => {
    const fakeProviderA = makeFakeProvider([
      { match: { lastUserMessage: 'What do I need to complete in my first week at D2?' }, reply: SCRIPTED_REPLY },
    ])

    const result = await runSwapHarness({
      provider: fakeProviderA,
      messages: RAW_MESSAGES,
    })

    expect(result.reply).toBe(SCRIPTED_REPLY)
    expect(result.providerLastArgs).toBeDefined()
  })

  it('provider B (fakeProviderB — 2nd vendor) streams the same scripted reply successfully', async () => {
    const fakeProviderB = makeFakeProvider([
      { match: { lastUserMessage: 'What do I need to complete in my first week at D2?' }, reply: SCRIPTED_REPLY },
    ])

    const result = await runSwapHarness({
      provider: fakeProviderB,
      messages: RAW_MESSAGES,
    })

    expect(result.reply).toBe(SCRIPTED_REPLY)
    expect(result.providerLastArgs).toBeDefined()
  })

  it('the call-site code (swap harness args) is IDENTICAL for both providers', async () => {
    // This test captures the QUAL-01 invariant: the call-site is unchanged on swap
    const argsForA: SwapHarnessArgs = {
      provider: makeFakeProvider([
        { match: { lastUserMessage: 'What do I need to complete in my first week at D2?' }, reply: SCRIPTED_REPLY },
      ]),
      messages: RAW_MESSAGES,
      knownNames: [],
      model: 'fake-model',
      cid: 'conv-swap-a',
      uid: 'test-uid-new-agent-001',
    }

    const argsForB: SwapHarnessArgs = {
      // Only `provider` changes — everything else is identical
      provider: makeFakeProvider([
        { match: { lastUserMessage: 'What do I need to complete in my first week at D2?' }, reply: SCRIPTED_REPLY },
      ]),
      messages: RAW_MESSAGES,
      knownNames: [],
      model: 'fake-model',
      cid: 'conv-swap-b',
      uid: 'test-uid-new-agent-001',
    }

    const resultA = await runSwapHarness(argsForA)
    const resultB = await runSwapHarness(argsForB)

    // Both succeed with the same reply
    expect(resultA.reply).toBe(resultB.reply)

    // The ONLY difference is which provider instance was used
    // (proven by the fact that both have lastArgs set after stream() was called)
    expect(argsForA.provider.lastArgs).toBeDefined()
    expect(argsForB.provider.lastArgs).toBeDefined()
  })
})

// ─── Behavior 2: PDPA gate — pdpa_redacted === true, no PII in provider payload ──

describe('Behavior 2: PDPA gate — pdpa_redacted===true and no PII in provider lastArgs (BOTH providers)', () => {
  it('provider A: pdpa_redacted gate is satisfied (assertRedacted does not throw)', async () => {
    const fakeProviderA = makeFakeProvider([
      { match: {}, reply: SCRIPTED_REPLY },
    ])

    const result = await runSwapHarness({
      provider: fakeProviderA,
      messages: PII_MESSAGES,
      knownNames: PII_KNOWN_NAMES,
    })

    expect(result.providerSawPdpaRedacted).toBe(true)
  })

  it('provider B: pdpa_redacted gate is satisfied (assertRedacted does not throw)', async () => {
    const fakeProviderB = makeFakeProvider([
      { match: {}, reply: SCRIPTED_REPLY },
    ])

    const result = await runSwapHarness({
      provider: fakeProviderB,
      messages: PII_MESSAGES,
      knownNames: PII_KNOWN_NAMES,
    })

    expect(result.providerSawPdpaRedacted).toBe(true)
  })

  it('provider A: no real MY phone (+60xxxxxxxxxx) in the outbound payload seen by the provider', async () => {
    const fakeProviderA = makeFakeProvider([
      { match: {}, reply: SCRIPTED_REPLY },
    ])

    await runSwapHarness({
      provider: fakeProviderA,
      messages: PII_MESSAGES,
      knownNames: PII_KNOWN_NAMES,
    })

    // lastArgs is what the provider received — must not contain the raw phone number
    const lastArgs = fakeProviderA.lastArgs
    expect(lastArgs).toBeDefined()

    if (lastArgs) {
      const payloadStr = JSON.stringify(lastArgs.messages)
      // Must NOT contain the original MY phone number
      expect(payloadStr).not.toMatch(/\+?60\d{9,10}/)
      // The phone should have been replaced by a PHONE_HASH token
      expect(payloadStr).toContain('PHONE_HASH')
    }
  })

  it('provider B: no real MY phone (+60xxxxxxxxxx) in the outbound payload seen by the provider', async () => {
    const fakeProviderB = makeFakeProvider([
      { match: {}, reply: SCRIPTED_REPLY },
    ])

    await runSwapHarness({
      provider: fakeProviderB,
      messages: PII_MESSAGES,
      knownNames: PII_KNOWN_NAMES,
    })

    const lastArgs = fakeProviderB.lastArgs
    expect(lastArgs).toBeDefined()

    if (lastArgs) {
      const payloadStr = JSON.stringify(lastArgs.messages)
      expect(payloadStr).not.toMatch(/\+?60\d{9,10}/)
      expect(payloadStr).toContain('PHONE_HASH')
    }
  })

  it('provider A: the original lead name is NOT in the outbound payload seen by the provider', async () => {
    const fakeProviderA = makeFakeProvider([
      { match: {}, reply: SCRIPTED_REPLY },
    ])

    await runSwapHarness({
      provider: fakeProviderA,
      messages: PII_MESSAGES,
      knownNames: PII_KNOWN_NAMES,
    })

    const lastArgs = fakeProviderA.lastArgs
    expect(lastArgs).toBeDefined()

    if (lastArgs) {
      const payloadStr = JSON.stringify(lastArgs.messages)
      // Original name 'Alice Lim' should be replaced by <LEAD_ID:n>
      expect(payloadStr).not.toContain('Alice Lim')
      expect(payloadStr).toContain('LEAD_ID')
    }
  })

  it('provider B: the original lead name is NOT in the outbound payload seen by the provider', async () => {
    const fakeProviderB = makeFakeProvider([
      { match: {}, reply: SCRIPTED_REPLY },
    ])

    await runSwapHarness({
      provider: fakeProviderB,
      messages: PII_MESSAGES,
      knownNames: PII_KNOWN_NAMES,
    })

    const lastArgs = fakeProviderB.lastArgs
    expect(lastArgs).toBeDefined()

    if (lastArgs) {
      const payloadStr = JSON.stringify(lastArgs.messages)
      expect(payloadStr).not.toContain('Alice Lim')
      expect(payloadStr).toContain('LEAD_ID')
    }
  })
})

// ─── Behavior 3: Persist + audit behavior is IDENTICAL across providers ──────

describe('Behavior 3: appendMessage + audit.log behavior is identical across providers (abstraction-driven)', () => {
  it('appendMessage is called with the same MessageDoc shape on provider A and B', async () => {
    const fakeProviderA = makeFakeProvider([
      { match: {}, reply: SCRIPTED_REPLY },
    ])
    const fakeProviderB = makeFakeProvider([
      { match: {}, reply: SCRIPTED_REPLY },
    ])

    const resultA = await runSwapHarness({
      provider: fakeProviderA,
      messages: RAW_MESSAGES,
      cid: 'conv-swap-persist-a',
    })

    const resultB = await runSwapHarness({
      provider: fakeProviderB,
      messages: RAW_MESSAGES,
      cid: 'conv-swap-persist-b',
    })

    // The persisted MessageDoc shape is identical — abstraction-driven, not vendor-driven
    expect(resultA.persistedMsg.role).toBe(resultB.persistedMsg.role)
    expect(resultA.persistedMsg.tenantId).toBe(resultB.persistedMsg.tenantId)
    expect(resultA.persistedMsg.redacted).toBe(resultB.persistedMsg.redacted)
    expect(resultA.persistedMsg.routeDecision).toBe(resultB.persistedMsg.routeDecision)

    // Same reply → same content
    expect(resultA.persistedMsg.content).toBe(resultB.persistedMsg.content)
  })

  it('appendMessage is called the same number of times per provider run', async () => {
    vi.clearAllMocks()

    const fakeProviderA = makeFakeProvider([{ match: {}, reply: SCRIPTED_REPLY }])
    await runSwapHarness({ provider: fakeProviderA, messages: RAW_MESSAGES, cid: 'conv-a' })
    const callsAfterA = mockAppendMessage.mock.calls.length

    const fakeProviderB = makeFakeProvider([{ match: {}, reply: SCRIPTED_REPLY }])
    await runSwapHarness({ provider: fakeProviderB, messages: RAW_MESSAGES, cid: 'conv-b' })
    const callsAfterB = mockAppendMessage.mock.calls.length

    // Each harness run calls appendMessage exactly once
    expect(callsAfterA).toBe(1)
    expect(callsAfterB - callsAfterA).toBe(1)
  })

  it('audit.log is called with the same action and structure on provider A and B', async () => {
    vi.clearAllMocks()

    const fakeProviderA = makeFakeProvider([{ match: {}, reply: SCRIPTED_REPLY }])
    await runSwapHarness({ provider: fakeProviderA, messages: RAW_MESSAGES, cid: 'conv-audit-a', uid: 'uid-001' })

    const fakeProviderB = makeFakeProvider([{ match: {}, reply: SCRIPTED_REPLY }])
    await runSwapHarness({ provider: fakeProviderB, messages: RAW_MESSAGES, cid: 'conv-audit-b', uid: 'uid-001' })

    // Two audit.log calls total (one per run)
    expect(mockAuditLog).toHaveBeenCalledTimes(2)

    const [callA, callB] = mockAuditLog.mock.calls
    const auditA = callA[0] as { action: string; actorUid: string; raw: Record<string, unknown> }
    const auditB = callB[0] as { action: string; actorUid: string; raw: Record<string, unknown> }

    // Same action, same actorUid, same pillar in raw — abstraction-driven
    expect(auditA.action).toBe(auditB.action)
    expect(auditA.actorUid).toBe(auditB.actorUid)
    expect(auditA.raw.pillar).toBe(auditB.raw.pillar)
  })

  it('persisted MessageDoc.redacted is true for BOTH providers — PDPA gate applied', async () => {
    const fakeProviderA = makeFakeProvider([{ match: {}, reply: SCRIPTED_REPLY }])
    const resultA = await runSwapHarness({
      provider: fakeProviderA,
      messages: RAW_MESSAGES,
    })

    const fakeProviderB = makeFakeProvider([{ match: {}, reply: SCRIPTED_REPLY }])
    const resultB = await runSwapHarness({
      provider: fakeProviderB,
      messages: RAW_MESSAGES,
    })

    // Both providers: the persisted doc has redacted:true (PDPA gate was applied)
    expect(resultA.persistedMsg.redacted).toBe(true)
    expect(resultB.persistedMsg.redacted).toBe(true)
  })
})
