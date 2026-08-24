# RESEARCH — Admin Leads management (quick-kayinleong-046)

**Bug report:** "I am trying out Reply function in chat page, but I dont seems to able to set any Lead in admin page"

**Verdict:** the report is accurate and the root cause is a **missing create path**, not a broken one. The `leads` / `leadContext` collections, their typed refs, converters, Firestore rules, PDPA-erasure manifest, the chat lead-selector UI, and the Reply-requires-leadId server gate are all built. **Nothing in the product ever creates a `leads/{leadId}` document.** The only code in the repo that writes one is a throwaway PDPA drill script. Reply is therefore 100% unreachable for any real user.

---

## Current state

### What exists

| Concern | Where | Status |
|---|---|---|
| `LeadDoc` type | `src/firebase/collections.ts:148-157` | ✅ |
| `LeadContextDoc` type | `src/firebase/collections.ts:159-170` | ✅ |
| `leadsRef()` factory | `src/firebase/collections.ts:851-853` | ✅ |
| `leadContextRef()` factory | `src/firebase/collections.ts:856-858` | ✅ |
| `leadConverter` / `leadContextConverter` (stamp `tenantId`) | `src/firebase/collections.ts:792-793`, `makeConverter` at `:772-784` | ✅ |
| Slot writer + readers | `src/memory/leadContext.ts:103-187` (`writeLeadSlot`, `readFinderSlot`, `readReplySlot`) | ✅ |
| Firestore rules for both collections | `firestore.rules:146-177` | ✅ (see delta below) |
| Rules unit tests | `src/firebase/__tests__/rules.test.ts:369-430` | ✅ |
| PDPA erasure coverage | `src/pdpa/erasure.ts:68-72`, `src/pdpa/coverage.ts:202-207` | ✅ |
| Chat lead-selector UI (cmdk in a bottom Sheet) | `app/[lang]/chat/lead-selector.tsx` | ✅ |
| Lead-list Server Action for the selector | `app/[lang]/chat/lead-actions.ts:62-97` | ✅ |
| Reply-requires-leadId server gate | `app/api/chat/route.ts:402-407` (HTTP 400) | ✅ |
| i18n `chat.leadSelector.*` in EN/BM/ZH | `src/i18n/messages/{en,ms,zh}.json` | ✅ |
| E2E coverage of the selector gate | `e2e/reply-draft.spec.ts:144-153` | ✅ |

### What is missing

1. **No create/update/delete path for `leads` anywhere in `app/` or `src/`.** Exhaustive grep of `leadsRef` usages:
   - `app/api/chat/route.ts:357` — `.get()` (read lead name for PDPA `knownNames`)
   - `app/[lang]/chat/lead-actions.ts:71` — `.where('ownerUid','==',uid).get()` (read)
   - `src/pdpa/erasure.ts:69` — delete (erasure only)
   - `src/firebase/collections.ts:851` — the factory itself
   - tests / coverage docs

   The **only** writer of a `leads` doc in the whole repo is a synthetic drill:
   ```ts
   // scripts/pdpa-erasure-drill.ts:41-42
   await adminDb.collection('leads').doc(DRILL_LEAD).set({ ownerUid: DRILL_ID, tenantId: TENANT, _drill: true })
   await adminDb.collection('leadContext').doc(DRILL_LEAD).set({ tenantId: TENANT, _drill: true })
   ```

2. **No create path for `leadContext` either.** All `leadContextRef()` usages are `.get()` or `.update()`; there is no `.set()`/`.add()` outside the drill script. See "Latent NOT_FOUND bug" below — this makes the leadContext doc a **required** part of any lead-create action.

3. **No admin Leads page.** Full listing of `app/[lang]/(admin)/` — 14 surfaces, none of them leads:
   `audit-log/`, `coach-assignment/`, `cohorts/`, `conversations/`, `erasure/`, `integrations/`, `inventory/`, `kb/` (+`kb/[docId]/`), `model-config/`, `pdpa-settings/`, `roles/`, `usage/`, `users/`, `whatsapp-import/`, plus `layout.tsx`.

4. **No `leads` nav item.** `NavItemKey` union at `app/[lang]/_components/app-sidebar-nav.ts:51-70` has no `leads` member.

