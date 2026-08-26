/**
 * decode-structured-output.test.ts — the SSE→structured-output decode bridge.
 *
 * Closes the v1.0 milestone gap: Reply/Finder turns stream a JSON object as text;
 * the client must decode it on completion so the interactive card renders. These tests
 * lock the decode gate and the per-pillar non-collision the caller relies on.
 */

import { describe, it, expect } from 'vitest'
import { decodeReplyOutput, decodeFinderOutput, salvageStructuredText, normalizeFinderShape } from './decode-structured-output'

const replyDraftJson = JSON.stringify({
  draft: { text: 'Thanks for reaching out…', sopDocIds: ['sop-cold-001'] },
})
const replyNoSopJson = JSON.stringify({
  noSopMatch: { reason: 'no_sop_match', message: 'I don\'t have a D2 reply SOP for this.' },
})
const replyClarifyJson = JSON.stringify({
  clarifyingQuestion: 'Could you paste the full message from the lead?',
})

const finderMatchesJson = JSON.stringify({
  matches: [
    {
      projectId: 'proj-001',
      rationale: 'Within budget and in the preferred area.',
      matchedCriteria: {
        segment: 'own_stay',
        priceMax: 800000,
        nationality: 'malaysian',
        bumiputera: null,
        locationPref: 'Cyberjaya',
        bedrooms: 3,
      },
    },
  ],
})
const finderRefusalJson = JSON.stringify({
  matches: [],
  refusal: { reason: 'no_match', explanation: 'No active project fits the stated budget.' },
})
const finderClarifyJson = JSON.stringify({
  matches: [],
  clarifyingQuestion: 'What is the lead\'s nationality and monthly income?',
})

describe('decodeReplyOutput', () => {
  it('decodes a grounded draft turn', () => {
    const out = decodeReplyOutput(replyDraftJson)
    expect(out?.draft?.text).toBe('Thanks for reaching out…')
    expect(out?.draft?.sopDocIds).toEqual(['sop-cold-001'])
  })

  it('decodes a no_sop_match refusal turn', () => {
    expect(decodeReplyOutput(replyNoSopJson)?.noSopMatch?.reason).toBe('no_sop_match')
  })

  it('decodes a clarifyingQuestion turn', () => {
    expect(decodeReplyOutput(replyClarifyJson)?.clarifyingQuestion).toMatch(/paste/i)
  })

  it('tolerates a ```json code fence', () => {
    const fenced = '```json\n' + replyDraftJson + '\n```'
    expect(decodeReplyOutput(fenced)?.draft?.sopDocIds).toEqual(['sop-cold-001'])
  })

  it('tolerates leading/trailing prose around the object', () => {
    const noisy = `Here is the reply:\n${replyDraftJson}\nLet me know if you want changes.`
    expect(decodeReplyOutput(noisy)?.draft).toBeTruthy()
  })

  it('returns null for plain prose (Coach-style text)', () => {
    expect(decodeReplyOutput('Here are three D2 onboarding tips for tonight.')).toBeNull()
  })

  it('returns null for empty / whitespace content', () => {
    expect(decodeReplyOutput('')).toBeNull()
    expect(decodeReplyOutput('   \n  ')).toBeNull()
  })

  it('returns null for an empty object (no populated branch)', () => {
    expect(decodeReplyOutput('{}')).toBeNull()
  })

  it('does NOT decode a Finder matches turn as a Reply card', () => {
    // Per-pillar gating is the caller\'s job, but the populated-branch guard also means a
    // Finder matches object (matches stripped by ReplyOutputSchema) is not a Reply card.
    expect(decodeReplyOutput(finderMatchesJson)).toBeNull()
  })
})

describe('decodeFinderOutput', () => {
  it('decodes a ranked matches turn', () => {
    const out = decodeFinderOutput(finderMatchesJson)
    expect(out?.matches).toHaveLength(1)
    expect(out?.matches[0]?.projectId).toBe('proj-001')
  })

  it('decodes a grounded refusal turn', () => {
    expect(decodeFinderOutput(finderRefusalJson)?.refusal?.reason).toBe('no_match')
  })

  it('decodes a clarifyingQuestion turn', () => {
    expect(decodeFinderOutput(finderClarifyJson)?.clarifyingQuestion).toMatch(/nationality/i)
  })

  it('returns null for plain prose', () => {
    expect(decodeFinderOutput('No structured output here.')).toBeNull()
  })

  it('returns null for a degenerate empty-matches object', () => {
    expect(decodeFinderOutput(JSON.stringify({ matches: [] }))).toBeNull()
  })
})

