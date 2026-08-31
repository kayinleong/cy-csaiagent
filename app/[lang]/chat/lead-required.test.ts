/**
 * lead-required.test.ts — the "pick a lead" handoff (quick-kayinleong-077).
 *
 * A Reply turn with no lead attached is refused by the route (D-07 fail-closed, HTTP 400).
 * In AUTO the agent never chose Reply — the router did — so a generic error toast told them
 * nothing about the lead they were supposed to attach. The client now matches this exact
 * error and opens the lead picker instead.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { LEAD_REQUIRED_ERROR } from '@/src/agents/reply/schema'

const ROUTE = readFileSync(new URL('../../api/chat/route.ts', import.meta.url), 'utf8')
const INPUT = readFileSync(new URL('./chat-input.tsx', import.meta.url), 'utf8')
const SHELL = readFileSync(new URL('./chat-shell.tsx', import.meta.url), 'utf8')

describe('LEAD_REQUIRED_ERROR is one shared string', () => {
  it('is what the route emits — not a second hand-typed copy', () => {
    // The client COMPARES against this. Two hand-maintained copies of a string one side
    // emits and the other matches is a silent break waiting to happen.
    expect(ROUTE).toContain('error: LEAD_REQUIRED_ERROR')
    expect(ROUTE).not.toMatch(/error: 'leadId required for reply'/)
  })

  it('is what the client matches on', () => {
    expect(INPUT).toContain('body.error === LEAD_REQUIRED_ERROR')
    expect(INPUT).toContain("from '@/src/agents/reply/schema'")
  })

  it('has not drifted from the wire value the route has always sent', () => {
    expect(LEAD_REQUIRED_ERROR).toBe('leadId required for reply')
  })
})

describe('the 400 opens the lead picker instead of a generic error', () => {
  it('the client hands the blocked text to the shell', () => {
    expect(INPUT).toContain('onLeadRequired(text)')
  })

  it('never touches assistantMsgId before it is declared (quick-kayinleong-079)', () => {
    // THE BUG THIS REPLACES. quick-077 removed an "empty assistant placeholder" here by id,
    // but the placeholder is created BELOW the error block — so the reference sat in
    // assistantMsgId's temporal dead zone, threw ReferenceError on every call, and the outer
    // catch turned it into "Something went wrong. Please try again."
    //
    // tsc allowed it: the reference was inside a setMessages callback, and TS cannot know
    // when a callback runs, so TDZ is not a compile error there.
    //
    // The test it replaces asserted the source CONTAINED that line — which proved it was
    // present, something never in doubt, and could not tell me it threw. This one compares
    // positions, which is what actually matters.
    // Comments are stripped first — several of them mention the identifier precisely
    // because they explain this bug, and a prose mention is not a reference.
    const code = INPUT.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')

    const declaration = code.indexOf('const assistantMsgId =')
    expect(declaration).toBeGreaterThan(-1)

    const firstUse = code.indexOf('assistantMsgId')
    expect(
      firstUse,
      `assistantMsgId is used at ${firstUse}, before its declaration at ${declaration} — ` +
        'that is a temporal dead zone and throws at runtime',
    ).toBe(declaration + 'const '.length)
  })

  it('ChatInput FORWARDS every prop useChatStream asks for (quick-kayinleong-079)', () => {
    // THE BUG THIS CATCHES, and it is the second false-confidence miss in a row.
    //
    // chat-input.tsx has TWO components: useChatStream (which does the work) and ChatInput
    // (which wraps it). ChatInput hand-lists what it forwards. quick-077 added
    // `onLeadRequired` to ChatInputProps, to useChatStream's signature, and to the shell's
    // JSX — all three greppable, all three asserted, all three passing — but never to
    // ChatInput's forwarding list. So the prop reached ChatInput and stopped, and the
    // handler read `undefined`. Proven in a browser: `hasCallback: undefined`.
    //
    // tsc cannot catch it: an optional prop that is simply not destructured is legal.
    //
    // So instead of grepping for a line, compare the two lists.
    const picked = INPUT.match(/\}: Pick<\s*ChatInputProps,([\s\S]*?)>\s*\)/)
    expect(picked, 'could not find useChatStream\'s Pick<> prop list').toBeTruthy()
    const consumed = [...picked![1].matchAll(/'([^']+)'/g)].map((m) => m[1])
    expect(consumed.length).toBeGreaterThan(5)

    // Anchored on `= useChatStream({` — the CALL. Matching bare `useChatStream({` finds the
    // hook's own DECLARATION first, and then the check compares the prop list against
    // itself and can never fail. It did exactly that on the first attempt.
    const call = INPUT.match(/=\s*useChatStream\(\{([\s\S]*?)\n  \}\)/)
    expect(call, 'could not find the useChatStream CALL site').toBeTruthy()
    const forwarded = call![1]
    expect(forwarded, 'matched the declaration, not the call').not.toContain('Pick<')

    const dropped = consumed.filter((prop) => !new RegExp(`\\b${prop}\\b`).test(forwarded))
    expect(
      dropped,
      `ChatInput does not forward: ${dropped.join(', ')} — useChatStream will read undefined`,
    ).toEqual([])
  })

  it('the shell opens the picker on the server-side refusal', () => {
    expect(SHELL).toContain('const handleLeadRequired = (text: string)')
    expect(SHELL).toContain('onLeadRequired={handleLeadRequired}')
  })
})

describe('picking a lead sends the message automatically', () => {
  it('holds the TEXT, not just a boolean flag', () => {
    // It was `pendingReplySend` (boolean) with `void pendingReplySend // reserved for an
    // auto-resume affordance; currently re-send is manual` — the agent had to press Send
    // twice. Holding the text is what makes the resume possible.
    expect(SHELL).toContain('pendingReplyText')
    // The old boolean is gone from the CODE. It survives in a comment that explains what
    // it used to do, which is worth keeping — so assert on usage, not on the word.
    expect(SHELL).not.toContain('setPendingReplySend')
    expect(SHELL).not.toContain('void pendingReplySend //')
  })

  it('dispatches through the existing hero-card path, pinned to reply', () => {
    expect(SHELL).toMatch(/setSubmittedSuggestion\(\{[\s\S]*?text: pendingReplyText[\s\S]*?pillar: 'reply'/)
  })

  it('drops the held text on cancel, so it cannot resurface on a later turn', () => {
    expect(SHELL).toMatch(/handleLeadSelectorCancel[\s\S]{0,320}setPendingReplyText\(null\)/)
  })

  it('still blocks a manually-chosen Reply with no lead, and holds that text too', () => {
    expect(SHELL).toMatch(/effective === 'reply' && !leadId[\s\S]{0,260}setPendingReplyText\(text\)/)
  })
})
