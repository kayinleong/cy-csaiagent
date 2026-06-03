# Claim: quick-kayinleong-002

- owner: kayinleong
- session: claude-code
- branch: phase-kayinleong-01
- started: 2026-06-03
- status: in-progress
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

- [pending]

## Verification

- [pending]
