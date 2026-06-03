# Claim: quick-kayinleong-002

- owner: kayinleong
- session: claude-code
- branch: phase-kayinleong-01
- started: 2026-06-03
- status: done
- summary: Post-Phase-3 dashboard/access UX hardening — role-based routing + sidebar nav, KB document explorer for the coach correction flow (no raw doc-ID entry), and a meaningful stall alert that opens the agent's chat history.

## What will change

Access matrix (user-confirmed "Coach keeps dashboard"):
- **new-agent** → chat only (everything else redirects to chat)
- **senior-coach** → Dashboard + Chat
- **admin** → Dashboard + KB + Inventory + Chat
- Post-login landing: agent → chat, coach/admin → dashboard.

Four feature areas:
1. **Role routing + sidebar.** Role-aware landing redirect (`app/[lang]/page.tsx`) + post-sign-in redirect. Route-group layout gates: `(coach)/layout.tsx` (senior-coach|admin), new `(admin)/layout.tsx` (admin only). New role-filtered `AppSidebar` (uses the vendored `components/ui/sidebar.tsx`) rendered on the dashboard/kb/inventory console surfaces, linking Dashboard / KB / Inventory / Chat per role.
2. **KB document explorer (correction flow).** New read-only KB list (`listDocsForReview`, gated senior-coach|admin) + dashboard server action + a `kb-doc-explorer` client component (searchable table: title/lang/pillar/version/status) with a per-row "Correct" trigger that pre-fills the correction dialog — removing the raw KB-document-ID input business users don't understand. The full `/kb` admin page stays admin-only.
3. **Stall alert → chat history.** Make alerts informative (friendly reason + relative time + contextBundle summary snippet) and clickable: a `getAgentChatHistory(agentUid)` server action (gated senior-coach|admin, downline-scoped, audited) fetches the agent's coach-pillar training thread; clicking an alert opens a dialog showing that chat history.

PDPA: chat-history view is scoped to the **coach pillar** training thread (agent↔AI Q&A, not client PII), downline-scoped + `auditDrilldown`-logged. Honors the no-Cloud-Functions / model-from-Remote-Config / read-only-as-user constraints.

## What has changed

**1. Role routing + sidebar**
- `app/[lang]/page.tsx` — role-aware landing (session → coach/admin to dashboard, new-agent to chat; else sign-in). Redirects are OUTSIDE the try/catch (a `redirect()` thrown inside catch would be swallowed).
- `app/[lang]/(auth)/sign-in/sign-in-form.tsx` — admin now lands on `/dashboard` (was `/kb`); coach/admin → dashboard, new-agent → chat.
- `app/[lang]/(coach)/layout.tsx` — now an async RSC gate (senior-coach|admin else → chat; no session → sign-in) wrapping `ConsoleShell`.
- `app/[lang]/(admin)/layout.tsx` — NEW async RSC gate (admin only; senior-coach → dashboard; new-agent → chat) wrapping `ConsoleShell`.
- `app/[lang]/_components/app-sidebar.tsx` — NEW role-filtered nav (vendored shadcn sidebar). `import type { Role }` keeps server-only auth.ts out of the client bundle.
- `app/[lang]/_components/console-shell.tsx` — NEW SidebarProvider + AppSidebar + SidebarInset + mobile trigger.
- i18n: `nav.dashboard`/`nav.console`/`nav.signedInAs` added to en/ms/zh.

**2. KB document explorer (correction flow)**
- `src/kb/crud.ts` — NEW `listDocsForReview(user)` (gated `assertAdminOrCoach`, read-only, excludes superseded).
- `app/[lang]/(coach)/dashboard/actions.ts` — NEW `listKbDocsForCorrection()` server action returning lightweight doc metadata.
- `app/[lang]/(coach)/_components/kb-doc-explorer.tsx` — NEW searchable table (title/lang/pillar/version/status) with a per-row "Correct" trigger.
- `inline-correction-dialog.tsx` — refactored from self-triggering + raw `docId` text input → controlled (`doc`/`onClose`); shows the selected document's title instead of a Firestore ID. Only consumer was the dashboard page.
- `dashboard/page.tsx` — correction section now renders `<KbDocExplorer>`.
- i18n: `kbExplorer*` + `correctionSelectedDoc` keys (en/ms/zh).

**3. Stall alert → chat history**
- `app/[lang]/(coach)/dashboard/actions.ts` — NEW `getAgentChatHistory(agentUid)`: gated senior-coach|admin, downline-scoped (non-admin verified via `agentProfiles.seniorCoachId === uid`, AUTH-06), `auditDrilldown`-logged, reads ONLY the coach-pillar thread `coach-${agentUid}` (training Q&A, no client PII).
- `stall-inbox.tsx` — rewritten: plain-language reason + relative time + agent ref; "View chat" opens a dialog rendering the agent's recent AI-Coach conversation. Resolve flow preserved.
- i18n: `viewChat`, `reasonKbMiss`/`reasonStall`, `chatHistory*`, `role*` keys (en/ms/zh).

## Verification

**Access matrix (user-confirmed):** new-agent → chat only; senior-coach → Dashboard + Chat; admin → Dashboard + KB + Inventory + Chat. Login lands: agent→chat, coach/admin→dashboard.

**Gates:**
- `npx tsc --noEmit` → exit 0 (clean).
- `npm run lint` → 0 errors (54 pre-existing warnings, all in test files / other files; none in the new/edited files — verified by grep). Fixed one new `set-state-in-effect` error by using the canonical `ignore`-guarded effect.
- `npx vitest run` → 455 passed / 97 skipped / 0 failed (unchanged from pre-change baseline).

**Security / PDPA self-audit:**
- All new server actions read role from the verified `__session` token (T-02-31), never from args.
- `getAgentChatHistory` enforces AUTH-06 downline scope for non-admins, audits the drill-down, and is scoped to the coach-pillar training thread — it cannot reach Finder/Reply (client-PII) conversations.
- `listDocsForReview`/`listKbDocsForCorrection` are read-only metadata, gated senior-coach|admin; the admin-only `/kb` management surface is unchanged (still `assertAdmin` + `(admin)` layout gate).
- New client components import `Role` as `import type` only → no server-only code (firebase-admin) leaks into the client bundle.

**Regression surface — ruled out:**
- Core/shell rule intact: no `src/ → app/` imports introduced (grep-confirmed).
- `InlineCorrectionDialog` API change: only consumer was `dashboard/page.tsx` (grep-confirmed); no test imports it.
- Existing actions (`resolveStall`, `submitCorrection`) and `listDocs`/`correctKbDoc` unchanged; new exports are additive.
- Route loops checked: senior-coach `/kb`→`/dashboard` (renders); new-agent any console→`/chat`; admin all→render. No redirect loops.
- 'use server' file exports only async functions + erased type interfaces (matches the existing pattern).
- i18n: all three message files validated as parseable JSON; only additive keys + two copy edits (`correctionDialogDescription`); no keys removed.

**NOT verified (stated honestly):** I could not exercise the live UI in a browser — this environment has no Firebase credentials / populated `.env.local`, and sign-in requires real Firebase Auth users. Code-level gates pass, but the user should click through: (a) sign in as each role and confirm the landing + sidebar link set; (b) on the dashboard, browse the KB explorer and run a correction without typing an ID; (c) click "View chat" on a stall alert and confirm the agent's chat history loads. NOT pushed (standing user hold).
