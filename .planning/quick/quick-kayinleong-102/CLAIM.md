# Claim: quick-kayinleong-102
- owner: kayinleong
- session: claude-code
- branch: quick-kayinleong-102
- started: 2026-10-28
- status: done
- summary: Finder projectDetail recovers when the model passes a project ID that doesn't exist (live run 4: P02/P09 "PDH: …" prompts answered "project doesn't exist"); record the run-4 live-site results workbook.

## What will change
- `src/agents/finder/tools.ts` — projectDetail's not-found path: resolve an unknown `projectId` to the real project by name (exact/normalized match) instead of returning not_found; when nothing resolves, return guidance telling the model to call searchProjects with the project name first.
- `src/agents/finder/prompt.ts` — if needed, one line saying projectDetail takes an ID from a tool result, never one built from the project name.
- Tests in `src/agents/finder/project-detail.test.ts`.
- `docs/UAT-Output-Test-Cases-RESULTS.xlsx` — run 4 (live site, 28 Oct 2026) results in the Client Sheet Field Check sheet.

## What has changed
- `src/inventory/search.ts` — new `projectNameKey` (lowercase letters and digits only) and `findProjectIdByName(names)`: one name-field read of `projects`, returns the ID of the ONE project whose name key equals one of the given names, else null. Equality only; status not filtered (same reason as `getProjectDetail`).
- `src/agents/finder/tools.ts` — `projectDetail`:
  - `projectId` is now optional and a new optional `projectName` is accepted.
  - On a missing or unknown ID it tries the exact name, and the given ID is tried too, because an invented ID is a slug of the name.
  - A found-by-name payload carries `resolvedByName` naming the real projectId.
  - A miss now tells the model to `searchProjects` by name before saying the project is not on record.
  - The tool description says the same.
- `src/agents/finder/prompt.ts` — with no ID and no search result, call projectDetail with `projectName` and never build an ID from a name; a `found:false` means search by name first; `resolvedByName` means answer normally.
- `src/agents/finder/project-detail.test.ts` — 8 tests in "projectDetail recovers a wrong or missing projectId by exact name"; the mock gains `projects.select`.
- `docs/UAT-Output-Test-Cases-RESULTS.xlsx` — run 4 (live site) results; the P02/P09 notes give the cause and the post-fix re-run.

Commits: de620f4 (fix), bacedbd (workbook).

## Verification
**Root cause.** For P02 and P09 the live model (claude-sonnet-4-6) called projectDetail with an ID it built from the name (`pdh-imperial-residences-ra`), with no search result in hand. projectDetail returned not_found, and the prompt then said "that ID does not exist, say so". Live Firestore has 90 projects and 90 distinct name keys, so no two collide. P02 is stored as "PDH: Imperial Residences RA". P09 is stored as "Pavilion Damansara Heights: Royal Suites(RC)", so an exact name can't find it and it depends on the search fallback.

**Tests.**
- `npx vitest run`: 1622 passed, 223 skipped.
  - 1 suite failed, and it was already failing: `tests/finder-corpus-gates.test.ts` needs the gitignored `projects.inventory.json`.
- The 8 new tests were run against the old code (stash): 6 fail, which shows they catch the bug.
  - The 2 that pass there are guards: a correct ID never reads by name, and a near name is a miss.
- `npx tsc --noEmit`: clean. `eslint` on the 4 changed files: clean.

**Real agent re-run.** P02 and P09, plus P08 and P46 as controls, went through the real Finder agent: the same system prompt, tools, step cap, output cap and PDPA redaction as the route, on claude-sonnet-4-6 (the live model). Results:

| Prompt | Path | Fields vs the Excel |
|---|---|---|
| P02 | `projectDetail{projectName}` → found | 7 of 8 stated fields match. H1A bedrooms: the answer says "3 + Studio (Dual Key)", the Excel says 4+1. |
| P09 | `projectDetail{projectName}` → miss → `searchProjects` → `projectDetail{projectId}` → found | All 11 stated fields match. |
| P08 | `projectDetail{projectName}` → found | Pass. |
| P46 | `projectDetail{projectName}` → found | Same as runs 3 and 4: total units 632 vs the Excel's 960, a known data question. |

**Live re-check (28 Oct).**
- Main was pushed at d23700c. The App Hosting rollout succeeded on both backends.
- P02 and P09 were re-asked in the deployed site's chat: Finder, a new conversation each, signed in as the admin test account. The answers were read back from Firestore and scored against the Excel.
- Both now find their project and answer in full, and every field they state matches the Excel:
  - P02: 8 of 8. H1A is "4+1 (Dual Key: 3 rooms + Studio)", matching the Excel.
  - P09: 11 of 11.
- The workbook's P02/P09 rows now hold this re-check (both Pass). The sheet reads 78 Pass, 1 Partial, 4 Fail.
- CI "Lint + Unit Tests + PII Scan" on d23700c fails with the same `no-explicit-any` lint errors, on the same lines, as 5d27801 before this claim. That failure was already there.

## Regression report
- **Details button (`projectId: <id>`).** The by-ID path is unchanged and comes first. A correct ID never triggers the name read (test). All 39 existing project-detail tests pass.
- **searchProjects / queryInventory.** Untouched. The `status:'active'` recommendation gate test passes.
- **getProjectDetail.** Unchanged. A blank ID with no name still reads nothing (existing test).
- **Substitution risk.** The name match is equality only. A near name (a prefix of a real name) is a miss (test), and a shared key resolves to neither (test).
- **Tool schema.** `projectId` is now optional. The real Claude run called the tool with `projectName` only (P02, P08, P46) and with both (P09). Nothing else reads projectDetail's input or output: route.ts only reads searchProjects output.
- **Behaviour change, deliberate.**
  - A "Full details for <name>" question now goes straight to projectDetail instead of searchProjects then projectDetail (run 3: 82 of 83 searched first).
  - Those answers no longer attach the full result table under the detail answer. Asking about one project still shows that project's details.
  - Each turn now uses about 14–21k tokens instead of about 45k, so the 300k/24h cap allows about 2 to 3 times as many detail turns.
- **PDPA.** `projectName` comes from the already-redacted message. Project names are not PII, and nothing new is logged.

## Known limitations
- P02 H1A bedrooms came from an older sales-kit extract instead of the fact sheet in this one sample. Run 3 had it right. This is not addressed here.
- A name that is neither the exact stored name nor found by searchProjects still ends as "not on record". By design, no fuzzy match.
