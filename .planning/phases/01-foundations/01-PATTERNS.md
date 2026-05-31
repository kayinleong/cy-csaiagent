# Phase 1: Foundations - Pattern Map

**Mapped:** 2026-05-31
**Files analyzed:** 38 new/modified files (grouped by role)
**Analogs found:** 9 with a real in-repo analog / 38 total — the rest are **net-new core/config** with no in-repo analog (greenfield); spec is TSD §3–§5 + RESEARCH.md patterns.

> **Read this first (the honest headline):** This is a **greenfield application core**. The repo is a stock Next.js 16.2.6 scaffold with 55 vendored shadcn components. The ONLY rich existing pattern source is `components/ui/*` (and `lib/utils.ts` + `hooks/use-mobile.ts`). Therefore:
> - **UI files** map to specific `components/ui/*` analogs with concrete excerpts (below).
> - **Next.js structural files** (`proxy.ts`, `app/[lang]/...`, `app/api/*`) have NO real analog — the scaffold's `app/layout.tsx` / `app/page.tsx` is only a *structural starting point* (RSC default export, `@/` alias, font wiring). The real spec is the **Next.js 16 conventions in RESEARCH.md §Pattern 1–5** (verified against `node_modules/next/dist/docs/`). Do NOT invent a fake analog from the scaffold's marketing `page.tsx`.
> - **`src/` core modules** (`agents/router/llm/memory/rag/kb/escalation/audit/ratelimit/i18n/firebase`) are 100% net-new. There is **no `src/` directory at all** today. For each, the spec is **TSD §3.2 (responsibilities) + §4 (data model) + RESEARCH.md Code Examples / Patterns** — explicitly called out per file. Forcing a shadcn analog onto a Firestore adapter would be misleading; honest "no analog → follow TSD §X" is the correct mapping.

---

## Project Conventions (apply to every new file)

Extracted from the live scaffold — these are the only *established* patterns and ALL new code must honor them:

| Convention | Source | Rule |
|------------|--------|------|
| **Path alias** | `tsconfig.json` lines 21-23 | `"@/*": ["./*"]` — single root alias. Import as `@/components/ui/button`, `@/lib/utils`, `@/src/firebase/admin`. NO `~` or relative `../../`. |
| **`cn()` class merge** | `lib/utils.ts` lines 1-6 | `import { cn } from "@/lib/utils"` — `twMerge(clsx(inputs))`. Every UI file uses `cn(...)` for className composition. |
| **shadcn component idiom** | `components/ui/button.tsx`, `card.tsx` | `React.ComponentProps<"el">` typing + `data-slot="..."` attribute + `cva` for variants + named exports (no default). `"use client"` only when hooks/interactivity are used. |
| **RSC-by-default** | `app/layout.tsx` (no `"use client"`), `components.json` `"rsc": true` | Server Components by default; add `"use client"` only for interactive leaves (chat input, CRUD form). |
| **shadcn aliases** | `components.json` lines 15-21 | `ui → @/components/ui`, `lib → @/lib`, `hooks → @/hooks`, `utils → @/lib/utils`. Do NOT re-add shadcn; reuse vendored components. |
| **Mobile-first** | `hooks/use-mobile.ts` (768px breakpoint) | Reuse `useIsMobile()` for responsive chat layout; the chat surface is mobile-first per PROJECT.md. |
| **Toasts** | `components/ui/sonner.tsx` + `sonner ^2.0.7` installed | Use the vendored `<Toaster>` + `toast()` for the handoff/escalation signal and ingestion status — do not hand-roll notifications. |
| **Core/shell import rule** | TSD §3.1 line 103, CLAUDE.md | `app/` may import `src/`; **`src/` must NEVER import `app/`**. New `src/` files must be Next-free and unit-testable. |
| **`tenantId` on every doc** | TSD §4 line 141, CLAUDE.md | Every Firestore write in `src/` includes `tenantId: "d2"`. Bake into the typed collection refs (`src/firebase/collections.ts`). |
| **Model IDs from Remote Config** | TSD §2.3, RESEARCH §llm example | Never hard-code a model ID; resolve via `modelFor(pillar)` → Remote Config. |

