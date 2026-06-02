/**
 * src/coach/journey/index.ts — Journey module public API.
 *
 * Re-exports all public types and functions from the journey sub-modules.
 * Callers import from '@/src/coach/journey' — never from sub-files directly.
 *
 * Core/shell rule: this file must NOT import from app/ or next.
 */

// Config types and the D2 journey definition
export type { JourneyConfig, JourneyStage, JourneyCheckpoint, Step, ComprehensionGate } from './config'
export { D2_JOURNEY } from './config'

// Pure transition logic + Firestore commit
export { nextCheckpoint, advance, commitAdvance } from './transition'

// Comprehension grading (COACH-09)
export type { GradeParaphraseOpts, GradeParaphraseResult } from './comprehension'
export { gradeParaphrase } from './comprehension'
