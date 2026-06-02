/**
 * src/coach/journey/transition.test.ts — TDD RED: pure journey transition logic.
 *
 * Tests the config-driven linear journey state machine (COACH-01/03):
 *   - JourneyConfig is an ordered list of stages/checkpoints.
 *   - nextCheckpoint returns the next step or null at the end.
 *   - The entry point 'start' maps to the day-one pairing checkpoint.
 *   - advance() is pure (no I/O); commitAdvance() wraps updateJourneyStage.
 *
 * All tests run offline — no Firebase, no network.
 *
 * Run: npx vitest run src/coach/journey/transition.test.ts
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Mock agentProfile (updateJourneyStage) ──────────────────────────────────

const mocks = vi.hoisted(() => ({
  mockUpdateJourneyStage: vi.fn(async () => {}),
}))

vi.mock('@/src/memory/agentProfile', () => ({
  updateJourneyStage: mocks.mockUpdateJourneyStage,
}))

// ─── Imports (after mocks) ───────────────────────────────────────────────────

import {
  nextCheckpoint,
  advance,
  commitAdvance,
} from './transition'
import { D2_JOURNEY, type JourneyConfig, type Step } from './config'

// ─── Test 1: JourneyConfig shape and D2_JOURNEY structure ───────────────────

describe('JourneyConfig: D2_JOURNEY config structure', () => {
  it('has at least one stage', () => {
    expect(D2_JOURNEY.stages.length).toBeGreaterThan(0)
  })

  it('each stage has an id and ordered checkpoints', () => {
    for (const stage of D2_JOURNEY.stages) {
      expect(typeof stage.id).toBe('string')
      expect(stage.id.length).toBeGreaterThan(0)
      expect(Array.isArray(stage.checkpoints)).toBe(true)
      expect(stage.checkpoints.length).toBeGreaterThan(0)
    }
  })

  it('each checkpoint has id, stage, and kbDocIds', () => {
    for (const stage of D2_JOURNEY.stages) {
      for (const cp of stage.checkpoints) {
        expect(typeof cp.id).toBe('string')
        expect(cp.id.length).toBeGreaterThan(0)
        expect(cp.stage).toBe(stage.id)
        expect(Array.isArray(cp.kbDocIds)).toBe(true)
        // kbDocIds may be empty for the entry sentinel but should be strings
        for (const id of cp.kbDocIds) {
          expect(typeof id).toBe('string')
        }
      }
    }
  })

  it('optional comprehensionGate has prompt and canonicalKbDocId when present', () => {
    const gatesFound: boolean[] = []
    for (const stage of D2_JOURNEY.stages) {
      for (const cp of stage.checkpoints) {
        if (cp.comprehensionGate) {
          gatesFound.push(true)
          expect(typeof cp.comprehensionGate.prompt).toBe('string')
          expect(cp.comprehensionGate.prompt.length).toBeGreaterThan(0)
          expect(typeof cp.comprehensionGate.canonicalKbDocId).toBe('string')
          expect(cp.comprehensionGate.canonicalKbDocId.length).toBeGreaterThan(0)
        }
      }
    }
    // At least some checkpoints should have comprehension gates (COACH-09)
    expect(gatesFound.length).toBeGreaterThan(0)
  })
})

// ─── Test 2: entry checkpoint is the day-one pairing step ───────────────────

describe('D2_JOURNEY: day-one pairing is the first checkpoint', () => {
  it("starts at the 'start' sentinel and first real step is day-one-pairing", () => {
    // 'start' is the entry sentinel set on new agents by setUserClaims.
    // nextCheckpoint from 'start' should return the day-one-pairing checkpoint.
    const firstStep = nextCheckpoint(D2_JOURNEY, 'onboarding', 'start')
    expect(firstStep).not.toBeNull()
    expect(firstStep!.id).toBe('day-one-pairing')
  })

  it('day-one-pairing checkpoint has kbDocIds for the PowerBoost playlist', () => {
    const step = nextCheckpoint(D2_JOURNEY, 'onboarding', 'start')!
    expect(step.kbDocIds.length).toBeGreaterThan(0)
    // KB doc IDs reference KB documents (not hardcoded content)
    for (const id of step.kbDocIds) {
      expect(typeof id).toBe('string')
      expect(id.length).toBeGreaterThan(0)
    }
  })
})

// ─── Test 3: nextCheckpoint traversal ───────────────────────────────────────

describe('nextCheckpoint: linear traversal through the journey', () => {
  it('returns null when called with the last checkpoint in the journey', () => {
    // Walk to the last checkpoint
    const allSteps: Step[] = []
    let currentStage = D2_JOURNEY.stages[0].id
    let currentCp = 'start'
    let next: Step | null
    let safety = 0
    while (safety < 50) {
      safety++
      next = nextCheckpoint(D2_JOURNEY, currentStage, currentCp)
      if (!next) break
      allSteps.push(next)
      currentStage = next.stage
      currentCp = next.id
    }
    // We should have traversed at least 4 checkpoints for the D2 journey
    expect(allSteps.length).toBeGreaterThanOrEqual(4)
    // Last call returned null (end of journey)
    expect(next!).toBeNull()
  })

  it('returns null when called from an unknown checkpoint', () => {
    const step = nextCheckpoint(D2_JOURNEY, 'unknown-stage', 'unknown-cp')
    expect(step).toBeNull()
  })

  it('returns null when called from an unknown stage', () => {
    const step = nextCheckpoint(D2_JOURNEY, 'does-not-exist', 'start')
    expect(step).toBeNull()
  })

  it('traverses without skipping checkpoints (ordered linearly)', () => {
    const visited: string[] = []
    let currentStage = D2_JOURNEY.stages[0].id
    let currentCp = 'start'
    let safety = 0
    while (safety < 50) {
      safety++
      const next = nextCheckpoint(D2_JOURNEY, currentStage, currentCp)
      if (!next) break
      // No checkpoint should appear twice
      expect(visited).not.toContain(next.id)
      visited.push(next.id)
      currentStage = next.stage
      currentCp = next.id
    }
    expect(visited.length).toBeGreaterThan(0)
  })
})

// ─── Test 4: advance() is pure — returns new {stage, checkpoint} or null ────

describe('advance: pure transition returning next {stage, checkpoint}', () => {
  it('returns the next {stage, checkpoint} from the entry point', () => {
    const next = advance(D2_JOURNEY, { stage: 'onboarding', checkpoint: 'start' })
    expect(next).not.toBeNull()
    expect(next!.stage).toBe('onboarding')
    expect(next!.checkpoint).toBe('day-one-pairing')
  })

  it('returns null at the end of the journey', () => {
    // Walk to the last step first
    let current = { stage: D2_JOURNEY.stages[0].id, checkpoint: 'start' }
    let safety = 0
    while (safety < 50) {
      safety++
      const next = advance(D2_JOURNEY, current)
      if (!next) break
      current = next
    }
    // Now we're at the last checkpoint — advance should return null
    const result = advance(D2_JOURNEY, current)
    expect(result).toBeNull()
  })

  it('does not mutate the config (pure function)', () => {
    const configCopy = JSON.parse(JSON.stringify(D2_JOURNEY))
    advance(D2_JOURNEY, { stage: 'onboarding', checkpoint: 'start' })
    expect(D2_JOURNEY).toEqual(configCopy)
  })
})

// ─── Test 5: commitAdvance calls updateJourneyStage ─────────────────────────

describe('commitAdvance: calls updateJourneyStage with the new stage/checkpoint', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('calls updateJourneyStage when next is not null', async () => {
    const next = { stage: 'onboarding', checkpoint: 'day-one-pairing' }
    await commitAdvance('uid-001', next)
    expect(mocks.mockUpdateJourneyStage).toHaveBeenCalledWith('uid-001', 'onboarding', 'day-one-pairing')
  })

  it('does NOT call updateJourneyStage when next is null (end of journey)', async () => {
    await commitAdvance('uid-001', null)
    expect(mocks.mockUpdateJourneyStage).not.toHaveBeenCalled()
  })
})