5. **No i18n namespace.** `src/i18n/messages/en.json` top-level keys: `app, auth, chat, handoff, kb, inventory, nav, pagination, journey, home, integrations, errors, dashboard, adminConversations, adminRoles, adminUsage, adminErasure, flagQueue, adminCohorts, adminCoachAssignment, agentsIndex, agentProfile, adminModelConfig, adminAuditLog, adminPdpa, adminUsers, adminWhatsapp` — no `adminLeads`.

6. **No REQ-ID for lead management.** `.planning/REQUIREMENTS.md` references leads only as *consumed* context (`FIND-05`, `FIND-08`, `REPLY-03`, `RO-03`). Lead provenance was never specified — the schema was built in Phase 1, consumers in Phases 3–4, and the producer was never planned. This is a genuine spec gap, not a regression.

### Why the user sees exactly this symptom

`listLeadsForReply()` returns `{ ok: true, leads: [] }` (the query succeeds, the collection is empty) → `lead-selector.tsx` renders `CommandEmpty` with `chat.leadSelector.empty`:

> `"No leads yet — add one before drafting a reply."` (`src/i18n/messages/en.json`)

The copy instructs the user to add a lead, and there is nowhere in the app to do it. Cancelling the sheet blocks dispatch (`chat-shell.tsx:136-139, 152-155`), so **Reply can never be exercised**.

### Latent NOT_FOUND bug (load-bearing for the fix)

`writeLeadSlot` uses `.update()`, which throws `NOT_FOUND` on a missing document:

```ts
// src/memory/leadContext.ts:121
await leadContextRef().doc(leadId).update(update as Record<string, unknown>)
```

The Reply branch calls it in `onFinish` with **no try/catch** (contrast the `recordKnowledgeGap` call ~20 lines below, which *is* wrapped):

```ts
// app/api/chat/route.ts:578-586
if (pillar === 'reply' && leadId) {
  const sopDocIds = extractReplySopIds(final)
  await writeLeadSlot(leadId, 'replySlot', {
    classification: replyClassification,
    latestDraft: final.text, // already PDPA-redacted (GATE 3 ran before streamText)
    sopDocIds,
    lastDraftedAt: Date.now(),
  })
```

**Consequence:** creating only `leads/{id}` (without `leadContext/{id}`) produces a draft that streams fine and then blows up in `onFinish`. The admin create action **must write both docs**. (Readers are safe — `readReplySlot` returns `null` on a missing doc, `src/memory/leadContext.ts:174-177`.)

---

## Lead data model (actual)

Quoted verbatim from `src/firebase/collections.ts:148-170`:

```ts
export interface LeadDoc {
  tenantId: TenantId
  ownerUid: string
  /** Lead name pseudonymized at the Claude boundary (e.g. <LEAD_ID:...>) */
  name: string
  phoneHash: string
  consentFlag: boolean
  nationality: string
  segment: string
}

export interface LeadContextDoc {
  tenantId: TenantId
  /** Coach agent's write slot — other agents must not overwrite this */
  coachSlot: Record<string, unknown>
  /** Finder agent's write slot */
  finderSlot: Record<string, unknown>
  /** Reply agent's write slot */
  replySlot: Record<string, unknown>
  /** Rolling summary shared across all pillars */
  rollingSummary: string
  updatedAt: Date | FieldValue
}
```

Slot shapes (`src/memory/leadContext.ts:49-90`):

```ts
export interface FinderSlot {
  criteria: ParsedCriteria
  discussedProjectIds: string[]
  lastRankedAt: number   // epoch ms, plain number (not a Timestamp)
}

export interface ReplySlot {
  classification: 'cold-prospect' | 'objection' | 'financing' | 'other'
  latestDraft: string    // already PDPA-redacted
  sopDocIds: string[]
  lastDraftedAt: number
}
```

Empty-object semantics matter: `readFinderSlot` / `readReplySlot` treat `{}` as "never written" and return `null` (`src/memory/leadContext.ts:149`, `:184`). **A create action must therefore seed all three slots as `{}`, not omit them** — omitting them also breaks the `leadContext` read rule, which tests `resource.data.coachSlot != null` (`firestore.rules:167`).

`tenantId` is stamped automatically by the converter — no caller can omit it (`src/firebase/collections.ts:774-779`) — but the cohorts writer sets it explicitly anyway to satisfy `WithFieldValue<T>` (see pattern below).

### PII posture (this is the sharp edge)

The schema is deliberately PII-lean and is enforced by two live consumers:

