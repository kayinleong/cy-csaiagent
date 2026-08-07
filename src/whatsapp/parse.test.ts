/**
 * src/whatsapp/parse.test.ts — unit tests for the portable WhatsApp export parser.
 *
 * Pure logic over synthetic transcripts (no real PII, no network, no Firestore) —
 * mirrors the core/shell rule (src/ is unit-testable without Next). Covers the
 * Android export shape, system-line stripping, multi-line folding, and the three
 * media-reference forms (<attached: …>, "… (file attached)", <Media omitted>).
 */

import { describe, it, expect } from 'vitest'
import { parseWhatsApp, toTranscript, toClassificationSample } from './parse'

// Synthetic 12/24-hour Android export. Names are fictional (no real PII).
const SAMPLE = [
  '18/03/2024, 10:01 am - Messages and calls are end-to-end encrypted.',
  '18/03/2024, 10:02 am - Alice created group "Lunar Residence Seputeh"',
  '18/03/2024, 10:03 am - Bob joined using this group\'s invite link',
  '18/03/2024, 10:04 am - Alice: Welcome! This chat is for the Lunar Residence Seputeh launch.',
  '18/03/2024, 10:05 am - Bob: Great — what is the indicative price?',
  'Is it under 800k?',
  '18/03/2024, 10:06 am - Alice: IMG-20240318-WA0001.jpg (file attached)',
  '18/03/2024, 10:07 am - Bob: <attached: floorplan-A.pdf>',
  '18/03/2024, 10:08 am - Alice: <Media omitted>',
].join('\n')

describe('parseWhatsApp', () => {
  const parsed = parseWhatsApp(SAMPLE)

  it('extracts the group name from the "created group" system line', () => {
    expect(parsed.groupName).toBe('Lunar Residence Seputeh')
  })

  it('counts system lines and excludes them from messages', () => {
    // encryption notice + created-group + joined = 3 system lines
    expect(parsed.systemLineCount).toBe(3)
    // 5 real messages (2 Alice text/img + 1 Bob text w/ continuation + 1 Bob pdf + 1 Alice omitted)
    expect(parsed.messages).toHaveLength(5)
  })

  it('captures participants (senders only)', () => {
    expect(parsed.participants.sort()).toEqual(['Alice', 'Bob'])
  })

  it('folds continuation lines into the preceding message', () => {
    const priceMsg = parsed.messages.find((m) => m.sender === 'Bob' && m.text.includes('indicative price'))
    expect(priceMsg?.text).toContain('Is it under 800k?')
  })

  it('detects all three media-reference forms', () => {
    expect(parsed.mediaRefs).toContain('IMG-20240318-WA0001.jpg')
    expect(parsed.mediaRefs).toContain('floorplan-A.pdf')
    // <Media omitted> is a message but has no concrete filename → not in mediaRefs
    const omitted = parsed.messages.find((m) => m.text === '[media omitted]')
    expect(omitted).toBeDefined()
  })

  it('rewrites media messages to a compact [media: …] marker', () => {
    const img = parsed.messages.find((m) => m.media === 'IMG-20240318-WA0001.jpg')
    expect(img?.text).toBe('[media: IMG-20240318-WA0001.jpg]')
  })
})

describe('toTranscript', () => {
  it('renders a header + one line per message, dropping system noise', () => {
    const t = toTranscript(parseWhatsApp(SAMPLE))
    expect(t).toContain('WhatsApp group: Lunar Residence Seputeh')
    expect(t).toContain('[18/03/2024, 10:04 am] Alice:')
    // system notices must NOT appear
    expect(t).not.toContain('end-to-end encrypted')
    expect(t).not.toContain('joined using')
  })
})

describe('toClassificationSample', () => {
  it('produces a bounded sample with group, participants, and message counts', () => {
    const s = toClassificationSample(parseWhatsApp(SAMPLE))
    expect(s).toContain('Group name: Lunar Residence Seputeh')
    expect(s).toContain('Participants (2):')
    expect(s).toContain('--- first messages ---')
  })
})
