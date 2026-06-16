/**
 * app/[lang]/_components/journey-label.ts — translate D2 journey stage / checkpoint
 * ids into the active locale for display.
 *
 * Agent rows store the journey stage (`onboarding`/`training`/`qualified`) and the
 * current checkpoint as kebab-case ids (e.g. `day-one-pairing`) from
 * src/coach/journey/config.ts. Rendering those raw is both untranslated and ugly,
 * so map them through the `journey` i18n namespace. Unknown ids (e.g. a future
 * checkpoint not yet in the catalogs) fall back to a humanized form rather than
 * surfacing a MISSING_MESSAGE.
 *
 * Pure module (no JSX): works with both useTranslations (client) and
 * getTranslations (server). Pass the `journey`-namespaced translator, cast to the
 * minimal callable shape — the keys are dynamic so the strict typed key union does
 * not apply.
 */

/** Minimal translator shape — a key→string callable (matches use-intl at runtime). */
export type JourneyTranslator = (key: string) => string

/** Stage ids that have a `journey.stages.*` label (keep in sync with config + i18n). */
const KNOWN_STAGES = new Set(['onboarding', 'training', 'qualified'])

/** Checkpoint ids that have a `journey.checkpoints.*` label (incl. the `start` sentinel). */
const KNOWN_CHECKPOINTS = new Set([
  'start',
  'day-one-pairing',
  'product-foundations',
  'channel-playbooks',
  'first-meta-ad',
  'onboarding-complete',
  'advanced-negotiation',
  'compliance-and-pdpa',
  'training-complete',
  'qualified-agent',
])

/** kebab-case id → Title Case words (fallback for ids without a catalog entry). */
export function humanizeJourneyId(id: string): string {
  return id
    .split('-')
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ')
}

/** Translated label for a journey stage id (humanized fallback if unknown). */
export function journeyStageLabel(t: JourneyTranslator, stage: string): string {
  return KNOWN_STAGES.has(stage) ? t(`stages.${stage}`) : humanizeJourneyId(stage)
}

/** Translated label for a journey checkpoint id (humanized fallback if unknown). */
export function journeyCheckpointLabel(t: JourneyTranslator, checkpoint: string): string {
  return KNOWN_CHECKPOINTS.has(checkpoint)
    ? t(`checkpoints.${checkpoint}`)
    : humanizeJourneyId(checkpoint)
}
