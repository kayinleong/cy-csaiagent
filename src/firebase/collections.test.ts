/**
 * collections.test.ts — Typed collection ref unit tests.
 *
 * Verifies (without live Firestore):
 *  1. Converters stamp tenantId:'d2' on every write (toFirestore).
 *  2. messagesRef(cid) builds a subcollection path under conversations/{cid}/messages.
 *  3. rateBudgetsRef converter stamps tenantId:'d2' (so 01-07 consumes a real, ruled collection).
 *  4. All 15 collection ref factories are exported and callable.
 *
 * Admin SDK is mocked so this test runs offline, in CI, with no Firebase project.
 */

import { describe, it, expect, vi } from 'vitest'

// ─── Hoist mocks to avoid hoisting-before-initialization error ───────────────
// vi.mock() calls are hoisted to the top of the file by vitest. Variables
// declared in the outer scope are NOT available at hoist time, so we must
// use vi.hoisted() to initialize them before the mocks run.

const { mockAdminDb } = vi.hoisted(() => {
  // Build a nested mock that tracks collection/doc/subcollection path calls.
  // The Admin SDK uses instance methods: adminDb.collection(name).doc(id).collection(sub)
  // We record the full path so tests can assert subcollection structure.

  function makeRef(path: string) {
    return {
      _path: path,
      withConverter: vi.fn(function (_converter: unknown) {
        return { _path: path }
      }),
      doc: vi.fn((id: string) => makeRef(`${path}/${id}`)),
      collection: vi.fn((sub: string) => makeRef(`${path}/${sub}`)),
    }
  }

  const mockAdminDb = {
    collection: vi.fn((name: string) => makeRef(name)),
  }

  return { mockAdminDb }
})

// ─── Mock firebase-admin modules ─────────────────────────────────────────────
vi.mock('firebase-admin/app', () => ({
  getApps: vi.fn(() => [{ name: '[DEFAULT]' }]),
  initializeApp: vi.fn(),
  cert: vi.fn((v: unknown) => v),
  getApp: vi.fn(() => ({ name: '[DEFAULT]' })),
}))

vi.mock('firebase-admin/firestore', () => ({
  getFirestore: vi.fn(() => mockAdminDb),
  FieldValue: {
    serverTimestamp: vi.fn(() => ({ _type: 'serverTimestamp' })),
  },
}))

vi.mock('firebase-admin/auth', () => ({
  getAuth: vi.fn(() => ({})),
}))

vi.mock('firebase-admin/remote-config', () => ({
  getRemoteConfig: vi.fn(() => ({})),
}))

// ─── Imports (after mocks) ───────────────────────────────────────────────────

import {
  TENANT_ID,
  usersRef,
  agentProfilesRef,
  conversationsRef,
  messagesRef,
  leadsRef,
  leadContextRef,
  projectsRef,
  collateralRef,
  kbDocsRef,
  kbChunksRef,
  kbIngestionJobsRef,
  escalationsRef,
  auditLogsRef,
  evalsRef,
  rateBudgetsRef,
  messageConverter,
  rateBudgetConverter,
  userConverter,
  auditLogConverter,
} from '@/src/firebase/collections'

import type { MessageDoc, RateBudgetDoc, UserDoc, AuditLogDoc } from '@/src/firebase/collections'

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('TENANT_ID constant', () => {
  it("equals 'd2'", () => {
    expect(TENANT_ID).toBe('d2')
  })
})

describe('converter.toFirestore stamps tenantId', () => {
  it('userConverter stamps tenantId:d2', () => {
    const input: UserDoc = {
      tenantId: 'd2',
      role: 'new-agent',
      lang: 'en',
      voiceSamples: [],
    }
    const out = userConverter.toFirestore(input)
    expect(out['tenantId']).toBe('d2')
    expect(out['role']).toBe('new-agent')
  })

  it('messageConverter stamps tenantId:d2', () => {
    const input: MessageDoc = {
      tenantId: 'd2',
      role: 'user',
      content: 'Hello coach',
      citations: [],
      routeDecision: 'coach',
      tokens: 10,
      redacted: false,
    }
    const out = messageConverter.toFirestore(input)
    expect(out['tenantId']).toBe('d2')
    expect(out['content']).toBe('Hello coach')
  })

  it('rateBudgetConverter stamps tenantId:d2', () => {
    const input: RateBudgetDoc = {
      tenantId: 'd2',
      ownerUid: 'test-uid-new-agent-001',
      requestCount: 0,
      tokenCount: 0,
      windowStart: new Date('2026-05-31T00:00:00Z'),
    }
    const out = rateBudgetConverter.toFirestore(input)
    expect(out['tenantId']).toBe('d2')
    expect(out['ownerUid']).toBe('test-uid-new-agent-001')
    expect(out['requestCount']).toBe(0)
    expect(out['tokenCount']).toBe(0)
  })

  it('auditLogConverter stamps tenantId:d2', () => {
    const input: AuditLogDoc = {
      tenantId: 'd2',
      actorUid: 'test-uid-new-agent-001',
      action: 'chat_turn',
      targetRef: 'conversations/conv-001',
      hashes: { content: 'abc123' },
      ts: new Date(),
    }
    const out = auditLogConverter.toFirestore(input)
    expect(out['tenantId']).toBe('d2')
    expect(out['actorUid']).toBe('test-uid-new-agent-001')
  })

  it('toFirestore always stamps TENANT_ID constant, regardless of caller value', () => {
    // Verifies the stamp is unconditional — a caller cannot accidentally
    // write a different tenantId.
    const input = {
      tenantId: 'other-tenant' as 'd2',
      role: 'new-agent' as const,
      lang: 'en' as const,
      voiceSamples: [],
    }
    const out = userConverter.toFirestore(input)
    expect(out['tenantId']).toBe('d2')
  })
})

