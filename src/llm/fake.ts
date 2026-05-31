/**
 * Deterministic LLM test double.
 *
 * Usage:
 *   import { makeFakeProvider } from '@/src/llm/fake'
 *
 *   const fake = makeFakeProvider([
 *     { match: { systemContains: 'coach' }, reply: 'I am the coach.' },
 *     { match: { lastUserMessage: 'hi', callCounter: 1 }, reply: 'First hi response' },
 *     { match: { lastUserMessage: 'hi', callCounter: 2 }, reply: 'Second hi response' },
 *   ])
 *
 *   for await (const chunk of fake.stream({ messages, system, model })) {
 *     process.stdout.write(chunk)  // streams in >=2 chunks
 *   }
 *
 *   // Inspect what was passed for PII assertions:
 *   expect(fake.lastArgs?.messages).not.toContainEqual({ role: 'user', content: '+6012...' })
 *
 * This file must NOT import from 'next' or '@/app' — it lives in src/ core and
 * must remain Next-free and unit-testable (TSD §3.1, CLAUDE.md core/shell rule).
 */
import type { LlmProvider, StreamArgs } from '@/src/llm/types'

/** Criteria for matching an incoming stream() call to a scripted reply. */
export interface ScriptMatch {
  /**
   * If set, matches when the system prompt contains this string (case-sensitive).
   * Checks args.system (and also the content of any system-role message).
   */
  systemContains?: string

  /**
   * If set, matches when the last user message content equals this string (exact).
   */
  lastUserMessage?: string

  /**
   * If set, matches only on the Nth call (1-indexed).
   * The internal call counter increments on every stream() call, so a second
   * call with identical args can return a different scripted turn.
   */
  callCounter?: number
}

/** A single scripted entry: a matcher and the reply to emit when it matches. */
export interface Script {
  match: ScriptMatch
  reply: string
}

/**
 * Returns an LlmProvider that deterministically returns scripted replies
 * without making any network calls.
 *
 * Matching priority: the first matching script in the array wins.
 * If no script matches, an empty string is streamed (silent no-op).
 *
 * @param scripts - Ordered list of (match, reply) pairs.
 */
export function makeFakeProvider(scripts: Script[]): LlmProvider & { lastArgs?: StreamArgs } {
  let callCounter = 0

  const provider: LlmProvider & { lastArgs?: StreamArgs } = {
    lastArgs: undefined,

    stream(args: StreamArgs): AsyncIterable<string> {
      // Record the call arguments for test-time inspection (PII assertions, etc.)
      provider.lastArgs = args

      // Advance the call counter before matching so callCounter:1 fires on the 1st call
      callCounter += 1
      const currentCall = callCounter

      // Pick the first matching script
      const matched = scripts.find((script) => {
        const { systemContains, lastUserMessage, callCounter: counterConstraint } = script.match

        // Check callCounter constraint if present
        if (counterConstraint !== undefined && counterConstraint !== currentCall) {
          return false
        }

        // Check systemContains against args.system and any system-role message
        if (systemContains !== undefined) {
          const systemText = args.system ?? ''
          const systemMessages = args.messages
            .filter((m) => m.role === 'system')
            .map((m) => m.content)
            .join(' ')
          const combined = `${systemText} ${systemMessages}`
          if (!combined.includes(systemContains)) {
            return false
          }
        }

        // Check lastUserMessage against the last user-role message
        if (lastUserMessage !== undefined) {
          const userMessages = args.messages.filter((m) => m.role === 'user')
          const last = userMessages[userMessages.length - 1]
          if (!last || last.content !== lastUserMessage) {
            return false
          }
        }

        return true
      })

      const reply = matched?.reply ?? ''

      // Simulate streaming: split the reply into >=2 chunks.
      // Split on whitespace boundaries; if the reply is a single word, split
      // it in half so there are always >=2 chunks (exercisable by streaming tests).
      function toChunks(text: string): string[] {
        if (text === '') return ['']
        const words = text.split(' ')
        if (words.length === 1) {
          // Single word: split in half
          const mid = Math.max(1, Math.floor(text.length / 2))
          return [text.slice(0, mid), text.slice(mid)]
        }
        // Multiple words: emit word by word (space prepended from 2nd word onward)
        return words.map((w, i) => (i === 0 ? w : ' ' + w))
      }

      const chunks = toChunks(reply)

      // Return an AsyncIterable<string> that yields each chunk with a microtask gap
      return {
        [Symbol.asyncIterator](): AsyncIterator<string> {
          let index = 0
          return {
            async next(): Promise<IteratorResult<string>> {
              if (index >= chunks.length) {
                return { done: true, value: undefined }
              }
              // Yield the next chunk (microtask gap simulates async I/O)
              const value = chunks[index++]
              return { done: false, value }
            },
          }
        },
      }
    },
  }

  return provider
}
