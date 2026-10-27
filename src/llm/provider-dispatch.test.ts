/**
 * src/llm/provider-dispatch.test.ts — modelFor routes an id to the provider that OWNS it
 * (quick-kayinleong-089).
 *
 * `modelFor` used to end in an unconditional `return anthropic(modelId)`, which made the
 * project's "model-agnostic, ids live in Firestore" design Anthropic-ONLY: publishing a
 * Gemini id resolved it correctly and then handed it to the wrong SDK.
 *
 * That became load-bearing rather than theoretical. The app runs on Netlify, whose function
 * ceiling kills a request at exactly 30s (observed: `Duration: 30000 ms`). A full
 * projectDetail answer measured 39.9s on claude-sonnet-4-6 and 20.3s on gemini-3.5-flash at
 * equal detail (3,819 vs 3,858 chars), so switching provider is what keeps answers from
 * being truncated mid unit-price table. The one swap surface the project has had to be able
 * to reach a second provider for that to be possible.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { LanguageModel } from 'ai'

/**
 * `LanguageModel` is a union: the SDK also accepts a bare model-id STRING. modelFor always
 * returns the object form, but the type does not know that, so narrow once here rather than
 * casting at every assertion.
 */
function handle(m: LanguageModel): { provider: string; modelId: string } {
  if (typeof m === 'string') throw new Error(`modelFor returned a bare string: ${m}`)
  return m as { provider: string; modelId: string }
}

const mockGet = vi.fn()
// MODEL_CONFIG_DOC_ID must be exported too: provider.ts imports it alongside appConfigRef,
// and a mock missing it makes the Firestore read throw — which modelFor CATCHES, silently
// falling back to the labelled Claude default. The first version of this test passed
// through that path and asserted against the fallback rather than the dispatch.
vi.mock('@/src/firebase/collections', () => ({
  appConfigRef: () => ({ doc: () => ({ get: mockGet }) }),
  MODEL_CONFIG_DOC_ID: 'modelConfig',
}))

describe('modelFor: provider dispatch', () => {
  beforeEach(() => {
    vi.resetModules()
    mockGet.mockReset()
  })

  it('sends a gemini-* id to the Google provider', async () => {
    mockGet.mockResolvedValue({ data: () => ({ models: { finder: 'gemini-3.5-flash' } }) })
    const { modelFor } = await import('@/src/llm/provider')
    const model = handle(await modelFor('finder'))
    // The AI SDK stamps the owning provider on the handle — asserting it is what catches a
    // regression back to an unconditional anthropic() call.
    expect(model.provider).toMatch(/google/i)
    expect(model.modelId).toBe('gemini-3.5-flash')
  })

  it('still sends a claude-* id to Anthropic', async () => {
    mockGet.mockResolvedValue({ data: () => ({ models: { finder: 'claude-sonnet-4-6' } }) })
    const { modelFor } = await import('@/src/llm/provider')
    const model = handle(await modelFor('finder'))
    expect(model.provider).toMatch(/anthropic/i)
    expect(model.modelId).toBe('claude-sonnet-4-6')
  })

  it('falls back to the labelled default when Firestore is unavailable', async () => {
    mockGet.mockRejectedValue(new Error('offline'))
    const { modelFor } = await import('@/src/llm/provider')
    const model = handle(await modelFor('finder'))
    expect(model.modelId.length).toBeGreaterThan(0)
  })
})

describe('modelFor: LOCAL_MODEL_OVERRIDE (quick-kayinleong-099)', () => {
  beforeEach(() => {
    vi.resetModules()
    mockGet.mockReset()
    mockGet.mockResolvedValue({ data: () => ({ models: { finder: 'claude-sonnet-4-6', router: 'claude-haiku-4-5' } }) })
  })
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('outside production, the override wins for every pillar and skips Firestore', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('LOCAL_MODEL_OVERRIDE', 'gemini-3.5-flash')
    const { modelFor } = await import('@/src/llm/provider')
    for (const pillar of ['finder', 'router', 'coach'] as const) {
      const model = handle(await modelFor(pillar))
      expect(model.provider).toMatch(/google/i)
      expect(model.modelId).toBe('gemini-3.5-flash')
    }
    expect(mockGet).not.toHaveBeenCalled()
  })

  it('in production the override is IGNORED and Firestore decides', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('LOCAL_MODEL_OVERRIDE', 'gemini-3.5-flash')
    const { modelFor } = await import('@/src/llm/provider')
    const model = handle(await modelFor('finder'))
    expect(model.provider).toMatch(/anthropic/i)
    expect(model.modelId).toBe('claude-sonnet-4-6')
  })

  it('a blank override is treated as unset', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('LOCAL_MODEL_OVERRIDE', '   ')
    const { modelFor } = await import('@/src/llm/provider')
    expect(handle(await modelFor('finder')).modelId).toBe('claude-sonnet-4-6')
  })
})
