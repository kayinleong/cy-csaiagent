/**
 * src/memory/index.ts — Shared memory layer public API.
 *
 * Three sub-modules:
 *   - conversation.ts: appendMessage (subcollection) + loadRecent (paginated)
 *   - leadContext.ts:  writeLeadSlot (agent-scoped slot writer)
 *   - agentProfile.ts: updateJourneyStage + touchLastActive (journey-state seam)
 *
 * All writes go through typed refs from 01-03 (collections.ts).
 * Framework-free — no Next.js, no React, no app/ imports.
 *
 * Consumed by: chat route (01-11), stall-detect job (01-10).
 */

export { appendMessage, loadRecent, ensurePrimaryThread, listConversations, searchConversations } from './conversation'
export type { MessageRecord, ConversationRecord } from './conversation'

export { writeLeadSlot, readFinderSlot, mergeFinderCriteria, mergeDiscussed } from './leadContext'
export type { LeadSlot, FinderSlot } from './leadContext'

export { updateJourneyStage, touchLastActive, getAgentProfile } from './agentProfile'
