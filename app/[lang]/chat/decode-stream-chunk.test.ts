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
  parseTextChunk,
  TEXT_BLOCK_SEPARATOR,
  isTextBlockEnd,
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

// ─── quick-kayinleong-048: step-boundary paragraph breaks ─────────────────────

describe('parseTextChunk', () => {
  it('returns the delta together with its text-block id', () => {
    expect(parseTextChunk('{"type":"text-delta","id":"b1","delta":"Hello"}')).toEqual({
      id: 'b1',
      delta: 'Hello',
    })
  })

  it('defaults a missing id to empty string rather than dropping the delta', () => {
    // Losing the text would be far worse than losing the boundary hint.
    expect(parseTextChunk('{"type":"text-delta","delta":"Hi"}')).toEqual({ id: '', delta: 'Hi' })
  })

  it('returns null for non-text-delta chunks and malformed lines', () => {
    expect(parseTextChunk('{"type":"text-start","id":"b1"}')).toBeNull()
    expect(parseTextChunk('{"type":"finish"}')).toBeNull()
    expect(parseTextChunk('garbage')).toBeNull()
  })

  it('stays consistent with parseTextDelta on the delta itself', () => {
    const line = '{"type":"text-delta","id":"b2","delta":" world"}'
    expect(parseTextChunk(line)?.delta).toBe(parseTextDelta(line))
  })
})

describe('step-boundary joining (the "now.The search" bug)', () => {
  /**
   * Mirrors the accumulation rule in chat-input.tsx: insert TEXT_BLOCK_SEPARATOR when
   * the block id changes mid-turn, and never at the very start.
   */
  function accumulate(lines: string[]): string {
    let content = ''
    let currentId: string | null = null
    for (const line of lines) {
      const c = parseTextChunk(line)
      if (!c) continue
      const isNewBlock = currentId !== null && c.id !== currentId
      currentId = c.id
      content += isNewBlock && content.length > 0 ? TEXT_BLOCK_SEPARATOR + c.delta : c.delta
    }
    return content
  }

  const d = (id: string, delta: string) =>
    JSON.stringify({ type: 'text-delta', id, delta })

  it('separates two steps instead of welding them together', () => {
    // The real Finder turn: step 1 narrates, calls searchProjects, step 2 continues.
    const out = accumulate([
      d('b1', 'Got it. Let me search now.'),
      d('b2', 'The search returned results'),
    ])
    expect(out).toBe('Got it. Let me search now.\n\nThe search returned results')
    expect(out).not.toContain('now.The search')
  })

  it('does NOT insert a separator between deltas of the same block', () => {
    // Mid-block newlines are the model's own formatting and must survive untouched.
    expect(accumulate([d('b1', 'Hello'), d('b1', ' there'), d('b1', '!')])).toBe(
      'Hello there!',
    )
  })

  it('never opens the message with a blank line', () => {
    expect(accumulate([d('b1', 'First')])).toBe('First')
    // Even if the very first chunk somehow arrives under a fresh id after an empty one.
    expect(accumulate([d('b1', ''), d('b2', 'First')])).toBe('First')
  })

  it('handles three or more steps', () => {
    expect(accumulate([d('a', 'one'), d('b', 'two'), d('c', 'three')])).toBe(
      'one\n\ntwo\n\nthree',
    )
  })

  it('uses a blank line, not a soft break — markdown would still run it together', () => {
    expect(TEXT_BLOCK_SEPARATOR).toBe('\n\n')
  })
})

// ─── quick-kayinleong-054: the REAL block boundary signal ─────────────────────
//
// quick-048 detected step boundaries by watching the text-delta id change. A raw SSE
// capture of a real Finder turn proved the SDK REUSES id "0" for every block, so that
// test never fired and the blocks welded together anyway. The 048 tests passed only
// because they used a synthetic stream with distinct ids.

describe('isTextBlockEnd', () => {
  it('detects a text-end chunk', () => {
    expect(isTextBlockEnd('{"type":"text-end","id":"0"}')).toBe(true)
  })

  it('is false for every other chunk type', () => {
    expect(isTextBlockEnd('{"type":"text-start","id":"0"}')).toBe(false)
    expect(isTextBlockEnd('{"type":"text-delta","id":"0","delta":"hi"}')).toBe(false)
    expect(isTextBlockEnd('{"type":"finish-step"}')).toBe(false)
    expect(isTextBlockEnd('not json')).toBe(false)
  })
})

