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
    it('free-text name: a pasted lead name is tokenized once the route injects lead names (GREEN as of Plan 04-06 route injection)', () => {
      // The route (app/api/chat/route.ts GATE 3, Plan 04-06) now reads leads/{leadId}.name
      // and passes it as names[] — closing the previously-empty `names: []` hook. Here we
      // assert the CONTRACT the route mitigation produces: when the pasted lead name IS the
      // injected known-name, replaceNames fires and the raw name does NOT survive to the
      // model. (This is the route-level mitigation, NOT free-text NER — NER stays deferred
      // to Phase-5 hardening.)
      const pastedInbound = 'Hi, Siti here, keen on the Cheras unit.'
      // Simulate the route injecting the lead's known name (leads/{leadId}.name = 'Siti').
      const result = pseudonymize({ messages: [{ role: 'user', content: pastedInbound }] }, ['Siti'])
      const out = result.redacted.messages[0].content
      // With route-injected names the lead name does not survive — it becomes <LEAD_ID:…>.
      expect(out).not.toContain('Siti')
      expect(out).toContain('<LEAD_ID:')
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

// ─── quick-kayinleong-106: RM figure forms, 'non-budget' mode, scrubPdpaTokens ──────────────
import { scrubPdpaTokens } from './pdpa'

const run = (content: string, financial?: 'all' | 'non-budget') =>
  pseudonymize({ messages: [{ role: 'user', content }] }, [], financial ? { financial } : {}).redacted
    .messages[0].content

/** Text with every <…_HASH:…> token removed — must contain no digit of an RM figure. */
const withoutTokens = (s: string) => s.replace(/<[A-Z]+_HASH:[0-9a-f]{12}>/g, '')

describe('strict mode: whole RM figure (incl. suffix) is masked', () => {
  const forms = [
    'RM1.5mil', 'RM1.5MIL', 'RM1.5 Mil', 'RM 1.5 mil', 'RM1,500,000', 'RM650,000.00',
    'RM1.5 juta', 'RM2mil', 'RM1.5million', 'RM800k', 'RM800K', 'RM 800 k', 'RM1.2M',
    'RM1.5m', 'RM1.5bil', 'RM3.5k psf', 'Rm800k', 'rm1.5mil', 'RM700psf', 'RM1.25mil',
  ]
  for (const f of forms) {
    it(`masks "${f}" with no digit left outside a token`, () => {
      const out = run(`budget ${f} please`)
      expect(out).toContain('<FIN_HASH:')
      expect(withoutTokens(out)).not.toMatch(/\d/)
    })
  }

  it('RM1.5MIL TO RM2.5MIL regression: no ".5MIL" leak', () => {
    const out = run('budget around RM1.5MIL TO RM2.5MIL')
    expect(out).not.toMatch(/\.5/i)
    expect(withoutTokens(out)).toBe('budget around  TO ')
  })

  it('RM 1.5M - 2.5M masks the RM figure; bare 2.5M has no RM prefix', () => {
    expect(withoutTokens(run('RM 1.5M - 2.5M'))).toBe(' - 2.5M')
  })

  it('does not touch farm1.5 or RMX', () => {
    expect(run('farm1.5 RMX')).toBe('farm1.5 RMX')
  })

  it('default call (no opts) still masks RM6000 and RM 6,000/month', () => {
    expect(run('I earn RM6000')).toMatch(/<FIN_HASH:/)
    expect(withoutTokens(run('RM 6,000/month'))).toBe('/month')
  })
})

describe("'non-budget' mode (Finder)", () => {
  const budgets = [
    'budget RM1.5mil-RM2.5mil',
    'RM1.5MIL TO RM2.5MIL',
    'Damansara Heights, RM1.5mil-RM2.5mil, 2 or 3 bedrooms',
    'bajet RM800k',
    'under RM800k',
    'bajet RM1.2juta',
    '预算RM150万',
    '预算RM800k以下',
    'RM3.5k psf',
    'income RM8k-RM10k, budget RM700k'.replace('income RM8k-RM10k, ', ''),
  ]
  for (const b of budgets) {
    it(`passes budget verbatim: ${b}`, () => {
      expect(run(b, 'non-budget')).toBe(b)
    })
  }

  const incomes = [
    'I earn RM6000 a month',
    'gaji RM8k sebulan',
    '月薪RM6000',
    'loan RM500k',
    'RM6000/month salary',
    'gaji RM5,000 sebulan',
    '收入RM8000',
    'monthly installment RM4,500',
    'RM4000 per month',
    'RM4000 每月',
  ]
  for (const i of incomes) {
    it(`masks income: ${i}`, () => {
      const out = run(i, 'non-budget')
      expect(out).toContain('<FIN_HASH:')
      expect(withoutTokens(out)).not.toMatch(/RM\d/i)
    })
  }

  it('mixed line masks only the income figure (cue nearest wins)', () => {
    const out = run('income RM8k-RM10k, budget RM700k', 'non-budget')
    expect(out).toContain('budget RM700k')
    expect(out).not.toMatch(/RM8k|RM10k/)
  })

  it('ZH mixed line: income masked, budget kept', () => {
    const out = run('收入RM8000，预算RM800k', 'non-budget')
    expect(out).toContain('预算RM800k')
    expect(out).not.toContain('RM8000')
  })

  it('pinned edge: "Lead earns RM15k, wants RM1.5mil condo" fails closed (both masked)', () => {
    const out = run('Lead earns RM15k, wants RM1.5mil condo', 'non-budget')
    expect(out).not.toMatch(/RM\d/)
  })

  it('pinned edge: "Bank loan up to RM1.2mil" passes (up to is nearer)', () => {
    expect(run('Bank loan up to RM1.2mil', 'non-budget')).toContain('RM1.2mil')
  })

  it('still masks IC, email, phone and names', () => {
    const out = pseudonymize(
      {
        messages: [
          {
            role: 'user',
            content: `Siti 880101-14-5678 siti@example.com +60123456789 budget RM1.5mil`,
          },
        ],
      },
      ['Siti'],
      { financial: 'non-budget' },
    ).redacted.messages[0].content
    expect(out).toContain('<LEAD_ID:1>')
    expect(out).toContain('<IC_HASH:')
    expect(out).toContain('<EMAIL_HASH:')
    expect(out).toContain('<PHONE_HASH:')
    expect(out).toContain('RM1.5mil')
    expect(out).not.toMatch(/Siti|880101|example\.com|60123456789/)
  })
})

describe('scrubPdpaTokens', () => {
  it('replaces all four token classes', () => {
    const t = 'a <FIN_HASH:0123456789ab> b <IC_HASH:0123456789ab> <EMAIL_HASH:0123456789ab> <PHONE_HASH:0123456789ab>'
    expect(scrubPdpaTokens(t, '[x]')).toBe('a [x] b [x] [x] [x]')
  })
  it('leaves <LEAD_ID:n> alone', () => {
    expect(scrubPdpaTokens('hi <LEAD_ID:3> <FIN_HASH:0123456789ab>', '[x]')).toBe('hi <LEAD_ID:3> [x]')
  })
  it('is idempotent and handles a token at string end', () => {
    const once = scrubPdpaTokens('end <FIN_HASH:0123456789ab>', '[x]')
    expect(once).toBe('end [x]')
    expect(scrubPdpaTokens(once, '[x]')).toBe(once)
  })
  it('catches a token completed by a later chunk when scrubbing the accumulated text', () => {
    let acc = 'RM <FIN_HA'
    expect(scrubPdpaTokens(acc, '[x]')).toBe('RM <FIN_HA')
    acc += 'SH:0123456789ab> ok'
    expect(scrubPdpaTokens(acc, '[x]')).toBe('RM [x] ok')
  })
  it('real pseudonymize output is fully scrubbed', () => {
    const out = run('RM1.5mil and RM6000 a month')
    expect(scrubPdpaTokens(out, '[x]')).toBe('[x] and [x] a month')
  })
})