---

## File Classification

### Tier A — UI files (real shadcn analog in `components/ui/`)

| New File | Role | Data Flow | Closest Analog | Match Quality |
|----------|------|-----------|----------------|---------------|
| `app/[lang]/(chat)/message-list.tsx` | UI component | streaming (render-only) | `components/ui/scroll-area.tsx` + `components/ui/card.tsx` | role-match (compose) |
| `app/[lang]/(chat)/chat-input.tsx` | UI component (client) | request-response | `components/ui/textarea.tsx` + `components/ui/button.tsx` | role-match (compose) |
| `app/[lang]/(chat)/page.tsx` (chat shell) | UI page (client island) | streaming | scaffold `app/page.tsx` (structure) + `hooks/use-mobile.ts` + `sonner.tsx` | partial (structure only) |
| `app/[lang]/(admin)/kb/page.tsx` (KB CRUD form) | UI page + form | CRUD | `components/ui/field.tsx` + `card.tsx` + `textarea.tsx` + `button.tsx` | exact (this is what `field.tsx` is for) |
| `app/[lang]/(admin)/kb/kb-doc-form.tsx` | UI component (client) | CRUD | `components/ui/field.tsx` (`Field`/`FieldLabel`/`FieldError`) | exact |

### Tier B — Next.js structural / server files (NO real analog — scaffold = structural start only)

| New File | Role | Data Flow | Structural Start | Spec to Follow |
|----------|------|-----------|------------------|----------------|
| `proxy.ts` | config / middleware | request-response | none (net-new at root) | RESEARCH §Pattern 2; `node_modules/next/dist/docs/.../16-proxy.md`. **NOT `middleware.ts`** |
| `app/layout.tsx` (modify) | layout | — | existing `app/layout.tsx` (lines 20-33) | Add `NextIntlClientProvider` + `<Toaster/>`; keep font + `@/` + `h-full` body pattern |
| `app/[lang]/layout.tsx` | layout | — | existing `app/layout.tsx` (structure) | RESEARCH §Structure; next-intl `[lang]` param wiring (Q2: confirm proxy vs middleware) |
| `app/api/chat/route.ts` | route handler | streaming (SSE) | none | RESEARCH §Pattern 1 (verbatim shape) + `15-route-handlers.md` + `streaming.md` |
| `app/api/kb/ingest/process/route.ts` | route handler | batch / chunked-poll | none | TSD §3.4 (chunked client-driven); RESEARCH §Arch-Responsibility-Map (KB ingestion row) |
| `app/api/jobs/stall-detect/route.ts` | route handler | event-driven (cron) | none | RESEARCH §Code Examples "QStash signed cron callback"; TSD §3.4 |
| `apphosting.yaml` | config | — | none | TSD §10 (region `asia-southeast1`, `minInstances=1`, Secret Manager bindings) |
| `firestore.rules` | config (security) | — | none | RESEARCH §Code Examples "deny-by-default rule sketch"; TSD §5.2 |
| `vitest.config.ts`, `playwright.config.ts`, `promptfooconfig.yaml` | config (test) | — | none | RESEARCH §Validation Architecture (Wave-0 deliverables) |

### Tier C — `src/` core modules (100% net-new, NO in-repo analog, no `src/` dir exists)

