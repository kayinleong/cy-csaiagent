/**
 * The quick-kayinleong-098 data patch planner: it touches only the records it names, only
 * while they still hold the 2026-10-20 values, and a restore cannot clobber a later edit.
 */

import { describe, it, expect } from 'vitest'
import {
  COMMERCIAL_PROJECTS,
  LOCATION_FIXES,
  fingerprintInput,
  planPatch,
  planRestore,
  type StoredProject,
} from './fix-uat-location-and-type.plan'

/** The live state on 2026-10-20: every fix target as exported, every type tag absent. */
function liveState(): Map<string, StoredProject> {
  const docs = new Map<string, StoredProject>()
  for (const f of LOCATION_FIXES) docs.set(f.docId, { name: f.name, locationText: f.expectedBefore })
  for (const p of COMMERCIAL_PROJECTS) docs.set(p.docId, { name: p.name, locationText: 'somewhere' })
  docs.set('untouched', { name: 'Parkside Residences', locationText: 'Jalan Bangsar' })
  return docs
}

describe('fix-uat-location-and-type planner', () => {
  it('plans exactly the 4 location fixes and 4 commercial tags, and nothing else', () => {
    const { changes, skipped } = planPatch(liveState())
    expect(skipped).toEqual([])
    expect(changes.filter((c) => c.field === 'locationText')).toHaveLength(4)
    expect(changes.filter((c) => c.field === 'propertyType').map((c) => c.after)).toEqual([
      'commercial', 'commercial', 'commercial', 'commercial',
    ])
    expect(changes.some((c) => c.docId === 'untouched')).toBe(false)
  })

  it('the corrected location strings are the client sheet Area or drop the false region tag', () => {
    const after = Object.fromEntries(LOCATION_FIXES.map((f) => [f.name, f.after]))
    expect(after['Alstonia Hilltop Homes']).toBe('Bukit Rahman Putra (BRP), Sungai Buloh, Selangor')
    expect(after['Rimbun Saujana Residency']).toBe('Shah Alam, Selangor')
    for (const f of LOCATION_FIXES) expect(f.after).not.toMatch(/Mont Kiara\/Dutamas|PJ\/Subang|, KLCC$/)
  })

  it('leaves alone a record edited since 2026-10-20', () => {
    const docs = liveState()
    docs.set(LOCATION_FIXES[0].docId, { name: LOCATION_FIXES[0].name, locationText: 'edited by an admin' })
    const { changes, skipped } = planPatch(docs)
    expect(changes.some((c) => c.docId === LOCATION_FIXES[0].docId)).toBe(false)
    expect(skipped[0].reason).toMatch(/changed since/)
  })

  it('is idempotent: a second run after apply plans nothing', () => {
    const docs = liveState()
    for (const c of planPatch(docs).changes) {
      docs.set(c.docId, { ...docs.get(c.docId), [c.field]: c.after ?? undefined })
    }
    expect(planPatch(docs).changes).toEqual([])
  })

  it('restore inverts the patch, including deleting a tag that was absent', () => {
    const docs = liveState()
    const forward = planPatch(docs).changes
    for (const c of forward) docs.set(c.docId, { ...docs.get(c.docId), [c.field]: c.after ?? undefined })

    const { changes } = planRestore(forward, docs)
    expect(changes).toHaveLength(forward.length)
    const tag = changes.find((c) => c.field === 'propertyType')!
    expect(tag.before).toBe('commercial')
    expect(tag.after).toBeNull() // absent before the patch, so the restore deletes it
  })

  it('restore will not clobber a value edited after the patch', () => {
    const docs = liveState()
    const forward = planPatch(docs).changes
    for (const c of forward) docs.set(c.docId, { ...docs.get(c.docId), [c.field]: c.after ?? undefined })
    docs.set(forward[0].docId, { ...docs.get(forward[0].docId), locationText: 'edited after the patch' })

    const { changes, skipped } = planRestore(forward, docs)
    expect(changes).toHaveLength(forward.length - 1)
    expect(skipped).toHaveLength(1)
  })

  it('the fingerprint covers what is written and ignores order', () => {
    const { changes } = planPatch(liveState())
    expect(fingerprintInput([...changes].reverse())).toBe(fingerprintInput(changes))
    const altered = changes.map((c, i) => (i === 0 ? { ...c, after: 'something else' } : c))
    expect(fingerprintInput(altered)).not.toBe(fingerprintInput(changes))
  })
})
