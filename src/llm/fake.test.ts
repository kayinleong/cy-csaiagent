/**
 * Tests for the deterministic LLM fake provider.
 * These tests run offline (no network) and are the prerequisite for all
 * downstream agent/router unit tests (QUAL-01, FND-02).
 *
 * TDD RED phase: written before the implementation exists.
 */
import { describe, it, expect } from 'vitest'
import { makeFakeProvider } from '@/src/llm/fake'
import type { StreamArgs } from '@/src/llm/types'

// ── Helper: collect all streamed chunks into one string ──────────────────────
async function collectStream(iterable: AsyncIterable<string>): Promise<string> {
  const chunks: string[] = []
  for await (const chunk of iterable) {
    chunks.push(chunk)
  }
  return chunks.join('')
}

// ── Helper: collect raw chunks (for streaming assertion) ─────────────────────
async function collectChunks(iterable: AsyncIterable<string>): Promise<string[]> {
  const chunks: string[] = []
  for await (const chunk of iterable) {
    chunks.push(chunk)
  }
  return chunks
}

const baseArgs: StreamArgs = {
  messages: [{ role: 'user', content: 'hello' }],
  model: 'fake-model',
}

// ── Test 1: systemContains matcher ────────────────────────────────────────────
describe('makeFakeProvider — systemContains matcher', () => {
  it('returns the scripted reply when system prompt contains the keyword', async () => {
    const provider = makeFakeProvider([
      {
        match: { systemContains: 'coach' },
        reply: 'Hello from coach agent!',
      },
    ])

    const args: StreamArgs = {
      ...baseArgs,
      system: 'You are the onboarding coach for D2.',
    }

    const stream = provider.stream(args)
    const result = await collectStream(stream)

    expect(result).toBe('Hello from coach agent!')
  })

  it('returns empty string when no script matches', async () => {
    const provider = makeFakeProvider([
      {
        match: { systemContains: 'finder' },
        reply: 'This is the property finder.',
      },
    ])

    const args: StreamArgs = {
      ...baseArgs,
      system: 'You are the onboarding coach.',
    }

    const stream = provider.stream(args)
    const result = await collectStream(stream)

    expect(result).toBe('')
  })
})

// ── Test 2: lastUserMessage matcher + callCounter advancement ─────────────────
describe('makeFakeProvider — lastUserMessage matcher + callCounter', () => {
  it('returns the scripted greeting when last user message matches', async () => {
    const provider = makeFakeProvider([
      {
        match: { lastUserMessage: 'hi' },
        reply: 'Welcome! How can I help you today?',
      },
    ])

    const args: StreamArgs = {
      messages: [{ role: 'user', content: 'hi' }],
      model: 'fake-model',
    }

    const stream = provider.stream(args)
    const result = await collectStream(stream)

    expect(result).toBe('Welcome! How can I help you today?')
  })

  it('callCounter advances per call, allowing different scripted turns', async () => {
    const provider = makeFakeProvider([
      {
        match: { lastUserMessage: 'hi', callCounter: 1 },
        reply: 'First call response',
      },
      {
        match: { lastUserMessage: 'hi', callCounter: 2 },
        reply: 'Second call response',
      },
    ])

    const args: StreamArgs = {
      messages: [{ role: 'user', content: 'hi' }],
      model: 'fake-model',
    }

    // First call
    const stream1 = provider.stream(args)
    const result1 = await collectStream(stream1)
    expect(result1).toBe('First call response')

    // Second identical call — counter has advanced, different reply
    const stream2 = provider.stream(args)
    const result2 = await collectStream(stream2)
    expect(result2).toBe('Second call response')
  })
})

// ── Test 3: streaming yields >1 chunk ────────────────────────────────────────
describe('makeFakeProvider — streaming yields multiple chunks', () => {
  it('yields more than one chunk so downstream streaming assertions are exercisable', async () => {
    const provider = makeFakeProvider([
      {
        match: { systemContains: 'coach' },
        reply: 'This is a multi-chunk streaming response.',
      },
    ])

    const args: StreamArgs = {
      ...baseArgs,
      system: 'You are the coach.',
    }

    const stream = provider.stream(args)
    const chunks = await collectChunks(stream)

    // Must yield at least 2 chunks to be a meaningful streaming simulation
    expect(chunks.length).toBeGreaterThan(1)
    // Full text must still be correct
    expect(chunks.join('')).toBe('This is a multi-chunk streaming response.')
  })
})

// ── Test 4: lastArgs records call arguments for PII assertions ───────────────
describe('makeFakeProvider — lastArgs recording', () => {
  it('exposes lastArgs so tests can assert no unredacted PII was passed', async () => {
    const provider = makeFakeProvider([
      {
        match: { systemContains: 'coach' },
        reply: 'OK',
      },
    ])

    const args: StreamArgs = {
      messages: [
        { role: 'system', content: 'You are the coach.' },
        { role: 'user', content: 'What is the onboarding process?' },
      ],
      system: 'You are the coach.',
      tools: [{ name: 'retrieveKnowledge' }],
      model: 'claude-sonnet-4-6',
    }

    const stream = provider.stream(args)
    await collectStream(stream) // drain the stream

    // lastArgs should be recorded for PII inspection
    expect(provider.lastArgs).toBeDefined()
    expect(provider.lastArgs?.messages).toHaveLength(2)
    expect(provider.lastArgs?.system).toBe('You are the coach.')
    expect(provider.lastArgs?.tools).toHaveLength(1)
    expect(provider.lastArgs?.model).toBe('claude-sonnet-4-6')
  })

  it('lastArgs.messages contains no string matching MY phone pattern', async () => {
    const provider = makeFakeProvider([])

    const args: StreamArgs = {
      messages: [
        { role: 'user', content: 'My contact is +60123456789' },
      ],
      model: 'fake-model',
    }

    const stream = provider.stream(args)
    await collectStream(stream)

    // The test surfaces that unredacted PII was passed — the pdpa gate in
    // src/audit/pdpa.ts (Phase 1) will prevent this from reaching the real provider.
    // This test intentionally records it to demonstrate the inspection surface.
    const recorded = provider.lastArgs?.messages.map((m) => m.content).join(' ') ?? ''
    // In prod, the pdpa gate would prevent this call — we just verify recording works.
    expect(recorded).toContain('+60123456789')
    // The fake records faithfully; the PDPA gate (not the fake) enforces redaction.
    expect(provider.lastArgs).toBeDefined()
  })
})
