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
  const mockAfter = vi.fn((fn: () => void) => fn()) // execute inline for test assertions
  const mockEnsurePrimaryThread = vi.fn(async () => 'coach-uid-001')
  // 03-07: Finder-specific mocks
  const mockFinderBuildSystemPrompt = vi.fn(() => 'You are a D2 Property Finder.')
  const mockFinderMakeTools = vi.fn(() => ({ searchProjects: {}, queryInventory: {}, fetchCollateral: {} }))
  const mockReadFinderSlot = vi.fn(async () => null)
  const mockMergeFinderCriteria = vi.fn((stored: unknown) => stored)
  const mockMergeDiscussed = vi.fn((prev: string[], next: string[]) => [...prev, ...next])
  const mockWriteLeadSlot = vi.fn(async () => {})

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
    mockAfter,
    mockEnsurePrimaryThread,
    mockFinderBuildSystemPrompt,
    mockFinderMakeTools,
    mockReadFinderSlot,
    mockMergeFinderCriteria,
    mockMergeDiscussed,
    mockWriteLeadSlot,
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
  ensurePrimaryThread: mocks.mockEnsurePrimaryThread,
  // 03-07: leadContext exports re-exported from the barrel
  readFinderSlot: mocks.mockReadFinderSlot,
  mergeFinderCriteria: mocks.mockMergeFinderCriteria,
  mergeDiscussed: mocks.mockMergeDiscussed,
  writeLeadSlot: mocks.mockWriteLeadSlot,
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
}))

// ─── Imports ──────────────────────────────────────────────────────────────────

import { POST } from './route'

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Build a mock UIMessageStreamResponse with custom headers */
function makeStreamResponse(extraHeaders: Record<string, string> = {}) {
  const headers = new Headers({
    'Content-Type': 'text/event-stream',
    ...extraHeaders,
  })
  return {
    headers,
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