| New File | Role | Data Flow | Analog | Spec to Follow |
|----------|------|-----------|--------|----------------|
| `src/firebase/{admin,client,collections}.ts` | core (data plane init) | — | **none** | TSD §3.2 `firebase` row + §4 (typed collection refs = single source of truth for `tenantId`) |
| `src/llm/{provider,fake,types,index}.ts` | core (service) | streaming | **none** | RESEARCH §Code Examples "llm/ abstraction + fake provider"; TSD §3.2 `llm` row; §6 model-swap |
| `src/rag/{embed,search,citations,index}.ts` | core (service, adapter) | request-response (KNN) | **none** | RESEARCH §Code Examples "Firestore vector retrieval"; TSD §3.2 `rag` row; §4 vector specifics |
| `src/router/{heuristic,classifier,index}.ts` | core (logic) | transform | **none** | TSD §3.2 `router` row (heuristic→Coach; `classifier.ts` = dormant seam, D-03) |
| `src/agents/coach/{prompt,tools,schema,index}.ts` | core (agent) | request-response | **none** | TSD §6 (grounding mandate, Zod schema, read-only tools-as-user); D-09 |
| `src/memory/{conversation,leadContext,agentProfile,index}.ts` | core (repository) | CRUD | **none** | TSD §3.2 `memory` row + §4 (messages subcollection, `leadContext` agent-scoped slots); RESEARCH §Pattern 4 |
| `src/kb/{ingest/{chunker,pdf,pipeline},crud,index}.ts` | core (pipeline) | batch / file-I/O | **none** | TSD §3.2 `kb` row + §3.4 chunked ingestion; D-10 multi-doc-capable |
| `src/escalation/{detect,handoff,index}.ts` | core (logic) | event-driven | **none** | TSD §3.2 `escalation` row; D-10 escalation seam |
| `src/audit/{log,pdpa}.ts` | core (service) | event-driven (append-only) | **none** | RESEARCH §Pitfall A; TSD §5.3 (pseudonymize-at-boundary, `pdpa_redacted` gate, hashes-only) |
| `src/ratelimit/{window,index}.ts` | core (service) | transform | **none** | TSD §3.2 `ratelimit` row + §9; D-02 (real decrement) |
| `src/i18n/{request,routing,detect}.ts` + `messages/{en,ms,zh}.json` | core (config) | — | **none** | TSD §7; RESEARCH §Pattern 2 / Q2 (next-intl ^4 wiring) |
| `src/llm/fake.ts` test double + `src/**/*.test.ts` | test | — | **none** | RESEARCH §Validation Architecture (Phase Requirements → Test Map) |

---

## Pattern Assignments

### Tier A — UI files (copy from these shadcn analogs)

#### `app/[lang]/(chat)/message-list.tsx` (UI component, streaming render)

**Analogs:** `components/ui/scroll-area.tsx` (the scroll container) + `components/ui/card.tsx` (message bubble / citation chip container).

**Scroll container pattern** (`scroll-area.tsx` lines 8-29) — wrap the streamed message list so it scrolls within a fixed mobile viewport:
```tsx
<ScrollAreaPrimitive.Root data-slot="scroll-area" className={cn("relative", className)} {...props}>
  <ScrollAreaPrimitive.Viewport
    data-slot="scroll-area-viewport"
    className="size-full rounded-[inherit] transition-[color,box-shadow] outline-none ...">
    {children}
  </ScrollAreaPrimitive.Viewport>
  <ScrollBar />
  <ScrollAreaPrimitive.Corner />
</ScrollAreaPrimitive.Root>
```

**Message bubble / citation card pattern** (`card.tsx` lines 5-21, 72-80) — use `Card` + `CardContent` for an assistant turn; render KB-chunk-ID citations (D-09) as `CardFooter`/badges:
```tsx
<Card data-slot="card" data-size="sm" className={cn("... rounded-xl bg-card ring-1 ring-foreground/10 ...", className)}>
  <CardContent data-slot="card-content" className={cn("px-4 ...", className)} />
</Card>
```

**Why this analog:** there is no existing message-list, but `ScrollArea` + `Card` are the exact primitives shadcn intends for a scrollable, bubbled feed. Compose, do not re-import shadcn.

---

#### `app/[lang]/(chat)/chat-input.tsx` (UI component, client, request-response)

**Analogs:** `components/ui/textarea.tsx` (the composer) + `components/ui/button.tsx` (send).

