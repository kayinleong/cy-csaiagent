/**
 * LLM provider interface contract.
 * Both the fake provider and real provider (Anthropic via AI SDK) implement this.
 * Keeping it framework-free (no Next.js, no AI SDK import) ensures:
 *   - src/ core remains portable and unit-testable without Next (TSD §3.1)
 *   - QUAL-01: any provider that satisfies this interface can be swapped in
 *
 * Usage:
 *   import type { LlmProvider, StreamArgs } from '@/src/llm/types'
 */

/** A single message in the conversation history. */
export interface Message {
  role: 'user' | 'assistant' | 'system'
  content: string
}

/**
 * Arguments passed to LlmProvider.stream().
 * Intentionally minimal — providers may accept more fields internally,
 * but the interface only mandates what all callers must supply.
 */
export interface StreamArgs {
  /** Conversation history (at minimum one user message). */
  messages: Message[]

  /**
   * Optional system prompt injected before the conversation.
   * Separate from messages so providers can apply it with cache_control
   * or other model-specific optimizations.
   */
  system?: string

  /**
   * Optional tool definitions the model may call.
   * Typed as unknown[] to keep the interface provider-agnostic;
   * real providers validate the shape with their own Zod schemas.
   */
  tools?: unknown[]

  /**
   * The model identifier to use.
   * MUST be resolved from Remote Config via modelFor() — never hard-coded.
   * In tests, pass any string (e.g. 'fake-model').
   */
  model: string
}

/**
 * The provider interface all LLM backends must implement.
 *
 * stream() returns an AsyncIterable<string> that yields token chunks.
 * The iterable also exposes lastArgs so tests can inspect what was passed
 * (e.g. to assert no unredacted PII was sent to the model).
 *
 * Streaming via AsyncIterable:
 *   for await (const chunk of provider.stream(args)) { ... }
 */
export interface LlmProvider {
  /**
   * Stream tokens from the model.
   * Yields string chunks; concatenating them produces the full response.
   * Exposes lastArgs after at least one call for test-time inspection.
   */
  stream(args: StreamArgs): AsyncIterable<string>

  /**
   * The arguments of the most recent stream() call.
   * Undefined before the first call. Used by tests to assert PDPA compliance:
   *   expect(provider.lastArgs?.messages).not.toContain('<real-PII>')
   */
  lastArgs?: StreamArgs
}
