# Phase 4: Reply Assistant + Reply Analytics - Pattern Map

**Mapped:** 2026-06-05
**Files analyzed:** 24 (new + modified)
**Analogs found:** 22 / 24 (2 net-new with partial analog)

> **Discipline: "grow, don't fork."** The Finder pillar (Phase 3) is the literal template for the Reply pillar. Nearly every new file has a 1:1 existing analog — copy its structure, rename, and adjust the narrow Reply-specific logic. Excerpts below are real code with `file:line`. Where the codebase makes a CONTEXT.md decision harder than it reads, the row is flagged ⚠️ (verified gap, not inferred).

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/agents/reply/index.ts` | agent | request-response | `src/agents/finder/index.ts` | exact |
| `src/agents/reply/prompt.ts` | agent (prompt) | transform | `src/agents/finder/prompt.ts` | exact |
| `src/agents/reply/schema.ts` | agent (schema) | transform | `src/agents/finder/schema.ts` | exact |
| `src/agents/reply/tools.ts` | agent (tools) | request-response | `src/agents/finder/tools.ts` + `src/agents/coach/tools.ts` (retrieveKnowledge) | exact |
| `src/agents/reply/reply.test.ts` | test | — | `src/agents/finder/finder.test.ts` | exact |
| `src/memory/leadContext.ts` (GROW) | model/memory | CRUD | `FinderSlot`/`readFinderSlot` in the same file | exact (in-file) |
| `app/api/chat/route.ts` (GROW) | route handler | streaming | the existing Finder dispatch branch in the same file | exact (in-file) |
| `src/router/heuristic.ts` (GROW) | router | transform | `FINDER_PATTERNS`/`COACH_PATTERNS` in the same file | exact (in-file) |
| `src/router/classifier.ts` (GROW) | router | request-response | `RouteSchema`/`classifyIntent` in the same file | exact (in-file) |
| `src/rag/search.ts` (GROW) | service | request-response | `firestoreRetrieve` in the same file | exact (in-file) |
| `src/rag/index.ts` (GROW) | service (facade) | request-response | `retrieve` facade in the same file | exact (in-file) |
| `src/firebase/collections.ts` (GROW) | model/config | CRUD | `escalations`/`knowledgeGaps` refs + converter + `KbChunkDoc` | exact (in-file) |
| `src/kb/ingest/pipeline.ts` (GROW) | service | batch/file-I/O | `processBatch` chunk write in the same file | exact (in-file) |
| `src/kb/crud.ts` (GROW) | service | CRUD | `CreateDocInput`/`createDoc` in the same file | exact (in-file) |
| `src/audit/pdpa.ts` (GROW) ⚠️ | service (security) | transform | `replacePhones`/`replaceNames` in the same file | exact (in-file) — needs extension |
| `src/eval/judge.ts` (GROW) | config (eval) | transform | `judgeRubric`/`combinedJudgeRubric` in the same file | exact (in-file) |
| `src/reply/diff.ts` | utility | transform | (no analog — net-new ~15-line util) | none |
| `firestore.rules` (GROW) | config (security) | — | `escalations`/`knowledgeGaps` match blocks | exact (in-file) |
| `firestore.indexes.json` (GROW) | config | — | `kbChunks (lang,status,embedding)` + `knowledgeGaps (seniorCoachId,lastSeenAt)` | exact (in-file) |
| `app/[lang]/chat/reply-draft-card.tsx` | component | event-driven | `app/[lang]/chat/match-list.tsx` | role-match (RSC card → client island) |
| `app/[lang]/chat/chat-input.tsx` (GROW) | component | request-response | the `pillarOverride`/`leadId` wiring in the same file | exact (in-file) |
| `app/[lang]/chat/{chat-header,message-list}.tsx` (GROW) | component | — | the pillar-chip + card-render wiring in those files | exact (in-file) |
| `app/[lang]/(admin)/kb/{actions,kb-doc-form,kb-doc-list,page}.tsx` (GROW) | route group (admin) | CRUD | the same files (pillar filter + category field) | exact (in-file) |
| `app/[lang]/(coach)/_components/reply-quality-panel.tsx` + `(coach)/dashboard/{page,actions}.ts` (GROW) | component + Server Action | CRUD/aggregation | `metrics-panel.tsx` (recharts) + `getAgentChatHistory` (downline read) | role-match |

**Net-new collection/artifacts (no file analog, structural analog only):** `replyEdits` (→ `escalations`/`knowledgeGaps`), `evals/gold/reply-*.yaml` (→ existing Coach gold sets), `.planning/phases/04-reply-assistant/WABA-GATE.md` (doc only), one-time `scripts/backfill-kb-chunks-pillar.ts` (→ `scripts/backfill-kb-status.ts`).

---

## Pattern Assignments

### `src/agents/reply/index.ts` (agent, request-response)

**Analog:** `src/agents/finder/index.ts` — copy the frozen `as const` object shape line-for-line.

**Agent object shape** (`src/agents/finder/index.ts:83-163`):
```typescript
export const finderAgent = {
  systemPrompt: FINDER_SYSTEM_PROMPT,
  buildSystemPrompt(options?: { leadContext?: Record<string, unknown> }): string {
    return buildFinderSystemPrompt(options)
  },
  outputSchema: FinderOutputSchema,
  makeTools(userLang: 'en' | 'ms' | 'zh', agentUid?: string, leadId?: string) {
    void agentUid
    void leadId
    return {
      searchProjects: makeSearchProjectsTool(userLang),
      queryInventory: makeQueryInventoryTool(userLang),
      fetchCollateral: makeFetchCollateralTool(userLang),
    }
  },
  async run(args: FinderRunArgs): Promise<FinderRunResult> {
    const { parsedCriteria, injectedSearchResult, userLang } = args
    if (injectedSearchResult !== undefined) {
      const output = buildOutputFromSearchResult(injectedSearchResult, parsedCriteria, userLang)
      const validated = FinderOutputSchema.parse(output)
      return { output: validated }
    }
    // ...default path
  },
} as const
```

**Reply adaptation:**
- `replyAgent.buildSystemPrompt({ replySlot, incoming?, leadId? })` (CONTEXT D-02 — note the build args differ from Finder's single `leadContext`).
- `makeTools(userLang, agentUid?, leadId?)` returns `{ retrieveReplySop, fetchVoiceSamples, fetchLeadContext }` — drop `queryInventory`/`fetchCollateral`.
- `run()` offline path takes an `injectedSopResult` (mirror `injectedSearchResult`) so the `no_sop_match` refusal gate is unit-testable without Firestore (RESEARCH Q1).
- The offline output builder mirrors `buildOutputFromSearchResult` (`finder/index.ts:177-269`): no hit → grounded `noSopMatch`; ambiguous inbound → `clarifyingQuestion`; hit → `draft` with `sopDocIds[]`.

**Header doc-comment to copy verbatim (intent):** `src/agents/finder/index.ts:27-33` — "Tools are READ-ONLY", "slot write happens in the route's onFinish, NOT inside a tool", "Model IDs resolved via modelFor()", "this file must NOT import from app/ or next."

---

### `src/agents/reply/prompt.ts` (agent prompt, transform)

**Analog:** `src/agents/finder/prompt.ts` — `buildFinderSystemPrompt(options?)` + exported `FINDER_SYSTEM_PROMPT` base.

**Prompt builder shape** (`src/agents/finder/prompt.ts:49-101`):
```typescript
export function buildFinderSystemPrompt(options?: {
  leadContext?: Record<string, unknown>
}): string {
  const reRankSection = options?.leadContext
    ? `\n## Returning Lead Context\n...`
    : ''
  return `\
You are the Property Finder for D2, a Malaysian real-estate brokerage.
...
## Grounding (MANDATORY)
- Use the searchProjects tool BEFORE recommending any project.
- Only recommend projects returned by the searchProjects tool. NEVER invent a project...
- If searchProjects returns no_match or ineligible, deliver the grounded refusal...
- Cite the projectId in every recommendation (e.g. "Project ID: project-kl-001").
...
## Tone and Language
- Respond in the same language the agent used (English, Bahasa Malaysia, or Mandarin/中文).
- Do not use em-dashes or AI-assistant clichés.
`
}
export const FINDER_SYSTEM_PROMPT = buildFinderSystemPrompt()
```

**Reply adaptation (the Reply-specific prompt content is Claude's-Discretion — derive from the curated voice doc, D-12):**
- Keep the **Grounding (MANDATORY)** block, swapping "searchProjects"→"retrieveReplySop", "projectId"→`[SOP:doc-id]`, "no_match"→`no_sop_match` (CONTEXT D-11).
- Keep the **Tone and Language** block verbatim — it is the anti-AI-tell baseline (RESEARCH D-13/D-14).
- Add a **Cold-prospect qualifying-questions** branch (REPLY-05): cold-prospect path asks qualifying questions, never auto-pitches.
- Inject the curated org-voice doc text (from `fetchVoiceSamples`) into the prompt at invocation time (RESEARCH Q6).

---

### `src/agents/reply/schema.ts` (agent schema, transform)

**Analog:** `src/agents/finder/schema.ts` — the `FinderOutputSchema` XOR-invariant pattern.

**Output schema with optional cross-fields** (`src/agents/finder/schema.ts:193-212`):
```typescript
export const FinderOutputSchema = z.object({
  matches: z.array(FinderMatchSchema),
  refusal: FinderRefusalSchema.optional(),
  clarifyingQuestion: z.string().min(1).optional(),
})
```
The app-level XOR invariant (matches XOR refusal XOR clarifyingQuestion) is enforced in `index.ts`, **not** in Zod (`finder/schema.ts:15`, `:182-191`).

**Reply adaptation — `ReplyOutputSchema`** (RESEARCH Q1, Pattern 4):
- `draft?: { text: string; sopDocIds: z.array(z.string().min(1)) }` — the grounded reply text + cited SOP IDs (mirror `FinderMatchSchema`'s `projectId`-is-real invariant: `finder/schema.ts:133-166`).
- `noSopMatch?: { reason: 'no_sop_match'; message: string }` — grounded refusal (mirror `FinderRefusalSchema`, `finder/schema.ts:172-180`).
- `clarifyingQuestion?: z.string().min(1)` — copy verbatim.
- Same XOR enforced at app level in `reply/index.ts`.

---

### `src/agents/reply/tools.ts` (agent tools, request-response)

**Analog (primary):** `src/agents/coach/tools.ts` — `makeRetrieveKnowledgeTool` is the closest analog for `retrieveReplySop` (rag-facade-wrapping, returns `{found, citations, context}` or a miss).
**Analog (read-only contract):** `src/agents/finder/tools.ts:4-13` — the "no Firestore writes in execute()" header.

**retrieveKnowledge → retrieveReplySop** (`src/agents/coach/tools.ts:89-127`):
```typescript
export function makeRetrieveKnowledgeTool(userLang: 'en' | 'ms' | 'zh') {
  return tool({
    description:
      'Search the D2 knowledge base ... Call this BEFORE answering any question ... ' +
      'Returns chunk IDs that you MUST cite in your answer.',
    inputSchema: z.object({ query: z.string().min(1).describe('...') }),
    execute: async ({ query }): Promise<RetrieveResult> => {
      const results: RetrievalResult[] = await retrieve(query, userLang)
      if (isRetrievalMiss(results)) {
        return { found: false, reason: 'kb_miss' }
      }
      const { citations } = buildCitations(results)
      const context = results.slice(0, 5)
        .map((r) => `[KB:${r.chunkId}]\n${r.text}`)
        .join('\n\n---\n\n')
      return { found: true, citations, context }
    },
  })
}
```

**Reply adaptation:**
- `retrieveReplySop({ query, category? })`: call the **parameterized** rag facade `retrieve(query, userLang, { pillar: 'reply' })` (see `src/rag/index.ts` grow below); filter `category` in memory; `[KB:...]`→`[SOP:...]`; miss returns `{ found: false, reason: 'no_sop_match' }` (RESEARCH Code Example).
- `fetchVoiceSamples()`: a `kbDocs` whole-doc read (`pillar:'reply', category:'voice', status:'published'`, `limit(1)`) — NOT a vector search; reads chunk text via `kbChunksRef().where('docId','==',voiceDocId)` (RESEARCH Q6). Read-only.
- `fetchLeadContext(leadId)`: wraps the new `readReplySlot(leadId)` (mirror `coach/tools.ts:141-165` getCurrentCheckpoint which wraps `getAgentProfile`). Read-only.
- ⚠️ **No `.set()/.add()/.update()` in any `execute()`** — verify against `finder/tools.ts:4-13`. `replySlot` + `replyEdits` write OUTSIDE tools (Pitfall 23/36).

---

### `src/agents/reply/reply.test.ts` (test)

**Analog:** `src/agents/finder/finder.test.ts` (21 KB). Mirror its structure: `run()` with injected SOP result exercising hit / `no_sop_match` / clarifying paths; schema validation; the no-Firestore-write assertion. Add a **parallel-lead isolation** case (RESEARCH Q4 / SC2) and per-classification cases (cold-prospect / objection / financing).

---

### `src/memory/leadContext.ts` (GROW — model/memory, CRUD)

**Analog (in-file):** `FinderSlot` + `readFinderSlot` already in this file.

**FinderSlot type** (`src/memory/leadContext.ts:49-60`):
```typescript
export interface FinderSlot {
  criteria: ParsedCriteria
  discussedProjectIds: string[]
  lastRankedAt: number   // Date.now() epoch ms — framework-free for tests
}
```

**readFinderSlot — empty-object-is-null semantics** (`src/memory/leadContext.ts:109-122`):
```typescript
export async function readFinderSlot(leadId: string): Promise<FinderSlot | null> {
  const snap = await leadContextRef().doc(leadId).get()
  if (!snap.exists) return null
  const data = snap.data()
  if (!data) return null
  const slot = data.finderSlot as Record<string, unknown>
  if (!slot || Object.keys(slot).length === 0) return null   // first-touch
  return slot as unknown as FinderSlot
}
```

**The slot writer is already pillar-generic** — no change needed (`leadContext.ts:31` `LeadSlot = 'coachSlot' | 'finderSlot' | 'replySlot'`; `:73-92` `writeLeadSlot` writes only the named slot). The `replySlot` field is already declared on `LeadContextDoc` (`collections.ts:126`, typed `Record<string, unknown>`).

**Reply adaptation (RESEARCH Q4):**
```typescript
export interface ReplySlot {
  classification: 'cold-prospect' | 'objection' | 'financing' | 'other'
  latestDraft: string          // last model draft (already PDPA-redacted)
  sopDocIds: string[]          // SOPs cited (grounding trail)
  lastDraftedAt: number        // Date.now() epoch ms (mirror lastRankedAt)
}
export async function readReplySlot(leadId: string): Promise<ReplySlot | null> {
  // copy readFinderSlot exactly, reading data.replySlot
}
```

---

### `app/api/chat/route.ts` (GROW — route handler, streaming)

**Analog (in-file):** the existing Finder dispatch branch. The GATE ordering (`route.ts:8-17`) is unchanged; Reply plugs in as a third branch.

**Override-enum widening — preserve the allow-list security control** (`app/api/chat/route.ts:206-210`):
```typescript
// CURRENT — invalid values become undefined (T-03-28)
override = (['coach', 'finder'] as const).includes(body.override as 'coach' | 'finder')
  ? (body.override as 'coach' | 'finder')
  : undefined
