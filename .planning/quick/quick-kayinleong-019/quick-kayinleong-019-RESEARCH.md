# quick-kayinleong-019 — Research: Admin-only easter-egg debug sidebar + "Clear all data"

**Researched:** 2026-06-15
**Domain:** Next.js 16 Server Actions + firebase-admin recursiveDelete + shadcn Sheet + easter-egg keypress
**Confidence:** HIGH (all findings grounded in this repo's source)

## Summary

Everything you need already exists in-repo. Reuse, don't reinvent:
- **Server admin gate:** `requireUser(req)` reads `role` from the **verified** ID token; the `__session` cookie pattern (`getSessionUser()` in `roles/actions.ts`) is the exact reuse target — the Server Action reads the cookie itself, the client passes nothing.
- **Recursive delete:** firebase-admin **13.10.0** exposes `adminDb.recursiveDelete(collectionRef)` (handles `conversations/{cid}/messages` subcollections automatically). Loop the explicit top-level collection list MINUS `users` and `appConfig`.
- **UI:** vendored `components/ui/sheet.tsx` (`side="right"`) is the right slide-in base; guard the destructive action with `components/ui/alert-dialog.tsx` (the `cohort-management.tsx` delete pattern).
- **Role on client:** there is **no client auth context**. The verified role is resolved server-side in the route-group layout and passed down as a prop (`ConsoleShell role={user.role}`). Pass `role` the same way to your debug components.

**Primary recommendation:** Add a `'use server'` action `clearAllData()` in a new `app/[lang]/(admin)/debug/actions.ts` that re-verifies `user.role === 'admin'` via the `getSessionUser()` cookie pattern, loops a hardcoded clear-list calling `adminDb.recursiveDelete(adminDb.collection(name))`, and audits via `audit.log`. Mount a client `DebugSidebar` (Sheet) + global `keydown` listener inside `console-shell.tsx`, gated on `role === 'admin'`.

---

## Q1 — Admin auth gating (server) [VERIFIED: repo source]

**Helper to reuse:** `requireUser(req: Request): Promise<AuthenticatedUser>`
- File: `src/firebase/auth.ts:106`
- Reads Bearer token from `Authorization` header → `adminAuth.verifyIdToken` → returns `{ uid, role, tenantId }` from **verified** claims (never from body/args). `role: 'new-agent' | 'senior-coach' | 'admin' | 'read-only'`.

**Exact Server-Action cookie pattern to copy** — `getSessionUser()` in `app/[lang]/(admin)/roles/actions.ts:44-57`:
```ts
async function getSessionUser() {
  const cookieStore = await cookies()                 // Next 16: cookies() is async
  const sessionCookie = cookieStore.get('__session')
  if (!sessionCookie?.value) throw new UnauthorizedError('No session cookie')
  const syntheticReq = new Request('https://d2.app/admin/debug', {
    headers: { Authorization: `Bearer ${sessionCookie.value}` },
  })
  return requireUser(syntheticReq)
}
```
Then the gate (verbatim from `roles/actions.ts:133`):
```ts
const user = await getSessionUser()
if (user.role !== 'admin') return { ok: false, error: 'Forbidden' }
```
This is the **three-layer gate** convention (layout → page → action re-check). The "Clear all data" action MUST do the Layer-3 token re-check itself — do not trust any client-passed role.

## Q2 — Admin detection (client) [VERIFIED: repo source]

**There is no client auth context/hook for role.** The verified role is resolved **server-side** in the route-group layout and threaded as a prop:
- `app/[lang]/(admin)/layout.tsx:56,74` resolves `user` via `requireUser`, then renders `<ConsoleShell role={user.role} lang={lang}>`.
- `app/[lang]/_components/console-shell.tsx:27` — `ConsoleShell({ role, lang, children })`, `role: Role`.
- (For Firebase Auth user identity the client uses `clientAuth` + `onAuthStateChanged` from `@/src/firebase/client`, e.g. `chat-input.tsx:28-29` — but **role lives only in the token claim, surfaced server-side**.)

**Recommendation:** Do not fetch role on the client. Pass `role` (already available in `ConsoleShell`) into your `DebugSidebar` / keypress-listener client components and mount them only when `role === 'admin'`.

## Q3 — Collection enumeration + recursive delete [VERIFIED: repo source + node_modules types]

**Admin SDK instance:** `adminDb` (`src/firebase/admin.ts:79`, type `Firestore`).
**firebase-admin version:** `13.10.0` (package.json:29) — new enough.
**`recursiveDelete` is available:** `@google-cloud/firestore/types/firestore.d.ts:624` →
`recursiveDelete(ref: CollectionReference | DocumentReference, bulkWriter?: BulkWriter): Promise<void>`.
Passing a top-level **CollectionReference** deletes every doc AND all subcollections underneath — so `recursiveDelete(adminDb.collection('conversations'))` wipes `conversations/{cid}` **and** `conversations/{cid}/messages/{mid}` in one call. No manual subcollection walk needed.

**Concrete approach:**
```ts
import { adminDb } from '@/src/firebase/admin'
const PRESERVE = new Set(['users', 'appConfig'])  // decision: preserve ENTIRE appConfig collection
for (const name of CLEAR_LIST) {
  await adminDb.recursiveDelete(adminDb.collection(name))  // raw collection ref, no converter needed
}
```
Use a **raw `adminDb.collection(name)`** (not the typed `*Ref()` factories) — converters are irrelevant for deletes and the typed refs are 1:1 with the names below anyway.

### COMPLETE collection list (authoritative — `src/firebase/collections.ts`)

**CLEAR (delete) — 21 top-level collections:**
```
agentProfiles, conversations (incl. messages subcollection), leads, leadContext,
projects, collateral, kbDocs, kbChunks, kbIngestionJobs, escalations,
auditLogs, evals, rateBudgets, knowledgeGaps, replyEdits, usageEvents,
usageRollups, erasureRequests, cohorts, conversationFlags
```
(That is every `*Ref()` factory's collection name EXCEPT the two below. `messages` is NOT a separate top-level entry — it is a subcollection of `conversations`, handled by recursiveDelete.)

**PRESERVE (do NOT delete):**
```
users        ← preserve (you don't want to lock yourself out)
appConfig     ← preserve the ENTIRE collection (decision: includes the modelConfig doc — safest)
```

> Note on `auditLogs`: it is in the CLEAR list per the requirement ("every collection except users + appConfig"). Be aware this wipes the audit trail — but the clear action itself should still write its own audit row (it will be the first row after the wipe). Confirm with Derek if audit history must survive; if so, add `auditLogs` to PRESERVE.

## Q4 — Existing Server Action conventions [VERIFIED: repo source]

**Shape** (see `app/[lang]/(admin)/roles/actions.ts` and `cohorts/actions.ts`):
- File starts with `'use server'`, lives under the `(admin)` route group.
- Each action: gate via `getSessionUser()` → `if (user.role !== 'admin') return { ok:false, error:'Forbidden' }`.
- **Return a discriminated result object**, never throw to the client:
  ```ts
  type Result = { ok: true } | { ok: false; error: string }
  ```
- Audit after success: `await audit.log({ actorUid: user.uid, action: 'clear-all-data', raw: {...} })`.
- **Client invocation** (`cohort-management.tsx`): import the action, call inside `useTransition()` + `startTransition`, surface result with `sonner` `toast`. No bare `confirm()`.

## Q5 — Sidebar / sheet UI primitives [VERIFIED: repo source]

Available in `components/ui/`: `sheet.tsx`, `dialog.tsx`, `alert-dialog.tsx`, `drawer.tsx`, `sidebar.tsx`, `alert.tsx`.

**Recommendation:**
- **Base panel:** `Sheet` (`components/ui/sheet.tsx`) with `<SheetContent side="right">` — purpose-built slide-in, supports `top|right|bottom|left` (line 51-55). `sidebar.tsx` is the heavy app-nav system (don't repurpose it for a debug panel).
- **Destructive confirm:** wrap "Clear all data" in `AlertDialog` (`components/ui/alert-dialog.tsx`) with `AlertDialogAction variant="destructive"` — exactly the pattern in `cohort-management.tsx:24-32` ("Delete cohort?" two-step confirm). Do NOT use a bare `confirm()`.

## Q6 — Global keypress listener placement [VERIFIED: repo source]

**Mount inside `console-shell.tsx`** (`app/[lang]/_components/console-shell.tsx`) — it is `'use client'`, already receives the verified `role`, and wraps every authenticated console page (rendered by both `(admin)/layout.tsx` and `(coach)/layout.tsx`). Gate the listener on `role === 'admin'` so it never mounts for other roles.

Implementation notes:
- `useEffect` with `window.addEventListener('keydown', ...)`; clean up on unmount.
- **Ignore typing in inputs:** skip when `document.activeElement` is an `<input>`, `<textarea>`, or `[contenteditable]` (and check `e.key === 'e'` only). Reset the count on any non-`e` key or a short timeout window so "press e 5 times" means a deliberate burst.
- On 5 hits, open the `Sheet` (local `useState` boolean).

## Q7 — Audit logging helper [VERIFIED: repo source]

`log(entry: AuditEntry): Promise<void>` — `src/audit/log.ts:76`, re-exported via `src/audit/index.ts` (`import * as audit from '@/src/audit'`).
```ts
interface AuditEntry { actorUid: string; action: string; targetRef?: string; raw: Record<string, unknown> }
```
- **Every value in `raw` is sha256-hashed** before storage — never store raw PII. For clear-all there's no PII; pass counts/labels, e.g. `raw: { op: 'clear-all-data', cleared: CLEAR_LIST.length }`.
- Fire-and-forget: it swallows its own errors (safe). For an admin action you may `await` it before returning so the row is written.

## Q8 — Test conventions [VERIFIED: repo source]

Representative: `app/[lang]/(admin)/roles/actions.test.ts` (Vitest). Pattern:
- `vi.mock('@/src/firebase/auth', ...)`, `vi.mock('@/src/audit', ...)`, `vi.mock('next/headers', () => ({ cookies: vi.fn().mockResolvedValue({ get: () => ({ value: '<token>' }) }) }))` — **declared BEFORE importing the action module**.
- Per-test: `vi.mocked(requireUser).mockResolvedValueOnce({ uid, role, tenantId })` to simulate admin / non-admin.
- Assert the `{ ok: true|false }` result and that `audit.log` was called with the expected `action`.
- For `clearAllData`: mock `@/src/firebase/admin` so `adminDb.recursiveDelete` and `adminDb.collection` are `vi.fn()` — assert it's called once per CLEAR_LIST entry and **never** with `'users'` or `'appConfig'`. No emulator needed for the unit test (admin-SDK fully mocked). `@firebase/rules-unit-testing` is for Firestore-rules tests only — not needed here.

## Q9 — Pitfalls

- **core/shell rule:** The `clearAllData` Server Action lives under `app/` (it's shell — uses `next/headers`). It MAY import `adminDb`, `requireUser`, `audit` from `src/`. Do NOT put the action in `src/`. The keypress/Sheet components are also `app/` client components. [VERIFIED: CLAUDE.md core/shell split + require-role.ts:10-13 precedent]
- **Next.js 16:** `cookies()` is **async** — `await cookies()`. Server Actions are POST-only and run server-side; do not stream from them. [VERIFIED: AGENTS.md / require-role.ts:26,69]
- **recursiveDelete is not transactional** and not atomic across collections — if it rejects mid-way some collections are wiped and some aren't. Acceptable for a destructive debug tool; surface the error in the toast. It also uses a BulkWriter (rate-limited) — fine at pilot scale. [CITED: firestore.d.ts:590-606]
- **auditLogs self-wipe:** clearing `auditLogs` erases history; the action's own audit row lands after the wipe. Flag to Derek (see Q3 note). [VERIFIED: requirement scope]
- **Don't lock yourself out:** `users` is preserved by design (claims live in Auth, not Firestore, so even wiping `users` wouldn't drop your admin claim — but agentProfiles/leadContext etc. will be gone; that's intended). [VERIFIED]
- **i18n:** EN-only copy is acceptable for an internal/hidden dev tool. **But** the project's i18n-parity test is a live GREEN gate — it checks key-set parity across `en/ms/zh`. If you hardcode English strings directly in JSX (no `next-intl` keys), you add **no** new i18n keys and the parity test stays green. **Recommendation: hardcode English strings inline (no `useTranslations` keys) for the debug panel** — this is the only way to stay English-only without breaking the parity gate. Do NOT add keys to only the `en` catalog. [VERIFIED: STATE.md i18n-parity gate + 07-04/07-06 decisions]
- **Keypress false positives:** without the input-focus guard, typing "e" in any KB/cohort text field would trigger the easter-egg. Guard on `activeElement` (Q6). [reasoned]

---

## Sources

### Primary (HIGH confidence — repo source, this session)
- `src/firebase/collections.ts` — authoritative collection list + `adminDb.collection()` refs
- `src/firebase/auth.ts:106` — `requireUser` (verified-claim role gate)
- `app/[lang]/(admin)/roles/actions.ts` — `getSessionUser` cookie pattern + admin gate + result shape + audit
- `app/[lang]/(admin)/layout.tsx`, `_components/console-shell.tsx` — role prop threading (no client auth context)
- `app/[lang]/(admin)/cohorts/cohort-management.tsx` — client action invocation (useTransition + AlertDialog destructive confirm)
- `src/audit/log.ts:76` — `audit.log` signature
- `app/[lang]/(admin)/roles/actions.test.ts` — Vitest mocking pattern
- `components/ui/sheet.tsx`, `alert-dialog.tsx` — vendored primitives
- `node_modules/@google-cloud/firestore/types/firestore.d.ts:624` — `recursiveDelete` signature
- `package.json:29` — firebase-admin 13.10.0

## Metadata
**Confidence breakdown:** Admin gate HIGH · recursiveDelete HIGH · collection list HIGH · UI primitives HIGH · i18n recommendation HIGH (confirmed against parity-gate decisions).
**Valid until:** stable (in-repo facts) — re-verify only if firebase-admin or the collection set changes.
