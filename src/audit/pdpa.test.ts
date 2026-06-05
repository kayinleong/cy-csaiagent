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

  // ─── Phase-4 security-critical PDPA coverage block (RED — Wave 0) ────────────
  //
  // These tests document the false-positive PDPA gate (RESEARCH §Q3 / Pitfall A):
  // `pseudonymize(input, names)` today only redacts names passed in `names[]` plus
  // phone regexes. Free-text IC numbers, emails, and RM-financial figures reach the
  // model UNREDACTED. The gate flag `pdpa_redacted` is hard-coded `true`, so it is a
  // PRESENCE gate, not a COVERAGE gate.
  //
  // Wave-1 (Plan 04-02) closes this by adding IC/email/RM-financial regexes to
  // pdpa.ts. The TOKEN PREFIX CONTRACT the Wave-1 implementer MUST produce:
  //   IC   `880101-14-5678`        → `<IC_HASH:…>`
  //   email `ahmad@example.com`    → `<EMAIL_HASH:…>`
  //   RM-financial `RM6000`        → `<FIN_HASH:…>`
  //
  // The IC/email/financial assertions below are EXPECTED-FAIL today (`it.fails`).
  // They fail RED against the current code, keeping the offline suite green; when
  // Wave-1 lands the regexes, `it.fails` flips to a failure and the implementer
  // changes them to `it()`. The name/phone baselines stay green as regression guards.
  //
  // Synthetic PII only (no real IC/email/phone — CI PII scan + global secrets rule).

  const SYNTHETIC_IC = '880101-14-5678'          // synthetic MY IC format (\d{6}-\d{2}-\d{4})
  const SYNTHETIC_EMAIL = 'ahmad@example.com'     // synthetic email
  const SYNTHETIC_INTL_PHONE = '+14155550123'     // synthetic US/intl phone
  const SYNTHETIC_FINANCIAL_1 = 'RM6000'          // RM-financial, no space
  const SYNTHETIC_FINANCIAL_2 = 'RM 6,000/month'  // RM-financial, spaced + thousands sep

  describe('Phase-4 PDPA coverage contract (security-critical, RESEARCH Q3 / Pitfall A)', () => {
    // ── name baseline (already passes — known-name path is the contract) ──
    it('name: a known name passed in names[] is tokenized to <LEAD_ID:…> (baseline, passes today)', () => {
      const input = { messages: [{ role: 'user', content: 'Hi this is Ahmad' }] }
      const result = pseudonymize(input, ['Ahmad'])
      const out = result.redacted.messages[0].content
      expect(out).not.toContain('Ahmad')
      expect(out).toContain('<LEAD_ID:')
    })

    // ── MY phone regression guard (already passes) ──
    it('MY phone: +60-format phone is tokenized to <PHONE_HASH:…> (regression guard, passes today)', () => {
      const input = { messages: [{ role: 'user', content: 'call me at +60123456789' }] }
      const result = pseudonymize(input, [])
      const out = result.redacted.messages[0].content
      expect(out).not.toContain('+60123456789')
      expect(out).toContain('<PHONE_HASH:')
    })

    // ── intl phone regression guard (already passes) ──
    it('intl phone: a +1 international phone is tokenized to <PHONE_HASH:…> (regression guard, passes today)', () => {
      const input = { messages: [{ role: 'user', content: `reach me on ${SYNTHETIC_INTL_PHONE}` }] }
      const result = pseudonymize(input, [])
      const out = result.redacted.messages[0].content
      expect(out).not.toContain(SYNTHETIC_INTL_PHONE)
      expect(out).toContain('<PHONE_HASH:')
    })

    // ── IC coverage (GREEN — Wave 1 / Plan 04-02 added the IC regex) ──
    it('IC: a Malaysian IC \\d{6}-\\d{2}-\\d{4} is tokenized to <IC_HASH:…>', () => {
      const input = { messages: [{ role: 'user', content: `my IC is ${SYNTHETIC_IC}` }] }
      const result = pseudonymize(input, [])
      const out = result.redacted.messages[0].content
      // The raw IC must NOT survive to the model
      expect(out).not.toContain(SYNTHETIC_IC)
      // …and an <IC_HASH:…> token must replace it (the Wave-1 contract)
      expect(out).toContain('<IC_HASH:')
    })

    // ── email coverage (GREEN — Wave 1 / Plan 04-02 added the email regex) ──
    it('email: a free-text email is tokenized to <EMAIL_HASH:…>', () => {
      const input = { messages: [{ role: 'user', content: `email me at ${SYNTHETIC_EMAIL}` }] }
      const result = pseudonymize(input, [])
      const out = result.redacted.messages[0].content
      expect(out).not.toContain(SYNTHETIC_EMAIL)
      expect(out).toContain('<EMAIL_HASH:')
    })

    // ── RM-financial coverage (GREEN — Wave 1 / Plan 04-02 added the financial regex) ──
    it('RM-financial: RM6000 is tokenized to <FIN_HASH:…>', () => {
      const input = { messages: [{ role: 'user', content: `I earn ${SYNTHETIC_FINANCIAL_1} per month` }] }
      const result = pseudonymize(input, [])
      const out = result.redacted.messages[0].content
      expect(out).not.toContain(SYNTHETIC_FINANCIAL_1)
      expect(out).toContain('<FIN_HASH:')
    })

    it('RM-financial: "RM 6,000/month" (spaced + thousands sep) is tokenized to <FIN_HASH:…>', () => {
      const input = { messages: [{ role: 'user', content: `budget is ${SYNTHETIC_FINANCIAL_2}` }] }
      const result = pseudonymize(input, [])
      const out = result.redacted.messages[0].content
      expect(out).not.toContain(SYNTHETIC_FINANCIAL_2)
      expect(out).toContain('<FIN_HASH:')
    })

    // ── free-text name leak documented: a name NOT in names[] leaks TODAY ──
    // Wave 1: the route injects known lead names from the lead record so replaceNames
    // fires. This test asserts the token-coverage contract for when names ARE passed
    // (the route-level mitigation), NOT free-text NER (deferred to Phase-5 hardening).
    it.fails('free-text name: an unknown name is tokenized once the route injects lead names (RED until Wave 1 route injection)', () => {
      // Today names:[] leaks the name (no NER). Wave 1's route reads leads/{leadId}.name
      // and passes it as names[]. Here we assert the CONTRACT: when the name IS the
      // injected known-name, it must be tokenized. This currently fails because the
      // paste arrives with names:[] — proving the route-injection hook is unfinished.
      const pastedInbound = 'Hi, Siti here, keen on the Cheras unit.'
      const result = pseudonymize({ messages: [{ role: 'user', content: pastedInbound }] }, [])
      const out = result.redacted.messages[0].content
      // Wave-1 expectation: with route-injected names the lead name does not survive.
      expect(out).not.toContain('Siti')
    })
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