// ─── quick-kayinleong-051: salvage a broken envelope ──────────────────────────
//
// A Finder turn reached the agent as a wall of {"matches":[{"projectId":... in a code
// block. The envelope had arrived TRUNCATED (no closing brace), so decodeFinderOutput
// returned null and the raw text fell through to the markdown renderer.

describe('salvageStructuredText', () => {
  it('recovers the answer field from a truncated envelope', () => {
    // Cut off mid-string, exactly like the reported turn.
    const broken = '{"matches": [], "answer": "**Own-Stay angle**\\n- Compact 2-bedroom'
    expect(salvageStructuredText(broken)).toBe('**Own-Stay angle**\n- Compact 2-bedroom')
  })

  it('recovers a rationale when that is where the prose landed', () => {
    const broken = '{"matches": [{"projectId": "p1", "rationale": "Kensho is in Taman Desa'
    expect(salvageStructuredText(broken)).toBe('Kensho is in Taman Desa')
  })

  it('decodes escapes rather than returning them literally', () => {
    const broken = '{"answer": "line one\\nline two \\"quoted\\" end"}'
    expect(salvageStructuredText(broken)).toBe('line one\nline two "quoted" end')
  })

  it('does not stop early on an escaped quote', () => {
    // A naive indexOf('"') would truncate at the escaped quote.
    const broken = '{"answer": "he said \\"yes\\" and then more text'
    expect(salvageStructuredText(broken)).toBe('he said "yes" and then more text')
  })

  it('tolerates a leading code fence', () => {
    expect(salvageStructuredText('```json\n{"answer": "hello"}')).toBe('hello')
  })

  it('prefers answer over rationale when both are present', () => {
    // answer is the conversational branch; it is the reply the agent is meant to read.
    const s = '{"answer": "the real reply", "matches": [{"rationale": "shortlist note"}]}'
    expect(salvageStructuredText(s)).toBe('the real reply')
  })

  it('returns null for ordinary prose — not our business', () => {
    expect(salvageStructuredText('Here are the key collateral files for Kensho.')).toBeNull()
    expect(salvageStructuredText('')).toBeNull()
  })

  it('returns null when the envelope has no readable field', () => {
    expect(salvageStructuredText('{"matches": [], "citations": []}')).toBeNull()
  })

  it('returns null rather than inventing text for an empty string value', () => {
    expect(salvageStructuredText('{"answer": ""}')).toBeNull()
    expect(salvageStructuredText('{"answer": "   "}')).toBeNull()
  })
})

describe('quick-051: decodeFinderOutput accepts the conversational answer branch', () => {
  it('decodes an answer-only output as a populated state', () => {
    const out = decodeFinderOutput('{"matches": [], "answer": "Kensho is leasehold."}')
    expect(out).not.toBeNull()
    expect(out?.answer).toBe('Kensho is leasehold.')
    expect(out?.matches).toEqual([])
  })

  it('still rejects a genuinely empty output', () => {
    expect(decodeFinderOutput('{"matches": []}')).toBeNull()
  })
})

// ─── quick-kayinleong-053: guardrails against model shape drift ───────────────
//
// Verbatim from a production screenshot: the envelope was COMPLETE and well-formed but
// the wrong SHAPE — collateral came back as an object of arrays of bare url strings. zod
// rejected it, the decoder returned null, and the agent got raw JSON in their chat.

