/**
 * src/eval/judge.ts — Opus-4.7 judge configuration for Promptfoo evals.
 *
 * The judge model ID is NEVER hard-coded here. It is resolved from Firebase
 * Remote Config at runtime (model-agnostic constraint — TSD §2.3, QUAL-01).
 *
 * At eval runtime the judge model is resolved via the JUDGE_MODEL env var,
 * which the eval runner populates from Remote Config. The JUDGE_MODEL_FALLBACK
 * constant below is used ONLY when running in offline/CI mode without Remote
 * Config access — it is labeled accordingly and must not be referenced directly
 * in any provider configuration.
 *
 * Rubric domains:
 *   1. Grounded    — cites a real chunk ID from the D2 KB (format [KB:chunk-id])
 *   2. Scoped      — refuses generic real-estate advice not in D2-specific KB
 *   3. Language    — responds in the same language as the prompt (EN/MS/ZH)
 *   4. Voice       — writes as a knowledgeable D2 senior agent (no AI-tell filler)
 *
 * Usage:
 *   import { judgeRubric, judgeModelEnvKey } from '@/src/eval/judge'
 *   // In promptfoo config: model ID = process.env[judgeModelEnvKey]
 *
 * Core/shell rule: this file must NOT import from app/ or next.
 */

// ─── Judge model env key ──────────────────────────────────────────────────────

/**
 * The environment variable name that holds the judge model ID resolved from
 * Firebase Remote Config. The eval runner sets this before invoking Promptfoo.
 *
 * Remote Config key: model.grader.default
 * Default value (configured by Derek in Remote Config): see Remote Config key above
 */
export const judgeModelEnvKey = 'JUDGE_MODEL'

/**
 * Offline-only fallback label. This string identifies the Remote Config key
 * that should supply the real model ID. NEVER pass this to an AI provider
 * directly — it is a documentation placeholder, not a model ID.
 *
 * When JUDGE_MODEL env var is unset (offline dev / CI without RC), the eval
 * runner logs a warning and skips the live judge call; see evals/CALIBRATION.md.
 */
export const JUDGE_MODEL_RC_KEY = 'model.grader.default'

// ─── Rubric definition ────────────────────────────────────────────────────────

/**
 * The four-domain rubric the Opus judge applies to every Coach response.
 *
 * Each domain is scored PASS/FAIL with a brief rationale.
 * All four domains must PASS for the overall eval to pass.
 *
 * These rubric strings are injected into the Promptfoo `assert` blocks in
 * evals/promptfooconfig.yaml via the `rubric-prompt` assertion type.
 */
export const judgeRubric = {
  /**
   * Domain 1: Grounding
   * The response must cite at least one KB chunk ID in the format [KB:chunk-id].
   * Generic answers without citations fail this domain.
   */
  grounded: `\
GROUNDING CHECK: Does the response cite at least one D2 knowledge-base chunk using
the format [KB:<chunk-id>]? A response that answers from general knowledge without
citing a specific D2 KB chunk FAILS this check. Respond with PASS or FAIL and a
one-sentence rationale.`,

  /**
   * Domain 2: Scope adherence
   * The response must refuse or redirect generic real-estate questions that
   * are not answered by D2-specific KB content.
   */
  scoped: `\
SCOPE CHECK: Does the response stay within D2-specific onboarding knowledge?
A response that gives generic Malaysian real-estate advice (not grounded in a
D2 KB document) FAILS this check. A response that correctly declines and redirects
an out-of-scope question PASSES. Respond with PASS or FAIL and a one-sentence rationale.`,

  /**
   * Domain 3: Language match
   * The response language must match the prompt language exactly.
   * An English prompt must receive an English response; Bahasa Malaysia → BM response;
   * Mandarin Chinese → Mandarin response.
   */
  languageMatch: `\
LANGUAGE CHECK: Does the response language match the prompt language? If the prompt
is in English (EN), the response must be in English. If the prompt is in Bahasa Malaysia
(MS), the response must be in Bahasa Malaysia. If the prompt is in Mandarin Chinese (ZH),
the response must be in Mandarin Chinese. Respond with PASS or FAIL and a one-sentence rationale.`,

  /**
   * Domain 4: Voice / tone
   * The response must sound like a knowledgeable D2 senior agent, not a generic AI.
   * Filler phrases like "Certainly!", "Great question!", or em-dashes are anti-tells.
   */
  voice: `\
VOICE CHECK: Does the response sound like a knowledgeable D2 senior agent helping
a colleague — direct, practical, and D2-specific? A response that uses generic AI
filler phrases ("Certainly!", "Great question!", excessive hedging) or sounds like a
generic assistant (not a D2 agent) FAILS this check. Respond with PASS or FAIL and
a one-sentence rationale.`,
} as const

/**
 * The combined multi-domain rubric string.
 * Used as the `value` in a Promptfoo `llm-rubric` assertion.
 */
export const combinedJudgeRubric = `\
You are an expert evaluator for the D2 Onboarding Coach AI. Score the response on
all four domains below. Each domain must receive a PASS or FAIL verdict with a
one-sentence rationale. The overall result is PASS only if ALL four domains pass.

${judgeRubric.grounded}

${judgeRubric.scoped}

${judgeRubric.languageMatch}

${judgeRubric.voice}

Format your response as:
GROUNDING: [PASS/FAIL] — <rationale>
SCOPE: [PASS/FAIL] — <rationale>
LANGUAGE: [PASS/FAIL] — <rationale>
VOICE: [PASS/FAIL] — <rationale>
OVERALL: [PASS/FAIL]
`