// REPLY: widen the tuple to ['coach','finder','reply'] AND the local type
// (route.ts:190) + the body type (route.ts:197). Keep the invalid→undefined pattern.
```

**Dispatch branch to mirror** (`app/api/chat/route.ts:289-314`):
```typescript
if (pillar === 'finder') {
  if (leadId) {
    storedFinderSlot = await readFinderSlot(leadId)
    if (storedFinderSlot) { mergedCriteria = mergeFinderCriteria(storedFinderSlot.criteria, {}) }
  }
  agentSystemPrompt = finderAgent.buildSystemPrompt({
    leadContext: storedFinderSlot ? (storedFinderSlot as unknown as Record<string, unknown>) : undefined,
  })
  agentTools = finderAgent.makeTools(userLang, uid, leadId)
} else {
  agentSystemPrompt = coachAgent.buildSystemPrompt()
  agentTools = coachAgent.makeTools(userLang)
}
```
Reply: add `else if (pillar === 'reply')` reading `storedReplySlot = await readReplySlot(leadId)` and building reply prompt + tools. Widen `agentTools` union type (`route.ts:283`) to include `ReturnType<typeof replyAgent.makeTools>`.

**stopWhen** (`route.ts:337`): `stopWhen: pillar === 'finder' ? stepCountIs(5) : stepCountIs(1)` → Reply uses a tool loop (retrieve SOP → maybe voice → draft), so include `'reply'` in the `stepCountIs(5)` arm.

**onFinish slot write to mirror** (`app/api/chat/route.ts:374-399`):
```typescript
if (pillar === 'finder' && leadId) {
  const newProjectIds = extractFinderProjectIds(final)
  const prevDiscussed = storedFinderSlot?.discussedProjectIds ?? []
  const discussedProjectIds = mergeDiscussed(prevDiscussed, newProjectIds)
  const criteriaToWrite: ParsedCriteria = mergedCriteria ?? (storedFinderSlot?.criteria ?? {...})
  await writeLeadSlot(leadId, 'finderSlot', { criteria: criteriaToWrite, discussedProjectIds, lastRankedAt: Date.now() })
}
```
Reply: add a `pillar === 'reply' && leadId` block. Add an `extractReplySopIds(final)` helper mirroring `extractFinderProjectIds` (`route.ts:121-143`) to pull cited SOP doc IDs from `retrieveReplySop` tool results; then `writeLeadSlot(leadId, 'replySlot', { classification, latestDraft, sopDocIds, lastDraftedAt: Date.now() })`.

⚠️ **Required-leadId fail-closed (Pitfall 5 / RESEARCH Q2 step 5):** `leadId` is optional in the body today (`route.ts:213-215`). For `pillar === 'reply'` with no `leadId`, return a 400 before streaming — the server must fail closed even though the UI prevents it (D-07).

⚠️ **GATE 3 PDPA — inject lead names (HIGHEST RISK / RESEARCH Q3):** today the route calls `pseudonymize({messages}, [])` with an **empty `names[]`** (`route.ts:248-253`); the comment at `:252` already flags the unfinished hook ("knownNames — will inject lead names from leadContext when available"). For Reply, read `leads/{leadId}.name` (+ downline lead names) and pass them as `names`. See the `pdpa.ts` grow below — this is a Wave-0 blocker.

---

### `src/router/heuristic.ts` (GROW — router, transform)

**Analog (in-file):** `FINDER_PATTERNS` (`heuristic.ts:58-77`) + the check loop in `heuristicPillar` (`:107-132`).

**Pattern-array + ordered check** (`src/router/heuristic.ts:107-132`):
```typescript
export function heuristicPillar(messages: MessageTurn[]): { pillar: 'coach' | 'finder'; reason: string } | null {
  const recentText = messages.slice(-4).map((m) => m.content).join(' ')
  for (const pattern of FINDER_PATTERNS) {   // ⚠️ finder checked FIRST today
    if (pattern.test(recentText)) return { pillar: 'finder', reason: `heuristic-finder:${pattern.source}` }
  }
  for (const pattern of COACH_PATTERNS) {
    if (pattern.test(recentText)) return { pillar: 'coach', reason: `heuristic-coach:${pattern.source}` }
  }
  return null
}
```

**Reply adaptation (RESEARCH Q8 / Pitfall C):**
- Add `REPLY_PATTERNS: RegExp[]` (e.g. `/\bdraft (a )?repl/i`, `/\breply to (this|him|her|them)\b/i`, `/\bwhat (should|do) i (say|reply)\b/i`, `/\b(lead|client) (said|wrote|sent|asked)\b/i`, a multi-line quoted-block heuristic).
- ⚠️ **Ordering matters:** `FINDER_PATTERNS` contains `/\bRM\b/` (`:59`) and `/\bfinancing\b/i` (`:73`) — a pasted inbound mentioning RM/financing would mis-route to Finder. Check Reply **structural** signals (inbound block / "reply to this") **before** the generic Finder keyword scan.
- Widen the `heuristicPillar` return type from `'coach' | 'finder'` to `'coach' | 'finder' | 'reply'` (`:109`). The `Pillar` type already includes `'reply'` (`:26`).

---

### `src/router/classifier.ts` (GROW — router, request-response)

**Analog (in-file):** `RouteSchema` + `classifyIntent` + `ROUTER_SYSTEM_PROMPT`.

**Binary schema to widen** (`src/router/classifier.ts:28-32`):
```typescript
const RouteSchema = z.object({
  pillar: z.enum(['coach', 'finder']),   // 'reply' added Phase 4 (A7)  ← widen to 3
  confidence: z.number().min(0).max(1),
  reason: z.string(),
})
```

**Reply adaptation (RESEARCH Q8):**
- Widen the enum to `['coach','finder','reply']` (`:29`) and `classifyIntent`'s return type (`:82-84`).
- Add a Reply paragraph to `ROUTER_SYSTEM_PROMPT` (`:42-54`) mirroring the coach/finder paragraph style.
- Model stays `modelFor('router')` (`:85`) — Remote Config, `claude-haiku-4-5`, never hard-coded.
- ⚠️ The classifier test asserts the schema **rejects** `'reply'` today (`classifier.test.ts:95`) — that assertion must be updated.

---

### `src/rag/search.ts` + `src/rag/index.ts` (GROW — service, request-response)

**Analog (in-file):** `firestoreRetrieve` (`search.ts:80-126`) + the `retrieve` facade (`index.ts:62-74`).

**Current findNearest query — hard-coded Coach contract (no pillar filter)** (`src/rag/search.ts:97-107`):
```typescript
const snap = await adminDb
  .collection('kbChunks')
  .where('lang', 'in', langFilter)
  .where('status', '==', 'published')
  .findNearest({
    vectorField: 'embedding',
    queryVector: FieldValue.vector(q),
    limit: FIND_NEAREST_LIMIT,
    distanceMeasure: 'DOT_PRODUCT',
  })
  .get()
