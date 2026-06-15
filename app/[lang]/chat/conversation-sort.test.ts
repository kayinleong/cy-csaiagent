/**
 * Tests for app/[lang]/chat/conversation-sort.ts (quick-kayinleong-010, CHAT-07).
 *
 * Behaviors proved:
 *   - A null-createdAt thread is NOT dropped and sorts to the FIRST position
 *     (null = newest — serverTimestamp() not yet resolved).
 *   - Two dated threads order createdAt DESC (newer first).
 *   - Mixed (null + dated): null first, then dated desc.
 *   - The input array is not mutated; a new array is returned.
 *
 * Pure module — no React/firebase pull-in, runs under the node vitest env.
 */

import { describe, it, expect } from 'vitest'
import { sortConversationsByCreatedAtDesc } from './conversation-sort'

describe('sortConversationsByCreatedAtDesc (quick-010 — null = newest, desc order)', () => {
  it('sorts null-createdAt to the FIRST position (not dropped), then dated desc', () => {
    const input = [
      { id: 'a', createdAt: null },
      { id: 'b', createdAt: new Date('2026-01-02') },
      { id: 'c', createdAt: new Date('2026-01-01') },
    ]

    const result = sortConversationsByCreatedAtDesc(input)

    expect(result.map((r) => r.id)).toEqual(['a', 'b', 'c'])
    // null is present, not filtered out
    expect(result).toHaveLength(3)
  })

  it('orders two dated-only threads newer-first', () => {
    const input = [
      { id: 'older', createdAt: new Date('2026-01-01') },
      { id: 'newer', createdAt: new Date('2026-03-15') },
    ]

    const result = sortConversationsByCreatedAtDesc(input)

    expect(result.map((r) => r.id)).toEqual(['newer', 'older'])
  })

  it('returns a NEW array and does not mutate the input', () => {
    const input = [
      { id: 'a', createdAt: null },
      { id: 'b', createdAt: new Date('2026-01-02') },
      { id: 'c', createdAt: new Date('2026-01-01') },
    ]
    const originalOrder = input.map((r) => r.id)

    const result = sortConversationsByCreatedAtDesc(input)

    // New reference
    expect(result).not.toBe(input)
    // Input order unchanged after the call
    expect(input.map((r) => r.id)).toEqual(originalOrder)
  })
})
