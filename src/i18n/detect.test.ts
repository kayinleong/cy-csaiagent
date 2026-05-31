// src/i18n/detect.test.ts — TDD RED phase
// Tests for per-message franc-min language detection (detectLang → 'en'|'ms'|'zh')
//
// These tests are written BEFORE the implementation (detect.ts) to assert the
// 4 required behaviors. All tests should fail until detect.ts is created.

import { describe, it, expect } from 'vitest'
import { detectLang } from './detect'

describe('detectLang — franc-min per-message detection', () => {
  it('test 1: returns "en" for an English message', () => {
    expect(detectLang('What time is the training session?')).toBe('en')
  })

  it('test 2: returns "ms" for a Bahasa Malaysia message', () => {
    expect(detectLang('Bila sesi latihan bermula?')).toBe('ms')
  })

  it('test 3: returns "zh" for a Mandarin message', () => {
    expect(detectLang('培训课程什么时候开始？')).toBe('zh')
  })

  it('test 4: returns "en" for a short/ambiguous string (fallback — no throw)', () => {
    // Short or ambiguous text (e.g. "ok") cannot be reliably detected.
    // Must return "en" (the default) rather than throwing or returning an unsupported code.
    const result = detectLang('ok')
    expect(result).toBe('en')
    // Verify it's always one of the three supported locales
    expect(['en', 'ms', 'zh']).toContain(result)
  })
})
