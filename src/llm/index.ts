/**
 * src/llm/index.ts — Public re-export barrel for the LLM abstraction layer.
 *
 * Consumers import from '@/src/llm' — never from sub-modules directly.
 *
 * Exports:
 *   - modelFor    : real provider (resolves model ID from Remote Config)
 *   - LlmProvider : shared interface (fake + real must both satisfy this)
 *   - StreamArgs  : shared input shape
 *   - makeFakeProvider : deterministic test double (offline, no network)
 *
 * References: TSD §2.3, §3.2 llm row, FND-02, QUAL-01.
 */

// Real provider — resolves model ID from Firebase Remote Config
export { modelFor } from './provider'
export type { Pillar } from './provider'

// Shared interface types — provider-agnostic
export type { LlmProvider, StreamArgs, Message } from './types'

// Test double — deterministic, offline, framework-free
export { makeFakeProvider } from './fake'
export type { Script, ScriptMatch } from './fake'