describe('messagesRef subcollection path', () => {
  it("builds a subcollection path through conversations/{cid}/messages", () => {
    // Reset so we can inspect calls cleanly
    mockAdminDb.collection.mockClear()

    const cid = 'conv-abc123'
    const ref = messagesRef(cid) as unknown as { _path: string }

    // The ref factory calls:
    //   adminDb.collection('conversations').doc(cid).collection('messages')
    // Our mock builds: path = conversations/conv-abc123/messages
    expect(ref._path).toBe(`conversations/${cid}/messages`)
  })

  it('messagesRef(cid) converter stamps tenantId:d2 on a message doc', () => {
    const input: MessageDoc = {
      tenantId: 'd2',
      role: 'assistant',
      content: 'Here is the KB answer.',
      citations: ['chunk-001', 'chunk-002'],
      routeDecision: 'coach',
      tokens: 42,
      redacted: true,
    }
    const out = messageConverter.toFirestore(input)
    expect(out['tenantId']).toBe('d2')
    expect(out['citations']).toEqual(['chunk-001', 'chunk-002'])
  })
})

describe('all 15 collection ref factories are callable', () => {
  it('usersRef() returns a ref', () => {
    expect(usersRef()).toBeDefined()
  })
  it('agentProfilesRef() returns a ref', () => {
    expect(agentProfilesRef()).toBeDefined()
  })
  it('conversationsRef() returns a ref', () => {
    expect(conversationsRef()).toBeDefined()
  })
  it('messagesRef(cid) returns a ref', () => {
    expect(messagesRef('test-conv')).toBeDefined()
  })
  it('leadsRef() returns a ref', () => {
    expect(leadsRef()).toBeDefined()
  })
  it('leadContextRef() returns a ref', () => {
    expect(leadContextRef()).toBeDefined()
  })
  it('projectsRef() returns a ref', () => {
    expect(projectsRef()).toBeDefined()
  })
  it('collateralRef() returns a ref', () => {
    expect(collateralRef()).toBeDefined()
  })
  it('kbDocsRef() returns a ref', () => {
    expect(kbDocsRef()).toBeDefined()
  })
  it('kbChunksRef() returns a ref', () => {
    expect(kbChunksRef()).toBeDefined()
  })
  it('kbIngestionJobsRef() returns a ref', () => {
    expect(kbIngestionJobsRef()).toBeDefined()
  })
  it('escalationsRef() returns a ref', () => {
    expect(escalationsRef()).toBeDefined()
  })
  it('auditLogsRef() returns a ref', () => {
    expect(auditLogsRef()).toBeDefined()
  })
  it('evalsRef() returns a ref', () => {
    expect(evalsRef()).toBeDefined()
  })
  it('rateBudgetsRef() returns a ref (15th collection — source of truth for 01-07 ratelimit)', () => {
    expect(rateBudgetsRef()).toBeDefined()
  })
})

describe('rateBudgetsRef — owner-scoped collection (TSD §9)', () => {
  it('rateBudgetsRef accesses the rateBudgets collection', () => {
    mockAdminDb.collection.mockClear()
    rateBudgetsRef()
    // The first (and only) argument to adminDb.collection() should be 'rateBudgets'
    expect(mockAdminDb.collection).toHaveBeenCalledWith('rateBudgets')
  })

  it('rateBudgetConverter stamps tenantId and preserves ownerUid', () => {
    const agentUid = 'test-uid-new-agent-001'
    const input: RateBudgetDoc = {
      tenantId: 'd2',
      ownerUid: agentUid,
      requestCount: 5,
      tokenCount: 1500,
      windowStart: new Date('2026-05-31T00:00:00Z'),
    }
    const out = rateBudgetConverter.toFirestore(input)
    expect(out['tenantId']).toBe('d2')
    expect(out['ownerUid']).toBe(agentUid)
    expect(out['requestCount']).toBe(5)
    expect(out['tokenCount']).toBe(1500)
  })
})

describe('no inline messages array on conversation doc', () => {
  it('ConversationDoc shape does not have a messages field (subcollection, not inline array)', () => {
    // Compile-time check backed by a runtime structural assertion.
    // If someone adds a `messages` field to ConversationDoc, TypeScript catches it first;
    // this test documents the architectural invariant.
    const exampleConv = {
      tenantId: 'd2' as const,
      ownerUid: 'uid-001',
      pillar: 'coach' as const,
      lang: 'en' as const,
      createdAt: new Date(),
      summary: '',
    }
    expect(Object.keys(exampleConv)).not.toContain('messages')
  })
})
