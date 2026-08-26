/**
 * app/api/chat/route.test.ts — Unit tests for the SSE chat route.
 *
 * Verified behaviors (offline, no live Anthropic/Firestore):
 *   1. Response includes X-Accel-Buffering: no + Cache-Control: no-store
 *   2. requireUser is called BEFORE ratelimit.check (auth gate first)
 *   3. ratelimit.check is called BEFORE assertRedacted/streamText (cost gate before spend)
 *   4. assertRedacted is called before streamText (PDPA gate before model call)
 *   5. after(() => audit.log()) is called for the audit write
 *   6. No hard-coded model ID — modelFor is called with 'coach'
 *   7. Unauthenticated request returns 401
 *   8. Rate-limited request returns 429
 *
 * 03-07 additions (FIND-01/04/05/08/11):
 *   12. finder-dispatch: routeAsync→finder routes to finderAgent (buildSystemPrompt + makeTools + modelFor('finder'))
 *   13. routeDecision-persist (D-02): assistant message gets routeDecision === 'finder:<reason>'
 *   14. pdpa-on-finder: assertRedacted is called BEFORE streamText on the finder path
 *   15. finderSlot-write (FIND-05/08): onFinish calls writeLeadSlot for finder+leadId; NOT for coach
 *   16. rerank-merge (FIND-08): stored finderSlot is read + mergeFinderCriteria called before finder run
 *
 * The full sign-in→stream→persist E2E and the model-swap integration test are
 * covered in 01-13 (capstone).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Hoist mocks ─────────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => {
  const mockRequireUser = vi.fn()
  const mockRatelimitCheck = vi.fn(async () => {})
  const mockRatelimitDecrement = vi.fn(async () => {})
  const mockAssertRedacted = vi.fn()
  const mockPseudonymize = vi.fn()
  const mockAuditLog = vi.fn(async () => {})
  const mockRoute = vi.fn()
  const mockRouteAsync = vi.fn()
  const mockModelFor = vi.fn()
  const mockStreamText = vi.fn()
  const mockAppendMessage = vi.fn(async () => 'msg-id-001')
  const mockUpdateMessage = vi.fn(async () => {})
  const mockAfter = vi.fn((fn: () => void) => fn()) // execute inline for test assertions
  const mockEnsurePrimaryThread = vi.fn(async () => 'coach-uid-001')
  // quick-033: a provided cid is resolved via ensureConversationOwned (creates/owns
  // the thread). The mock echoes the cid so downstream appendMessage(cid) assertions hold.
  const mockEnsureConversationOwned = vi.fn(async (_uid: string, cid: string) => cid)
  // 03-07: Finder-specific mocks
  const mockFinderBuildSystemPrompt = vi.fn(() => 'You are a D2 Property Finder.')
  const mockFinderMakeTools = vi.fn(() => ({ searchProjects: {}, queryInventory: {}, fetchCollateral: {} }))
  const mockReadFinderSlot = vi.fn(async () => null)
  const mockMergeFinderCriteria = vi.fn((stored: unknown) => stored)
  const mockMergeDiscussed = vi.fn((prev: string[], next: string[]) => [...prev, ...next])
  const mockWriteLeadSlot = vi.fn(async () => {})
  // 04-01 Wave 0: reply-dispatch + kb-miss mocks
  const mockReplyBuildSystemPrompt = vi.fn(() => 'You are the D2 Reply Assistant.')
  const mockReplyMakeTools = vi.fn(() => ({ retrieveReplySop: {}, fetchVoiceSamples: {}, fetchLeadContext: {} }))
  const mockReadReplySlot = vi.fn(async () => null)
  const mockRecordKnowledgeGap = vi.fn(async () => {})
  // 04-06: lead-record read (GATE-3 name injection) + agent-profile read (kb-miss coach scoping)
  const mockLeadGet = vi.fn(async () => ({ data: () => ({ name: 'Siti' }) }))
  const mockLeadsRef = vi.fn(() => ({ doc: vi.fn(() => ({ get: mockLeadGet })) }))
  const mockAgentProfileGet = vi.fn(async () => ({ data: () => ({ seniorCoachId: 'coach-uid-001' }) }))
  const mockAgentProfilesRef = vi.fn(() => ({ doc: vi.fn(() => ({ get: mockAgentProfileGet })) }))

  return {
    mockRequireUser,
    mockRatelimitCheck,
    mockRatelimitDecrement,
    mockAssertRedacted,
    mockPseudonymize,
    mockAuditLog,
    mockRoute,
    mockRouteAsync,
    mockModelFor,
    mockStreamText,
    mockAppendMessage,
    mockUpdateMessage,
    mockAfter,
    mockEnsurePrimaryThread,
    mockEnsureConversationOwned,
    mockFinderBuildSystemPrompt,
    mockFinderMakeTools,
    mockReadFinderSlot,
    mockMergeFinderCriteria,
    mockMergeDiscussed,
    mockWriteLeadSlot,
    mockReplyBuildSystemPrompt,
    mockReplyMakeTools,
    mockReadReplySlot,
    mockRecordKnowledgeGap,
    mockLeadGet,
    mockLeadsRef,
    mockAgentProfileGet,
    mockAgentProfilesRef,
  }
})

// ─── Module mocks ─────────────────────────────────────────────────────────────

vi.mock('@/src/firebase/auth', () => ({
  requireUser: mocks.mockRequireUser,
  UnauthorizedError: class UnauthorizedError extends Error {
    statusCode = 401
    constructor(msg = 'Unauthorized') { super(msg); this.name = 'UnauthorizedError' }
  },
}))

vi.mock('@/src/ratelimit', () => ({
  check: mocks.mockRatelimitCheck,
  decrement: mocks.mockRatelimitDecrement,
  RateLimitError: class RateLimitError extends Error {
    constructor(msg: string) { super(msg); this.name = 'RateLimitError' }
  },
}))

vi.mock('@/src/audit', () => ({
  pseudonymize: mocks.mockPseudonymize,
  assertRedacted: mocks.mockAssertRedacted,
  PdpaViolationError: class PdpaViolationError extends Error {
    constructor(msg = 'PDPA violation') { super(msg); this.name = 'PdpaViolationError' }
  },
  log: mocks.mockAuditLog,
}))

vi.mock('@/src/router', () => ({
  route: mocks.mockRoute,
  routeAsync: mocks.mockRouteAsync,
}))

vi.mock('@/src/llm/provider', () => ({
  modelFor: mocks.mockModelFor,
}))

vi.mock('ai', () => ({
  streamText: mocks.mockStreamText,
  // stepCountIs is imported by the route for the Finder multi-step loop bound (T-03-30)
  stepCountIs: vi.fn((n: number) => ({ _type: 'stepCountIs', n })),
}))

vi.mock('@/src/memory', () => ({
  appendMessage: mocks.mockAppendMessage,
  updateMessage: mocks.mockUpdateMessage,
  ensurePrimaryThread: mocks.mockEnsurePrimaryThread,
  ensureConversationOwned: mocks.mockEnsureConversationOwned,
  // 03-07: leadContext exports re-exported from the barrel
  readFinderSlot: mocks.mockReadFinderSlot,
  mergeFinderCriteria: mocks.mockMergeFinderCriteria,
  mergeDiscussed: mocks.mockMergeDiscussed,
  writeLeadSlot: mocks.mockWriteLeadSlot,
  // 04-01 Wave 0: reply slot reader (route consumes once Plan 04-06 wires reply dispatch)
  readReplySlot: mocks.mockReadReplySlot,
}))

vi.mock('@/src/agents/finder', () => ({
  finderAgent: {
    systemPrompt: 'You are a D2 Property Finder.',
    outputSchema: {},
    buildSystemPrompt: mocks.mockFinderBuildSystemPrompt,
    makeTools: mocks.mockFinderMakeTools,
  },
}))

vi.mock('@/src/agents/coach', () => ({
  coachAgent: {
    systemPrompt: 'You are a D2 coach.',
    outputSchema: {},
    buildSystemPrompt: vi.fn(() => 'You are a D2 coach.'),
    makeTools: vi.fn(() => ({ retrieveKnowledge: {} })),
  },
}))

vi.mock('@/src/i18n/detect', () => ({
  detectLang: vi.fn(() => 'en'),
}))

vi.mock('next/server', () => ({
  after: mocks.mockAfter,
}))

vi.mock('@/src/firebase/collections', () => ({
  TENANT_ID: 'd2',
  // 04-06: lead-record read for GATE-3 name injection (route reads leads/{leadId}.name)
  leadsRef: mocks.mockLeadsRef,
  // 04-06: agent-profile read for kb-miss coach scoping (route reads agentProfiles/{uid}.seniorCoachId)
  agentProfilesRef: mocks.mockAgentProfilesRef,
}))

// 04-01 Wave 0: reply agent + kb-miss feed mocks (consumed once Plan 04-05/04-06 wire
// the reply dispatch + no_sop_match → recordKnowledgeGap path into the route).
vi.mock('@/src/agents/reply', () => ({
  replyAgent: {
    systemPrompt: 'You are the D2 Reply Assistant.',
    outputSchema: {},
    buildSystemPrompt: mocks.mockReplyBuildSystemPrompt,
    makeTools: mocks.mockReplyMakeTools,
  },
}))

vi.mock('@/src/escalation', () => ({
  recordKnowledgeGap: mocks.mockRecordKnowledgeGap,
}))

// ─── Imports ──────────────────────────────────────────────────────────────────

import { POST, replyAgentReportedSopGap, fullTurnText } from './route'

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Build a mock UIMessageStreamResponse with custom headers */
function makeStreamResponse(extraHeaders: Record<string, string> = {}) {
  const headers = new Headers({
    'Content-Type': 'text/event-stream',
    ...extraHeaders,
  })
  return {
    headers,
    consumeStream: vi.fn(async () => {}),
    toUIMessageStreamResponse: vi.fn(() => new Response('stream', { headers })),
  }
}

