/**
 * decode-stream-chunk.test.ts — the SSE UI Message Stream chunk parsers.
 *
 * Locks the fix for the chat-not-rendering bug (quick-kayinleong-007): the route emits the
 * AI SDK v5 UI Message Stream JSON format ({"type":"text-delta","delta":"…"}); the parser
 * must extract `delta` from those lines and ignore everything else — including the legacy v4
 * data-stream format (`0:"token"`) the old regex parsed, which the route never emits.
 */

import { describe, it, expect } from 'vitest'
import {
  parseTextDelta,
  isHandoffChunk,
  parseStreamError,
  parseMessageMetadata,
} from './decode-stream-chunk'

describe('parseTextDelta', () => {
  it('extracts the delta string from a v5 text-delta chunk', () => {
    expect(parseTextDelta('{"type":"text-delta","id":"0","delta":"Hello"}')).toBe('Hello')
  })

  it('preserves whitespace and escaped characters in the delta', () => {
    expect(
      parseTextDelta('{"type":"text-delta","id":"0","delta":" a new D2 agent.\\n\\nHello"}'),
    ).toBe(' a new D2 agent.\n\nHello')
    expect(parseTextDelta('{"type":"text-delta","id":"0","delta":"Ps**"}')).toBe('Ps**')
  })

  it('returns an empty-string delta verbatim (not null)', () => {
    expect(parseTextDelta('{"type":"text-delta","id":"0","delta":""}')).toBe('')
  })

  it('ignores non-text lifecycle chunks', () => {
    expect(parseTextDelta('{"type":"start"}')).toBeNull()
    expect(parseTextDelta('{"type":"start-step"}')).toBeNull()
    expect(parseTextDelta('{"type":"text-start","id":"0"}')).toBeNull()
    expect(parseTextDelta('{"type":"text-end","id":"0"}')).toBeNull()
    expect(parseTextDelta('{"type":"finish-step"}')).toBeNull()
    expect(parseTextDelta('{"type":"finish","finishReason":"stop"}')).toBeNull()
  })

  it('ignores tool and error chunks', () => {
    expect(parseTextDelta('{"type":"tool-input-delta","toolCallId":"t1","inputTextDelta":"x"}')).toBeNull()
    expect(parseTextDelta('{"type":"error","errorText":"boom"}')).toBeNull()
  })

  it('does NOT match the legacy v4 data-stream format (it is dead)', () => {
    expect(parseTextDelta('0:"Hello"')).toBeNull()
    expect(parseTextDelta('e:{"finishReason":"stop"}')).toBeNull()
  })

  it('returns null for malformed / non-JSON lines without throwing', () => {
    expect(parseTextDelta('')).toBeNull()
    expect(parseTextDelta('not json')).toBeNull()
    expect(parseTextDelta('{"type":"text-delta"')).toBeNull() // truncated JSON
    expect(parseTextDelta('{"type":"text-delta","id":"0"}')).toBeNull() // delta missing
    expect(parseTextDelta('{"type":"text-delta","delta":42}')).toBeNull() // delta not a string
    expect(parseTextDelta('null')).toBeNull()
    expect(parseTextDelta('"just a string"')).toBeNull()
  })
})

describe('isHandoffChunk', () => {
  it('detects kb_miss and handoff markers anywhere in the line', () => {
    expect(isHandoffChunk('{"type":"data-handoff","data":{}}')).toBe(true)
    expect(isHandoffChunk('{"result":{"found":false,"reason":"kb_miss"}}')).toBe(true)
  })

  it('returns false for ordinary text chunks', () => {
    expect(isHandoffChunk('{"type":"text-delta","id":"0","delta":"Hello"}')).toBe(false)
  })
})

// ─── quick-kayinleong-046 ─────────────────────────────────────────────────────

describe('parseStreamError', () => {
  it('extracts errorText from an error chunk', () => {
    // A model failure mid-stream arrives on an already-200 response, so the client's
    // `!response.ok` check never sees it. Dropping this chunk is what produced the
    // reported "it didn't respond": empty bubble, no toast, spinner stuck.
    expect(parseStreamError('{"type":"error","errorText":"overloaded_error"}')).toBe(
      'overloaded_error',
    )
  })

  it('falls back to a generic label when errorText is empty or missing', () => {
    expect(parseStreamError('{"type":"error","errorText":""}')).toBe('stream error')
    expect(parseStreamError('{"type":"error"}')).toBe('stream error')
  })

  it('returns null for non-error chunks and malformed lines', () => {
    expect(parseStreamError('{"type":"text-delta","id":"0","delta":"hi"}')).toBeNull()
    expect(parseStreamError('{"type":"finish"}')).toBeNull()
    expect(parseStreamError('not json')).toBeNull()
    expect(parseStreamError('')).toBeNull()
  })
})

describe('parseMessageMetadata', () => {
  it('reads the pillar off the start chunk', () => {
    expect(
      parseMessageMetadata('{"type":"start","messageMetadata":{"pillar":"finder"}}'),
    ).toEqual({ pillar: 'finder' })
  })

  it('reads citations and kbMiss off the finish chunk', () => {
    expect(
      parseMessageMetadata(
        '{"type":"finish","messageMetadata":{"pillar":"coach","citations":["a","b"],"kbMiss":false}}',
      ),
    ).toEqual({ pillar: 'coach', citations: ['a', 'b'], kbMiss: false })
  })

  it('accepts a standalone message-metadata chunk', () => {
    expect(
      parseMessageMetadata('{"type":"message-metadata","messageMetadata":{"kbMiss":true}}'),
    ).toEqual({ kbMiss: true })
  })

  it('ignores an unrecognised pillar rather than trusting it', () => {
    // The pillar selects which decoder runs; a bogus value must not reach that switch.
    expect(
      parseMessageMetadata('{"type":"start","messageMetadata":{"pillar":"wat"}}'),
    ).toBeNull()
  })

  it('drops non-string entries from citations', () => {
    expect(
      parseMessageMetadata('{"type":"finish","messageMetadata":{"citations":["a",7,null]}}'),
    ).toEqual({ citations: ['a'] })
  })

  it('returns null for chunks that carry no metadata', () => {
    expect(parseMessageMetadata('{"type":"text-delta","id":"0","delta":"hi"}')).toBeNull()
    expect(parseMessageMetadata('{"type":"finish"}')).toBeNull()
    expect(parseMessageMetadata('{"type":"start","messageMetadata":null}')).toBeNull()
    expect(parseMessageMetadata('nope')).toBeNull()
  })
})

describe('isHandoffChunk (deprecated)', () => {
  it('false-positives on any line merely containing the word — why it was replaced', () => {
    // Documents the flaw: it could only ever fire because the Coach's JSON envelope was
    // leaking into the stream as literal text, and it fired on innocent prose too.
    expect(isHandoffChunk('{"type":"text-delta","delta":"the handoff went well"}')).toBe(true)
  })
})
