/**
 * Tests for src/audit/pdpa.ts — PDPA boundary pseudonymization + gate.
 *
 * All test data is SYNTHETIC — no real PII (CI PII scan will fail otherwise).
 * Synthetic user fixtures come from tests/fixtures/synthetic-users.ts.
 *
 * Covers 4 behaviors per the plan spec:
 *   1. Names and phones are replaced; output contains no original name or MY phone
 *   2. pseudonymize returns pdpa_redacted:true and a reversible mapping (server-side only)
 *   3. assertRedacted THROWS PdpaViolationError when pdpa_redacted !== true; does NOT throw when true
 *   4. No-PII text passes through unchanged; multiple phones/names all replaced
 */

import { describe, it, expect } from 'vitest'
import { pseudonymize, assertRedacted, PdpaViolationError } from './pdpa'

// Synthetic test data — NOT real PII.
// These strings use the Malaysian phone format prefix (+60) but with
// clearly-fake suffixes that no real subscriber would have.
const SYNTHETIC_PHONE_1 = '+60123456789'   // synthetic MY format (non-real suffix)
const SYNTHETIC_PHONE_2 = '+60198765432'   // second synthetic phone
const SYNTHETIC_NAME = 'Alice Lim (Test)'  // the synthetic display name from fixture
const SYNTHETIC_NAME_2 = 'Bob Tan Coach (Test)'  // second synthetic name

describe('pseudonymize', () => {
  it('Behavior 1: replaces a synthetic name with <LEAD_ID:…> and a MY phone with <PHONE_HASH:…>; output contains neither the original name nor the original phone pattern', () => {
    const input = {
      messages: [
        {
          role: 'user',
          content: `My name is ${SYNTHETIC_NAME} and my phone is ${SYNTHETIC_PHONE_1}. Please help me.`,
        },
      ],
      context: `Lead ${SYNTHETIC_NAME} called from ${SYNTHETIC_PHONE_1}`,
    }

    const result = pseudonymize(input, [SYNTHETIC_NAME])

    // The output messages and context must contain no original phone string
    const outputText = JSON.stringify(result.redacted)
    expect(outputText).not.toContain(SYNTHETIC_PHONE_1)
    expect(outputText).not.toMatch(/\+?60\d{9,10}/)

    // The output must contain no original name
    expect(outputText).not.toContain(SYNTHETIC_NAME)

    // The output must contain the LEAD_ID token and PHONE_HASH token
    expect(outputText).toMatch(/<LEAD_ID:\d+>/)
    expect(outputText).toMatch(/<PHONE_HASH:[a-f0-9]+>/)
  })

  it('Behavior 2: returns pdpa_redacted:true and a reversible mapping (not sent to model)', () => {
    const input = {
      messages: [
        {
          role: 'user',
          content: `My name is ${SYNTHETIC_NAME}`,
        },
      ],
    }

    const result = pseudonymize(input, [SYNTHETIC_NAME])

    // Must return pdpa_redacted: true
    expect(result.pdpa_redacted).toBe(true)

    // Must return a mapping for server-side reconstitution
    expect(result.mapping).toBeInstanceOf(Map)
    expect(result.mapping.size).toBeGreaterThan(0)

    // The mapping values must contain the original name (for reconstitution)
    const mappingValues = Array.from(result.mapping.values())
    expect(mappingValues.some((v) => v === SYNTHETIC_NAME)).toBe(true)

    // The mapping must NOT be part of the redacted payload sent to the model
    // (the redacted output is what goes to Claude; mapping stays server-side)
    const redactedText = JSON.stringify(result.redacted)
    expect(redactedText).not.toContain(SYNTHETIC_NAME)
  })

  it('Behavior 3: assertRedacted THROWS PdpaViolationError when pdpa_redacted !== true; does NOT throw when true', () => {
    // Must throw when pdpa_redacted is false
    expect(() => assertRedacted({ pdpa_redacted: false })).toThrow(PdpaViolationError)

    // Must throw when pdpa_redacted is missing (undefined)
    expect(() => assertRedacted({})).toThrow(PdpaViolationError)

    // Must throw when pdpa_redacted is any other value
    expect(() => assertRedacted({ pdpa_redacted: undefined as unknown as boolean })).toThrow(PdpaViolationError)

    // Must NOT throw when pdpa_redacted is true
    expect(() => assertRedacted({ pdpa_redacted: true })).not.toThrow()
  })

  it('Behavior 4: no-PII text passes through unchanged and still gets pdpa_redacted:true; multiple phones/names are all replaced', () => {
    // Sub-case A: text with no PII passes through unchanged
    const noPiiInput = {
      messages: [
        { role: 'user', content: 'What are the property types available in D2?' },
        { role: 'assistant', content: 'D2 offers several property types including apartments and townhouses.' },
      ],
    }
    const noPiiResult = pseudonymize(noPiiInput, [])

    expect(noPiiResult.pdpa_redacted).toBe(true)
    // Content should be preserved (no PII to replace)
    expect(noPiiResult.redacted.messages[0].content).toBe('What are the property types available in D2?')
    expect(noPiiResult.redacted.messages[1].content).toBe('D2 offers several property types including apartments and townhouses.')

    // Sub-case B: multiple phones and names in one message are ALL replaced
    const multiPiiInput = {
      messages: [
        {
          role: 'user',
          content: `${SYNTHETIC_NAME} (phone: ${SYNTHETIC_PHONE_1}) is helping ${SYNTHETIC_NAME_2} who called from ${SYNTHETIC_PHONE_2}.`,
        },
      ],
    }
    const multiResult = pseudonymize(multiPiiInput, [SYNTHETIC_NAME, SYNTHETIC_NAME_2])

    const multiOutputText = JSON.stringify(multiResult.redacted)

    // Neither phone must survive
    expect(multiOutputText).not.toContain(SYNTHETIC_PHONE_1)
    expect(multiOutputText).not.toContain(SYNTHETIC_PHONE_2)
    expect(multiOutputText).not.toMatch(/\+?60\d{9,10}/)

    // Neither name must survive
    expect(multiOutputText).not.toContain(SYNTHETIC_NAME)
    expect(multiOutputText).not.toContain(SYNTHETIC_NAME_2)
  })
})
