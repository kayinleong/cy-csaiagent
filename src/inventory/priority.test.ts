/**
 * src/inventory/priority.test.ts — admin Priority List matcher + boost
 * (quick-kayinleong-090).
 *
 * These are behavioural tests, not source greps. The invariant that matters is
 * NEGATIVE — the boost may reorder a result set and may never change its contents —
 * so the suite asserts what the boost cannot do at least as hard as what it can.
 */

import { describe, it, expect } from 'vitest'
import { priorityRankOf, applyPriorityBoost } from './priority'

/** Minimal shape the boost needs — mirrors the { doc, score, id } tuples in search.ts. */
function p(name: string) {
  return { doc: { name }, id: name.toLowerCase().replace(/\W+/g, '-') }
}

describe('priorityRankOf — matching an admin phrase to a corpus project name', () => {
  it('matches the exact stored name', () => {
    expect(priorityRankOf('Accent PJ', 'push Accent PJ first')).not.toBeNull()
  })

  it('matches on the leading segment, which is how admins actually write a name', () => {
    // The corpus name carries qualifiers nobody retypes.
    const stored = 'Royal Suites, Pavilion Damansara Heights (phase 2)'
    expect(priorityRankOf(stored, 'always recommend Royal Suites first')).not.toBeNull()
  })

  it('matches across an @ separator', () => {
    expect(priorityRankOf('Kensho @ Taman Desa', 'lead with Kensho')).not.toBeNull()
  })

  it('ignores punctuation and case differences on both sides', () => {
    expect(priorityRankOf('Kensho @ Taman Desa', 'KENSHO, taman desa.')).not.toBeNull()
  })

  it('returns null for a project the admin never named', () => {
    expect(priorityRankOf('Accent PJ', 'always recommend Royal Suites first')).toBeNull()
  })

  it('does not match a name fragment inside a longer word', () => {
    // "Accent" must not fire on "Accentuate" — the boost reorders live inventory.
    expect(priorityRankOf('Accent', 'we should accentuate the garden units')).toBeNull()
  })

  it('refuses aliases shorter than the noise floor', () => {
    // A 3-char name would hoist on almost any sentence.
    expect(priorityRankOf('The', 'the best project we have')).toBeNull()
  })

  it('returns null for empty or whitespace priority text', () => {
    expect(priorityRankOf('Accent PJ', '')).toBeNull()
    expect(priorityRankOf('Accent PJ', '   \n  ')).toBeNull()
  })

  it('orders by where the admin named the project', () => {
    const text = 'Royal Suites first, then Accent PJ, then Kensho'
    const royal = priorityRankOf('Royal Suites, Pavilion Damansara Heights (phase 2)', text)
    const accent = priorityRankOf('Accent PJ', text)
    const kensho = priorityRankOf('Kensho @ Taman Desa', text)
    expect(royal).not.toBeNull()
    expect(accent).not.toBeNull()
    expect(kensho).not.toBeNull()
    expect(royal!).toBeLessThan(accent!)
    expect(accent!).toBeLessThan(kensho!)
  })
})

describe('applyPriorityBoost — reorders a result set, never changes it', () => {
  const ranked = [p('Accent PJ'), p('Kensho @ Taman Desa'), p('Royal Suites, Pavilion Damansara Heights (phase 2)'), p('Conlay KLCC')]

  it('hoists a named project to the front', () => {
    const out = applyPriorityBoost(ranked, 'always recommend Royal Suites first')
    expect(out[0].doc.name).toBe('Royal Suites, Pavilion Damansara Heights (phase 2)')
  })

  it('hoists in the order the admin named them', () => {
    const out = applyPriorityBoost(ranked, 'Conlay first, then Royal Suites')
    expect(out.map((x) => x.doc.name)).toEqual([
      'Conlay KLCC',
      'Royal Suites, Pavilion Damansara Heights (phase 2)',
      'Accent PJ',
      'Kensho @ Taman Desa',
    ])
  })

  it('NEVER adds, drops or duplicates a project — the gates upstream own the contents', () => {
    const out = applyPriorityBoost(ranked, 'Royal Suites, and also Bangsar Hill Park and Tropicana')
    expect(out).toHaveLength(ranked.length)
    expect([...out.map((x) => x.id)].sort()).toEqual([...ranked.map((x) => x.id)].sort())
  })

  it('preserves the incoming relative order of every unnamed project', () => {
    // This is the quick-050 relevance-tier ordering. A re-sort would destroy it;
    // a partition must not.
    const out = applyPriorityBoost(ranked, 'Royal Suites')
    const rest = out.filter((x) => x.doc.name !== 'Royal Suites, Pavilion Damansara Heights (phase 2)')
    expect(rest.map((x) => x.doc.name)).toEqual(['Accent PJ', 'Kensho @ Taman Desa', 'Conlay KLCC'])
  })

  it('is a no-op when no candidate is named', () => {
    const out = applyPriorityBoost(ranked, 'push Tropicana Gardens')
    expect(out.map((x) => x.doc.name)).toEqual(ranked.map((x) => x.doc.name))
  })

  it('matches a single distinctive token — admins write "Conlay", the corpus says "Conlay KLCC"', () => {
    const out = applyPriorityBoost(ranked, 'lead with Conlay')
    expect(out[0].doc.name).toBe('Conlay KLCC')
  })

  it('AMBIGUITY GUARD: "Royal Suites" must not also hoist "Royal Gardens"', () => {
    // Both names answer to the bare token "royal". Without the guard both are hoisted
    // and the second one is simply the wrong project put in front of a client.
    const twoRoyals = [
      p('Accent PJ'),
      p('Royal Gardens Residences'),
      p('Royal Suites, Pavilion Damansara Heights (phase 2)'),
    ]
    const out = applyPriorityBoost(twoRoyals, 'always recommend Royal Suites first')

    expect(out[0].doc.name).toBe('Royal Suites, Pavilion Damansara Heights (phase 2)')
    // Royal Gardens loses its priority claim and keeps its original relative position.
    expect(out.map((x) => x.doc.name)).toEqual([
      'Royal Suites, Pavilion Damansara Heights (phase 2)',
      'Accent PJ',
      'Royal Gardens Residences',
    ])
  })

  it('is a no-op for empty, whitespace, null and undefined priority text', () => {
    for (const empty of ['', '   ', null, undefined]) {
      expect(applyPriorityBoost(ranked, empty)).toBe(ranked) // same reference: costs nothing
    }
  })
})