/** Build a mock onFinish result */
const mockFinalResult = {
  text: 'The D2 onboarding process starts with PowerBoost.',
  usage: { totalTokens: 150, promptTokens: 100, completionTokens: 50 },
}

/** Create a mock Request with an auth header and body */
function buildRequest(body: object, authHeader = 'Bearer valid-token-001') {
  return new Request('http://localhost/api/chat', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: authHeader,
    },
    body: JSON.stringify(body),
  })
}

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks()

  // Default: authenticated user
  mocks.mockRequireUser.mockResolvedValue({ uid: 'uid-001', role: 'new-agent', tenantId: 'd2' })

  // Default: rate limit OK
  mocks.mockRatelimitCheck.mockResolvedValue(undefined)

  // Default: PDPA pseudonymize returns a gate-passing result
  mocks.mockPseudonymize.mockReturnValue({
    redacted: { messages: [{ role: 'user', content: 'What is D2?' }] },
    pdpa_redacted: true,
    mapping: new Map(),
  })

  // Default: assertRedacted passes
  mocks.mockAssertRedacted.mockReturnValue(undefined)

  // Default: sync router routes to coach
  mocks.mockRoute.mockReturnValue({ pillar: 'coach', reason: 'phase-1-single-pillar' })
  // Default: async router routes to coach (03-07)
  mocks.mockRouteAsync.mockResolvedValue({ pillar: 'coach', reason: 'heuristic-coach:keyword' })

  // Default: modelFor returns a mock model object
  mocks.mockModelFor.mockResolvedValue({ modelId: 'mock-model' })

  // Default: streamText returns a stream result with toUIMessageStreamResponse
  // NOTE: onFinish is called synchronously to prevent async leakage between tests.
  // Tests that need the onFinish result use mockImplementationOnce with their own await.
  const streamResult = {
    consumeStream: vi.fn(async () => {}),
    toUIMessageStreamResponse: vi.fn(({ headers }: { headers: Record<string, string> }) => {
      return new Response('data: mock stream\n\n', {
        headers: {
          'Content-Type': 'text/event-stream',
          ...headers,
        },
      })
    }),
    onFinish: undefined as unknown,
  }
  mocks.mockStreamText.mockImplementation((_opts: { onFinish?: (result: typeof mockFinalResult) => Promise<void> }) => {
    // Default: do NOT call onFinish — prevents async leakage between tests.
    // Tests that need onFinish behavior use mockImplementationOnce with their own logic.
    return streamResult
  })
})

// ─── Test 1: Load-bearing SSE headers ────────────────────────────────────────

describe('Test 1: Load-bearing SSE headers are present', () => {
  it('includes X-Accel-Buffering: no in the response', async () => {
    const req = buildRequest({
      messages: [{ role: 'user', content: 'Hello' }],
      cid: 'conv-001',
    })

    const response = await POST(req)

    expect(response.headers.get('X-Accel-Buffering')).toBe('no')
  })

  it('includes Cache-Control: no-store in the response', async () => {
    const req = buildRequest({
      messages: [{ role: 'user', content: 'Hello' }],
      cid: 'conv-001',
    })

    const response = await POST(req)

    expect(response.headers.get('Cache-Control')).toBe('no-store')
  })
})

// ─── Test 2: Gate ordering — auth before ratelimit ───────────────────────────

describe('Test 2: Gate ordering — requireUser called before ratelimit.check', () => {
  it('requireUser is called on every request', async () => {
    const req = buildRequest({ messages: [{ role: 'user', content: 'Hi' }] })
    await POST(req)
    expect(mocks.mockRequireUser).toHaveBeenCalledWith(req)
  })

  it('ratelimit.check is called after requireUser succeeds', async () => {
    const callOrder: string[] = []
    mocks.mockRequireUser.mockImplementation(async () => {
      callOrder.push('requireUser')
      return { uid: 'uid-001', role: 'new-agent', tenantId: 'd2' }
    })
    mocks.mockRatelimitCheck.mockImplementation(async () => {
      callOrder.push('ratelimitCheck')
    })

    const req = buildRequest({ messages: [{ role: 'user', content: 'Hi' }] })
    await POST(req)

    expect(callOrder[0]).toBe('requireUser')
    expect(callOrder[1]).toBe('ratelimitCheck')
  })
})

// ─── Test 3: assertRedacted called before streamText ─────────────────────────

describe('Test 3: assertRedacted called before streamText (PDPA gate before model)', () => {
  it('assertRedacted is called before streamText', async () => {
    const callOrder: string[] = []

    mocks.mockAssertRedacted.mockImplementation(() => {
      callOrder.push('assertRedacted')
    })
    mocks.mockStreamText.mockImplementation(({ onFinish }: { onFinish: (r: typeof mockFinalResult) => Promise<void> }) => {
      callOrder.push('streamText')
      setTimeout(() => onFinish(mockFinalResult), 0)
      return {
        consumeStream: vi.fn(async () => {}),
        toUIMessageStreamResponse: vi.fn(({ headers }: { headers: Record<string, string> }) =>
          new Response('stream', { headers: { ...headers, 'Content-Type': 'text/event-stream' } })
        ),
      }
    })

    const req = buildRequest({ messages: [{ role: 'user', content: 'Hi' }] })
    await POST(req)

    const assertIdx = callOrder.indexOf('assertRedacted')
    const streamIdx = callOrder.indexOf('streamText')
    expect(assertIdx).toBeLessThan(streamIdx)
  })
})

// ─── Test 4: modelFor called with 'coach' ────────────────────────────────────

describe('Test 4: modelFor called with coach pillar — no hard-coded model ID', () => {
  it('calls modelFor with the pillar name to resolve the model from Remote Config', async () => {
    const req = buildRequest({ messages: [{ role: 'user', content: 'What is D2?' }] })
    await POST(req)

    expect(mocks.mockModelFor).toHaveBeenCalledWith('coach')
  })
})

// ─── Test 4b (quick-043): Coach gets a multi-step budget so it can answer after a tool ─
//
// Regression guard: Coach is a retrieve-then-answer agent — it MUST be allowed a step 2
// after calling retrieveKnowledge, or it returns an empty response (finishReason
// "tool-calls", no text). Previously the route capped Coach at stepCountIs(1). This
// asserts the Coach path is given stopWhen = stepCountIs(n) with n >= 2.
describe('Test 4b (quick-043): Coach streamText gets stopWhen allowing >= 2 steps', () => {
  it('passes a multi-step stopWhen for the coach pillar (retrieve → answer)', async () => {
    // Default route is coach (mockRouteAsync → coach).
    const req = buildRequest({ messages: [{ role: 'user', content: 'tell me about the onboarding journey' }] })
    await POST(req)

    expect(mocks.mockStreamText).toHaveBeenCalled()
    const opts = mocks.mockStreamText.mock.calls[0][0] as { stopWhen?: { _type?: string; n?: number } }
    // stepCountIs is mocked as (n) => ({ _type: 'stepCountIs', n })
    expect(opts.stopWhen?._type).toBe('stepCountIs')
    expect(opts.stopWhen?.n ?? 0).toBeGreaterThanOrEqual(2)
  })
})

// ─── Test 5: Unauthenticated request returns 401 ─────────────────────────────

describe('Test 5: Auth gate returns 401 for unauthenticated requests', () => {
  it('returns 401 when requireUser throws UnauthorizedError', async () => {
    const { UnauthorizedError } = await import('@/src/firebase/auth')
    mocks.mockRequireUser.mockRejectedValue(new UnauthorizedError('Missing token'))

    const req = buildRequest({ messages: [{ role: 'user', content: 'Hi' }] }, 'Bearer bad-token')
    const response = await POST(req)

    expect(response.status).toBe(401)
    // ratelimit was NOT called (auth gate is first)
    expect(mocks.mockRatelimitCheck).not.toHaveBeenCalled()
    // streamText was NOT called
    expect(mocks.mockStreamText).not.toHaveBeenCalled()
  })
})

// ─── Test 6: Rate-limited request returns 429 ────────────────────────────────

describe('Test 6: Rate limit gate returns 429 when budget is exceeded', () => {
  it('returns 429 when ratelimit.check throws RateLimitError', async () => {
    const { RateLimitError } = await import('@/src/ratelimit')
    mocks.mockRatelimitCheck.mockRejectedValue(new RateLimitError('Over budget'))

    const req = buildRequest({ messages: [{ role: 'user', content: 'Hi' }] })
    const response = await POST(req)

    expect(response.status).toBe(429)
    // streamText was NOT called (rate limit gate before model spend)
    expect(mocks.mockStreamText).not.toHaveBeenCalled()
  })
})

// ─── Test 7: No "use server" pragma ──────────────────────────────────────────

describe('Test 7: Route Handler is not a Server Action', () => {
  it('does not export a "use server" directive (Route Handler, not Server Action)', async () => {
    // Read the route source to assert no "use server" directive
    const fs = await import('fs')
    const path = await import('path')
    const routeSource = fs.readFileSync(
      path.resolve(import.meta.dirname, './route.ts'),
      'utf-8',
    )
    expect(routeSource).not.toContain('"use server"')
    expect(routeSource).not.toContain("'use server'")
  })
})

// ─── Test 8 (02-03): Stable cid via ensurePrimaryThread ──────────────────────

describe('Test 8 (02-03): ensurePrimaryThread called when no cid provided', () => {
  it('calls ensurePrimaryThread when no cid is provided in body', async () => {
    const req = buildRequest({
      messages: [{ role: 'user', content: 'What is D2 onboarding?' }],
      // No cid provided
    })

    await POST(req)

    expect(mocks.mockEnsurePrimaryThread).toHaveBeenCalledWith('uid-001', expect.any(String))
  })

  it('does NOT call ensurePrimaryThread when cid is explicitly provided', async () => {
    const req = buildRequest({
      messages: [{ role: 'user', content: 'Hello' }],
      cid: 'coach-uid-explicit',
    })

    await POST(req)

    expect(mocks.mockEnsurePrimaryThread).not.toHaveBeenCalled()
  })

  it('resolves a provided cid via ensureConversationOwned (separate session, quick-033)', async () => {
    const req = buildRequest({
      messages: [{ role: 'user', content: 'Hello from a new session' }],
      cid: 'chat-new-session-xyz',
    })

    await POST(req)

    expect(mocks.mockEnsureConversationOwned).toHaveBeenCalledWith(
      'uid-001',
      'chat-new-session-xyz',
      expect.any(String),
      'coach',
      expect.any(String),
    )
  })
})