**Composer pattern** (`textarea.tsx` lines 5-16) — note `field-sizing-content` (auto-grow) and `text-base md:text-sm` (mobile-readable):
```tsx
<textarea
  data-slot="textarea"
  className={cn(
    "flex field-sizing-content min-h-16 w-full rounded-lg border border-input bg-transparent px-2.5 py-2 text-base ... focus-visible:ring-3 focus-visible:ring-ring/50 ... md:text-sm ...",
    className
  )}
  {...props}
/>
```

**Send button pattern** (`button.tsx` lines 44-65) — `data-slot`/`data-variant`/`data-size` + `cva`; use `size="icon"` for a mobile send affordance:
```tsx
<Comp data-slot="button" data-variant={variant} data-size={size}
      className={cn(buttonVariants({ variant, size, className }))} {...props} />
```

**Client-island note:** this is the `"use client"` leaf that holds the AI SDK `useChat()` hook (RESEARCH §Pattern 1 diagram, line 175). Keep the page a thin server shell; the input + message-list are the client islands.

---

#### `app/[lang]/(chat)/page.tsx` (chat shell — page, partial analog)

**Structural start:** scaffold `app/page.tsx` — copy ONLY the *shape* (default-exported component, `@/` imports, Tailwind flex layout `flex flex-col flex-1`). Discard the marketing content entirely.

**Mobile-first hook** (`hooks/use-mobile.ts` lines 5-19) — reuse verbatim for responsive layout:
```ts
import { useIsMobile } from "@/hooks/use-mobile"  // 768px breakpoint matchMedia
```

**Toast wiring** (`components/ui/sonner.tsx` lines 7-49) — mount `<Toaster/>` (in `app/layout.tsx`) and call `toast()` to surface the KB-miss handoff signal (D-10) and ingestion progress.

**No real analog for the streaming/auth wiring** — follow RESEARCH §Pattern 1 (the `useChat()` → `POST /api/chat` + Bearer ID-token flow, lines 173-194).

---

#### `app/[lang]/(admin)/kb/page.tsx` + `kb-doc-form.tsx` (KB CRUD form — EXACT analog)

**Analog:** `components/ui/field.tsx` — this vendored component is purpose-built for exactly this minimal authenticated CRUD form (D-10). Use it as the form skeleton; this is the strongest analog in the whole phase.

**Form field pattern** (`field.tsx` lines 41-52, 72-86, 101-116, 176-225):
```tsx
import { Field, FieldGroup, FieldLabel, FieldDescription, FieldError } from "@/components/ui/field"

<FieldGroup>                                    {/* lines 41-52: vertical gap-5 container */}
  <Field orientation="vertical">                {/* lines 72-86: data-invalid → text-destructive */}
    <FieldLabel htmlFor="title">Title</FieldLabel>
    <Input id="title" name="title" />           {/* @/components/ui/input */}
    <FieldDescription>KB document title</FieldDescription>
    <FieldError errors={errors.title} />         {/* lines 176-225: renders Zod issue messages */}
  </Field>
  <Field>
    <FieldLabel htmlFor="content">Content</FieldLabel>
    <Textarea id="content" name="content" />     {/* @/components/ui/textarea */}
  </Field>
</FieldGroup>
```

**Container:** wrap in `Card`/`CardHeader`/`CardContent`/`CardFooter` (`card.tsx`) — `CardFooter` (lines 82-92) for the submit/cancel button row.

**`FieldError` consumes Zod** (lines 176-209): it accepts `errors?: Array<{ message?: string }>` — pair it directly with the `zod ^4` schema added in Phase 1. No hand-rolled validation display.

**Mutation flow:** the CRUD form submits via a **Server Action** (not a Route Handler — RESEARCH §Pattern 1: "Route Handler for streams, Server Action for mutations"). Ingestion of an attached PDF goes through the chunked-poll loop, NOT inline.

---

### Tier B — Next.js structural files (scaffold = structural start; spec = RESEARCH/docs)

#### `proxy.ts` (config — NO analog, net-new at repo root)

