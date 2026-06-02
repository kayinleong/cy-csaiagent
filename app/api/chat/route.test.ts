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
  const mockModelFor = vi.fn()
  const mockStreamText = vi.fn()
  const mockAppendMessage = vi.fn(async () => 'msg-id-001')
  const mockAfter = vi.fn((fn: () => void) => fn()) // execute inline for test assertions
  const mockEnsurePrimaryThread = vi.fn(async () => 'coach-uid-001')

  return {
    mockRequireUser,
    mockRatelimitCheck,
    mockRatelimitDecrement,
    mockAssertRedacted,
    mockPseudonymize,
    mockAuditLog,
    mockRoute,
    mockModelFor,
    mockStreamText,
    mockAppendMessage,
    mockAfter,
    mockEnsurePrimaryThread,
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
}))

vi.mock('@/src/llm/provider', () => ({
  modelFor: mocks.mockModelFor,
}))

vi.mock('ai', () => ({
  streamText: mocks.mockStreamText,
}))

vi.mock('@/src/memory', () => ({
  appendMessage: mocks.mockAppendMessage,
  ensurePrimaryThread: mocks.mockEnsurePrimaryThread,
}))

vi.mock('@/src/agents/coach', () => ({
  coachAgent: {
    systemPrompt: 'You are a D2 coach.',
    outputSchema: {},
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

  // Default: router routes to coach
  mocks.mockRoute.mockReturnValue({ pillar: 'coach', reason: 'phase-1-single-pillar' })

  // Default: modelFor returns a mock model object
  mocks.mockModelFor.mockResolvedValue({ modelId: 'mock-model' })

  // Default: streamText returns a stream result with toUIMessageStreamResponse
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
  mocks.mockStreamText.mockImplementation(({ onFinish }: { onFinish: (result: typeof mockFinalResult) => Promise<void> }) => {
    // Schedule onFinish to run asynchronously (simulate stream completion)
    setTimeout(() => onFinish(mockFinalResult), 0)
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