describe('quick-054: separator fires on REPEATED block ids', () => {
  /** Mirrors chat-input's accumulation, now keyed on text-end rather than an id change. */
  function accumulate(lines: string[]): string {
    let content = ''
    let sawEnd = false
    for (const line of lines) {
      if (isTextBlockEnd(line)) { sawEnd = true; continue }
      const c = parseTextChunk(line)
      if (!c) continue
      const isNew = sawEnd && content.length > 0
      sawEnd = false
      content += isNew ? TEXT_BLOCK_SEPARATOR + c.delta : c.delta
    }
    return content
  }
  const d = (id: string, delta: string) => JSON.stringify({ type: 'text-delta', id, delta })
  const end = (id: string) => JSON.stringify({ type: 'text-end', id })

  it('separates two blocks that BOTH carry id "0" — the real SDK shape', () => {
    // Verbatim structure from the SSE capture.
    const out = accumulate([
      d('0', 'Let me search the inventory now.'),
      end('0'),
      d('0', '{\n  "matches": ['),
    ])
    expect(out).toBe('Let me search the inventory now.\n\n{\n  "matches": [')
    expect(out).not.toContain('now.{')
  })

  it('does not separate deltas within one block', () => {
    expect(accumulate([d('0', 'Hello'), d('0', ' there')])).toBe('Hello there')
  })

  it('never opens a message with a blank line', () => {
    // A turn can end a block before any text has accumulated.
    expect(accumulate([end('0'), d('0', 'First')])).toBe('First')
  })

  it('handles three blocks all sharing one id', () => {
    expect(
      accumulate([d('0', 'a'), end('0'), d('0', 'b'), end('0'), d('0', 'c')]),
    ).toBe('a\n\nb\n\nc')
  })
})

// ─── quick-kayinleong-085: finderRows on the finish chunk ────────────────────

describe('parseMessageMetadata: finderRows', () => {
  const row = (i: number) => ({
    projectId: `p${i}`,
    name: `Project ${i}`,
    priceValue: 0,
    bedrooms: 0,
    tenure: 'Freehold',
    locationText: 'Kuala Lumpur',
    vpStatus: false,
    bumiQuota: false,
    foreignEligible: true,
    sizeMinSqft: 904,
    sizeMaxSqft: 4855,
    score: 0.7,
  })

  const finish = (meta: Record<string, unknown>) =>
    JSON.stringify({ type: 'finish', messageMetadata: { pillar: 'finder', ...meta } })

  it('recovers the rows from a finish chunk', () => {
    const meta = parseMessageMetadata(finish({ finderRows: [row(1), row(2)] }))
    expect(meta?.finderRows).toHaveLength(2)
    expect(meta?.finderRows?.map((r) => r.projectId)).toEqual(['p1', 'p2'])
  })

  it('drops a malformed entry ITEM BY ITEM while its valid siblings survive', () => {
    // One bad row must cost that row, not the whole table — same discipline as
    // collateralByProject.
    const meta = parseMessageMetadata(
      finish({ finderRows: [row(1), { projectId: '' }, null, 'nope', row(2)] }),
    )
    expect(meta?.finderRows?.map((r) => r.projectId)).toEqual(['p1', 'p2'])
  })

  it('yields no finderRows for a non-array value', () => {
    expect(parseMessageMetadata(finish({ finderRows: { p1: row(1) } }))?.finderRows).toBeUndefined()
    expect(parseMessageMetadata(finish({ finderRows: 'p1' }))?.finderRows).toBeUndefined()
  })

  it('yields no finderRows when every entry is malformed', () => {
    expect(parseMessageMetadata(finish({ finderRows: [{}, null] }))?.finderRows).toBeUndefined()
  })

  it('a turn with no finderRows key is unaffected', () => {
    const meta = parseMessageMetadata(finish({ citations: ['c1'] }))
    expect(meta?.pillar).toBe('finder')
    expect(meta?.finderRows).toBeUndefined()
  })
})