**No analog.** This file does not exist and `middleware.ts` must NOT be used (Next.js 16 renamed Middleware→Proxy). Copy the verified shape from **RESEARCH §Pattern 2** (lines 269-289), source `node_modules/next/dist/docs/01-app/01-getting-started/16-proxy.md`:
```ts
// proxy.ts (root, same level as app/)
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl
  const locales = ['en', 'ms', 'zh']
  const hasLocale = locales.some(l => pathname.startsWith(`/${l}/`) || pathname === `/${l}`)
  if (!hasLocale) {
    request.nextUrl.pathname = `/${detectLocale(request)}${pathname}`
    return NextResponse.redirect(request.nextUrl)
  }
  return NextResponse.next()
}
export const config = { matcher: ['/((?!_next|api).*)'] }
```
**OPEN (Q2):** confirm whether `next-intl ^4` integrates via `proxy.ts` or still emits `middleware.ts` under Next.js 16 before locking. Reconcile with the project "proxy.ts not middleware.ts" rule.

---

#### `app/layout.tsx` (MODIFY — structural analog = itself)

**This is the one true modify-in-place file.** Current state (lines 20-33) is the structural start:
```tsx
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
```
**Changes to make** (keep the font wiring + `h-full`/`flex flex-col` body):
- Replace the hard-coded `<html lang="en">` with the `[lang]` param (locale becomes dynamic).
- Add `NextIntlClientProvider` (RESEARCH §Structure, line 218).
- Mount `<Toaster/>` from `@/components/ui/sonner`.
- Replace `metadata` "Create Next App" placeholder (lines 15-18) with real app metadata.

---

#### `app/api/chat/route.ts` (route handler, SSE — NO analog)

**No analog.** Copy the verified shape from **RESEARCH §Pattern 1** (lines 240-266), verified against `node_modules/next/dist/docs/.../15-route-handlers.md` + `streaming.md`. Load-bearing details:
- Node runtime, `export const maxDuration = 90`.
- `requireUser(req)` → `adminAuth.verifyIdToken()` HARD gate **before** anything else.
- `ratelimit.check(uid,'chat')` before any token spend.
- `router.route(messages)` → `'coach'` (heuristic; LLM seam dormant — D-03/FND-06).
- `streamText({ model: modelFor('coach'), ... })` — model id from Remote Config.
- `onFinish` → `memory.appendMessage` + `after(() => audit.log(...))` (append-only, hashes-only).
- **Headers are load-bearing:** `'Cache-Control': 'no-store'`, `'X-Accel-Buffering': 'no'`.
- **OPEN (Q1):** `toUIMessageStreamResponse` (v6) vs `toDataStreamResponse` (v5) — resolve in SPIKE-AI-SDK; use the exact name for the pinned `ai` major.

---

#### `app/api/jobs/stall-detect/route.ts` (route handler, cron — NO analog)

**No analog.** Copy from **RESEARCH §Code Examples "QStash signed cron callback"** (lines 429-440), verified against QStash Next.js docs:
```ts
import { verifySignatureAppRouter } from '@upstash/qstash/nextjs'
async function handler(req: Request) {
  const stalled = await escalation.findStalled({ days: 2 })   // runs as service account
  for (const s of stalled) await escalation.emitHandoffSignal(s)
  await writeHeartbeat('stall-detect')                        // watchdog reads this
  return Response.json({ processed: stalled.length })
}
export const POST = verifySignatureAppRouter(handler)
```
Reject unsigned requests; write a heartbeat (Pitfall F). SPIKE-CRON gates this; GH Actions is the fallback (D-05).

---

#### `app/api/kb/ingest/process/route.ts` (route handler, chunked-poll — NO analog)

**No analog.** Follow TSD §3.4 (chunked, client-driven, idempotent via sha256, resumable) + RESEARCH §Arch-Responsibility-Map (KB-ingestion row, line 100). **Anti-pattern to avoid:** never embed a large PDF in one request or inside `after()` (Cloud Run timeout trap — RESEARCH §Anti-Patterns line 307).

---

#### `firestore.rules` (security config — NO analog)

