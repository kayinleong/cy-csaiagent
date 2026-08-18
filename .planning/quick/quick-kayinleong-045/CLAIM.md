# Claim: quick-kayinleong-045
- owner: kayinleong
- session: claude-code
- branch: quick-kayinleong-045-whatsapp-ingest
- started: 2026-08-06
- status: done
- summary: Admin page to ingest a WhatsApp group-chat export (.zip). Browser parses the zip (JSZip), an AI Server Action matches the conversation to an existing inventory project (or proposes a new one), the chat text is ingested into the KB, and media uploads to Firebase Storage as collateral. BUILD ONLY — no live ingestion is executed in this claim.

## What will change
- New admin page `app/[lang]/(admin)/whatsapp-import/` (Server Component + client component): drag-drop zip → in-browser JSZip parse → show detected group + counts → AI project decision (confirm) → ingest.
- New Server Action(s): classify chat → match existing inventory project or propose new (modelFor); trigger KB ingest of the chat text; attach media as collateral.
- Reuse existing KB ingest pipeline (createDoc → /api/kb/ingest/process poll) for the chat text; attachCollateral for media (Firebase Storage storagePath).
- Firebase Storage security rule for admin media uploads; EN/BM/ZH i18n copy; types.

## What has changed
- `src/whatsapp/parse.ts` — portable WhatsApp-export parser (Android format; system-line strip, multi-line fold, 3 media-ref forms) + `toTranscript` / `toClassificationSample`. **New.**
- `src/whatsapp/parse.test.ts` — 8 unit tests over a synthetic transcript (no PII). **New.**
- `app/[lang]/(admin)/whatsapp-import/actions.ts` — `classifyWhatsAppProjectAction` (admin-gated; `modelFor('finder')` + `generateObject`; matches an existing project or proposes a new one) + `listProjectOptionsAction`. **New.**
- `app/[lang]/(admin)/whatsapp-import/page.tsx` — RSC shell (`requireRole` admin gate + `listProjects` seed). **New.**
- `app/[lang]/(admin)/whatsapp-import/whatsapp-import-form.tsx` — client island: in-browser JSZip parse → classify → confirm/override → ingest (createProject HIDDEN for new + createKbDoc + poll `/api/kb/ingest/process` + upload media to Storage + attachCollateral), with progress UI. **New.**
- `src/firebase/client.ts` — added `clientStorage` (`getStorage`) export. **Modified (additive).**
- `storage.rules` — **created** (firebase.json already referenced it; file was missing). Admin-only write to `collateral/**` (≤200 MB), signed-in read, deny-all catch-all.
- `src/i18n/messages/{en,ms,zh}.json` — new `adminWhatsapp` namespace (53 keys ×3) + `nav.whatsappImport`. **Modified (additive; parity held).**
- `app/[lang]/_components/app-sidebar-nav.ts` — new admin-only `whatsappImport` nav item under Knowledge Management. **Modified (additive).**

BUILD ONLY — no live ingestion was executed (no createDoc/embed/Storage write ran against Firebase; no Claude/Gemini call made).

## Verification
**Gates (all green):**
- `npm run typecheck` — clean (tsc --noEmit).
- `npm run build` — succeeds; `/[lang]/whatsapp-import` route registered (ƒ dynamic).
- `npx vitest run` on `src/whatsapp/parse.test.ts` (8), `src/i18n/__tests__/i18n-parity.test.ts` (6), `app/[lang]/_components/app-sidebar-nav.test.ts` (13) — 27 passed.

**Regression surface + self-audit:**
- **i18n parity** — most likely break; adding keys to one catalog only would fail CI. Added identical `adminWhatsapp` (53) + `nav.whatsappImport` to en/ms/zh; parity test green.
- **Sidebar nav** — the new item is `roles: ['admin']`, placed under Knowledge. Verified `app-sidebar.tsx` renders `item.icon` directly + `t(item.key)` (no separate icon map to extend); label present in all 3 catalogs. Nav test asserts section-key order + per-role `toContain`/`not.toContain` on named keys — none reference the new key; read-only/senior-coach visibility unaffected (admin-only). Green.
- **`src/firebase/client.ts`** — additive `clientStorage` export only (diff verified); existing `clientAuth`/`clientDb` consumers untouched. Bucket already in `firebaseConfig`.
- **`storage.rules`** — net-new; the deploy previously had no storage rules file at all (firebase.json pointed at a missing path). Mirrors the Firestore custom-claim model. Does not affect app runtime, only Storage deploy.
- **New route/actions** — all under a net-new folder; no existing file's behavior changed. Every mutation routes through existing admin-gated Server Actions (createProjectAction / createKbDocAction / attachCollateralAction) — no new privileged surface; three independent admin gates preserved.

**Deferred to operator (runtime, out of scope for build-only):** the AI classify call needs Anthropic credits (currently exhausted); live KB ingest + Storage upload need a signed-in admin session. New projects are created **hidden** so a $0/blank placeholder can never be recommended by Finder until enriched + activated.

Status: **done** (build-only scope).

## Operational addendum (post-build runtime bring-up)
The operator subsequently ran the feature against live Firebase, surfacing runtime fixes + infra provisioning (all committed on this branch):
- **i18n interpolation** — `t(key).replace('{x}', …)` rendered raw key paths (no custom next-intl error handler → missing-arg fallback). Switched to native `t(key, { …args })`. (commit 0850821)
- **Media step UX + robustness** — real status (pending/running/done/error), current-file display, bar advances on `done+errors`, per-file 30 s timeout, fail-fast after 5 consecutive failures, KB success decoupled from media. (commit ce3af01)
- **Storage provisioning** (see `docs/operations/README.md` → *Cloud Storage*):
  - `storage.rules` deployed to `cy-csaiagent` (`firebase deploy --only storage`).
  - Default bucket `cy-csaiagent.firebasestorage.app` was created in **US-EAST1** (not `asia-southeast1`) — permanent; **explicitly accepted by the owner** (PDPA/region deviation recorded).
  - Bucket had **no CORS** → browser uploads hung/timed out; applied `docs/operations/storage.cors.json` via `gsutil cors set`. Verified.
- Runtime status: KB ingest confirmed working (255 chunks on the sample export); media uploads unblocked once CORS was set.
