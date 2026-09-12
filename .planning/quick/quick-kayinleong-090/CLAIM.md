# Claim: quick-kayinleong-090
- owner: kayinleong
- session: claude-code
- branch: main
- started: 2026-09-12
- summary: admin-editable "Priority List" prompt injected into Coach/Finder recommendation ordering, plus a two-format contract for the Finder (table for recommendations, full fact-sheet for a single property, no AI summarization)
- status: claimed

## What will change

Two tasks, one claim — they share the Finder prompt surface, so splitting them would mean
two conflicting edits to the same system prompt.

### Task 1 — Priority List (admin surface → Firestore → agent prompt)

A free-text prompt an admin types in the admin dashboard, persisted to Firestore, and
injected into the Coach/Finder system prompt so property recommendations follow the
admin's stated ordering for the area the user asked about.

### Task 2 — Finder answers in exactly two formats

1. **Recommendations / plural ask → markdown table only.**
2. **Single-property ask → the fact-sheet layout** defined by the user's attached
   `Fact + Layout + Reason summary (Royal Suites).docx`, captured verbatim in
   `FORMAT-CONTRACT.md` in this directory.

Plus: **no AI summarization of property data** — stored detail is emitted in full, not
condensed.

## What has changed

_(pending)_

## Verification

_(pending)_