**No analog.** Copy the deny-by-default sketch from **RESEARCH §Code Examples "Custom claims + deny-by-default rule sketch"** (lines 443-457) + TSD §5.2 (lines 180-188):
```js
match /agentProfiles/{uid} {
  allow read: if isSelf(uid)
           || (hasRole('senior-coach') && resource.data.seniorCoachId == request.auth.uid && sameTenant())
           || (hasRole('admin') && sameTenant());
  allow write: if isSelf(uid) || (hasRole('admin') && sameTenant());
}
match /auditLogs/{id} { allow create: if false; allow read: if hasRole('admin') && sameTenant(); }
```
**Avoid Pitfall B:** never `if request.auth != null`. Every collection × all 3 roles must have a corresponding `@firebase/rules-unit-testing` test (D-11).

---

### Tier C — `src/` core modules (NO analog — follow TSD §3.2 + RESEARCH Code Examples)

> **All Tier-C files are net-new with no in-repo analog.** The repo has no `src/` directory. For each, the planner must follow the cited TSD/RESEARCH spec, NOT a fabricated codebase pattern. The two files that have a concrete code template in RESEARCH are flagged.

#### `src/firebase/{admin,client,collections}.ts` (data-plane init — NO analog)
**Spec:** TSD §3.2 `firebase` row (line 97) + §4. `collections.ts` defines typed collection refs as the **single source of truth** that injects `tenantId: "d2"` on every write (TSD §4 line 141). `admin.ts` exports `adminDb`, `adminAuth`, `remoteConfig` (consumed by `rag/search.ts` and `llm/provider.ts`). **First file built — every other `src/` module imports from here.**

#### `src/llm/{provider,fake,types,index}.ts` (model abstraction — TEMPLATE in RESEARCH)
**Spec + template:** RESEARCH §Code Examples "llm/ abstraction + fake provider" (lines 415-426):
```ts
export function modelFor(pillar: 'coach'|'finder'|'reply'|'router'|'grader') {
  const id = remoteConfig().getString(`model.${pillar}.default`)  // NEVER hard-code
  return anthropic(id)               // swap provider → call sites unchanged (QUAL-01)
}
```
`fake.ts` = deterministic test double keyed by matcher (systemContains / lastUserMessage / callCounter). This is the prerequisite for ALL agent/router unit tests (RESEARCH §Wave-0 Gaps). FND-02 + QUAL-01.

#### `src/rag/{embed,search,citations,index}.ts` (RAG adapter — TEMPLATE in RESEARCH)
**Spec + template:** RESEARCH §Code Examples "Firestore vector retrieval" (lines 384-402):
```ts
const snap = await adminDb.collection('kbChunks')
  .where('lang', 'in', [userLang, 'en'])          // cross-lingual fallback; REQUIRES composite vector index
  .findNearest({ vectorField: 'embedding', queryVector: FieldValue.vector(q),
                 limit: 8, distanceMeasure: 'DOT_PRODUCT' })
  .get()
return snap.docs.map(d => ({ chunkId: d.id, ...d.data() }))   // chunkId = citation source
```
Adapter shape (Firestore default | Pinecone fallback — D-05). Voyage `voyage-3-large` 1024-d, normalized. SPIKE-RAG gates this. FND-03.

#### `src/router/{heuristic,classifier,index}.ts` (intent router — NO analog)
**Spec:** TSD §3.2 `router` row (line 110); D-03/D-06/FND-06. Phase 1 = heuristic-only, **always routes to Coach**. `classifier.ts` exists as a **dormant seam** (activates Phase 3). Pure logic, framework-free, unit-testable.

#### `src/agents/coach/{prompt,tools,schema,index}.ts` (Coach agent — NO analog)
**Spec:** TSD §6 + D-09. Minimal-but-extensible: thin scoped system prompt + ONE read-only tool (`retrieveKnowledge` → `rag.retrieve`) + **real KB-chunk-ID citations** + Zod output schema. Tools are read-only and authenticate **as the user** (CLAUDE.md). Invoked through the router, never directly. Design for Phase-2 extension (not throwaway).

