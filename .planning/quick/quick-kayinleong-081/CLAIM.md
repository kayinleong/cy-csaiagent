# Claim: quick-kayinleong-081
- owner: kayinleong
- session: claude-code
- branch: quick-kayinleong-045-whatsapp-ingest
- started: 2026-08-29
- status: done
- summary: the chat header is unusable at 375px — the pillar tabs clip mid-word to "ach" and "Find"

## What is wrong

Driven at a real 375x812 viewport, signed in as a real agent. The header reads:

    [history] [D2] [AI]  ach    Find  [Talk to my coach]  [signout]

The pillar selector — the primary control on this surface, and this is a mobile-first
product — is clipped to fragments.

The cause is `justify-center` on a container that is also `overflow-x-auto`. When the content
is wider than the box, centring clips BOTH ends, which is exactly the "ach" / "Find" pattern.
Left-aligned overflow would at least start at "Auto" and scroll.

Space at 375px: history 32 + logo 32 + AI badge ~28 + "Talk to my coach" ~135 + sign-out 32 +
padding ~24 leaves roughly 70px for four tabs that need ~210.

Planned: left-align the overflow below `sm`, make "Talk to my coach" icon-only on mobile the
way sign-out already is, and tighten tab padding. Keep the AI badge — CHAT-05 requires it to
be persistent.

## What has changed

**`chat-header.tsx`**
- `justify-start … sm:justify-center` on the tab strip. This was the actual bug: centring an
  `overflow-x-auto` container clips BOTH ends, which is why it read "ach … Find".
- `min-w-0` on that flex item so it can shrink and form a scroll box instead of pushing the
  header wider.
- Tab padding `px-2 sm:px-3`.
- "Talk to my coach" is icon-only below `sm`, the same treatment sign-out already had, with
  `aria-label` + `title` carrying the meaning.
- The decorative D2 logo mark is hidden below `sm`. It is `aria-hidden` and the wordmark
  beside it was already hidden, so it was 40px of branding taken from the primary control.
  **The AI badge stays** — CHAT-05 requires that to be persistent, so the decoration was the
  thing to drop, not the disclosure.

**`conversation-list.tsx`**
- `[&>[data-radix-scroll-area-viewport]>div]:!block`. Radix renders
  `<div style="min-width:100%;display:table">` inside its Viewport, and a table box sizes to
  its CONTENT — so `w-full` on the row button resolved against the widest title, `truncate`
  never engaged, and titles ran past the sheet edge and were clipped mid-word with no
  ellipsis. Scoped here rather than in `components/ui/scroll-area.tsx`, which the message
  list shares and which has its own tuned sizing (quick-020/052).
- `w-[85vw] max-w-80 sm:w-80` — 320px on a 360px phone left 40px of scrim to tap out of.

## Verification

- `npx tsc --noEmit` -> **0 errors**
- `npx vitest run` -> **1143 passed**, 197 skipped, 0 failed (was 1136; **+7**)
- `npx eslint app src` -> **0 errors**; `npm run build` -> exit 0

### Seen at a real 375x812 viewport, signed in as a real agent
| | before | after |
|---|---|---|
| pillar tabs | `ach … Find` — two of four, both clipped mid-word | **Auto · Coach · Finder · Reply**, all fully readable |
| coach button | full pill, ~135px | compact lime icon |
| history titles | clipped hard at the sheet edge, no ellipsis | `Find me a 2-bedroom in Bangsar, bu…` |

Desktop re-checked afterwards and is unchanged: logo, wordmark, centred tabs, language chips,
full coach pill.

### Regression surface
- Every change is `sm:`-gated or scoped to this one ScrollArea, so desktop is untouched — and
  that was confirmed by looking, not assumed.
- The shared `components/ui/scroll-area.tsx` is NOT modified.
- Icon-only buttons keep `aria-label`, so nothing is lost to a screen reader.

## Honest gaps

1. **Only 375x812 was exercised.** 320px (SE-class) would be tighter still and I did not try
   it; the tab strip scrolls there rather than fitting, which is the intended fallback but
   unverified.
2. **These tests are source assertions.** For a utility class that is honest — the class
   being present IS the behaviour — but they cannot catch a layout regression caused by
   something else on the page. They exist mainly to carry the REASON so the classes are not
   tidied away.
3. **Only the chat surface was checked.** The admin and dashboard pages at mobile width were
   not looked at.