// ─── Test 9 (02-03): langOverride honored ────────────────────────────────────

describe('Test 9 (02-03): langOverride flows to RAG and reply language', () => {
  it('uses langOverride when provided in body', async () => {
    const { detectLang } = await import('@/src/i18n/detect')
    const mockDetect = detectLang as ReturnType<typeof vi.fn>
    mockDetect.mockReturnValue('en')

    const req = buildRequest({
      messages: [{ role: 'user', content: 'Hello' }],
      langOverride: 'ms',
    })

    await POST(req)

    // coachAgent.makeTools should be called with the overridden lang
    const { coachAgent } = await import('@/src/agents/coach')
    expect((coachAgent.makeTools as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith('ms')
  })

  it('falls back to detectLang when langOverride is absent', async () => {
    const { detectLang } = await import('@/src/i18n/detect')
    const mockDetect = detectLang as ReturnType<typeof vi.fn>
    mockDetect.mockReturnValue('zh')

    const req = buildRequest({
      messages: [{ role: 'user', content: '你好' }],
    })

    await POST(req)

    const { coachAgent } = await import('@/src/agents/coach')
    expect((coachAgent.makeTools as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith('zh')
  })
})

// ─── Test 10 (02-03): User + assistant messages both persisted ────────────────

describe('Test 10 (02-03): both user and assistant messages persisted in onFinish', () => {
  it('appendMessage is called with user role and then assistant role (via onFinish)', async () => {
    // Use a local tracking array — independent of accumulated mock history
    const persistedRoles: string[] = []
    ;(mocks.mockAppendMessage as ReturnType<typeof vi.fn>).mockImplementation(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      async (_cid: unknown, msg: any) => {
        persistedRoles.push((msg as { role: string }).role)
        return 'msg-id-local'
      }
    )

    // Invoke onFinish synchronously via a custom streamText mock for this test
    mocks.mockStreamText.mockImplementationOnce(({ onFinish }: { onFinish: (r: Record<string, unknown>) => Promise<void> }) => {
      void onFinish({ ...mockFinalResult, steps: [] })
      return {
        consumeStream: vi.fn(async () => {}),
        toUIMessageStreamResponse: vi.fn(({ headers }: { headers: Record<string, string> }) =>
          new Response('stream', { headers: { ...headers, 'Content-Type': 'text/event-stream' } })
        ),
      }
    })

    const req = buildRequest({
      messages: [{ role: 'user', content: 'Tell me about D2 onboarding' }],
      cid: 'coach-uid-001',
    })

    await POST(req)
    // onFinish is awaited by streamText mock synchronously, but appendMessage is async
    await new Promise((r) => setImmediate(r))

    // Both user and assistant must have been persisted
    expect(persistedRoles).toContain('user')
    expect(persistedRoles).toContain('assistant')
    // user must come before assistant
    expect(persistedRoles.indexOf('user')).toBeLessThan(persistedRoles.indexOf('assistant'))
  })
})

// ─── Tests 12–16 (03-07): Finder dispatch, routeDecision, PDPA, finderSlot ───

describe('Test 12 (03-07): finder dispatch — routeAsync→finder routes to finderAgent', () => {
  it('calls finderAgent.buildSystemPrompt + makeTools + modelFor("finder") when pillar is finder', async () => {
    mocks.mockRouteAsync.mockResolvedValueOnce({ pillar: 'finder', reason: 'heuristic-finder:criteria' })

    const req = buildRequest({
      messages: [{ role: 'user', content: 'My lead budget RM600k, OC area, own stay' }],
      cid: 'conv-001',
    })

    await POST(req)

    expect(mocks.mockFinderBuildSystemPrompt).toHaveBeenCalled()
    // userLang depends on detectLang mock; assert uid + leadId positional args 1+2
    expect(mocks.mockFinderMakeTools).toHaveBeenCalledWith(expect.any(String), 'uid-001', undefined)
    expect(mocks.mockModelFor).toHaveBeenCalledWith('finder')
  })

  it('coach path unchanged when routeAsync returns coach', async () => {
    mocks.mockRouteAsync.mockResolvedValueOnce({ pillar: 'coach', reason: 'heuristic-coach:keyword' })

    const req = buildRequest({
      messages: [{ role: 'user', content: 'What is D2 PowerBoost?' }],
      cid: 'conv-001',
    })

    await POST(req)

    expect(mocks.mockFinderBuildSystemPrompt).not.toHaveBeenCalled()
    expect(mocks.mockModelFor).toHaveBeenCalledWith('coach')
  })

  it('passes leadId to finderAgent.makeTools when provided', async () => {
    mocks.mockRouteAsync.mockResolvedValueOnce({ pillar: 'finder', reason: 'heuristic-finder:criteria' })

    const req = buildRequest({
      messages: [{ role: 'user', content: 'Find project for my lead' }],
      cid: 'conv-001',
      leadId: 'lead-001',
    })

    await POST(req)

    expect(mocks.mockFinderMakeTools).toHaveBeenCalledWith(expect.any(String), 'uid-001', 'lead-001')
  })
})

describe('Test 13 (03-07): routeDecision persisted as "pillar:reason" (D-02)', () => {
  it('persists routeDecision as "finder:<reason>" on both messages for a finder turn', async () => {
    mocks.mockRouteAsync.mockResolvedValueOnce({ pillar: 'finder', reason: 'heuristic-finder:criteria' })

    // Use a promise to await onFinish completion properly
    let resolveOnFinish: () => void
    const onFinishDone = new Promise<void>((r) => { resolveOnFinish = r })

    mocks.mockStreamText.mockImplementationOnce(({ onFinish }: { onFinish: (r: Record<string, unknown>) => Promise<void> }) => {
      // Call onFinish and resolve when it completes
      void onFinish({ ...mockFinalResult, steps: [] }).then(resolveOnFinish)
      return {
        consumeStream: vi.fn(async () => {}),
        toUIMessageStreamResponse: vi.fn(({ headers }: { headers: Record<string, string> }) =>
          new Response('stream', { headers: { ...headers, 'Content-Type': 'text/event-stream' } })
        ),
      }
    })

    const req = buildRequest({
      messages: [{ role: 'user', content: 'Find me a project' }],
      cid: 'conv-001',
    })

    await POST(req)
    await onFinishDone

    // Both persisted messages should have routeDecision = 'finder:heuristic-finder:criteria'
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const calls = mocks.mockAppendMessage.mock.calls as any[]
    expect(calls.length).toBeGreaterThanOrEqual(2)
    for (const call of calls) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const msg = call[1] as Record<string, unknown>
      expect(msg.routeDecision).toBe('finder:heuristic-finder:criteria')
    }
  })

  it('persists routeDecision as "coach:<reason>" on both messages for a coach turn', async () => {
    mocks.mockRouteAsync.mockResolvedValueOnce({ pillar: 'coach', reason: 'heuristic-coach:keyword' })

    // Use a promise to await onFinish completion properly
    let resolveOnFinish: () => void
    const onFinishDone = new Promise<void>((r) => { resolveOnFinish = r })

    mocks.mockStreamText.mockImplementationOnce(({ onFinish }: { onFinish: (r: Record<string, unknown>) => Promise<void> }) => {
      void onFinish({ ...mockFinalResult, steps: [] }).then(resolveOnFinish)
      return {
        consumeStream: vi.fn(async () => {}),
        toUIMessageStreamResponse: vi.fn(({ headers }: { headers: Record<string, string> }) =>
          new Response('stream', { headers: { ...headers, 'Content-Type': 'text/event-stream' } })
        ),
      }
    })

    const req = buildRequest({
      messages: [{ role: 'user', content: 'What is D2 PowerBoost?' }],
      cid: 'conv-001',
    })

    await POST(req)
    await onFinishDone

    // Both persisted messages should have routeDecision = 'coach:heuristic-coach:keyword'
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const calls = mocks.mockAppendMessage.mock.calls as any[]
    expect(calls.length).toBeGreaterThanOrEqual(2)
    for (const call of calls) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const msg = call[1] as Record<string, unknown>
      expect(msg.routeDecision).toBe('coach:heuristic-coach:keyword')
    }
  })
})

describe('Test 14 (03-07): assertRedacted called before streamText on FINDER path', () => {
  it('assertRedacted precedes streamText when routeAsync returns finder', async () => {
    mocks.mockRouteAsync.mockResolvedValueOnce({ pillar: 'finder', reason: 'heuristic-finder:criteria' })

    const callOrder: string[] = []

    mocks.mockAssertRedacted.mockImplementationOnce(() => {
      callOrder.push('assertRedacted')
    })
    mocks.mockStreamText.mockImplementationOnce(({ onFinish }: { onFinish: (r: typeof mockFinalResult) => Promise<void> }) => {
      callOrder.push('streamText')
      setTimeout(() => onFinish(mockFinalResult), 0)
      return {
        consumeStream: vi.fn(async () => {}),
        toUIMessageStreamResponse: vi.fn(({ headers }: { headers: Record<string, string> }) =>
          new Response('stream', { headers: { ...headers, 'Content-Type': 'text/event-stream' } })
        ),
      }
    })

    const req = buildRequest({
      messages: [{ role: 'user', content: 'Find a project for budget RM600k' }],
      cid: 'conv-001',
    })

    await POST(req)

    const assertIdx = callOrder.indexOf('assertRedacted')
    const streamIdx = callOrder.indexOf('streamText')
    expect(assertIdx).toBeLessThan(streamIdx)
  })

  it('returns 422 on finder path when assertRedacted throws PdpaViolationError', async () => {
    mocks.mockRouteAsync.mockResolvedValueOnce({ pillar: 'finder', reason: 'heuristic-finder:criteria' })

    const { PdpaViolationError } = await import('@/src/audit')
    mocks.mockAssertRedacted.mockImplementationOnce(() => {
      throw new PdpaViolationError('PII not redacted')
    })

    const req = buildRequest({
      messages: [{ role: 'user', content: 'Lead name is John, budget RM600k' }],
      cid: 'conv-001',
    })

    const response = await POST(req)
    expect(response.status).toBe(422)
    expect(mocks.mockStreamText).not.toHaveBeenCalled()
  })
})

describe('Test 15 (03-07): finderSlot written in onFinish for finder+leadId; NOT for coach', () => {
  it('calls writeLeadSlot with finderSlot when pillar is finder and leadId is provided', async () => {
    mocks.mockRouteAsync.mockResolvedValueOnce({ pillar: 'finder', reason: 'heuristic-finder:criteria' })
    mocks.mockReadFinderSlot.mockResolvedValueOnce(null)

    // Simulate a finder turn with a searchProjects tool result
    const finderSteps = [
      {
        toolResults: [
          {
            toolName: 'searchProjects',
            result: {
              found: true,
              matches: [
                { projectId: 'proj-001' },
                { projectId: 'proj-002' },
              ],
            },
          },
        ],
      },
    ]

    let resolveOnFinish: () => void
    const onFinishDone = new Promise<void>((r) => { resolveOnFinish = r })

    mocks.mockStreamText.mockImplementationOnce(({ onFinish }: { onFinish: (r: Record<string, unknown>) => Promise<void> }) => {
      void onFinish({ ...mockFinalResult, steps: finderSteps }).then(resolveOnFinish)
      return {
        consumeStream: vi.fn(async () => {}),
        toUIMessageStreamResponse: vi.fn(({ headers }: { headers: Record<string, string> }) =>
          new Response('stream', { headers: { ...headers, 'Content-Type': 'text/event-stream' } })
        ),
      }
    })

    const req = buildRequest({
      messages: [{ role: 'user', content: 'Find project for my lead, budget RM600k' }],
      cid: 'conv-001',
      leadId: 'lead-001',
    })

    await POST(req)
    await onFinishDone

    expect(mocks.mockWriteLeadSlot).toHaveBeenCalledWith(
      'lead-001',
      'finderSlot',
      expect.objectContaining({
        discussedProjectIds: expect.any(Array),
        lastRankedAt: expect.any(Number),
      }),
    )
  })

  it('does NOT call writeLeadSlot when pillar is coach', async () => {
    // Reset the routeAsync mock to clear any leftover Once queue from previous tests
    // (vi.clearAllMocks() in beforeEach only clears call history, not the Once queue)
    mocks.mockRouteAsync.mockReset()
    mocks.mockRouteAsync.mockResolvedValue({ pillar: 'coach', reason: 'heuristic-coach:keyword' })
    mocks.mockWriteLeadSlot.mockClear()

    let resolveOnFinish: () => void
    const onFinishDone = new Promise<void>((r) => { resolveOnFinish = r })

    mocks.mockStreamText.mockImplementationOnce(({ onFinish }: { onFinish: (r: Record<string, unknown>) => Promise<void> }) => {
      void onFinish({ ...mockFinalResult, steps: [] }).then(resolveOnFinish)
      return {
        consumeStream: vi.fn(async () => {}),
        toUIMessageStreamResponse: vi.fn(({ headers }: { headers: Record<string, string> }) =>
          new Response('stream', { headers: { ...headers, 'Content-Type': 'text/event-stream' } })
        ),
      }
    })

    const req = buildRequest({
      messages: [{ role: 'user', content: 'What is D2 PowerBoost?' }],
      cid: 'conv-001',
      leadId: 'lead-001',
    })

    await POST(req)
    await onFinishDone

    expect(mocks.mockWriteLeadSlot).not.toHaveBeenCalled()
  })

  it('does NOT call writeLeadSlot when pillar is finder but no leadId', async () => {
    mocks.mockRouteAsync.mockResolvedValueOnce({ pillar: 'finder', reason: 'heuristic-finder:criteria' })

    let resolveOnFinish: () => void
    const onFinishDone = new Promise<void>((r) => { resolveOnFinish = r })

    mocks.mockStreamText.mockImplementationOnce(({ onFinish }: { onFinish: (r: Record<string, unknown>) => Promise<void> }) => {
      void onFinish({ ...mockFinalResult, steps: [] }).then(resolveOnFinish)
      return {
        consumeStream: vi.fn(async () => {}),
        toUIMessageStreamResponse: vi.fn(({ headers }: { headers: Record<string, string> }) =>
          new Response('stream', { headers: { ...headers, 'Content-Type': 'text/event-stream' } })
        ),
      }
    })

    const req = buildRequest({
      messages: [{ role: 'user', content: 'Show me some projects' }],
      cid: 'conv-001',
      // no leadId
    })

    await POST(req)
    await onFinishDone

    expect(mocks.mockWriteLeadSlot).not.toHaveBeenCalled()
  })
})

describe('Test 16 (03-07): re-rank merge — stored finderSlot read + mergeFinderCriteria called', () => {
  it('reads finderSlot and calls mergeFinderCriteria when stored slot exists', async () => {
    mocks.mockRouteAsync.mockResolvedValueOnce({ pillar: 'finder', reason: 'heuristic-finder:criteria' })

    const storedSlot = {
      criteria: {
        segment: 'own_stay' as const,
        priceMin: null,
        priceMax: 600000,
        monthlyIncome: null,
        nationality: 'malaysian' as const,
        bumiputera: null,
        locationPref: 'Cheras',
        bedrooms: 3,
        freeText: 'OC area, 3 bed',
      },
      discussedProjectIds: ['proj-000'],
      lastRankedAt: Date.now() - 60000,
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mocks.mockReadFinderSlot.mockResolvedValueOnce(storedSlot as any)

    const req = buildRequest({
      messages: [{ role: 'user', content: 'Actually budget now RM700k' }],
      cid: 'conv-001',
      leadId: 'lead-001',
    })

    await POST(req)

    expect(mocks.mockReadFinderSlot).toHaveBeenCalledWith('lead-001')
    expect(mocks.mockMergeFinderCriteria).toHaveBeenCalledWith(storedSlot.criteria, expect.any(Object))
  })

  it('skips mergeFinderCriteria when no stored slot exists (first touch)', async () => {
    mocks.mockRouteAsync.mockResolvedValueOnce({ pillar: 'finder', reason: 'heuristic-finder:criteria' })
    mocks.mockReadFinderSlot.mockResolvedValueOnce(null)

    const req = buildRequest({
      messages: [{ role: 'user', content: 'Budget RM600k, Cheras area' }],
      cid: 'conv-001',
      leadId: 'lead-001',
    })

    await POST(req)

    expect(mocks.mockReadFinderSlot).toHaveBeenCalledWith('lead-001')
    expect(mocks.mockMergeFinderCriteria).not.toHaveBeenCalled()
  })
})

// ─── Test 17 (03-07): extractFinderProjectIds helper ─────────────────────────

describe('Test 17 (03-07): extractFinderProjectIds extracts project IDs from searchProjects tool results', () => {
  it('returns projectIds from searchProjects tool result when found', async () => {
    const { extractFinderProjectIds } = await import('./route')

    const fakeFinish = {
      steps: [
        {
          toolResults: [
            {
              toolName: 'searchProjects',
              result: {
                found: true,
                matches: [
                  { projectId: 'proj-001' },
                  { projectId: 'proj-002' },
                ],
              },
            },
          ],
        },
      ],
    }

    const ids = extractFinderProjectIds(fakeFinish)
    expect(ids).toEqual(['proj-001', 'proj-002'])
  })

  it('returns [] when searchProjects returned no matches (found:false)', async () => {
    const { extractFinderProjectIds } = await import('./route')

    const fakeFinish = {
      steps: [
        {
          toolResults: [
            { toolName: 'searchProjects', result: { found: false, reason: 'no_match' } },
          ],
        },
      ],
    }

    const ids = extractFinderProjectIds(fakeFinish)
    expect(ids).toEqual([])
  })

  it('returns [] when no tool was called', async () => {
    const { extractFinderProjectIds } = await import('./route')
    const ids = extractFinderProjectIds({ steps: [] })
    expect(ids).toEqual([])
  })
})

// ─── Test 11 (02-03): extractCitationChunkIds helper ─────────────────────────

describe('Test 11 (02-03): extractCitationChunkIds extracts chunk IDs from tool results', () => {
  it('returns chunk IDs from retrieveKnowledge tool result when found', async () => {
    const { extractCitationChunkIds } = await import('./route')

    const fakeFinish = {
      steps: [
        {
          toolResults: [
            {
              toolName: 'retrieveKnowledge',
              result: {
                found: true,
                citations: [
                  { chunkId: 'chunk-001', docId: 'doc-1', snippet: 'D2 onboarding content' },
                  { chunkId: 'chunk-002', docId: 'doc-1', snippet: 'PowerBoost content' },
                ],
                context: 'content here',
              },
            },
          ],
        },
      ],
    }

    const ids = extractCitationChunkIds(fakeFinish)
    expect(ids).toEqual(['chunk-001', 'chunk-002'])
  })

  it('returns [] when no tool was called', async () => {
    const { extractCitationChunkIds } = await import('./route')
    const ids = extractCitationChunkIds({ steps: [] })
    expect(ids).toEqual([])
  })

  it('returns [] when retrieveKnowledge returned a miss', async () => {
    const { extractCitationChunkIds } = await import('./route')

    const fakeFinish = {
      steps: [
        {
          toolResults: [
            { toolName: 'retrieveKnowledge', result: { found: false, reason: 'kb_miss' } },
          ],
        },
      ],
    }

    const ids = extractCitationChunkIds(fakeFinish)
    expect(ids).toEqual([])
  })
})

// ─── 04-01 Wave 0: Reply dispatch RED tests (REPLY-02/03/04/09, D-07/D-11) ────
//
// These document the Phase-4 reply-dispatch contract the chat route must satisfy.
// Today the route has NO `pillar === 'reply'` branch (reply falls through to the
// coach/else branch), does NOT enforce a required leadId (no 400), calls
// pseudonymize(messages, []) with an EMPTY names[] (the unfinished GATE-3 hook at
// route.ts:252), never writes a replySlot, and never records a kb-miss. Each assertion
// below is EXPECTED-FAIL (`it.fails`) so it fails RED against current code while keeping
// the offline suite GREEN (exit 0). Plans 04-06 (dispatch + leadId fail-closed + name
// injection + replySlot onFinish + no_sop_match→recordKnowledgeGap) flip them to passes.

describe('04-01 (REPLY-02): reply dispatch builds reply prompt + tools + modelFor("reply")', () => {
  it('a reply turn calls replyAgent.buildSystemPrompt + makeTools + modelFor("reply") (GREEN as of Plan 04-06)', async () => {
    mocks.mockRouteAsync.mockResolvedValueOnce({ pillar: 'reply', reason: 'heuristic-reply:draft-a-reply' })

    const req = buildRequest({
      messages: [{ role: 'user', content: 'draft a reply to this lead' }],
      cid: 'conv-reply-001',
      leadId: 'lead-001',
    })

    await POST(req)

    expect(mocks.mockReplyBuildSystemPrompt).toHaveBeenCalled()
    expect(mocks.mockModelFor).toHaveBeenCalledWith('reply')
  })
})

describe('04-01 (REPLY-04 / D-07): reply turn without leadId fails closed with HTTP 400', () => {
  it('a reply turn with NO leadId returns HTTP 400 (server fail-closed — GREEN as of Plan 04-06)', async () => {
    mocks.mockRouteAsync.mockResolvedValueOnce({ pillar: 'reply', reason: 'heuristic-reply:draft-a-reply' })

    const req = buildRequest({
      messages: [{ role: 'user', content: 'draft a reply' }],
      cid: 'conv-reply-002',
      // NO leadId — the UI prevents this (D-07) but the server MUST also fail closed.
    })

    const response = await POST(req)
    expect(response.status).toBe(400)
    // Fail-closed BEFORE any model spend — streamText must NOT have been called.
    expect(mocks.mockStreamText).not.toHaveBeenCalled()
  })
})

describe('04-01 (PDPA / Q3): reply turn injects known lead names into pseudonymize', () => {
  it('pseudonymize receives a NON-empty names[] for a reply turn with a leadId (GREEN as of Plan 04-06)', async () => {
    mocks.mockRouteAsync.mockResolvedValueOnce({ pillar: 'reply', reason: 'heuristic-reply:draft-a-reply' })

    const req = buildRequest({
      messages: [{ role: 'user', content: 'lead said: "Siti here, still keen" — draft a reply' }],
      cid: 'conv-reply-003',
      leadId: 'lead-001',
    })

    await POST(req)

    // GATE 3 must inject lead names so replaceNames actually fires (closing route.ts:252).
    const namesArg = mocks.mockPseudonymize.mock.calls.at(-1)?.[1] as string[] | undefined
    expect(Array.isArray(namesArg)).toBe(true)
    expect((namesArg ?? []).length).toBeGreaterThan(0)
  })
})

describe('04-01 (REPLY-09): replySlot written in onFinish for a reply turn with a leadId', () => {
  it('onFinish calls writeLeadSlot("replySlot", …) for a reply turn with a leadId (GREEN as of Plan 04-06)', async () => {
    mocks.mockRouteAsync.mockResolvedValueOnce({ pillar: 'reply', reason: 'heuristic-reply:draft-a-reply' })

    let resolveOnFinish: () => void
    const onFinishDone = new Promise<void>((r) => { resolveOnFinish = r })

    mocks.mockStreamText.mockImplementationOnce(({ onFinish }: { onFinish: (r: Record<string, unknown>) => Promise<void> }) => {
      void onFinish({ ...mockFinalResult, steps: [] }).then(resolveOnFinish)
      return {
        consumeStream: vi.fn(async () => {}),
        toUIMessageStreamResponse: vi.fn(({ headers }: { headers: Record<string, string> }) =>
          new Response('stream', { headers: { ...headers, 'Content-Type': 'text/event-stream' } })
        ),
      }
    })

    const req = buildRequest({
      messages: [{ role: 'user', content: 'draft a reply to this' }],
      cid: 'conv-reply-004',
      leadId: 'lead-001',
    })

    await POST(req)
    await onFinishDone

    const slotNames = (mocks.mockWriteLeadSlot.mock.calls as unknown as unknown[][]).map((c) => c[1])
    expect(slotNames).toContain('replySlot')
  })
})

describe('04-01 (REPLY-03 / SC2): parallel-lead isolation at the route level', () => {
  it('two reply turns for different leads each pass their own leadId to readReplySlot (GREEN as of Plan 04-06)', async () => {
    mocks.mockRouteAsync.mockResolvedValue({ pillar: 'reply', reason: 'heuristic-reply:draft-a-reply' })

    await POST(buildRequest({
      messages: [{ role: 'user', content: 'draft a reply for lead A' }],
      cid: 'conv-A', leadId: 'lead-A',
    }))
    await POST(buildRequest({
      messages: [{ role: 'user', content: 'draft a reply for lead B' }],
      cid: 'conv-B', leadId: 'lead-B',
    }))

    const readLeadIds = (mocks.mockReadReplySlot.mock.calls as unknown as unknown[][]).map((c) => c[0])
    expect(readLeadIds).toContain('lead-A')
    expect(readLeadIds).toContain('lead-B')
  })
})

describe('04-01 (D-11): no_sop_match reply turn records a kb-miss knowledgeGap tagged reply', () => {
  it('a reply turn resolving to no_sop_match calls recordKnowledgeGap with pillar:"reply" (GREEN as of Plan 04-06)', async () => {
    mocks.mockRouteAsync.mockResolvedValueOnce({ pillar: 'reply', reason: 'heuristic-reply:draft-a-reply' })

    let resolveOnFinish: () => void
    const onFinishDone = new Promise<void>((r) => { resolveOnFinish = r })

    // Simulate the reply tool returning a no_sop_match miss in the stream steps.
    mocks.mockStreamText.mockImplementationOnce(({ onFinish }: { onFinish: (r: Record<string, unknown>) => Promise<void> }) => {
      const finish = {
        ...mockFinalResult,
        // quick-kayinleong-047: the gap write now ALSO requires the agent's own
        // conclusion, so the fixture carries the ReplyOutput envelope a real
        // no_sop_match turn actually emits. Without it this asserted a gap row for a
        // turn the agent never called a gap — which is exactly the false-positive the
        // guard exists to stop.
        text: JSON.stringify({
          noSopMatch: { reason: 'no_sop_match', message: "I don't have a D2 reply SOP for this" },
        }),
        steps: [
          {
            toolResults: [
              { toolName: 'retrieveReplySop', result: { found: false, reason: 'no_sop_match' } },
            ],
          },
        ],
      }
      void onFinish(finish).then(resolveOnFinish)
      return {
        consumeStream: vi.fn(async () => {}),
        toUIMessageStreamResponse: vi.fn(({ headers }: { headers: Record<string, string> }) =>
          new Response('stream', { headers: { ...headers, 'Content-Type': 'text/event-stream' } })
        ),
      }
    })

    const req = buildRequest({
      messages: [{ role: 'user', content: 'lead asked something with no SOP — draft a reply' }],
      cid: 'conv-reply-005',
      leadId: 'lead-001',
    })

    await POST(req)
    await onFinishDone

    expect(mocks.mockRecordKnowledgeGap).toHaveBeenCalled()
    const arg = (mocks.mockRecordKnowledgeGap.mock.calls as unknown as unknown[][]).at(-1)?.[0] as { pillar?: string } | undefined
    expect(arg?.pillar).toBe('reply')
  })
})

// ─── quick-kayinleong-046: durability + server-authoritative turn metadata ────
//
// Three reported defects converge on this route:
//   - the Coach's {answer,citations,handoff} JSON envelope rendering raw in the chat
//     bubble, because the client guessed the pillar from its own override chip;
//   - a refresh mid-stream losing the whole turn, because both message writes lived in
//     onFinish, which the AI SDK skips when the consumer cancels;
//   - a KB miss detected by substring-sniffing 'kb_miss' out of the leaking envelope.

describe('quick-046: turn durability', () => {
  it('persists the user message BEFORE the model call, not in onFinish', async () => {
    const order: string[] = []
    mocks.mockAppendMessage.mockImplementation((async (
      _cid: string,
      msg: { role: string },
    ) => {
      order.push(`append:${msg.role}`)
      return 'msg-id'
    }) as unknown as () => Promise<string>)
    mocks.mockStreamText.mockImplementationOnce(() => {
      order.push('streamText')
      return {
        consumeStream: vi.fn(async () => {}),
        toUIMessageStreamResponse: vi.fn(() => new Response('s')),
      }
    })

    await POST(buildRequest({ messages: [{ role: 'user', content: 'hi' }], cid: 'c-046a' }))

    // The user's message is a fact the moment it clears the gates — it must not depend
    // on the model succeeding, or on the browser staying connected.
    expect(order[0]).toBe('append:user')
    expect(order).toContain('streamText')
    expect(order.indexOf('append:user')).toBeLessThan(order.indexOf('streamText'))
  })

  it('calls consumeStream() so onFinish still runs if the client disconnects', async () => {
    const consumeStream = vi.fn(async () => {})
    mocks.mockStreamText.mockImplementationOnce(() => ({
      consumeStream,
      toUIMessageStreamResponse: vi.fn(() => new Response('s')),
    }))

    await POST(buildRequest({ messages: [{ role: 'user', content: 'hi' }], cid: 'c-046b' }))

    // Without this, a browser refresh mid-stream skipped the TransformStream flush and
    // took the assistant message, the ratelimit decrement, the audit row and the usage
    // event down with it.
    expect(consumeStream).toHaveBeenCalledTimes(1)
  })
})

describe('quick-046: server-authoritative message metadata', () => {
  /** Drive the route, then return the messageMetadata callback + a step-feeder. */
  async function captureMetadata(
    routeTo: { pillar: string; reason: string },
    steps: Array<{ toolResults?: Array<{ toolName?: string; result?: unknown }> }>,
  ) {
    mocks.mockRouteAsync.mockResolvedValue(routeTo)
    let metaFn:
      | ((a: { part: { type: string } }) => Record<string, unknown> | undefined)
      | undefined
    mocks.mockStreamText.mockImplementationOnce(
      ({ onStepFinish }: { onStepFinish?: (s: unknown) => void }) => {
        for (const s of steps) onStepFinish?.(s)
        return {
          consumeStream: vi.fn(async () => {}),
          toUIMessageStreamResponse: vi.fn((opts: { messageMetadata?: typeof metaFn }) => {
            metaFn = opts.messageMetadata
            return new Response('s')
          }),
        }
      },
    )
    await POST(buildRequest({ messages: [{ role: 'user', content: 'q' }], cid: 'c-046m' }))
    return metaFn
  }

  it('reports the resolved pillar on the start chunk, before any text', async () => {
    const meta = await captureMetadata({ pillar: 'coach', reason: 'heuristic-coach:keyword' }, [])
    // The client needs the pillar up front to pick a renderer. It previously inferred it
    // from pillarOverride, which is undefined in Auto mode — so no decoder ran and the
    // Finder/Reply JSON envelope reached the bubble verbatim.
    expect(meta?.({ part: { type: 'start' } })).toMatchObject({
      pillar: 'coach',
      routeDecision: 'coach:heuristic-coach:keyword',
    })
  })

  it('flags kbMiss when a Coach turn ran retrieval and got nothing', async () => {
    const meta = await captureMetadata({ pillar: 'coach', reason: 'heuristic-coach:keyword' }, [
      { toolResults: [{ toolName: 'retrieveKnowledge', result: { found: false } }] },
    ])
    expect(meta?.({ part: { type: 'finish' } })).toMatchObject({ kbMiss: true, citations: [] })
  })

  it('reports real citations and no kbMiss when retrieval hit', async () => {
    const meta = await captureMetadata({ pillar: 'coach', reason: 'heuristic-coach:keyword' }, [
      {
        toolResults: [
          {
            toolName: 'retrieveKnowledge',
            result: { found: true, citations: [{ chunkId: 'k1' }, { chunkId: 'k2' }] },
          },
        ],
      },
    ])
    // Citations come from the tool results the server actually saw — not from the model
    // restating chunk IDs, which it can get wrong or fabricate.
    expect(meta?.({ part: { type: 'finish' } })).toMatchObject({
      citations: ['k1', 'k2'],
      kbMiss: false,
    })
  })

  it('does NOT flag kbMiss on a greeting that never called a retrieval tool', async () => {
    const meta = await captureMetadata({ pillar: 'coach', reason: 'heuristic-coach:keyword' }, [
      { toolResults: [] },
    ])
    // Greetings and "what can you do" answer directly with no retrieval. Firing the
    // senior-coach handoff toast for those would be noise.
    expect(meta?.({ part: { type: 'finish' } })).toMatchObject({ kbMiss: false })
  })

  it('never flags kbMiss for non-coach pillars', async () => {
    const meta = await captureMetadata({ pillar: 'finder', reason: 'heuristic-finder:keyword' }, [
      { toolResults: [{ toolName: 'retrieveKnowledge', result: { found: false } }] },
    ])
    // Finder/Reply have their own miss signals (refusal / no_sop_match).
    expect(meta?.({ part: { type: 'finish' } })).toMatchObject({ pillar: 'finder', kbMiss: false })
  })

  it('returns undefined for chunk types that carry no metadata', async () => {
    const meta = await captureMetadata({ pillar: 'coach', reason: 'heuristic-coach:keyword' }, [])
    expect(meta?.({ part: { type: 'text-delta' } })).toBeUndefined()
  })
})

// ─── quick-kayinleong-047: false reply-SOP gaps ───────────────────────────────
//
// With the Reply chip pinned, typing "hi" made the agent search for a greeting SOP,
// miss, and the route recorded a knowledgeGaps row with the topic "hi" — corrupting the
// feed that tells the senior coach which SOPs to write. The gap write now requires the
// AGENT's own conclusion, not just a tool miss.

describe('quick-047: replyAgentReportedSopGap', () => {
  it('is true when the agent emitted noSopMatch', () => {
    expect(
      replyAgentReportedSopGap({
        text: JSON.stringify({
          noSopMatch: { reason: 'no_sop_match', message: 'no D2 reply SOP for this' },
        }),
      }),
    ).toBe(true)
  })

  it('tolerates a ```json fence and surrounding prose', () => {
    expect(
      replyAgentReportedSopGap({
        text: '```json\n{"noSopMatch":{"reason":"no_sop_match","message":"m"}}\n```',
      }),
    ).toBe(true)
  })

  it('is FALSE for a clarifying question — the non-inbound path, not a gap', () => {
    // This is the whole point: "hi" now yields a clarifyingQuestion, which must never
    // be recorded as a missing SOP.
    expect(
      replyAgentReportedSopGap({
        text: JSON.stringify({
          clarifyingQuestion: "Paste the client's message and I'll draft a reply.",
        }),
      }),
    ).toBe(false)
  })

  it('is FALSE when a clarifying question and noSopMatch both appear', () => {
    // Ambiguous output must not create a gap row — clarifyingQuestion wins.
    expect(
      replyAgentReportedSopGap({
        text: JSON.stringify({
          clarifyingQuestion: 'Which lead is this about?',
          noSopMatch: { reason: 'no_sop_match', message: 'm' },
        }),
      }),
    ).toBe(false)
  })

  it('is FALSE for a grounded draft', () => {
    expect(
      replyAgentReportedSopGap({
        text: JSON.stringify({ draft: { text: 'Hi there', sopDocIds: ['sop-1'] } }),
      }),
    ).toBe(false)
  })

  it('fails CLOSED on unparseable, empty, or missing output', () => {
    // A malformed turn is not evidence of a missing SOP. A missed gap row is far
    // cheaper than a false one.
    expect(replyAgentReportedSopGap({ text: 'I could not parse this' })).toBe(false)
    expect(replyAgentReportedSopGap({ text: '' })).toBe(false)
    expect(replyAgentReportedSopGap({ text: '   ' })).toBe(false)
    expect(replyAgentReportedSopGap({})).toBe(false)
  })
})

describe('quick-047: a non-inbound reply turn records NO knowledge gap', () => {
  it('a clarifying-question turn does not call recordKnowledgeGap even though the tool missed', async () => {
    mocks.mockRouteAsync.mockResolvedValueOnce({ pillar: 'reply', reason: 'manual-override' })

    let resolveOnFinish: () => void
    const onFinishDone = new Promise<void>((r) => { resolveOnFinish = r })

    // The shape a greeting produces once the prompt's "Not an inbound message" branch
    // is honoured: the tool may still have been called and missed, but the agent asks
    // for the client's message instead of declaring an SOP gap.
    mocks.mockStreamText.mockImplementationOnce(({ onFinish }: { onFinish: (r: Record<string, unknown>) => Promise<void> }) => {
      const finish = {
        ...mockFinalResult,
        text: JSON.stringify({
          clarifyingQuestion: "Paste the client's WhatsApp message and I'll draft a reply.",
        }),
        steps: [
          {
            toolResults: [
              { toolName: 'retrieveReplySop', result: { found: false, reason: 'no_sop_match' } },
            ],
          },
        ],
      }
      void onFinish(finish).then(resolveOnFinish)
      return {
        consumeStream: vi.fn(async () => {}),
        toUIMessageStreamResponse: vi.fn(() => new Response('stream')),
      }
    })

    await POST(buildRequest({
      messages: [{ role: 'user', content: 'hi' }],
      cid: 'conv-reply-047',
      leadId: 'lead-001',
    }))
    await onFinishDone

    // The bug: "hi" used to write a knowledgeGaps row with the topic "hi", polluting
    // the feed that tells the senior coach which SOPs to write.
    expect(mocks.mockRecordKnowledgeGap).not.toHaveBeenCalled()
  })
})

// ─── quick-kayinleong-050: persisted turns were truncated ─────────────────────
//
// A tester reported "some part of the response is truncated" and could not tell whether
// it was UI, backend length, or user error. It was none of those: onFinish's `final.text`
// is the LAST STEP's text only (ai@5.0.193 builds it from
// recordedSteps[recordedSteps.length - 1]), while the client accumulates every block. So
// the message was whole while it streamed and truncated once reloaded from Firestore.

describe('quick-050: fullTurnText', () => {
  it('joins every step, not just the last', () => {
    expect(
      fullTurnText({
        text: 'second half only',
        steps: [{ text: 'Got it, searching now.' }, { text: 'second half only' }],
      }),
    ).toBe('Got it, searching now.\n\nsecond half only')
  })

  it('uses a blank line so the reloaded transcript matches the live one', () => {
    // The client joins blocks with TEXT_BLOCK_SEPARATOR ('\n\n', quick-048). A single
    // newline would render as one run-on paragraph through MarkdownMessage.
    const out = fullTurnText({ steps: [{ text: 'a' }, { text: 'b' }] })
    expect(out).toBe('a\n\nb')
  })

  it('handles a single-step turn unchanged', () => {
    expect(fullTurnText({ text: 'only', steps: [{ text: 'only' }] })).toBe('only')
  })

  it('skips empty step texts rather than emitting blank gaps', () => {
    // A tool-only step carries no text; joining it blindly would produce leading or
    // doubled separators.
    expect(
      fullTurnText({ steps: [{ text: 'a' }, { text: '' }, {}, { text: 'b' }] }),
    ).toBe('a\n\nb')
  })

  it('falls back to final.text when no step carries text', () => {
    // Never persist an empty message just because the step shape was unexpected.
    expect(fullTurnText({ text: 'fallback', steps: [] })).toBe('fallback')
    expect(fullTurnText({ text: 'fallback' })).toBe('fallback')
    expect(fullTurnText({ text: 'fallback', steps: [{}, { text: '' }] })).toBe('fallback')
  })

  it('returns empty string when there is nothing at all', () => {
    expect(fullTurnText({})).toBe('')
  })
})

describe('quick-050: the persisted message is the FULL turn', () => {
  it('appendMessage stores every step, not the last one', async () => {
    const stored: string[] = []
    mocks.mockAppendMessage.mockImplementation((async (
      _cid: string,
      msg: { role: string; content: string },
    ) => {
      if (msg.role === 'assistant') stored.push(msg.content)
      return 'id'
    }) as unknown as () => Promise<string>)

    let resolveOnFinish: () => void
    const done = new Promise<void>((r) => { resolveOnFinish = r })

    mocks.mockStreamText.mockImplementationOnce(
      ({ onFinish }: { onFinish: (r: Record<string, unknown>) => Promise<void> }) => {
        void onFinish({
          ...mockFinalResult,
          text: 'The two strongest candidates are…',
          steps: [
            { text: 'Got it. Let me search now.' },
            { text: 'The two strongest candidates are…' },
          ],
        }).then(resolveOnFinish)
        return {
          consumeStream: vi.fn(async () => {}),
          toUIMessageStreamResponse: vi.fn(() => new Response('s')),
        }
      },
    )

    await POST(buildRequest({ messages: [{ role: 'user', content: 'q' }], cid: 'c-050' }))
    await done

    expect(stored).toHaveLength(1)
    expect(stored[0]).toBe('Got it. Let me search now.\n\nThe two strongest candidates are…')
    // The regression: storing final.text alone silently dropped the opening block.
    expect(stored[0]).not.toBe('The two strongest candidates are…')
  })
})

// ─── quick-kayinleong-055: the assistant reply must ALWAYS persist ────────────
//
// Measured in production: 19 lost responses across 26% of conversations. onFinish was the
// ONLY path that wrote an assistant message, so any turn that errored or aborted saved the
// user's question and nothing else — the agent revisits a chat and sees their own messages
// with no replies.

describe('quick-055: assistant message survives a failed turn', () => {
  /** Capture just the assistant writes. */
  function captureAssistantWrites(): string[] {
    const written: string[] = []
    mocks.mockAppendMessage.mockImplementation((async (
      _cid: string,
      msg: { role: string; content: string },
    ) => {
      if (msg.role === 'assistant') written.push(msg.content)
      return 'id'
    }) as unknown as () => Promise<string>)
    return written
  }

  it('persists partial text when the stream ERRORS (onFinish never runs)', async () => {
    const written = captureAssistantWrites()
    mocks.mockStreamText.mockImplementationOnce(
      ({ onStepFinish, onError }: {
        onStepFinish?: (s: unknown) => void
        onError?: (e: { error: unknown }) => void
      }) => {
        onStepFinish?.({ text: 'Here are the two strongest matches', toolResults: [] })
        onError?.({ error: new Error('overloaded_error') })
        return {
          consumeStream: vi.fn(async () => {}),
          toUIMessageStreamResponse: vi.fn(() => new Response('s')),
        }
      },
    )

    await POST(buildRequest({ messages: [{ role: 'user', content: 'q' }], cid: 'c-055a' }))

    expect(written).toEqual(['Here are the two strongest matches'])
  })

  it('persists partial text when the turn is ABORTED', async () => {
    const written = captureAssistantWrites()
    mocks.mockStreamText.mockImplementationOnce(
      ({ onStepFinish, onAbort }: {
        onStepFinish?: (s: unknown) => void
        onAbort?: () => void
      }) => {
        onStepFinish?.({ text: 'Searching inventory', toolResults: [] })
        onAbort?.()
        return {
          consumeStream: vi.fn(async () => {}),
          toUIMessageStreamResponse: vi.fn(() => new Response('s')),
        }
      },
    )

    await POST(buildRequest({ messages: [{ role: 'user', content: 'q' }], cid: 'c-055b' }))

    expect(written).toEqual(['Searching inventory'])
  })

  it('writes EXACTLY ONCE when both onError and onFinish fire', async () => {
    // The double-write quick-046 was rightly worried about when it declined to pair
    // consumeStream() with onAbort. The idempotency guard is what makes covering every
    // path safe.
    const written = captureAssistantWrites()
    mocks.mockStreamText.mockImplementationOnce(
      ({ onStepFinish, onError, onFinish }: {
        onStepFinish?: (s: unknown) => void
        onError?: (e: { error: unknown }) => void
        onFinish?: (r: Record<string, unknown>) => Promise<void>
      }) => {
        onStepFinish?.({ text: 'partial', toolResults: [] })
        onError?.({ error: new Error('boom') })
        void onFinish?.({ ...mockFinalResult, text: 'partial', steps: [{ text: 'partial' }] })
        return {
          consumeStream: vi.fn(async () => {}),
          toUIMessageStreamResponse: vi.fn(() => new Response('s')),
        }
      },
    )

    await POST(buildRequest({ messages: [{ role: 'user', content: 'q' }], cid: 'c-055c' }))

    expect(written).toHaveLength(1)
  })

  it('does NOT write an empty bubble when nothing was generated', async () => {
    // An empty assistant message reads as the agent having answered with silence, which
    // is worse than an honest gap.
    const written = captureAssistantWrites()
    mocks.mockStreamText.mockImplementationOnce(
      ({ onError }: { onError?: (e: { error: unknown }) => void }) => {
        onError?.({ error: new Error('failed before any text') })
        return {
          consumeStream: vi.fn(async () => {}),
          toUIMessageStreamResponse: vi.fn(() => new Response('s')),
        }
      },
    )

    await POST(buildRequest({ messages: [{ role: 'user', content: 'q' }], cid: 'c-055d' }))

    expect(written).toEqual([])
  })

  it('marks an incomplete turn in routeDecision, not in the content', async () => {
    // The agent should not be shown scaffolding, but the transcript must stay honest.
    // quick-061: the row is APPENDED at the step boundary as ':partial' and FINALISED by
    // an update, so the honest end state is the LAST write of either kind — not the append.
    const decisions: string[] = []
    // Filtered by cid — the microtask flush below also drains write chains left pending by
    // earlier tests in this file, whose mocks fire-and-forget onFinish.
    const record = (cid: string, msg: { role: string; routeDecision?: string }) => {
      if (msg.role === 'assistant' && cid === 'c-055e') decisions.push(String(msg.routeDecision))
    }
    mocks.mockAppendMessage.mockImplementation((async (
      cid: string,
      msg: { role: string; routeDecision?: string },
    ) => {
      record(cid, msg)
      return 'id'
    }) as unknown as () => Promise<string>)
    mocks.mockUpdateMessage.mockImplementation((async (
      cid: string,
      _mid: string,
      msg: { role: string; routeDecision?: string },
    ) => {
      record(cid, msg)
    }) as unknown as () => Promise<void>)

    mocks.mockStreamText.mockImplementationOnce(
      ({ onStepFinish, onError }: {
        onStepFinish?: (s: unknown) => void
        onError?: (e: { error: unknown }) => void
      }) => {
        onStepFinish?.({ text: 'half an answer', toolResults: [] })
        onError?.({ error: new Error('x') })
        return {
          consumeStream: vi.fn(async () => {}),
          toUIMessageStreamResponse: vi.fn(() => new Response('s')),
        }
      },
    )

    await POST(buildRequest({ messages: [{ role: 'user', content: 'q' }], cid: 'c-055e' }))

    await new Promise((r) => setTimeout(r, 0))
    expect(decisions.at(-1)).toMatch(/:error$/)
  })
})

// ─── quick-kayinleong-057: an EMPTY early callback must not claim the write ───
//
// Reported for the third time: "the chat history still not save, revisit still doesnt show
// the meesasge". The cause was in quick-055's own fix. `persistAssistantOnce` set its
// `persisted` flag BEFORE testing for empty text, and 055 also wired
// `abortSignal: req.signal` — so a client disconnect fired onAbort with nothing
// accumulated, latched the flag, and then REFUSED the completed reply that consumeStream()
// kept alive. Before 055 that same disconnect was saved.

describe('quick-057: a completed reply survives an early empty callback', () => {
  /**
   * Drain pending microtasks. The mock calls `void onFinish?.(...)` fire-and-forget, where
   * the real SDK awaits it — and the writer now serialises through a promise chain, so the
   * write lands a few hops after POST resolves. Production awaits it properly inside
   * onFinish; this only compensates for the mock's shortcut.
   */
  const flushWrites = () => new Promise((r) => setTimeout(r, 0))

  /** Capture assistant appends and in-place upgrades separately. */
  function captureAssistant(cid: string): { appended: string[]; updated: string[] } {
    const appended: string[] = []
    const updated: string[] = []
    // Filtered by cid: flushWrites() also drains write chains left pending by EARLIER
    // tests in this file (their mocks call `void onFinish?.()` and never await it), and
    // those late writes would otherwise land in this test's array.
    mocks.mockAppendMessage.mockImplementation((async (
      writtenCid: string,
      msg: { role: string; content: string },
    ) => {
      if (msg.role === 'assistant' && writtenCid === cid) appended.push(msg.content)
      return 'assistant-mid'
    }) as unknown as () => Promise<string>)
    mocks.mockUpdateMessage.mockImplementation((async (
      writtenCid: string,
      _mid: string,
      msg: { role: string; content: string },
    ) => {
      if (msg.role === 'assistant' && writtenCid === cid) updated.push(msg.content)
    }) as unknown as () => Promise<void>)
    return { appended, updated }
  }

  it('onAbort with NO text does not block the onFinish write — the reported bug', async () => {
    const { appended } = captureAssistant('c-057a')
    mocks.mockStreamText.mockImplementationOnce(
      ({ onAbort, onFinish }: {
        onAbort?: () => void
        onFinish?: (r: Record<string, unknown>) => Promise<void>
      }) => {
        // The client went away before the first token — nothing accumulated yet.
        onAbort?.()
        // consumeStream() keeps the model call alive and the turn completes anyway.
        void onFinish?.({
          ...mockFinalResult,
          text: 'the complete answer',
          steps: [{ text: 'the complete answer' }],
        })
        return {
          consumeStream: vi.fn(async () => {}),
          toUIMessageStreamResponse: vi.fn(() => new Response('s')),
        }
      },
    )

    await POST(buildRequest({ messages: [{ role: 'user', content: 'q' }], cid: 'c-057a' }))
    await flushWrites()

    expect(appended).toEqual(['the complete answer'])
  })

  it('onError with NO text does not block the onFinish write either', async () => {
    const { appended } = captureAssistant('c-057b')
    mocks.mockStreamText.mockImplementationOnce(
      ({ onError, onFinish }: {
        onError?: (e: { error: unknown }) => void
        onFinish?: (r: Record<string, unknown>) => Promise<void>
      }) => {
        onError?.({ error: new Error('transient') })
        void onFinish?.({
          ...mockFinalResult,
          text: 'recovered answer',
          steps: [{ text: 'recovered answer' }],
        })
        return {
          consumeStream: vi.fn(async () => {}),
          toUIMessageStreamResponse: vi.fn(() => new Response('s')),
        }
      },
    )

    await POST(buildRequest({ messages: [{ role: 'user', content: 'q' }], cid: 'c-057b' }))
    await flushWrites()

    expect(appended).toEqual(['recovered answer'])
  })

  it('UPGRADES a partial in place rather than appending a second bubble', async () => {
    const { appended, updated } = captureAssistant('c-057c')
    mocks.mockStreamText.mockImplementationOnce(
      ({ onStepFinish, onAbort, onFinish }: {
        onStepFinish?: (s: unknown) => void
        onAbort?: () => void
        onFinish?: (r: Record<string, unknown>) => Promise<void>
      }) => {
        onStepFinish?.({ text: 'half an', toolResults: [] })
        onAbort?.()
        void onFinish?.({
          ...mockFinalResult,
          text: 'half an answer, now complete',
          steps: [{ text: 'half an answer, now complete' }],
        })
        return {
          consumeStream: vi.fn(async () => {}),
          toUIMessageStreamResponse: vi.fn(() => new Response('s')),
        }
      },
    )

    await POST(buildRequest({ messages: [{ role: 'user', content: 'q' }], cid: 'c-057c' }))
    await flushWrites()

    // ONE row, whatever the write count: quick-061 appends it at the step boundary, the
    // abort finalises the marker, and onFinish extends it to the complete text.
    expect(appended).toEqual(['half an'])
    expect(updated.at(-1)).toBe('half an answer, now complete')
  })

  it('never lets a SHORTER later text overwrite what is already stored', async () => {
    const { appended, updated } = captureAssistant('c-057d')
    mocks.mockStreamText.mockImplementationOnce(
      ({ onStepFinish, onError, onFinish }: {
        onStepFinish?: (s: unknown) => void
        onError?: (e: { error: unknown }) => void
        onFinish?: (r: Record<string, unknown>) => Promise<void>
      }) => {
        onStepFinish?.({ text: 'the long complete answer', toolResults: [] })
        onError?.({ error: new Error('late failure') })
        // A finish payload whose last step is shorter must not truncate the record.
        void onFinish?.({ ...mockFinalResult, text: 'oops', steps: [{ text: 'oops' }] })
        return {
          consumeStream: vi.fn(async () => {}),
          toUIMessageStreamResponse: vi.fn(() => new Response('s')),
        }
      },
    )

    await POST(buildRequest({ messages: [{ role: 'user', content: 'q' }], cid: 'c-057d' }))
    await flushWrites()

    // The point is that the stored text is never truncated. quick-061 does write once more
    // here (finalising ':partial' to ':error'), but always with the LONG text — the short
    // onFinish payload is refused.
    expect(appended).toEqual(['the long complete answer'])
    expect(updated.every((c) => c === 'the long complete answer')).toBe(true)
    expect(updated).not.toContain('oops')
  })

  it('does NOT pass abortSignal — cancelling the model is what loses the reply', async () => {
    // consumeStream() exists to finish a turn the client walked away from. Passing
    // req.signal cancels that same call, so the two are contradictory; 046 chose
    // finish-and-save and 055 silently reversed it.
    await POST(buildRequest({ messages: [{ role: 'user', content: 'q' }], cid: 'c-057e' }))
    const args = mocks.mockStreamText.mock.calls.at(-1)?.[0] as Record<string, unknown>
    expect(args.abortSignal).toBeUndefined()
    expect(typeof args.onAbort).toBe('function')
  })
})

// ─── quick-kayinleong-061: the text must be on disk BEFORE the turn ends ──────
//
// Measured on live Firestore: 25 lost replies, every one of them Finder (coach 24/24 and
// reply 4/4 lost nothing). usageEvents — written at the END of onFinish — matched the
// stored assistant count, so onFinish never ran; and there were zero :error / :aborted
// markers, so onError and onAbort did not run either. When NO callback fires the process is
// being killed, and callback plumbing cannot save the turn.

describe('quick-061: the assistant row is written at each step boundary', () => {
  const flushWrites = () => new Promise((r) => setTimeout(r, 0))

  function captureAssistant(cid: string) {
    const appended: Array<{ content: string; routeDecision: string }> = []
    const updated: Array<{ content: string; routeDecision: string }> = []
    mocks.mockAppendMessage.mockImplementation((async (
      writtenCid: string,
      msg: { role: string; content: string; routeDecision: string },
    ) => {
      if (msg.role === 'assistant' && writtenCid === cid) {
        appended.push({ content: msg.content, routeDecision: msg.routeDecision })
      }
      return 'assistant-mid'
    }) as unknown as () => Promise<string>)
    mocks.mockUpdateMessage.mockImplementation((async (
      writtenCid: string,
      _mid: string,
      msg: { role: string; content: string; routeDecision: string },
    ) => {
      if (msg.role === 'assistant' && writtenCid === cid) {
        updated.push({ content: msg.content, routeDecision: msg.routeDecision })
      }
    }) as unknown as () => Promise<void>)
    return { appended, updated }
  }

  it('persists step-1 text even when NO callback ever fires — the reported failure', async () => {
    const { appended } = captureAssistant('c-061a')
    mocks.mockStreamText.mockImplementationOnce(
      ({ onStepFinish }: { onStepFinish?: (s: unknown) => void }) => {
        // Two steps land, then the process is killed: no onFinish, no onError, no onAbort.
        onStepFinish?.({ text: 'Here are the two strongest matches', toolResults: [] })
        onStepFinish?.({ text: '', toolResults: [] })
        return {
          consumeStream: vi.fn(async () => {}),
          toUIMessageStreamResponse: vi.fn(() => new Response('s')),
        }
      },
    )

    await POST(buildRequest({ messages: [{ role: 'user', content: 'q' }], cid: 'c-061a' }))
    await flushWrites()

    expect(appended).toHaveLength(1)
    expect(appended[0].content).toBe('Here are the two strongest matches')
    // Marked incomplete in the observable D-02 field, never in the content.
    expect(appended[0].routeDecision).toMatch(/:partial$/)
  })

  it('extends the SAME row across steps rather than appending one per step', async () => {
    const { appended, updated } = captureAssistant('c-061b')
    mocks.mockStreamText.mockImplementationOnce(
      ({ onStepFinish }: { onStepFinish?: (s: unknown) => void }) => {
        onStepFinish?.({ text: 'first', toolResults: [] })
        onStepFinish?.({ text: 'second', toolResults: [] })
        onStepFinish?.({ text: 'third', toolResults: [] })
        return {
          consumeStream: vi.fn(async () => {}),
          toUIMessageStreamResponse: vi.fn(() => new Response('s')),
        }
      },
    )

    await POST(buildRequest({ messages: [{ role: 'user', content: 'q' }], cid: 'c-061b' }))
    await flushWrites()

    expect(appended).toHaveLength(1)
    expect(updated).toHaveLength(2)
    expect(updated.at(-1)!.content).toBe('first\n\nsecond\n\nthird')
  })

  it('a completed turn ends CLEAN — onFinish clears the :partial marker', async () => {
    const { appended, updated } = captureAssistant('c-061c')
    mocks.mockStreamText.mockImplementationOnce(
      ({ onStepFinish, onFinish }: {
        onStepFinish?: (s: unknown) => void
        onFinish?: (r: Record<string, unknown>) => Promise<void>
      }) => {
        onStepFinish?.({ text: 'searching', toolResults: [] })
        void onFinish?.({
          ...mockFinalResult,
          text: 'searching\n\nthe full ranked answer',
          steps: [{ text: 'searching' }, { text: 'the full ranked answer' }],
        })
        return {
          consumeStream: vi.fn(async () => {}),
          toUIMessageStreamResponse: vi.fn(() => new Response('s')),
        }
      },
    )

    await POST(buildRequest({ messages: [{ role: 'user', content: 'q' }], cid: 'c-061c' }))
    await flushWrites()

    expect(appended).toHaveLength(1)
    const final = updated.at(-1)!
    expect(final.content).toBe('searching\n\nthe full ranked answer')
    expect(final.routeDecision).not.toMatch(/:partial$/)
  })

  it('a tool-only step writes nothing — no empty bubble mid-loop', async () => {
    const { appended, updated } = captureAssistant('c-061d')
    mocks.mockStreamText.mockImplementationOnce(
      ({ onStepFinish }: { onStepFinish?: (s: unknown) => void }) => {
        onStepFinish?.({ text: '', toolResults: [{ toolName: 'searchProjects' }] })
        return {
          consumeStream: vi.fn(async () => {}),
          toUIMessageStreamResponse: vi.fn(() => new Response('s')),
        }
      },
    )

    await POST(buildRequest({ messages: [{ role: 'user', content: 'q' }], cid: 'c-061d' }))
    await flushWrites()

    expect(appended).toEqual([])
    expect(updated).toEqual([])
  })
})