#### `src/memory/{conversation,leadContext,agentProfile,index}.ts` (repository — NO analog)
**Spec:** TSD §3.2 `memory` row + §4 + RESEARCH §Pattern 4 (lines 296-298). Messages → **subcollection** `conversations/{cid}/messages/{mid}` (NEVER inline array — Pitfall E). `leadContext/{leadId}` = shared doc with agent-scoped write slots (`coachSlot`/`finderSlot`/`replySlot`) + rolling summary. Phase 1 wires the Coach slot only. FND-04/FND-05.

#### `src/kb/{ingest/{chunker,pdf,pipeline},crud,index}.ts` (ingestion pipeline — NO analog)
**Spec:** TSD §3.2 `kb` row + §3.4 + D-10. Multi-doc-capable data model + minimal CRUD; chunked ingestion proven on one small EN doc (SPIKE-INGEST). `pdfjs-dist` (PDF), `mammoth` (DOCX), `gpt-tokenizer` (chunk sizing) — RESEARCH §Don't-Hand-Roll. FND-08.

#### `src/escalation/{detect,handoff,index}.ts` (escalation logic — NO analog)
**Spec:** TSD §3.2 `escalation` row + D-10. `detect.ts` (stall detection, called by the cron) + `handoff.ts` (emit handoff signal on KB-miss / stall). Thin receiving side in Phase 1 (full senior-coach dashboard = Phase 2).

