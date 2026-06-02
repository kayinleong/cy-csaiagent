/**
 * src/coach/journey/comprehension.test.ts — TDD RED: comprehension gate grading.
 *
 * Tests the free-text paraphrase grading function (COACH-09):
 *   - gradeParaphrase(answer, canonicalText, opts) returns {pass, score}.
 *   - An injected deterministic grade fn drives all tests — no live Gemini call.
 *   - Close paraphrase passes; off-topic fails.
 *   - Threshold is configurable.
 *   - Empty/blank answer fails.
 *   - No MCQ — free-text only.
 *
 * All tests run offline — no Firebase, no Gemini, no Anthropic.
 *
 * Run: npx vitest run src/coach/journey/comprehension.test.ts
 */

import { describe, it, expect } from 'vitest'
import { gradeParaphrase } from './comprehension'

// ─── Deterministic similarity fns for testing ───────────────────────────────

/** Always returns a high similarity score (simulates a good paraphrase). */
const alwaysPassGrade = async (_a: string, _b: string): Promise<number> => 0.92

/** Always returns a low similarity score (simulates an off-topic answer). */
const alwaysFailGrade = async (_a: string, _b: string): Promise<number> => 0.30

/** Returns exactly the threshold value (simulates a borderline answer). */
const borderlineGrade = (threshold: number) =>
  async (_a: string, _b: string): Promise<number> => threshold

// ─── Test 1: Passing paraphrase ──────────────────────────────────────────────

describe('gradeParaphrase: passing paraphrase', () => {
  it('returns {pass: true, score >= threshold} when the grade fn returns a high score', async () => {
    const result = await gradeParaphrase(
      'D2 agents must follow bumiputera quota rules for eligible units.',
      'Bumiputera quota rules restrict how many units can be sold to non-bumiputera buyers.',
      { grade: alwaysPassGrade },
    )
    expect(result.pass).toBe(true)
    expect(result.score).toBeGreaterThanOrEqual(0.78) // default threshold
  })

  it('returns a numeric score in [0, 1]', async () => {
    const result = await gradeParaphrase(
      'Any paraphrase text',
      'Any canonical text',
      { grade: alwaysPassGrade },
    )
    expect(typeof result.score).toBe('number')
    expect(result.score).toBeGreaterThanOrEqual(0)
    expect(result.score).toBeLessThanOrEqual(1)
  })
})

// ─── Test 2: Failing paraphrase ──────────────────────────────────────────────

describe('gradeParaphrase: failing paraphrase', () => {
  it('returns {pass: false} when the grade fn returns a low score', async () => {
    const result = await gradeParaphrase(
      'This is completely unrelated to the topic.',
      'Bumiputera quota rules restrict how many units can be sold to non-bumiputera buyers.',
      { grade: alwaysFailGrade },
    )
    expect(result.pass).toBe(false)
    expect(result.score).toBeLessThan(0.78)
  })
})

// ─── Test 3: Empty/blank answer fails ───────────────────────────────────────

describe('gradeParaphrase: empty or blank answer always fails', () => {
  it('returns {pass: false, score: 0} for an empty string', async () => {
    const result = await gradeParaphrase(
      '',
      'Any canonical text',
      { grade: alwaysPassGrade }, // grade fn doesn't matter — empty always fails
    )
    expect(result.pass).toBe(false)
    expect(result.score).toBe(0)
  })

  it('returns {pass: false, score: 0} for a whitespace-only string', async () => {
    const result = await gradeParaphrase(
      '   \t\n  ',
      'Any canonical text',
      { grade: alwaysPassGrade },
    )
    expect(result.pass).toBe(false)
    expect(result.score).toBe(0)
  })
})

// ─── Test 4: Threshold configuration ────────────────────────────────────────

describe('gradeParaphrase: threshold is configurable', () => {
  it('passes when score equals the threshold (at-threshold is a pass)', async () => {
    const threshold = 0.85
    const result = await gradeParaphrase(
      'Some paraphrase',
      'Some canonical text',
      { grade: borderlineGrade(threshold), threshold },
    )
    expect(result.pass).toBe(true)
    expect(result.score).toBe(threshold)
  })

  it('fails when score is just below the threshold', async () => {
    const threshold = 0.85
    const justBelow = threshold - 0.01
    const result = await gradeParaphrase(
      'Some paraphrase',
      'Some canonical text',
      { grade: borderlineGrade(justBelow), threshold },
    )
    expect(result.pass).toBe(false)
    expect(result.score).toBeCloseTo(justBelow)
  })

  it('uses the default threshold (~0.78) when none is specified', async () => {
    // Score of 0.77 should fail with default threshold
    const result = await gradeParaphrase(
      'Some paraphrase',
      'Some canonical text',
      { grade: async () => 0.77 },
    )
    expect(result.pass).toBe(false)

    // Score of 0.80 should pass with default threshold
    const result2 = await gradeParaphrase(
      'Some paraphrase',
      'Some canonical text',
      { grade: async () => 0.80 },
    )
    expect(result2.pass).toBe(true)
  })
})

// ─── Test 5: Grade fn is injectable (no live call in tests) ──────────────────

describe('gradeParaphrase: backend is injectable', () => {
  it('calls the injected grade fn with answer and canonicalText', async () => {
    let capturedA = ''
    let capturedB = ''
    const capturingGrade = async (a: string, b: string): Promise<number> => {
      capturedA = a
      capturedB = b
      return 0.90
    }

    const answer = 'My paraphrase answer'
    const canonical = 'The canonical KB content'
    await gradeParaphrase(answer, canonical, { grade: capturingGrade })

    expect(capturedA).toBe(answer)
    expect(capturedB).toBe(canonical)
  })

  it('does not call the grade fn for an empty answer (short-circuits)', async () => {
    let gradeCalled = false
    const trackingGrade = async (_a: string, _b: string): Promise<number> => {
      gradeCalled = true
      return 0.99
    }

    await gradeParaphrase('', 'Some canonical text', { grade: trackingGrade })
    expect(gradeCalled).toBe(false)
  })
})

// ─── Test 6: No MCQ — function signature is free-text only ──────────────────

describe('gradeParaphrase: free-text only, no MCQ interface', () => {
  it('accepts a full free-text string as the answer (not an option index)', async () => {
    // The function signature takes string answer — not a number/letter choice.
    // This test documents the anti-pattern guard: MCQ would accept 'A', 'B', '1'.
    const longAnswer =
      'A D2 agent must check bumiputera quota availability before proceeding with a sale. ' +
      'This means verifying that the specific unit is not reserved under the bumiputera ' +
      'allocation scheme, which typically requires checking with the developer or project manager.'
    const result = await gradeParaphrase(
      longAnswer,
      'Bumiputera quota rules govern unit eligibility for different buyer categories.',
      { grade: alwaysPassGrade },
    )
    expect(result.pass).toBe(true)
  })
})