```

**Facade signature to parameterize** (`src/rag/index.ts:62-74`):
```typescript
export async function retrieve(query: string, userLang: 'en' | 'ms' | 'zh'): Promise<RetrievalResult[]> {
  const adapter = activeAdapter()
  if (adapter === 'pinecone') return pineconeRetrieve(query, userLang)
  return firestoreRetrieve(query, userLang)
}
```

**Reply adaptation (RESEARCH Q7 — recommendation (a): parameterize, keep one path):**
- Add optional `opts?: { pillar?: 'coach'|'finder'|'reply'; category?: string }` to `firestoreRetrieve` and thread through `retrieve`.
- When `opts.pillar` is set, add `.where('pillar','==',opts.pillar)` to the `findNearest` pre-filter (equality-only — Pitfall 6). Map `pillar` from `data.pillar` in the result mapping (`search.ts:114-125`).
- ⚠️ Filter `category` **in memory** after retrieval (categories are few; top-8 is small) to avoid a second composite index — mirrors the Finder "equality pre-filter + in-memory affordability" pattern noted at `collections.ts:185-192`.
- ⚠️ This needs a new composite vector index `(pillar, lang, status, embedding 1024-d flat)` — the existing `(lang,status,embedding)` index won't cover the added `pillar` equality.

---

### `src/firebase/collections.ts` (GROW — model/config, CRUD)

**Analog (in-file):** `KnowledgeGapDoc` + `knowledgeGapsRef` (the server-only, downline-scoped collection template) + the `makeConverter` factory + `KbChunkDoc`.

**Converter factory (stamps tenantId)** (`src/firebase/collections.ts:423-435`):
```typescript
function makeConverter<T extends { tenantId: TenantId }>(): FirestoreDataConverter<T> {
  return {
    toFirestore(data: WithFieldValue<T>): WithFieldValue<DocumentData> {
      return { ...(data as DocumentData), tenantId: TENANT_ID } // stamp — no caller can omit
    },
    fromFirestore(snapshot: QueryDocumentSnapshot): T { return snapshot.data() as T },
  }
}
```

**Ref factory + server-only doc-comment to copy** (`src/firebase/collections.ts:562-576`):
```typescript
/**
 * Collection 16: knowledgeGaps/{gapId}
 * Server / Admin-SDK writes ONLY ... Read is scoped to the owning seniorCoachId + admin.
 */