- **`name` is already the pseudonym.** Rules tests seed `name: '<LEAD_ID:001>'` (`src/firebase/__tests__/rules.test.ts:380`), and `TSD.md:146` documents the field as `name(pseudonymized)`.
- **`phoneHash`, not `phone`.** There is no raw-phone field. The hashing primitive is `hashValue` (sha256, first 12 hex) in `src/audit/pdpa.ts:105-107`; it is module-private and only reachable via `pseudonymize()` (`:248`).
- **`leads/{id}.name` is injected as `knownNames` into the PDPA gate**, so it is used as a *needle to redact*, not as content to send:
  ```ts
  // app/api/chat/route.ts:355-371
  if (leadId) {
    try {
      const leadSnap = await leadsRef().doc(leadId).get()
      const leadName = leadSnap.data()?.name
      if (leadName) knownNames.push(leadName)
  ...
  const { redacted, pdpa_redacted } = pseudonymize({ messages: ... }, knownNames)
  ```
  **If an admin form stores a real name in `name`, that real name becomes the redaction needle** — which is actually the *desired* behaviour for redacting pasted WhatsApp text, but it means the raw name is now at rest in Firestore, readable by any admin, contradicting `TSD.md:146` and the rules-test fixture. The form must not invite a raw name. Recommendation in the fix plan: label the field "Lead label / pseudonym", default-generate `<LEAD_ID:xxxxxxxxxxxx>`, and derive `phoneHash` server-side from a phone the action hashes and **never persists**.

---

## Pattern to copy

**Closest analog: `app/[lang]/(admin)/cohorts/`** — a 3-file admin CRUD (list + create + edit + delete) over a plain Firestore doc with no embeddings and no file upload. It is a closer fit than `inventory/` (which drags in Gemini embedding-on-write, price-band derivation, CSV import, and a `src/inventory/` core module) — but `inventory/` is the right reference for the RSC page gate + Timestamp serialization.

Cohorts also already contains the exact **owner-picker** interaction a Leads form needs (choose which agent owns the lead) via `listUsersWithRoles()` + a shadcn `Select`.

### File-by-file anatomy

#### 1. `cohorts/page.tsx` — RSC shell + role gate + server-side list

Uses the **centralized gate helper**, which is the current convention (`inventory/page.tsx:62-86` still hand-rolls the older Pattern A; prefer this):

```tsx
// app/[lang]/(admin)/cohorts/page.tsx:17-48
import { getTranslations } from 'next-intl/server'
import { requireRole } from '../../_lib/require-role'
import { listCohorts, listAgentCohorts, type CohortSummary } from './actions'
import { listUsersWithRoles } from '../roles/actions'
import { CohortManagement, type CohortAgent } from './cohort-management'

export async function generateMetadata() {
  return { title: 'Cohorts — D2 Admin' }
}

export default async function CohortsAdminPage({ params }: PageProps) {
  const { lang } = await params

  // D-24: admin-only — read-only is NOT admitted; disallowed roles redirect to Home.
  await requireRole({ lang, allowed: ['admin'], fallback: `/${lang}` })

  let initialCohorts: CohortSummary[] = []
  try {
    const result = await listCohorts()
    if (result.ok) initialCohorts = result.cohorts
  } catch {
    initialCohorts = []       // Non-blocking — render an empty table rather than crash.
  }
  ...
  const t = await getTranslations('adminCohorts')
```

Layout: `container mx-auto max-w-4xl px-4 py-8`, `h1` = `text-2xl font-semibold tracking-tight` + `p` = `mt-1 text-sm text-muted-foreground` (`cohorts/page.tsx:78-82`).

#### 2. `cohorts/actions.ts` — `'use server'`, three-layer admin gate, audited

The `getSessionUser()` helper is copy-pasted verbatim across every admin actions file (`cohorts/actions.ts:34-47`, `roles/actions.ts:44-57`, `inventory/actions.ts:50-60`):

```ts
async function getSessionUser(): Promise<Awaited<ReturnType<typeof requireUser>>> {
  const cookieStore = await cookies()
  const sessionCookie = cookieStore.get('__session')

  if (!sessionCookie?.value) {
    throw new UnauthorizedError('No session cookie')
  }

  const syntheticReq = new Request('https://d2.app/admin/cohorts', {
    headers: { Authorization: `Bearer ${sessionCookie.value}` },
  })

  return requireUser(syntheticReq)
}
```

Every action follows the identical five-step shape (`cohorts/actions.ts:75-112`):

