/**
 * src/coach/journey/config.ts — Config-driven linear D2 onboarding journey.
 *
 * Defines the journey as ordered stages → ordered checkpoints, each checkpoint
 * referencing KB doc IDs (Derek-editable via the admin app — no code change).
 *
 * Design principles (D-06, COACH-01/03/07/08/09):
 *   - The journey is DATA, not code. Content lives in the KB.
 *   - kbDocIds[] are KB document references — placeholder IDs that match
 *     the actual documents Derek creates in the admin app by convention.
 *   - comprehensionGate is an optional free-text gate at key checkpoints
 *     (COACH-09 — replace passive video with evidence-based grading).
 *   - 'start' is the entry sentinel set by setUserClaims on new agents;
 *     nextCheckpoint('onboarding', 'start') → day-one-pairing.
 *
 * A5 (Checkpoint taxonomy — Derek to confirm):
 *   Proposed D2 PowerBoost journey:
 *   Stage 1 (onboarding): day-one-pairing → product-foundations → channel-playbooks
 *                         → first-meta-ad → onboarding-complete
 *   Stage 2 (training):   advanced-negotiation → compliance-and-pdpa → training-complete
 *   Stage 3 (qualified):  (terminal — no further checkpoints)
 *
 * Documented in 02-04-SUMMARY.md for Derek's review.
 *
 * Core/shell rule: this file must NOT import from app/ or next.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * An optional free-text comprehension gate that guards checkpoint advancement.
 * The gate asks the agent to paraphrase key content; gradeParaphrase() evaluates it.
 */
export interface ComprehensionGate {
  /** The prompt the Coach should ask to elicit the paraphrase. */
  prompt: string
  /**
   * The KB doc ID whose content is used as the canonical reference text for grading.
   * gradeParaphrase() will retrieve this doc's canonical summary to compare against.
   */
  canonicalKbDocId: string
}

/**
 * A single checkpoint within a journey stage.
 * Each checkpoint references KB doc IDs so Derek edits content, not code.
 */
export interface JourneyCheckpoint {
  /** Unique checkpoint identifier (kebab-case). */
  id: string
  /** The stage this checkpoint belongs to. */
  stage: string
  /**
   * KB document IDs providing the content for this checkpoint.
   * The Coach retrieves these docs to deliver conversational guidance.
   * Placeholder IDs: Derek names actual KB docs with these IDs in the admin app.
   */
  kbDocIds: string[]
  /** Optional comprehension gate — grades a free-text paraphrase (COACH-09). */
  comprehensionGate?: ComprehensionGate
}

/** Type alias for a resolved checkpoint step (same as JourneyCheckpoint). */
export type Step = JourneyCheckpoint

/** A journey stage containing ordered checkpoints. */
export interface JourneyStage {
  /** Unique stage identifier (kebab-case). */
  id: string
  /** Human-readable stage label (shown in the dashboard). */
  label: string
  /** Ordered checkpoints within this stage (advance through them linearly). */
  checkpoints: JourneyCheckpoint[]
}

/** The complete journey configuration — stages in order. */
export interface JourneyConfig {
  stages: JourneyStage[]
}

// ─── D2_JOURNEY: Proposed PowerBoost Onboarding Sequence ─────────────────────
//
// ⚠️ A5 NOTE: This checkpoint taxonomy is proposed based on the D2 PowerBoost
// programme structure (research + CONTEXT.md). Derek must CONFIRM this sequence
// and ensure the admin app has KB documents with these IDs. The structure can be
// updated by Derek without code changes — only kbDocIds need to match actual
// KB documents.
//
// KB doc ID naming convention:
//   kb-coach-{topic}-{lang}
// Derek creates KB docs in the admin app and tags them with matching IDs.

