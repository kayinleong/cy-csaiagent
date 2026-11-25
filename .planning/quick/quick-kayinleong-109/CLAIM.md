# Claim: quick-kayinleong-109
- owner: kayinleong
- session: claude-code
- branch: quick-kayinleong-109 (from origin/main 01fa04c)
- started: 2026-11-25
- status: done
- summary: Tapping a Finder table row opens or closes its details dropdown, so a phone user does not have to scroll right to the Details button.

## What will change
- **Row tap.** A row that has server details toggles its dropdown when tapped anywhere on it. The Details button stays (keyboard and screen readers use it).
- **No double toggle.** A tap on the button, or on a link inside the row, is not counted twice.
- **Text selection.** Selecting text in a row does not toggle it.
- **Rows without details.** These are older saved turns. Tapping the row does nothing; their Details button keeps the AI turn.

## What has changed
- **Row tap** (`app/[lang]/chat/match-table.tsx`). A row with server details has `onClick`, `cursor-pointer` and `data-expandable`.
  - A tap toggles its dropdown through the same `toggleOpen`.
  - The tap is ignored:
    - when the target is inside a control (button, a, input, select, textarea, role=button);
    - while text is selected;
    - on a row without details.
  - The rule is the pure helper `rowClickToggles`.
- **Chevron cue.** A `ChevronRight` (lucide) sits before the name in the sticky name cell and turns 90° when the row is open. It is aria-hidden.
- **Details button.** Unchanged, with aria-expanded / aria-controls. It is the keyboard and screen-reader path.

## Verification
- **Tests:**
  - `rowClickToggles` truth table (4 cases).
  - A source check that the row handler skips control clicks.
  - A render check: a row with details is tappable and has the chevron; a row without has neither; nothing is open by default.
- **Interactive preview** (real `MatchList` bundled with esbuild, a real Finder run's output, built CSS, 375 px):
  - A bubbling click on the project name opens the dropdown, with the panel pinned at 16–359 px.
  - The Details button then closes it with no double toggle.
  - Button open → row tap close → row tap reopen all work.
  - The chevron's computed rotate is 90deg.
  - No AI call.
- **Checks:**
  - `vitest --maxWorkers=4`: 1859 passed. The Reply test timed out under load and passes alone (16/16). `finder-corpus-gates` needs the gitignored data, as before.
  - `tsc` clean, `eslint` 0 errors, `next build` OK.

## Regression report
- **Unchanged:** the Details button's behaviour and the fallback for older turns (existing tests).
- **Pagination:** the Paginator controls are outside the rows.
- **Name column:** keeps its full, wrapping name.
- **Highlight and location cells:** are plain text, so a tap there opens the row (intended).

## Known limitations
- **Not merged or deployed.**
- **Preview tool clicks.** The preview tool's own coordinate click missed in the scaled viewport; real bubbling click events were used instead.
