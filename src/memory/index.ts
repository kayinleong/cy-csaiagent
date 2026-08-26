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

export { appendMessage, updateMessage, loadRecent, ensurePrimaryThread, ensureConversationOwned, truncateTitle, listConversations, searchConversations } from './conversation'
export type { MessageRecord, ConversationRecord } from './conversation'

export { writeLeadSlot, readFinderSlot, readReplySlot, mergeFinderCriteria, mergeDiscussed } from './leadContext'
export type { LeadSlot, FinderSlot, ReplySlot } from './leadContext'

export { updateJourneyStage, touchLastActive, getAgentProfile } from './agentProfile'
