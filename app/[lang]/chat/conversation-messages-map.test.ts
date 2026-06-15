import { describe, it, expect } from 'vitest'
import { mapConversationMessages, type RawMessageRecord } from './conversation-messages-map'

describe('mapConversationMessages (quick-018 — transcript ordering + mapping)', () => {
  it('keeps a null-createdAt message and sorts it before timestamped ones (oldest, not dropped)', () => {
    const recs: RawMessageRecord[] = [
      { id: 'b', role: 'assistant', content: 'second', citations: [], createdAt: new Date('2026-01-02') },
      { id: 'legacy', role: 'user', content: 'legacy', citations: [], createdAt: null },
      { id: 'a', role: 'user', content: 'first', citations: [], createdAt: new Date('2026-01-01') },
    ]
    expect(mapConversationMessages(recs).map((m) => m.id)).toEqual(['legacy', 'a', 'b'])
  })

  it('orders timestamped messages ascending (oldest first)', () => {
    const recs: RawMessageRecord[] = [
      { id: 'new', role: 'assistant', content: '', citations: [], createdAt: new Date('2026-03-01') },
      { id: 'old', role: 'user', content: '', citations: [], createdAt: new Date('2026-01-01') },
    ]
    expect(mapConversationMessages(recs).map((m) => m.id)).toEqual(['old', 'new'])
  })

  it("filters out 'system' messages (UI shows only user/assistant)", () => {
    const recs: RawMessageRecord[] = [
      { id: 's', role: 'system', content: 'sys', citations: [], createdAt: new Date('2026-01-01') },
      { id: 'u', role: 'user', content: 'hi', citations: [], createdAt: new Date('2026-01-02') },
    ]
    const out = mapConversationMessages(recs)
    expect(out.map((m) => m.id)).toEqual(['u'])
    expect(out.every((m) => m.role === 'user' || m.role === 'assistant')).toBe(true)
  })

  it('maps citation chunk-id strings to ChatMessage citation objects', () => {
    const recs: RawMessageRecord[] = [
      { id: 'a', role: 'assistant', content: 'x', citations: ['chunk-1', 'chunk-2'], createdAt: new Date('2026-01-01') },
    ]
    expect(mapConversationMessages(recs)[0].citations).toEqual([
      { chunkId: 'chunk-1' },
      { chunkId: 'chunk-2' },
    ])
  })

  it('defaults missing content/citations and does not mutate the input array', () => {
    const recs: RawMessageRecord[] = [
      { id: 'b', role: 'user', createdAt: new Date('2026-01-02') },
      { id: 'a', role: 'user', createdAt: new Date('2026-01-01') },
    ]
    const before = recs.map((r) => r.id)
    const out = mapConversationMessages(recs)
    expect(out.map((m) => m.id)).toEqual(['a', 'b'])
    expect(out[0]).toMatchObject({ content: '', citations: [] })
    expect(recs.map((r) => r.id)).toEqual(before) // input untouched
  })
})
