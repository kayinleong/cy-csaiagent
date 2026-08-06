# Claim: quick-kayinleong-045
- owner: kayinleong
- session: claude-code
- branch: quick-kayinleong-045-whatsapp-ingest
- started: 2026-08-06
- status: in-progress
- summary: Admin page to ingest a WhatsApp group-chat export (.zip). Browser parses the zip (JSZip), an AI Server Action matches the conversation to an existing inventory project (or proposes a new one), the chat text is ingested into the KB, and media uploads to Firebase Storage as collateral. BUILD ONLY — no live ingestion is executed in this claim.

## What will change
- New admin page `app/[lang]/(admin)/whatsapp-import/` (Server Component + client component): drag-drop zip → in-browser JSZip parse → show detected group + counts → AI project decision (confirm) → ingest.
- New Server Action(s): classify chat → match existing inventory project or propose new (modelFor); trigger KB ingest of the chat text; attach media as collateral.
- Reuse existing KB ingest pipeline (createDoc → /api/kb/ingest/process poll) for the chat text; attachCollateral for media (Firebase Storage storagePath).
- Firebase Storage security rule for admin media uploads; EN/BM/ZH i18n copy; types.

## What has changed
- _(filled as work completes)_

## Verification
- Build-only: `npm run typecheck` + `npm run build` must pass. AI-matching + live ingest are NOT executed here (the app's Anthropic account is out of credits; runtime ingest is deferred to the operator). Regression report before done.