#### `src/audit/{log,pdpa}.ts` (audit + PDPA boundary — NO analog)
**Spec:** TSD §5.3 + RESEARCH §Pitfall A (lines 347-351). `log.ts` = append-only writer via `after()`, **hashes only, never raw PII** (create-only rule). `pdpa.ts` = boundary pseudonymization (names → `<LEAD_ID:…>`, phones → `<PHONE_HASH>`) + the `pdpa_redacted:true` gate that **refuses unredacted production model calls**. Fully implemented + unit-tested in Phase 1 even on synthetic data (Claude's-discretion default). FND-09/FND-11/QUAL-03/QUAL-05.

#### `src/ratelimit/{window,index}.ts` (rate limiter — NO analog)
**Spec:** TSD §3.2 `ratelimit` row + §9 + D-02. Real per-agent token + request decrement; refuse runaway conversations **before** the LLM call (RESEARCH §Arch-Map rate-limiting row). QUAL-07.

#### `src/i18n/{request,routing,detect}.ts` + `messages/{en,ms,zh}.json` (i18n — NO analog)
**Spec:** TSD §7 + D-08. All three `next-intl ^4` catalogs from day 1; `detect.ts` = per-message `franc-min` language detection. Proof slice copy is EN; machinery is trilingual. **OPEN (Q2):** next-intl v4 routing-file convention under Next.js 16.

---

## Shared Patterns

### Class merging (`cn`) — apply to ALL Tier-A UI files
**Source:** `lib/utils.ts` lines 1-6
```ts
import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
export function cn(...inputs: ClassValue[]) { return twMerge(clsx(inputs)) }
```
Every UI component composes classNames via `cn(...)`. Import as `import { cn } from "@/lib/utils"`.

### shadcn component idiom — apply to ALL new UI components
**Source:** `components/ui/button.tsx` (lines 44-65), `card.tsx` (lines 5-21)
- Type props as `React.ComponentProps<"el">` (or `typeof Primitive`).
- Add a `data-slot="..."` attribute for styling hooks.
- Use `cva` + `VariantProps` for variant systems (see `buttonVariants` lines 7-42).
- Named exports only (no default export for components).
- `"use client"` ONLY on interactive leaves (see `scroll-area.tsx` line 1, `field.tsx` line 1) — omit it on render-only server components.

### Auth gate — apply to ALL Route Handlers + privileged Server Actions
**Source:** RESEARCH §Pattern 1 (line 247) + §Arch-Responsibility-Map (auth row, line 95). **No in-repo analog (no auth code exists yet).**
```ts
const uid = await requireUser(req)   // adminAuth.verifyIdToken() — HARD gate, every privileged call
```
Never trust a client claim; Security Rules are the second hard boundary (defense-in-depth, TSD §5.2).

### PDPA boundary gate — apply to EVERY outbound model call
**Source:** `src/audit/pdpa.ts` (net-new) + TSD §5.3 + RESEARCH §Pitfall A. Pseudonymize context → assert `pdpa_redacted === true` before the prompt leaves the server (RESEARCH §Pattern 1 diagram line 184). Audit stores hashes only.

### Toasts for signals — apply to handoff/escalation + ingestion status
**Source:** `components/ui/sonner.tsx` lines 7-49 (vendored `<Toaster>` with themed icons). Use `toast.success/info/warning/error()` from `sonner` — do not hand-roll notifications.

---

## No Analog Found

All of the following are net-new with no in-repo analog. This is expected for a greenfield core — the planner should use the cited TSD/RESEARCH spec, NOT invent a codebase pattern.

| File / group | Role | Data Flow | Reason |
|--------------|------|-----------|--------|
| `proxy.ts` | config | request-response | No `proxy.ts`/`middleware.ts` exists; Next.js 16 convention (RESEARCH §Pattern 2) |
| `app/api/chat/route.ts` | route handler | streaming | No `app/api/` exists; spec = RESEARCH §Pattern 1 |
| `app/api/kb/ingest/process/route.ts` | route handler | batch | No ingestion code; spec = TSD §3.4 |
| `app/api/jobs/stall-detect/route.ts` | route handler | event-driven | No cron code; spec = RESEARCH QStash example |
| `src/firebase/*` | core | — | No Firebase wiring; spec = TSD §3.2/§4 |
| `src/llm/*` | core | streaming | No AI code; **template in RESEARCH §Code Examples** |
| `src/rag/*` | core | KNN | No RAG code; **template in RESEARCH §Code Examples** |
| `src/router/*` | core | transform | No router; spec = TSD §3.2 |
| `src/agents/coach/*` | core | request-response | No agent; spec = TSD §6 + D-09 |
| `src/memory/*` | core | CRUD | No memory layer; spec = TSD §4 + RESEARCH §Pattern 4 |
| `src/kb/*` | core | file-I/O | No KB layer; spec = TSD §3.4 + D-10 |
| `src/escalation/*` | core | event-driven | No escalation; spec = TSD §3.2 + D-10 |
| `src/audit/*` | core | append-only | No audit/PDPA code; spec = TSD §5.3 + Pitfall A |
| `src/ratelimit/*` | core | transform | No ratelimit; spec = TSD §9 |
| `src/i18n/*` + `messages/*.json` | core | — | No i18n; spec = TSD §7 |
| `firestore.rules` + rules tests | config | — | No rules; spec = RESEARCH deny-by-default sketch |
| `apphosting.yaml` | config | — | No deploy config; spec = TSD §10 |
| `vitest/playwright/promptfoo` configs | config | — | No test infra; spec = RESEARCH §Validation Architecture |
| `evals/` config + trilingual fixture | config | — | No evals; spec = TSD §8 + D-03 |

---

## Metadata

**Analog search scope:** `app/` (4 files), `components/ui/` (55 components — sampled the 6 relevant: button, card, field, scroll-area, textarea, sonner), `lib/` (utils.ts), `hooks/` (use-mobile.ts), root configs (tsconfig, components.json, package.json). Confirmed **no `src/` directory exists**.
**Files scanned:** 14 (4 app + 6 shadcn + utils + use-mobile + tsconfig + components.json + package.json).
**Greenfield finding:** the only reusable in-repo pattern source is the vendored shadcn library + the `@/` alias + `cn()` convention. 29 of 38 target files are net-new core/config with no analog — mapped to TSD §3.2/§4/§5 + RESEARCH Code Examples/Patterns rather than a forced codebase analog.
**Pattern extraction date:** 2026-05-31
```
