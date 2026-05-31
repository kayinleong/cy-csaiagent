/**
 * Seeded English KB fixture for RAG/coach unit tests.
 *
 * Provides one seeded EN KB document and a small set of chunk texts for
 * testing knowledge retrieval (FND-03, D-07).
 *
 * The KB document is a "proof slice" — a minimal D2-specific piece of
 * knowledge that proves the RAG pipeline (embed → vector store → retrieve
 * → cite) works end-to-end with real grounding.
 *
 * Content is English-only for the Phase-1 proof slice (D-07). The
 * retrieval machinery is multilingual (lang-filtered findNearest), but the
 * seeded KB content is EN. Full trilingual KB translation is Phase 2.
 *
 * Every Firestore doc carries tenantId: 'd2' (TSD §4, CLAUDE.md convention).
 */

/** Shape of a KB document as stored in Firestore (kbDocs collection). */
export interface KbDoc {
  id: string
  tenantId: 'd2'
  title: string
  lang: 'en' | 'ms' | 'zh'
  source: string
  createdAt: string // ISO timestamp
  status: 'active' | 'draft' | 'archived'
}

/** Shape of a KB chunk as stored in Firestore (kbChunks collection). */
export interface KbChunk {
  id: string
  docId: string
  tenantId: 'd2'
  lang: 'en' | 'ms' | 'zh'
  text: string
  /** 1024-d Voyage embedding (omitted in fixtures — provided by the embed pipeline) */
  embedding?: number[]
  chunkIndex: number
}

/**
 * The seeded EN KB document.
 * Topic: D2 onboarding overview — what new agents must complete in week 1.
 */
export const seedKbDocEn: KbDoc = {
  id: 'kb-doc-d2-onboarding-en-001',
  tenantId: 'd2',
  title: 'D2 New Agent Onboarding Guide (English)',
  lang: 'en',
  source: 'D2 Internal Training Materials v1',
  createdAt: '2026-05-31T00:00:00.000Z',
  status: 'active',
}

/**
 * Small set of chunk texts derived from the seeded KB document.
 * Used in RAG retrieval tests to verify the coach cites correct chunk IDs.
 *
 * In production, these texts are embedded via Voyage voyage-3-large (1024-d)
 * and stored in the kbChunks collection with their embedding vectors.
 * In tests, the fake provider bypasses embedding and retrieval entirely.
 */
export const seedKbChunksEn: KbChunk[] = [
  {
    id: 'kb-chunk-d2-onboarding-en-001-00',
    docId: 'kb-doc-d2-onboarding-en-001',
    tenantId: 'd2',
    lang: 'en',
    chunkIndex: 0,
    text: [
      'Welcome to D2 Property! As a new agent, your first week focuses on three key areas:',
      '(1) completing the D2 compliance checklist, (2) attending the product knowledge session,',
      'and (3) setting up your CRM account. Your senior coach will guide you through each step.',
    ].join(' '),
  },
  {
    id: 'kb-chunk-d2-onboarding-en-001-01',
    docId: 'kb-doc-d2-onboarding-en-001',
    tenantId: 'd2',
    lang: 'en',
    chunkIndex: 1,
    text: [
      'D2 Compliance Checklist: All agents must submit a certified true copy of their REN tag,',
      'NRIC, and bank account details within 3 working days of joining.',
      'Failure to do so will delay commission processing.',
    ].join(' '),
  },
  {
    id: 'kb-chunk-d2-onboarding-en-001-02',
    docId: 'kb-doc-d2-onboarding-en-001',
    tenantId: 'd2',
    lang: 'en',
    chunkIndex: 2,
    text: [
      'Product Knowledge: D2 currently offers residential and commercial projects in',
      'Kuala Lumpur, Selangor, and Johor. Key projects include Taman D2 Residences (freehold,',
      'bumiputera-reserved lots available) and D2 Commercial Hub (strata offices, foreigner-eligible).',
    ].join(' '),
  },
  {
    id: 'kb-chunk-d2-onboarding-en-001-03',
    docId: 'kb-doc-d2-onboarding-en-001',
    tenantId: 'd2',
    lang: 'en',
    chunkIndex: 3,
    text: [
      'CRM Setup: Use the D2 CRM portal at crm.d2property.my. Your login credentials are',
      'sent to your registered email. Complete your profile and link your upline coach',
      'before submitting your first lead.',
    ].join(' '),
  },
]

/** Chunk IDs in insertion order — used to verify citation correctness in RAG tests. */
export const seedKbChunkIds: string[] = seedKbChunksEn.map((c) => c.id)
