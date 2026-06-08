/**
 * decode-structured-output.test.ts — the SSE→structured-output decode bridge.
 *
 * Closes the v1.0 milestone gap: Reply/Finder turns stream a JSON object as text;
 * the client must decode it on completion so the interactive card renders. These tests
 * lock the decode gate and the per-pillar non-collision the caller relies on.
 */

import { describe, it, expect } from 'vitest'
import { decodeReplyOutput, decodeFinderOutput } from './decode-structured-output'

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