```ts
export async function createCohort(input: CohortInput): Promise<CohortResult> {
  let user: Awaited<ReturnType<typeof requireUser>>
  try {
    user = await getSessionUser()
  } catch {
    return { ok: false, error: 'Unauthorized' }
  }

  // D-03: cohort writes are admin-only — role from the VERIFIED token (T-07-10).
  if (user.role !== 'admin') {
    return { ok: false, error: 'Forbidden' }
  }

  try {
    // The converter stamps tenantId on every write; set it explicitly too to
    // satisfy WithFieldValue<CohortDoc> ...
    const ref = await cohortsRef().add({
      tenantId: TENANT_ID,
      name: input.name,
      ...
      createdAt: FieldValue.serverTimestamp(),
    })

    await audit.log({
      actorUid: user.uid,
      action: 'cohort-create',
      targetRef: `cohorts/${ref.id}`,
      raw: { cohortId: ref.id, name: input.name },
    })

    return { ok: true, id: ref.id }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to create cohort'
    return { ok: false, error: msg }
  }
}
```

Discriminated result union (`cohorts/actions.ts:56-66`):

```ts
export interface CohortActionResult { ok: true; id?: string }
export type CohortActionError = { ok: false; error: string }
export type CohortResult = CohortActionResult | CohortActionError
```

Bounded list read — never fetch-all (`cohorts/actions.ts:219-233`, i.e. `listCohorts`):

```ts
// Bounded read — never fetch-all (pilot org ≤ 200 cohorts is far above reality).
const snap = await cohortsRef().limit(200).get()
const cohorts: CohortSummary[] = snap.docs.map((doc) => {
  const data = doc.data()
  return { id: doc.id, name: data.name, description: data.description, createdBy: data.createdBy }
})
return { ok: true, cohorts }
```

`audit.log` hashes **every** value in `raw` before storage (`src/audit/log.ts:34-39, 76-96`) and swallows its own failures, so passing a lead label there is PDPA-safe. `action` is a free-form `string` (`AuditLogDoc.action` at `src/firebase/collections.ts:403`) — no union to extend.

Owner-picker source (`roles/actions.ts:75-95`) — reuse as-is:

```ts
export interface UserWithRole {
  id: string
  role: Role
  displayRef: string          // first 8 chars of uid
  email: string | null        // PII — resolved server-side only; never logged or audited
  seniorCoachId: string | null
}
```

#### 3. `cohorts/cohort-management.tsx` — `'use client'` island

Structure (`cohort-management.tsx:19-72` imports, `:236-457` render):

- **Hooks:** `useState` for rows + dialog state, `useTransition` for pending, `usePagination` from `../../_components/paginator`.
- **i18n:** `const t = useTranslations('adminCohorts')` — every string, no literals.
- **shadcn (all pre-vendored in `components/ui/`):** `Table/TableHeader/TableBody/TableRow/TableHead/TableCell`, `Dialog/DialogContent/DialogHeader/DialogTitle/DialogDescription/DialogFooter`, `AlertDialog*` for destructive confirm, `Button`, `Input`, `Textarea`, `Select/SelectTrigger/SelectValue/SelectContent/SelectItem`, `Empty/EmptyHeader/EmptyTitle/EmptyDescription`, plus `Paginator`. Icons from `lucide-react` (`Plus, Pencil, Trash2, …`).
- **Validation:** inline and minimal — `if (!name.trim()) return` and `disabled={!name.trim() || isPending}`. No zod, no react-hook-form anywhere in the admin group. (`inventory/project-form.tsx:64-88` shows the heavier variant: a hand-rolled `validateForm()` producing `Partial<Record<string,string[]>>` rendered through shadcn `Field/FieldLabel/FieldError`.)
- **Submit + toast:**
  ```tsx
  // cohort-management.tsx:159-188
  function handleSubmit() {
    if (!name.trim()) return
    startTransition(async () => {
      const result = editing
        ? await updateCohort(editing.id, { name: name.trim(), description: description.trim() })
        : await createCohort({ name: name.trim(), description: description.trim() })

      if (result.ok) {
        toast.success(editing ? t('updated') : t('created'))
        ...optimistic local setState...
        setFormOpen(false)
      } else {
        toast.error(result.error ?? t('genericError'))
      }
    })
  }
  ```
  `toast` is `sonner`; the `<Toaster>` is mounted by the console shell. Optimistic local `setState` after success — **no `router.refresh()`**. (`inventory/project-form.tsx:131-136` uses the cruder `window.location.reload()` fallback.)