export function knowledgeGapsRef(): CollectionReference<KnowledgeGapDoc> {
  return adminDb.collection('knowledgeGaps').withConverter(knowledgeGapConverter)
}
```

**Reply adaptations:**
1. **`replyEdits` (new collection 17)** — `ReplyEditDoc` + `replyEditConverter` + `replyEditsRef()` mirroring `KnowledgeGapDoc`/`knowledgeGapsRef` (RESEARCH Q5):
   ```typescript
   export interface ReplyEditDoc {
     tenantId: TenantId
     leadId: string
     draftId: string
     sopDocIds: string[]
     originalDraft: string
     editedFinal: string
     editRatio: number
     agentUid: string
     seniorCoachId: string   // ⚠️ denormalized at write so the coach read-rule can match (Pitfall D)
     lang: 'en' | 'ms' | 'zh'
     thumbsDown?: boolean
     timestamp: Date | FieldValue
   }
   ```
2. ⚠️ **Add `pillar` to `KbChunkDoc`** (`collections.ts:282-302` currently has NO pillar field) — denormalized from the parent `kbDoc`, same way `status` already is (`:289-296`). Without it the `retrieveReplySop` pillar filter cannot work (RESEARCH Q7 / Pitfall B).
3. **Add `category?: string` to `KbDocDoc`** (`KbDocDoc.pillar` is already typed `'coach'|'finder'|'reply'` at `:278`). `category` is net-new and optional (D-09).
4. ⚠️ **`knowledgeGaps` for Reply kb-miss (A3):** `KnowledgeGapDoc` has no pillar discriminator (`:369-391`). Add a `pillar`/`source` field, or write Reply misses with a `topicLabel` prefix, to keep them on the existing feed (D-11).

---

### `src/kb/ingest/pipeline.ts` (GROW — service, batch/file-I/O)

**Analog (in-file):** the `processBatch` chunk write.

⚠️ **The pillar gap is here** — `processBatch` destructures `lang` but NOT `pillar`, and `chunksRef.add(...)` omits `pillar`** (`src/kb/ingest/pipeline.ts:174-220`):
```typescript
const { chunkTexts, remaining, total, docId, lang, supersedesId } = jobData   // ⚠️ pillar not destructured
// ...
await chunksRef.add({
  docId, text, lang,
  ownerCollection: 'kbDocs',
  embedding, tokens,
  tenantId: TENANT_ID,
  chunkIndex,
  status: 'published' as const,
  // ⚠️ no `pillar` written — must add `pillar` here
})
```
The job doc already carries `pillar` (`KbIngestionJobDoc.pillar` at `collections.ts:317`; written in `shardJob` at `pipeline.ts:129`). **Fix:** destructure `pillar` from `jobData` (`:174-181`) and add `pillar` to the `chunksRef.add({...})` (RESEARCH Q7).

**Backfill (new, one-time):** mirror `scripts/backfill-kb-status.ts` (verified to exist) — `scripts/backfill-kb-chunks-pillar.ts` stamps `pillar:'coach'` on all existing chunks with no `pillar`. The status-backfill is idempotent (`status === undefined` filter); copy that shape for `pillar`.

---

### `src/kb/crud.ts` (GROW — service, CRUD)

**Analog (in-file):** `CreateDocInput`/`UpdateDocInput` + `createDoc`.

**Input type + doc-data write** (`src/kb/crud.ts:59-65`, `:114-140`):
```typescript
export interface CreateDocInput {
  title: string
  content: string
  lang: 'en' | 'ms' | 'zh'
  pillar: 'coach' | 'finder' | 'reply'   // ← already pillar-aware
}
// createDoc:
const docData: Omit<KbDocDoc, 'tenantId'> = {
  title: input.title, sourcePath: `kb/${docId}`, version: 1,
  lang: input.lang, pillar: input.pillar, status: 'published',
  publishedAt: FieldValue.serverTimestamp(),
}
```

**Reply adaptation:** add `category?: string` to `CreateDocInput`/`UpdateDocInput` (`:59-86`) and persist it in `docData` (D-09). `assertAdmin` gate is unchanged.

---

### `src/audit/pdpa.ts` (GROW — service/security, transform) ⚠️ HIGHEST RISK

**Analog (in-file):** `replacePhones` / `replaceNames` / `redactText` + the `pseudonymize`/`assertRedacted` contract.

**Phone regex + replacement pattern to mirror** (`src/audit/pdpa.ts:70-104`):
```typescript
const MY_PHONE_REGEX = /(\+?60\d{8,10})/g
const INTL_PHONE_REGEX = /(\+[1-9]\d{6,14})/g
function replacePhones(text: string, mapping: Map<string, string>): string {
  let result = text.replace(MY_PHONE_REGEX, (match) => {
    const token = `<PHONE_HASH:${hashPhone(match)}>`
    mapping.set(token, match)
    return token
  })
  // ...INTL_PHONE_REGEX similarly
  return result
}
```

⚠️ **The gap (verified, RESEARCH Q3 / Pitfall A):** `pseudonymize(input, names)` (`pdpa.ts:162-190`) only redacts (a) names explicitly passed in `names[]` via `replaceNames` (`:110-130`) and (b) phones. It does NOT catch free-text names, IC numbers, emails, addresses, or financials. `pdpa_redacted` is hard-coded `true` (`:187`), so `assertRedacted` (`:205-209`) is a **presence** gate, not a **coverage** gate.

**Reply adaptation (extend, do NOT rewrite — preserve the throw-don't-warn contract at `:205-209`):**
- Add free-text PII regexes alongside the phone regexes (`:70-73`): Malaysian IC `\d{6}-\d{2}-\d{4}`, email, RM-amount financials. Add corresponding `replaceIC`/`replaceEmail`/`replaceFinancial` helpers mirroring `replacePhones` and call them inside `redactText` (`:135-144`).
- Inject known lead names at the route (see route.ts grow) so `replaceNames` actually fires.
- **Security-critical tests (extend `src/audit/pdpa.test.ts`):** for each PII class (name, MY phone, intl phone, IC, email, RM-financial), assert the redacted payload contains a token, not the raw value.

---

### `src/eval/judge.ts` (GROW — config/eval, transform)

**Analog (in-file):** the `judgeRubric` 6-domain object + `combinedJudgeRubric`.

**Rubric domain + combined-string shape** (`src/eval/judge.ts:102-107`, `:151-176`):
```typescript
voice: `\
VOICE CHECK: Does the response sound like a knowledgeable D2 senior agent ...
A response that uses generic AI filler phrases ("Certainly!", "Great question!" ...) ...
FAILS this check. Respond with PASS or FAIL and a one-sentence rationale.`,
// combinedJudgeRubric concatenates all six domain strings + a fixed output format.
```

**Reply adaptation (D-13, RESEARCH Q6):**
- Reuse `voice` (`:102`), `toneDrift` (`:135`), `languageMatch` (`:91`) verbatim.
- Add Reply-specific rubric strings: `voiceMatch` (vs the curated voice doc), `qualifyingQuestions` (cold-prospect uses questions, not a pitch — REPLY-05), `noAutoPitch`.
- Map the `grounded` domain's `[KB:chunk-id]` check (`:68-72`) to Reply's `[SOP:doc-id]` citation.
- Add a `combinedReplyJudgeRubric` mirroring `combinedJudgeRubric` (`:151-176`). Judge model stays `JUDGE_MODEL` from Remote Config (`:37`).

---

### `src/reply/diff.ts` (NEW — utility, transform) — NO ANALOG

No diff library installed (RESEARCH Standard Stack). Net-new ~15-line core util computing `editRatio` (normalized char-level edit distance) — keep both raw strings; the dashboard needs a numeric rate, not a visual diff (D-18/D-20). Core/shell rule applies (no app/ import). Add `src/reply/diff.test.ts`.

---

### `firestore.rules` (GROW — config/security)

**Analog (in-file):** the `escalations` and `knowledgeGaps` match blocks — the exact downline-scoped, server-write-only template.

**Downline-scoped read + deny client writes** (`firestore.rules:231-241`):
```
match /knowledgeGaps/{gapId} {
  allow read:
    if (hasRole('senior-coach') && resource.data.seniorCoachId == request.auth.uid && sameTenant())
    || (hasRole('admin') && sameTenant());
  allow create, update, delete: if false;   // server-side Admin SDK only
}
```

**Reply adaptation — `replyEdits` (RESEARCH Q5, D-19):**
```
match /replyEdits/{eventId} {
  allow read:
    if (resource.data.agentUid == request.auth.uid && sameTenant())                              // agent reads own
    || (hasRole('senior-coach') && resource.data.seniorCoachId == request.auth.uid && sameTenant()) // coach reads downline
    || (hasRole('admin') && sameTenant());                                                        // admin reads all
  allow create, update, delete: if false;   // server-side Admin SDK only (append-only)
}
```
⚠️ The coach read requires `resource.data.seniorCoachId` — denormalize it on write (Pitfall D). Add `replyEdits` cases to `src/firebase/__tests__/rules/rules.test.ts` (mirror the existing escalations/knowledgeGaps rule tests).

---

### `firestore.indexes.json` (GROW — config)

**Analog (in-file):** the `kbChunks (lang,status,embedding)` vector index (`firestore.indexes.json:93-107`) and the `knowledgeGaps (seniorCoachId,lastSeenAt DESC)` composite (`:108-115`).

**Vector index shape to mirror** (`firestore.indexes.json:93-107`):
```json
{
  "collectionGroup": "kbChunks",
  "queryScope": "COLLECTION",
  "fields": [
    { "fieldPath": "lang", "order": "ASCENDING" },
    { "fieldPath": "status", "order": "ASCENDING" },
    { "fieldPath": "embedding", "vectorConfig": { "dimension": "1024", "flat": {} } }
  ]
}
```

**Reply adaptations (RESEARCH Q7, Q5; Pitfall F):**
- New vector index `kbChunks (pillar, lang, status, embedding 1024-d flat)` — back the pillar-filtered `findNearest`.
- `replyEdits (seniorCoachId, timestamp DESC)` — the coach feed (model on the `knowledgeGaps` composite at `:108-115`).
- `replyEdits (agentUid, timestamp DESC)` — agent self-view.
- `replyEdits (sopDocIds ARRAY_CONTAINS, timestamp)` — per-SOP edit aggregation.
- `kbDocs (pillar, category, status)` — the `fetchVoiceSamples` whole-doc lookup.
- ⚠️ Must be deployed (`firebase deploy --only firestore:indexes`) before the queries ship.

---

### `app/[lang]/chat/reply-draft-card.tsx` (NEW — component, event-driven)

**Analog:** `app/[lang]/chat/match-list.tsx` — the visually-distinct, state-branching card renderer.

**Three-state branch + vendored Card composition** (`app/[lang]/chat/match-list.tsx:23-117`):
```typescript
import { Card, CardContent, CardFooter, CardHeader } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import type { FinderOutput, FinderMatch } from '@/src/agents/finder/schema'

