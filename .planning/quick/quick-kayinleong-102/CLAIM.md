# Claim: quick-kayinleong-102
- owner: kayinleong
- session: claude-code
- branch: quick-kayinleong-102
- started: 2026-10-28
- status: claimed
- summary: Finder projectDetail recovers when the model passes a project ID that doesn't exist (live run 4: P02/P09 "PDH: …" prompts answered "project doesn't exist"); record the run-4 live-site results workbook.

## What will change
- `src/agents/finder/tools.ts` — projectDetail's not-found path: resolve an unknown `projectId` to the real project by name (exact/normalized match) instead of returning not_found; when nothing resolves, return guidance telling the model to call searchProjects with the project name first.
- `src/agents/finder/prompt.ts` — if needed, one line saying projectDetail takes an ID from a tool result, never one built from the project name.
- Tests in `src/agents/finder/project-detail.test.ts`.
- `docs/UAT-Output-Test-Cases-RESULTS.xlsx` — run 4 (live site, 28 Oct 2026) results in the Client Sheet Field Check sheet.

## What has changed
(filled at close)

## Verification
(filled at close)