- **Destructive delete:** `AlertDialog` with `AlertDialogAction variant="destructive"`, never a bare `confirm()` (`cohort-management.tsx:441-456`).
- **Empty state:** `<Empty><EmptyHeader><EmptyTitle>{t('emptyTitle')}</EmptyTitle><EmptyDescription>{t('emptyBody')}</EmptyDescription>` (`:247-253`).

#### 4. Authorization — the exact helper (three layers)

**Layer 1 — route group** (`app/[lang]/(admin)/layout.tsx:67-71`): admits `admin` + `read-only`, redirects everyone else. Deliberately admits `read-only` so per-page gates aren't dead code.

**Layer 2 — the page**, `app/[lang]/_lib/require-role.ts:63-107`:

```ts
export async function requireRole({ lang, allowed, fallback }: RequireRoleOptions): Promise<AuthenticatedUser> {
  const cookieStore = await cookies()
  const sessionCookie = cookieStore.get('__session')
  if (!sessionCookie?.value) {
    redirect(`/${lang}/sign-in`)
  }
  let user: AuthenticatedUser
  let unauthorized = false
  try {
    const syntheticReq = new Request('https://d2.app/_gate/require-role', {
      headers: { Authorization: `Bearer ${sessionCookie.value}` },
    })
    user = await requireUser(syntheticReq)
  } catch (err) {
    if (err instanceof UnauthorizedError) { unauthorized = true } else { throw err }
  }
  if (unauthorized) { redirect(`/${lang}/sign-in`) }
  if (!allowed.includes(user!.role)) { redirect(fallback ?? `/${lang}/chat`) }
  return user!
}
```
**Pitfall 6 (documented in that file's header):** `redirect()` throws `NEXT_REDIRECT`; every `redirect()` must be **outside** the try/catch that swallows `requireUser` errors.

**Layer 3 — every Server Action** re-checks `user.role !== 'admin'` from the verified token, never from args. The claim source of truth is `requireUser` (`src/firebase/auth.ts:106-137`) reading `decoded['role']` / `decoded['tenantId']` from `verifyIdToken` output.

An alternative core-module gate exists for `src/`-side logic — `assertAdmin` at `src/inventory/crud.ts:109-113` — but leads need no core module, so Layer 3 in the action is sufficient (matches cohorts).

---

## Fix plan

### A. Files to CREATE

| # | Path | Contents |
|---|---|---|
| 1 | `app/[lang]/(admin)/leads/page.tsx` | RSC. `await requireRole({ lang, allowed: ['admin'], fallback: '/'+lang })`. `Promise.all([listLeads(), listUsersWithRoles()])` in a non-blocking try/catch. `getTranslations('adminLeads')`. Render `<LeadManagement …/>` inside `container mx-auto max-w-4xl px-4 py-8`. Mirror `cohorts/page.tsx` line-for-line. |
| 2 | `app/[lang]/(admin)/leads/actions.ts` | `'use server'`. `getSessionUser()` verbatim (URL `https://d2.app/admin/leads`). Exports `listLeads`, `createLead`, `updateLead`, `deleteLead`. Result union `LeadResult = {ok:true;id?:string} \| {ok:false;error:string}`. Every action: `getSessionUser()` → `role !== 'admin'` → work → `audit.log({action:'lead-create'\|'lead-update'\|'lead-delete', targetRef:\`leads/${id}\`, raw:{leadId, ownerUid}})`. |
| 3 | `app/[lang]/(admin)/leads/lead-management.tsx` | `'use client'`. Table (Label / Owner / Segment / Nationality / Consent / Actions) + create-edit `Dialog` + delete `AlertDialog` + `Empty` + `Paginator`. `useTranslations('adminLeads')`, `useTransition`, `sonner` toasts, optimistic `setState`. Owner selected via shadcn `Select` over the `UserWithRole[]` roster filtered to `role === 'new-agent'` (mirrors `cohort-management.tsx:127-133`). |
| 4 | `app/[lang]/(admin)/leads/actions.test.ts` | Mirror `app/[lang]/(admin)/coach-assignment/actions.test.ts` — assert Unauthorized (no cookie), Forbidden (`senior-coach`, `read-only`), and that create writes **both** docs. |

### B. `createLead` — the critical two-doc write

```ts
// app/[lang]/(admin)/leads/actions.ts (sketch)
const batch = adminDb.batch()          // or two awaited writes with the same generated id
const ref = leadsRef().doc()           // generate the id up front so leadContext can share it
batch.set(ref, {
  tenantId: TENANT_ID,
  ownerUid: input.ownerUid,
  name: input.label,                   // pseudonym / label, NEVER a raw legal name
  phoneHash: input.phoneHash,          // hashed in the action; the raw phone is never persisted
  consentFlag: input.consentFlag,
  nationality: input.nationality,
  segment: input.segment,
})
batch.set(leadContextRef().doc(ref.id), {
  tenantId: TENANT_ID,
  coachSlot: {},                       // MUST be {} — readFinderSlot/readReplySlot treat {} as
  finderSlot: {},                      // "never written" (leadContext.ts:149,184), and the read
  replySlot: {},                       // rule tests `resource.data.coachSlot != null` (rules:167)
  rollingSummary: '',
  updatedAt: FieldValue.serverTimestamp(),
})
await batch.commit()
```

Both docs share the same id — that is the schema contract (`leadContext/{leadId}`, `TSD.md:147`). **Omitting the `leadContext` doc reproduces the unhandled `NOT_FOUND` at `app/api/chat/route.ts:580`.** `deleteLead` must delete both (mirror `src/pdpa/erasure.ts` semantics).

### C. PII handling in the form (must-not-regress)

- Field label: **"Lead label"**, not "Lead name". Placeholder/default: a generated `<LEAD_ID:xxxxxxxxxxxx>` token, matching the rules-test fixture (`rules.test.ts:380`) and `TSD.md:146`.
- Phone: accept a phone **only** as transient form input; hash it in the Server Action and store `phoneHash`. There is no exported hash helper today — `hashValue` is module-private in `src/audit/pdpa.ts:105-107`. Either (a) export a small `hashLeadPhone()` from `src/audit/pdpa.ts` reusing `hashValue`, or (b) inline `createHash('sha256').update(phone).digest('hex').slice(0,12)` in the action. Option (a) is preferred (one hashing convention).
- Never put the raw phone in `audit.log.raw` beyond what gets hashed anyway, never in a `console.*`, and never in a URL/query param.
- Note the coupling: whatever goes in `name` becomes the PDPA redaction needle at `app/api/chat/route.ts:355-371`. A pseudonym label keeps Firestore clean; agents recognise their own leads by the label in the picker (`lead-actions.ts:32-39` returns `name` verbatim for display).

### D. Files to MODIFY

| # | Path | Change |
|---|---|---|
| 5 | `app/[lang]/_components/app-sidebar-nav.ts` | Add `\| 'leads'` to `NavItemKey` (`:51-70`); add `{ key: 'leads', href: \`/${lang}/leads\`, icon: UserSquare, roles: ['admin'] }` to the **`agents`** section (`:130-142`) — leads are agent-owned, and `read-only` must be excluded (D-24). Import the icon. |
| 6 | `src/i18n/messages/en.json` | New top-level `adminLeads` namespace (keys below). |
| 7 | `src/i18n/messages/ms.json` | Same key set, BM copy. |
| 8 | `src/i18n/messages/zh.json` | Same key set, 中文 copy. |
| 9 | `src/i18n/messages/{en,ms,zh}.json` → `nav` | Add `"leads"` label to all three. |
| 10 | `firestore.rules` | Admin-create delta (below). |
| 11 | `src/firebase/__tests__/rules.test.ts` | Extend the `leads collection` suite (`:369-414`) for the new admin-create grant + a still-denied cross-owner create. |
| 12 | *(recommended, separate hunk)* `app/api/chat/route.ts:578-586` | Wrap the Reply `writeLeadSlot` in try/catch, mirroring the `recordKnowledgeGap` guard 20 lines below, so a missing `leadContext` degrades the memory write instead of throwing in `onFinish`. Defence-in-depth for legacy leads created by the drill script. |

### E. Chat-side lead selection — no change needed

The flow already works end to end and needs **zero** modification; it was simply starved of data.

- `chat-shell.tsx:136-139` — a Reply dispatch with `leadId === undefined` opens the picker and returns `false` (blocks send).
- `lead-selector.tsx:87-103` — fetches `listLeadsForReply()` on open.
- `lead-actions.ts:71` — `leadsRef().where('ownerUid','==',uid).get()` — **scoped to the signed-in agent's own uid from the verified token**, so a lead created by an admin only appears for the agent set as `ownerUid`. This is the single most important integration detail: **the admin form's owner picker determines whose selector the lead shows up in.** For the user's own smoke test they must set `ownerUid` to their own uid (or run the test as that agent).
- `chat-shell.tsx:144-150` → `handleLeadPicked` sets `leadId` and resumes dispatch; `leadId` is sent in the POST body and read at `app/api/chat/route.ts:303-305`.
- `route.ts:402-407` remains the fail-closed server gate.

**What degrades without a lead:** nothing degrades gracefully — Reply is *fully blocked*. Client-side the picker refuses to close with a selection; server-side the route returns `400 {"error":"leadId required for reply"}` **before** `streamText`, so no model spend occurs. Coach and Finder keep `leadId` optional; Finder without a lead loses `finderSlot` persistence (no re-rank-without-re-typing per `FIND-08`, no returning-client dedup per `FIND-06`), but still answers.

Optional nicety (not required): pass `?leadId=` through `chat/page.tsx` `searchParams` into `ChatShell` so the admin table can deep-link "Draft a reply for this lead". `chat/page.tsx:39-46` currently only awaits `params`.

### F. `firestore.rules` delta

Current (`firestore.rules:146-157`):

```
match /leads/{leadId} {
  allow read:
    if (resource.data.ownerUid == request.auth.uid && sameTenant())
    || (hasRole('admin') && sameTenant());

  allow create:
    if (request.resource.data.ownerUid == request.auth.uid && incomingTenant());

  allow update, delete:
    if (resource.data.ownerUid == request.auth.uid && sameTenant());
}
```

Admin already has **read** on any lead but **cannot create a lead on behalf of another agent** — `create` requires `ownerUid == request.auth.uid`. The new Server Actions use the Admin SDK, which bypasses rules entirely, so this does **not** block the feature; but the rules should state the intended access model (they are the audited spec, and the rules test matrix is the proof artifact). Proposed delta — mirrors the `leadContext` block's own `|| (hasRole('admin') && incomingTenant())` shape at `:174-176`:

```
  allow create:
    if (request.resource.data.ownerUid == request.auth.uid && incomingTenant())
    || (hasRole('admin') && incomingTenant());

  allow update, delete:
    if (resource.data.ownerUid == request.auth.uid && sameTenant())
    || (hasRole('admin') && sameTenant());
```

`leadContext` needs **no** rules change — `:174-176` already grants `write` to admin. `read-only` stays denied on both by `!isReadOnlyRole()` / the absence of an `isAnalyticsReader()` grant (RO-03).

### G. i18n keys (identical set required in EN / BM / ZH)

`src/i18n/__tests__/i18n-parity.test.ts` fails CI if any dotted leaf path exists in one catalog and not the others, so all three must land in the same commit. Nesting convention: one top-level namespace per admin surface (`adminCohorts`, `adminUsers`, …), flat leaf keys inside, ICU interpolation as `{name}` (see `adminCohorts.manageDescription: "Add or remove agents in {cohort}."`).

New namespace `adminLeads`:

```
pageTitle, pageSubtitle,
colLabel, colOwner, colSegment, colNationality, colConsent, colActions,
createCta, createTitle, createDescription,
editCta, editTitle, editDescription,
deleteCta, deleteConfirmTitle, deleteConfirmBody, deleteConfirm,
fieldLabel, fieldLabelPlaceholder, fieldLabelHelp,
fieldOwner, fieldOwnerPlaceholder,
fieldPhone, fieldPhonePlaceholder, fieldPhoneHelp,
fieldConsent, fieldConsentHelp,
fieldNationality, fieldNationalityPlaceholder,
fieldSegment, fieldSegmentPlaceholder,
save, cancel,
created, updated, deleted,
emptyTitle, emptyBody,
genericError
```

Plus `nav.leads` in all three. `fieldLabelHelp` / `fieldPhoneHelp` carry the PDPA copy ("use a pseudonym, not the client's legal name"; "the phone is hashed and never stored").

---

## Regression surface

Features sharing the code paths this change touches, and the audit for each:

| Surface | Shared path | Risk | Verification |
|---|---|---|---|
| **Chat Reply flow** | `leads` collection now non-empty for the first time | The lead-selector renders real rows and the `<24h` recent-badge partition (`lead-selector.tsx:71-79`) executes with real `lastTouchedAt` for the first time. `lastTouchedAt` is `null` on a fresh lead (no `updatedAt` millis until a slot write), so `recent` is `null` → the "pick explicitly" path (HR-3). | `e2e/reply-draft.spec.ts:144-153` (selector opens); manual: create a lead → sign in as its owner → force Reply → pick → draft streams → re-open Reply and confirm the recent badge appears. |
| **Chat Finder flow** | `writeLeadSlot(leadId,'finderSlot',…)` at `route.ts:566` | Same `.update()` NOT_FOUND exposure as Reply. Fixed by the two-doc create; the item-12 try/catch would cover Finder too if extended. | `e2e/finder-flow.spec.ts:229-240` (re-rank via stored `finderSlot`). |
| **PDPA gate** | `knownNames` injection at `route.ts:355-371` | A real `leads/{id}.name` now flows into `pseudonymize()` as a redaction needle. A very short or punctuation-only label could over-redact benign text. Keep labels token-shaped (`<LEAD_ID:…>`). | `src/audit/pdpa.test.ts`; spot-check a draft with a 2-char label. |
| **PDPA erasure** | `src/pdpa/erasure.ts:68-72`, `src/pdpa/coverage.ts:202-207` | Both collections are already in the manifest; adding a create path does not change the manifest. Admin-created leads with an `ownerUid` are erasable by the existing `ownerUid`-keyed sweep. **If a lead is created with an empty/garbage `ownerUid` it becomes un-erasable orphan PII** — the action must reject a blank `ownerUid` (mirror `setAgentCohort`'s `if (!agentUid) return {ok:false,error:'Missing agent'}` at `cohorts/actions.ts:188-190`) and verify the user exists (mirror the cohort-existence check at `:194-198`). | `src/pdpa/coverage.test.ts`, `src/pdpa/erasure.test.ts`; re-run `scripts/pdpa-erasure-drill.ts`. |
| **Firestore rules** | `firestore.rules:146-157` widening | Broadening `leads` create/update/delete to admin must not leak cross-owner access to `new-agent` / `senior-coach` / `read-only`. | `src/firebase/__tests__/rules.test.ts` `leads collection` + `leadContext collection` suites; RO-03 must stay green (read-only denied on both). |
| **Sidebar nav** | `app-sidebar-nav.ts` `NavItemKey` + `agents` section | `app-sidebar-nav.test.ts` asserts section keys/order and per-role membership. It uses `toContain` / `not.toContain`, **not** exact counts (`:83, :102-132, :189-214`), so adding one item is safe — but `read-only` must not see it (`:155-162` pattern) and `senior-coach` must not either. | `npx vitest run app/[lang]/_components/app-sidebar-nav.test.ts` |
| **i18n catalogs** | all three JSON files | `src/i18n/__tests__/i18n-parity.test.ts` goes RED on any asymmetric key. | `npx vitest run src/i18n` |
| **Admin console shell** | `(admin)/layout.tsx` | No change; the new page sits inside the existing group and re-gates itself. `read-only` reaching `/[lang]/leads` must redirect to Home (`/${lang}`), never chat (RO-01). | Manual with a `read-only` token; assert redirect target is Home. |
| **Audit log** | `src/audit/log.ts` | `action` is a free `string`; three new labels add rows only. `raw` values are all sha256-hashed (`:76-90`), so a lead label never lands in plaintext. Failures are swallowed by design. | `src/audit/log.test.ts`; eyeball a row in `/[lang]/audit-log`. |
| **`writeLeadSlot` semantics** | `src/memory/leadContext.ts:103-122` | **Do not** change `.update()` to `.set({merge:true})` in this claim — that would silently create partial `leadContext` docs missing the `{}` slot defaults and the `coachSlot != null` read-rule predicate, and it is a behavioural change to the slot-isolation contract (`memory.test.ts` covers it). Keep the fix in the create path. | `npx vitest run src/memory` |

### Not in scope (flag, don't fix here)

- The unguarded `writeLeadSlot` in `route.ts:578-586` is a pre-existing latent bug. Item 12 is a one-line defensive wrap; if it is treated as behaviour change, split it into its own claim.
- Lead management for the **agent** (not admin) — an agent adding their own lead from the chat surface — is the natural follow-on (rules already allow self-owned create at `firestore.rules:152-153`), and is arguably where this belongs long-term. Out of scope for an admin-page fix.
- No REQ-ID exists for lead CRUD; consider adding `ADMIN-xx: admin-managed lead registry` to `.planning/REQUIREMENTS.md` so the surface is traceable.