export const D2_JOURNEY: JourneyConfig = {
  stages: [
    // ── Stage 1: Onboarding ──────────────────────────────────────────────────
    {
      id: 'onboarding',
      label: 'Onboarding',
      checkpoints: [
        // Entry sentinel: 'start' is set on new agents by setUserClaims.
        // The 'start' sentinel is NOT a real checkpoint — it's the "not yet begun"
        // state. nextCheckpoint('onboarding', 'start') yields day-one-pairing.
        // We represent it as the first checkpoint so the config is self-contained.
        {
          id: 'day-one-pairing',
          stage: 'onboarding',
          kbDocIds: [
            'kb-coach-day-one-intro-en',
            'kb-coach-powerboost-overview-en',
            'kb-coach-senior-coach-intro-en',
          ],
          comprehensionGate: {
            prompt:
              'In your own words, describe the three key commitments you are making as a new D2 agent, ' +
              'and what the PowerBoost programme aims to help you achieve in your first 7–10 days.',
            canonicalKbDocId: 'kb-coach-day-one-intro-en',
          },
        },
        {
          id: 'product-foundations',
          stage: 'onboarding',
          kbDocIds: [
            'kb-coach-d2-product-range-en',
            'kb-coach-project-status-guide-en',
            'kb-coach-bumiputera-rules-en',
          ],
          comprehensionGate: {
            prompt:
              'Explain the difference between a bumiputera-quota and a foreign-eligible unit, ' +
              'and give one example of how this affects a lead\'s eligibility.',
            canonicalKbDocId: 'kb-coach-bumiputera-rules-en',
          },
        },
        {
          id: 'channel-playbooks',
          stage: 'onboarding',
          kbDocIds: [
            'kb-coach-meta-ads-playbook-en',
            'kb-coach-whatsapp-playbook-en',
            'kb-coach-iproperty-playbook-en',
            'kb-coach-content-playbook-en',
          ],
          comprehensionGate: {
            prompt:
              'Walk me through the first three steps you would take when setting up a Meta lead-gen ad ' +
              'for a D2 project, and explain why each step matters.',
            canonicalKbDocId: 'kb-coach-meta-ads-playbook-en',
          },
        },
        {
          id: 'first-meta-ad',
          stage: 'onboarding',
          kbDocIds: [
            'kb-coach-first-meta-ad-walkthrough-en',
            'kb-coach-meta-ad-compliance-en',
          ],
          comprehensionGate: {
            prompt:
              'Describe the compliance checklist you must complete before publishing your first Meta ad, ' +
              'and what happens if a required item is missing.',
            canonicalKbDocId: 'kb-coach-meta-ad-compliance-en',
          },
        },
        {
          id: 'onboarding-complete',
          stage: 'onboarding',
          kbDocIds: [
            'kb-coach-onboarding-completion-en',
          ],
          // No comprehension gate on the final onboarding checkpoint — celebration only.
        },
      ],
    },

    // ── Stage 2: Training ────────────────────────────────────────────────────
    {
      id: 'training',
      label: 'Training',
      checkpoints: [
        {
          id: 'advanced-negotiation',
          stage: 'training',
          kbDocIds: [
            'kb-coach-negotiation-sop-en',
            'kb-coach-objection-handling-en',
          ],
          comprehensionGate: {
            prompt:
              'Describe the D2 preferred approach to handling a lead who says the price is too high. ' +
              'What is the first thing you should never do, and what should you do instead?',
            canonicalKbDocId: 'kb-coach-objection-handling-en',
          },
        },
        {
          id: 'compliance-and-pdpa',
          stage: 'training',
          kbDocIds: [
            'kb-coach-pdpa-obligations-en',
            'kb-coach-d2-code-of-conduct-en',
          ],
          comprehensionGate: {
            prompt:
              'In your own words, explain the two primary PDPA obligations D2 agents must fulfil ' +
              'before sharing a lead\'s contact details with a project developer.',
            canonicalKbDocId: 'kb-coach-pdpa-obligations-en',
          },
        },
        {
          id: 'training-complete',
          stage: 'training',
          kbDocIds: [
            'kb-coach-training-completion-en',
          ],
        },
      ],
    },

    // ── Stage 3: Qualified (terminal) ────────────────────────────────────────
    {
      id: 'qualified',
      label: 'Qualified',
      checkpoints: [
        {
          id: 'qualified-agent',
          stage: 'qualified',
          kbDocIds: [
            'kb-coach-qualified-agent-guide-en',
          ],
          // Terminal checkpoint — nextCheckpoint returns null from here.
        },
      ],
    },
  ],
}
