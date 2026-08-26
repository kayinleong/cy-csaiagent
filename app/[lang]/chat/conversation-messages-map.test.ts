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

// ─── quick-kayinleong-050: pillar carried through history ─────────────────────
//
// A restored Finder/Reply turn had no pillar for the client decoder to gate on, so its
// raw JSON envelope rendered verbatim in the bubble — one of the "raw unprocessed output"
// reports. routeDecision was already persisted on every message (D-02); it just was not
// carried through this mapper.

describe('quick-050: structured output on history-loaded turns', () => {
  // Must satisfy FinderOutputSchema — matchedCriteria is a fully-specified object, not
  // a loose bag (src/agents/finder/schema.ts:151-158).
  const finderJson = JSON.stringify({
    matches: [
      {
        projectId: 'p1',
        rationale: 'Matches the stated budget and area.',
        matchedCriteria: {
          segment: 'own_stay',
          priceMax: 900000,
          nationality: 'malaysian',
          bumiputera: null,
          locationPref: 'Bangsar',
          bedrooms: 2,
        },
      },
    ],
  })
  const replyJson = JSON.stringify({
    draft: { text: 'Thanks for reaching out — could I ask your budget?', sopDocIds: ['sop-1'] },
  })

  it('decodes a Finder turn into a card instead of leaving raw JSON', () => {
    const [msg] = mapConversationMessages([
      { id: 'm1', role: 'assistant', content: finderJson, routeDecision: 'finder:heuristic-finder:keyword', createdAt: null },
    ])
    expect(msg.finderOutput).toBeDefined()
    expect(msg.finderOutput?.matches).toHaveLength(1)
  })

  it('surfaces a Reply turn as readable prose, NOT as a card', () => {
    // Deliberate: ReplyDraftCard requires a non-optional leadId that history does not
    // carry, and its edit-capture would then write rows against an empty lead.
    const [msg] = mapConversationMessages([
      { id: 'm2', role: 'assistant', content: replyJson, routeDecision: 'reply:manual-override', createdAt: null },
    ])
    expect(msg.replyOutput).toBeUndefined()
    expect(msg.content).toBe('Thanks for reaching out — could I ask your budget?')
    expect(msg.content).not.toContain('sopDocIds')
  })

  it('leaves a Coach turn alone', () => {
    const [msg] = mapConversationMessages([
      { id: 'm3', role: 'assistant', content: 'Plain prose answer.', routeDecision: 'coach:heuristic-coach:keyword', createdAt: null },
    ])
    expect(msg.content).toBe('Plain prose answer.')
    expect(msg.finderOutput).toBeUndefined()
  })

  it('is a no-op when routeDecision is absent (legacy messages)', () => {
    // Pre-D-02 messages have no routeDecision; they must still render, not throw.
    const [msg] = mapConversationMessages([
      { id: 'm4', role: 'assistant', content: finderJson, createdAt: null },
    ])
    expect(msg.finderOutput).toBeUndefined()
    expect(msg.content).toBe(finderJson)
  })

  it('never decodes a user turn', () => {
    const [msg] = mapConversationMessages([
      { id: 'm5', role: 'user', content: finderJson, routeDecision: 'finder:x', createdAt: null },
    ])
    expect(msg.finderOutput).toBeUndefined()
  })

  it('falls back to the raw content when the pillar says finder but it will not parse', () => {
    const [msg] = mapConversationMessages([
      { id: 'm6', role: 'assistant', content: 'not json at all', routeDecision: 'finder:x', createdAt: null },
    ])
    expect(msg.finderOutput).toBeUndefined()
    expect(msg.content).toBe('not json at all')
  })
})
