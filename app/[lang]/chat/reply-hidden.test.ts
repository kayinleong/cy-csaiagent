/**
 * reply-hidden.test.ts — Reply is not offered to agents (quick-kayinleong-075).
 *
 * The pillar is fully built and the server still accepts it; this is about what an agent
 * can CHOOSE. The two surfaces that let them choose — the header tab and the hero
 * suggestion card — must agree, because a card that pins a mode the header does not show is
 * worse than either one alone.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { REPLY_PILLAR_ENABLED } from './chat-header'

const HEADER = readFileSync(new URL('./chat-header.tsx', import.meta.url), 'utf8')
const HERO = readFileSync(new URL('./hero-empty-state.tsx', import.meta.url), 'utf8')

describe('REPLY_PILLAR_ENABLED', () => {
  it('is off, so the chat page offers Auto / Coach / Finder only', () => {
    expect(REPLY_PILLAR_ENABLED).toBe(false)
  })

  it('gates the header tab rather than deleting it', () => {
    // Deleting would lose the lead-selector wiring and the i18n keys; this must stay a
    // one-line flip to bring back.
    expect(HEADER).toMatch(/REPLY_PILLAR_ENABLED && \(/)
    expect(HEADER).toContain('value="reply"')
  })

  it('keeps the other three tabs unconditional', () => {
    for (const pillar of ['auto', 'coach', 'finder']) {
      expect(HEADER).toContain(`value="${pillar}"`)
    }
  })

  it('gates the hero suggestion card with the SAME flag', () => {
    // The failure this prevents: hiding the tab but leaving a card that pins Reply on tap.
    expect(HERO).toContain('REPLY_PILLAR_ENABLED')
    expect(HERO).toMatch(/pillar !== 'reply' \|\| REPLY_PILLAR_ENABLED/)
  })

  it('swaps the hero subtitle so the page does not advertise Reply', () => {
    // "Or paste a client message and I'll draft a reply in your voice" is a pitch for a
    // mode the agent can no longer pick.
    expect(HERO).toContain("REPLY_PILLAR_ENABLED ? 'heroSubtitle' : 'heroSubtitleNoReply'")
  })

  it('has the no-Reply subtitle in every locale, and none of them mention a reply', () => {
    // The variant is the SAME sentence with the Reply clause removed, not new prose
    // invented in a language I cannot check.
    for (const lang of ['en', 'ms', 'zh']) {
      const messages = JSON.parse(
        readFileSync(new URL(`../../../src/i18n/messages/${lang}.json`, import.meta.url), 'utf8'),
      ) as { chat: Record<string, string> }
      const subtitle = messages.chat.heroSubtitleNoReply
      expect(subtitle, `${lang} is missing heroSubtitleNoReply`).toBeTruthy()
      expect(subtitle).not.toMatch(/reply|balasan|回复/i)
      // And it stays a prefix of the original, which is what makes it a deletion.
      expect(messages.chat.heroSubtitle.startsWith(subtitle)).toBe(true)
    }
  })

  it('still allows the server to accept a reply override', () => {
    // PillarOverride keeps 'reply' — the route, agent and ReplyDraftCard are untouched, so
    // Auto-routing and any re-enable keep working.
    expect(HEADER).toContain("export type PillarOverride = 'coach' | 'finder' | 'reply'")
  })
})