describe('quick-053: collateral shape drift', () => {
  const REAL_DRIFT = JSON.stringify({
    matches: [
      {
        projectId: 'NCrw4BbrKLOTyWhb4M5O',
        rationale: 'Confirmed 2-bedroom at RM900,000 in Bangsar (Lorong Maarof).',
        matchedCriteria: {
          segment: 'unknown',
          priceMax: 900000,
          nationality: 'unknown',
          bumiputera: null,
          locationPref: 'Bangsar',
          bedrooms: 2,
        },
        collateral: {
          brochures: [
            'https://firebasestorage.googleapis.com/v0/b/x/o/a.pdf?alt=media&token=t1',
            'https://firebasestorage.googleapis.com/v0/b/x/o/b.pdf?alt=media&token=t2',
          ],
        },
      },
    ],
  })

  it('decodes the exact envelope that reached a user as raw JSON', () => {
    const out = decodeFinderOutput(REAL_DRIFT)
    expect(out).not.toBeNull()
    expect(out?.matches).toHaveLength(1)
    expect(out?.matches[0].collateral).toHaveLength(2)
  })

  it('singularises the container key into a usable chip label', () => {
    const out = decodeFinderOutput(REAL_DRIFT)
    expect(out?.matches[0].collateral?.[0].type).toBe('brochure')
    expect(out?.matches[0].collateral?.[0].url).toContain('firebasestorage.googleapis.com')
  })

  it('also decodes it WITH the narration prefix the model still emits', () => {
    // "Let me run the search now.{...}" — forbidden by the quick-048 prompt rule, but the
    // model does it anyway. A guardrail cannot depend on the model obeying.
    const out = decodeFinderOutput('Let me run the search now.' + REAL_DRIFT)
    expect(out).not.toBeNull()
    expect(out?.matches[0].collateral).toHaveLength(2)
  })

  it('handles collateral as a flat array of bare url strings', () => {
    const s = JSON.stringify({
      matches: [{ projectId: 'p', rationale: 'r', matchedCriteria: {
        segment: 'unknown', priceMax: null, nationality: 'unknown',
        bumiputera: null, locationPref: null, bedrooms: null,
      }, collateral: ['https://a.test/x.pdf'] }],
    })
    expect(decodeFinderOutput(s)?.matches[0].collateral).toEqual([
      { type: 'file', url: 'https://a.test/x.pdf' },
    ])
  })

  it('accepts href/link as url aliases', () => {
    expect(normalizeFinderShape({
      matches: [{ collateral: [{ type: 'brochure', href: 'https://a.test/x.pdf' }] }],
    })).toEqual({
      matches: [{ collateral: [{ type: 'brochure', url: 'https://a.test/x.pdf' }] }],
    })
  })

  it('drops collateral entirely when nothing survives, rather than emitting []', () => {
    // collateral is optional and MatchList already handles its absence; an empty array
    // would render an empty chip row.
    const out = normalizeFinderShape({ matches: [{ collateral: { brochures: [] } }] }) as {
      matches: Array<Record<string, unknown>>
    }
    expect('collateral' in out.matches[0]).toBe(false)
  })

  it('NEVER invents a url — an item without one is dropped, not fabricated', () => {
    // Grounding is a hard constraint: repairing container shape is fine, inventing a
    // link is not.
    const out = normalizeFinderShape({
      matches: [{ collateral: [{ type: 'brochure' }, { type: 'x', url: 'https://ok.test/a' }] }],
    }) as { matches: Array<{ collateral: unknown[] }> }
    expect(out.matches[0].collateral).toEqual([{ type: 'x', url: 'https://ok.test/a' }])
  })

  it('leaves an already-canonical envelope untouched', () => {
    const canonical = { matches: [{ collateral: [{ type: 'brochure', url: 'https://a.test/x' }] }] }
    expect(normalizeFinderShape(canonical)).toEqual(canonical)
  })

  it('passes through non-objects for zod to reject honestly', () => {
    expect(normalizeFinderShape(null)).toBeNull()
    expect(normalizeFinderShape('nope')).toBe('nope')
    expect(normalizeFinderShape([1, 2])).toEqual([1, 2])
  })
})

describe('quick-053: salvage tolerates a prose prefix', () => {
  it('salvages an envelope that does NOT start with a brace', () => {
    // The quick-051 version required startsWith('{'), so a narrated turn was declined and
    // rendered raw. That inconsistency is why one turn degraded gracefully and the next
    // showed the user JSON.
    const narrated = 'Let me run the search now.{"matches": [], "answer": "Bangsar Hill Park is leasehold.'
    expect(salvageStructuredText(narrated)).toBe('Bangsar Hill Park is leasehold.')
  })

  it('still declines ordinary prose with no envelope at all', () => {
    expect(salvageStructuredText('Here are the collateral files for Kensho.')).toBeNull()
  })
})
