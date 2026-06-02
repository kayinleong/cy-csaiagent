/**
 * src/eval/judge.test.ts — Offline structural tests for the judge rubric + gold sets.
 *
 * All tests here run WITHOUT a live model call or Firebase connection.
 * They validate:
 *   1. Rubric domain structure (all expected domains present in judge.ts).
 *   2. Gold-set YAML files parse correctly (via fs + yaml-compatible parse).
 *   3. Each gold file contains EN / MS / ZH cases.
 *   4. Each gold case references the rubric (via KB: citation assertion).
 *
 * These are the offline gates. Live judge scoring runs only when JUDGE_MODEL
 * env is set (guarded in runNightly.ts + evals/CALIBRATION.md).
 *
 * Core/shell rule: no app/ imports here.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  judgeRubric,
  combinedJudgeRubric,
  judgeModelEnvKey,
  JUDGE_MODEL_RC_KEY,
} from './judge'

// ─── Helper: minimal YAML list parser ────────────────────────────────────────
// Avoids pulling in a YAML library for a structural check.
// Extracts `lang:` and `description:` lines from the gold YAML for validation.

function extractYamlLines(content: string, key: string): string[] {
  const regex = new RegExp(`^\\s*${key}:\\s*(.+)$`, 'gm')
  const matches: string[] = []
  let m: RegExpExecArray | null
  while ((m = regex.exec(content)) !== null) {
    matches.push(m[1].trim().replace(/^["']|["']$/g, ''))
  }
  return matches
}

function readGoldFile(filename: string): string {
  const p = join(process.cwd(), 'evals', 'gold', filename)
  return readFileSync(p, 'utf-8')
}

// ─── Test suite ───────────────────────────────────────────────────────────────

describe('judge.ts — rubric domain structure', () => {
  it('exports judgeModelEnvKey = "JUDGE_MODEL"', () => {
    expect(judgeModelEnvKey).toBe('JUDGE_MODEL')
  })

  it('exports JUDGE_MODEL_RC_KEY = "model.grader.default"', () => {
    expect(JUDGE_MODEL_RC_KEY).toBe('model.grader.default')
  })

  it('has a grounded domain in judgeRubric', () => {
    expect(judgeRubric.grounded).toBeTruthy()
    expect(judgeRubric.grounded).toContain('GROUNDING CHECK')
  })

  it('has a scoped domain in judgeRubric', () => {
    expect(judgeRubric.scoped).toBeTruthy()
    expect(judgeRubric.scoped).toContain('SCOPE CHECK')
  })

  it('has a languageMatch domain in judgeRubric', () => {
    expect(judgeRubric.languageMatch).toBeTruthy()
    expect(judgeRubric.languageMatch).toContain('LANGUAGE CHECK')
  })

  it('has a voice domain in judgeRubric', () => {
    expect(judgeRubric.voice).toBeTruthy()
    expect(judgeRubric.voice).toContain('VOICE CHECK')
  })

  it('has a hallucination domain in judgeRubric (Phase 2 addition)', () => {
    expect(judgeRubric.hallucination).toBeTruthy()
    expect(judgeRubric.hallucination).toContain('HALLUCINATION CHECK')
  })

  it('has a toneDrift domain in judgeRubric (Phase 2 addition)', () => {
    expect(judgeRubric.toneDrift).toBeTruthy()
    expect(judgeRubric.toneDrift).toContain('TONE-DRIFT CHECK')
  })

  it('combinedJudgeRubric references all six domains', () => {
    expect(combinedJudgeRubric).toContain('GROUNDING CHECK')
    expect(combinedJudgeRubric).toContain('SCOPE CHECK')
    expect(combinedJudgeRubric).toContain('LANGUAGE CHECK')
    expect(combinedJudgeRubric).toContain('VOICE CHECK')
    expect(combinedJudgeRubric).toContain('HALLUCINATION CHECK')
    expect(combinedJudgeRubric).toContain('TONE-DRIFT CHECK')
  })

  it('combinedJudgeRubric output format includes HALLUCINATION and TONE-DRIFT lines', () => {
    expect(combinedJudgeRubric).toContain('HALLUCINATION: [PASS/FAIL]')
    expect(combinedJudgeRubric).toContain('TONE-DRIFT: [PASS/FAIL]')
  })

  it('combinedJudgeRubric does NOT hard-code any model ID', () => {
    // Must not contain claude-, anthropic-, opus- (hard-coded model strings)
    expect(combinedJudgeRubric).not.toMatch(/claude-[a-z]/)
    expect(combinedJudgeRubric).not.toMatch(/anthropic:[a-z]/)
    expect(combinedJudgeRubric).not.toMatch(/opus-\d/)
  })
})

// ─── Gold-set structural validation ──────────────────────────────────────────

describe('evals/gold/coach-training.yaml — structural validation', () => {
  let content: string

  it('file is readable', () => {
    content = readGoldFile('coach-training.yaml')
    expect(content.length).toBeGreaterThan(100)
  })

  it('contains at least one EN case (lang: en)', () => {
    const langs = extractYamlLines(content, 'lang')
    expect(langs.some((l) => l === 'en')).toBe(true)
  })

  it('contains at least one MS case (lang: ms)', () => {
    const langs = extractYamlLines(content, 'lang')
    expect(langs.some((l) => l === 'ms')).toBe(true)
  })

  it('contains at least one ZH case (lang: zh)', () => {
    const langs = extractYamlLines(content, 'lang')
    expect(langs.some((l) => l === 'zh')).toBe(true)
  })

  it('has KB: citation assertions', () => {
    expect(content).toContain('KB:')
  })

  it('has PII gate assertions (no MY phone numbers)', () => {
    expect(content).toContain('MY_PHONE')
    expect(content).toContain('60\\d{9,10}')
  })

  it('has no real MY phone numbers (+60xxxxxxxxx)', () => {
    const MY_PHONE = /\+?60\d{9,10}/
    expect(MY_PHONE.test(content)).toBe(false)
  })
})

describe('evals/gold/coach-journey.yaml — structural validation', () => {
  let content: string

  it('file is readable', () => {
    content = readGoldFile('coach-journey.yaml')
    expect(content.length).toBeGreaterThan(100)
  })

  it('contains at least one EN case (lang: en)', () => {
    const langs = extractYamlLines(content, 'lang')
    expect(langs.some((l) => l === 'en')).toBe(true)
  })

  it('contains at least one MS case (lang: ms)', () => {
    const langs = extractYamlLines(content, 'lang')
    expect(langs.some((l) => l === 'ms')).toBe(true)
  })

  it('contains at least one ZH case (lang: zh)', () => {
    const langs = extractYamlLines(content, 'lang')
    expect(langs.some((l) => l === 'zh')).toBe(true)
  })

  it('has KB: citation assertions', () => {
    expect(content).toContain('KB:')
  })

  it('has comprehension-gate case (no multiple-choice check)', () => {
    // The comprehension gate case asserts that multiple-choice format is absent
    expect(content).toContain('multiChoice')
    expect(content).toContain('A\\)|B\\)|C\\)|D\\)')
  })

  it('has no real MY phone numbers', () => {
    const MY_PHONE = /\+?60\d{9,10}/
    expect(MY_PHONE.test(content)).toBe(false)
  })
})

describe('evals/gold/coach-playbooks.yaml — structural validation', () => {
  let content: string

  it('file is readable', () => {
    content = readGoldFile('coach-playbooks.yaml')
    expect(content.length).toBeGreaterThan(100)
  })

  it('contains at least one EN case (lang: en)', () => {
    const langs = extractYamlLines(content, 'lang')
    expect(langs.some((l) => l === 'en')).toBe(true)
  })

  it('contains at least one MS case (lang: ms)', () => {
    const langs = extractYamlLines(content, 'lang')
    expect(langs.some((l) => l === 'ms')).toBe(true)
  })

  it('contains at least one ZH case (lang: zh)', () => {
    const langs = extractYamlLines(content, 'lang')
    expect(langs.some((l) => l === 'zh')).toBe(true)
  })

  it('has KB: citation assertions', () => {
    expect(content).toContain('KB:')
  })

  it('has Meta Ads walkthrough case', () => {
    // Must include the first-Meta-ad walkthrough (COACH-08)
    expect(content).toContain('Meta')
  })

  it('has no real MY phone numbers', () => {
    const MY_PHONE = /\+?60\d{9,10}/
    expect(MY_PHONE.test(content)).toBe(false)
  })
})
