/**
 * decode-structured-output.test.ts — the SSE→structured-output decode bridge.
 *
 * Closes the v1.0 milestone gap: Reply/Finder turns stream a JSON object as text;
 * the client must decode it on completion so the interactive card renders. These tests
 * lock the decode gate and the per-pillar non-collision the caller relies on.
 */

import { describe, it, expect } from 'vitest'
import { decodeReplyOutput, decodeFinderOutput, salvageStructuredText } from './decode-structured-output'

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