export function MatchList({ output, className }: MatchListProps) {
  const { matches, refusal, clarifyingQuestion } = output
  if (clarifyingQuestion) { /* State 3: plain message */ }
  if (refusal) { /* State 2: grounded refusal Card with reason header */ }
  if (matches.length > 0) { /* State 1: ranked cards */ }
  /* fallback */
}
```

**Reply adaptation (D-15/16/18):**
- Three states keyed on `ReplyOutput`: `draft` → the draft card; `noSopMatch` → grounded-refusal card (copy the `refusal` branch at `:65-87`); `clarifyingQuestion` → plain message (copy `:50-62`).
- ⚠️ The draft card needs a **client island** (`match-list.tsx` is RSC render-only at `:6-7`) because it has a controlled `<textarea>` + clipboard + a Server Action call. Default to a shadcn `Textarea` (`components/ui/textarea.tsx`, already used in `chat-input.tsx:30`).
- Quoted incoming block + editable `<textarea>` seeded with `originalDraft` + **single** `Copy draft` button (D-16: no share/send/post). On copy: read textarea → clipboard → compute `editRatio` (src/reply/diff.ts) → call a `captureReplyEdit` Server Action → collapse to "Copied — go send it from WhatsApp." Toast via `sonner` (already imported in `chat-input.tsx:27`).
- The `captureReplyEdit` Server Action mirrors the `getSessionUser()` → `requireUser` pattern in `(admin)/kb/actions.ts:34-48` and `(coach)/dashboard/actions.ts:39-52`; it does the Admin-SDK `replyEditsRef().add(...)` write (clients can't write — rules deny).

---

### `app/[lang]/chat/{chat-input,chat-header,message-list}.tsx` (GROW — component)

**Analog (in-file):** the `pillarOverride`/`leadId` wiring already in `chat-input.tsx`.

**Override + leadId threaded into the POST body** (`app/[lang]/chat/chat-input.tsx:55-60`, `:159-177`):
```typescript
pillarOverride?: 'coach' | 'finder'   // ← widen to add 'reply' (3 places: :55, :163, the union at :106)
leadId?: string                        // ← already threaded for Finder
// ...
if (pillarOverride) { requestBody.override = pillarOverride }
if (leadId) { requestBody.leadId = leadId }
```

**Reply adaptation:**
- Widen `pillarOverride` to `'coach' | 'finder' | 'reply'` (`:55`, `:163`) and the `requestBody.override` type (`:163`).
- Add the **lead-selector flow (D-07):** if `pillar`-intent is reply and no `leadId`, show a downline-scoped "Which lead?" picker before dispatch; default to the most-recent touched lead only if <24h old.
- `chat-header.tsx`: widen the pillar chip ToggleGroup to add a "Reply" option.
- `message-list.tsx`: render the `reply-draft-card` variant (mirror however `match-list` is currently invoked there).

---

### `app/[lang]/(admin)/kb/*` (GROW — admin route group, CRUD)

**Analog (in-file):** the Server-Action mutation pattern in `(admin)/kb/actions.ts`.

**Server Action session + role gate** (`app/[lang]/(admin)/kb/actions.ts:34-48`, `:63-78`):
```typescript
async function getSessionUser() {
  const cookieStore = await cookies()
  const sessionCookie = cookieStore.get('__session')
  if (!sessionCookie?.value) throw new Error('Not authenticated')
  const syntheticReq = new Request('https://d2.app/admin/kb', {
    headers: { Authorization: `Bearer ${sessionCookie.value}` },
  })
  return requireUser(syntheticReq)
}
export async function createKbDocAction(input: CreateDocInput): Promise<ActionResult> {
  try {
    const user = await getSessionUser()
    const result = await createDoc(user, input)
    return { ok: true, docId: result.docId, ... }
  } catch (err) { return { ok: false, error: ... } }
}
```

**Reply adaptation (D-10, ADMIN-05):** add a pillar filter/tab to `kb-doc-list.tsx`/`page.tsx`; add `category` (and confirm `pillar:'reply'`) to `kb-doc-form.tsx`; thread `category` through `createKbDocAction`/`updateKbDocAction` (the actions just forward `CreateDocInput`/`UpdateDocInput` — adding `category` to those types is the only `actions.ts` change). No new route group.

---

### `app/[lang]/(coach)/_components/reply-quality-panel.tsx` + `(coach)/dashboard/{page,actions}.ts` (GROW — component + Server Action)

**Analog (component):** `app/[lang]/(coach)/_components/metrics-panel.tsx` — the recharts client island.
**Analog (downline-scoped read):** `getAgentChatHistory` in `(coach)/dashboard/actions.ts`.

**recharts client island** (`app/[lang]/(coach)/_components/metrics-panel.tsx:1-2`, `:28-54`):
```typescript
'use client'   // ← recharts is browser-only; MUST be a client component (Pitfall 7)
import { useTranslations } from 'next-intl'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, LineChart, Line, CartesianGrid, Legend } from 'recharts'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
export function MetricsPanel({ funnel, agentRows }: MetricsPanelProps) {
  const t = useTranslations('dashboard')
  // ...map data → <ResponsiveContainer><BarChart>...</BarChart></ResponsiveContainer>
}
```

**Downline-scope double-gate (role-from-token + seniorCoachId match)** (`app/[lang]/(coach)/dashboard/actions.ts:237-256`):
```typescript
if (user.role !== 'senior-coach' && user.role !== 'admin') {
  return { ok: false, error: 'Forbidden: senior-coach or admin role required' }
}
// AUTH-06: a non-admin coach may only read their own downline.
if (user.role !== 'admin') {
  const profileSnap = await agentProfilesRef().doc(agentUid).get()
  const profile = profileSnap.data()
  if (!profile || profile.seniorCoachId !== user.uid) {
    return { ok: false, error: 'Forbidden: agent is not in your downline' }
  }
}
```

**Reply adaptation (D-21/D-22, ADMIN-06):**
- `reply-quality-panel.tsx` (`'use client'`, recharts): edit-rate per SOP, thumbs-down rate, top-edited SOP, escalation rate, drafts-per-agent.
- A new dashboard query (in `(coach)/dashboard/actions.ts` or a server read) computes the metrics with **Firestore aggregation (`count()`)** over `replyEdits` (Pitfall 9 / Don't-Hand-Roll), scoped by `seniorCoachId == user.uid` for coaches and unfiltered for admin (D-22: one component, role-conditional query). Copy the role + downline gate above verbatim.
- ⚠️ Edit-rate denominator (Pitfall E / A2): write a `replyEdits` row on **every** Copy (even unchanged, `editRatio:0`) so the denominator = total copies citing a SOP.

---

## Shared Patterns

### Authentication / authorization (apply to every server entry point)
**Source:** `src/firebase/auth.ts` `requireUser` (GATE 1 at `app/api/chat/route.ts:148-166`); Server-Action variant `getSessionUser()` (`(admin)/kb/actions.ts:34-48`, `(coach)/dashboard/actions.ts:39-52`).
**Apply to:** the reply dispatch in `route.ts`, `captureReplyEdit` action, all dashboard/admin reads.
**Rule:** uid + role come from the **verified token**, never from request args (T-02-31).

### Read-only tools, side-effects in onFinish (Pitfall 23/36)
**Source:** `src/agents/finder/tools.ts:4-13` (header) + the `onFinish` slot write at `route.ts:374-399`.
**Apply to:** all three Reply tools + the `replySlot` write + `replyEdits` write. Never `.set()/.add()/.update()` inside a tool `execute()`.

### Grounding mandate (no invention; cite source IDs)
**Source:** `src/agents/coach/tools.ts:107-109` (kb_miss return) + Finder grounded-refusal (`finder/index.ts:211-248`) + prompt block (`finder/prompt.ts:62-67`).
**Apply to:** `retrieveReplySop` (`no_sop_match`), the reply prompt, the `ReplyOutputSchema` XOR, the judge `grounded` assertion. `[SOP:doc-id]` citations are mandatory.

### Model resolution from Remote Config (never hard-code)
**Source:** `modelFor(pillar)` (`route.ts:318`); `modelFor('router')` (`classifier.ts:85`); `JUDGE_MODEL` (`judge.ts:37`). The `reply` key is already in the provider fallback map (RESEARCH Standard Stack, `provider.ts:42`).
**Apply to:** reply dispatch (`modelFor('reply')`), classifier (unchanged), eval judge. QUAL-01 model-swap test must still pass.

### PII pseudonymization at the boundary (load-bearing for Reply)
**Source:** `pseudonymize` + `assertRedacted` (`src/audit/pdpa.ts:162-209`), called at GATE 3 (`route.ts:243-265`).
**Apply to:** every Reply turn — inject lead names + add IC/email/financial regexes (extend, don't replace). This is the #1 watch-item; coverage tests are mandatory before any Reply turn ships.

### tenantId on every doc (single-tenant, don't paint into a corner)
**Source:** `makeConverter` stamp (`collections.ts:423-435`); `sameTenant()` rule (`firestore.rules:34-37`).
**Apply to:** `replyEdits` converter + every new doc write + the `replyEdits` rule.

### Server-only, append-only collection (downline-scoped read)
**Source:** `escalations` (`firestore.rules:196-206`) + `knowledgeGaps` (`:231-241`) + `knowledgeGapsRef` doc-comment (`collections.ts:562-576`).
**Apply to:** `replyEdits` — deny client writes; denormalize `seniorCoachId`; CI rules test.

---

## No Analog Found

| File | Role | Data Flow | Reason / Substitute |
|------|------|-----------|---------------------|
| `src/reply/diff.ts` | utility | transform | No diff library installed; net-new ~15-line `editRatio` util (RESEARCH Standard Stack / Don't-Hand-Roll). No code analog — follow core/shell conventions only. |
| `.planning/phases/04-reply-assistant/WABA-GATE.md` | doc | — | Documented gate, zero code (D-23). No code analog. Propose thresholds (RESEARCH Q9); Derek finalizes. |

> The two "net-new collection" items (`replyEdits`, `evals/gold/reply-*.yaml`) and the one-time `scripts/backfill-kb-chunks-pillar.ts` DO have structural analogs (`escalations`/`knowledgeGaps`, existing Coach gold sets, `scripts/backfill-kb-status.ts`) — see Pattern Assignments — so they are not listed here.

---

## Metadata

**Analog search scope:** `src/agents/{finder,coach}`, `src/router`, `src/memory`, `src/rag`, `src/kb`, `src/audit`, `src/eval`, `src/firebase`, `src/jobs`, `app/api/chat`, `app/[lang]/chat`, `app/[lang]/(admin)/kb`, `app/[lang]/(coach)`, `firestore.rules`, `firestore.indexes.json`, `scripts/`.
**Files scanned (read in full or targeted):** 19 source/config files + directory listings.
**Project skills loaded:** none (no `.claude/skills/` or `.agents/skills/` directory present).
**Pattern extraction date:** 2026-06-05
**Highest-risk patterns flagged ⚠️:** PDPA free-text coverage gap (`pdpa.ts`/`route.ts:248-253`), `kbChunks.pillar` migration (`pipeline.ts:210-220`), required-leadId fail-closed (`route.ts:213-215`), `seniorCoachId` denormalization for coach reads (`firestore.rules`), heuristic ordering (`heuristic.ts:117`), new composite indexes (`firestore.indexes.json`).
