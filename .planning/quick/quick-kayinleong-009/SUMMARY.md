---
quick_id: quick-kayinleong-009
status: complete
date: 2026-06-15
commit: f6081d9
---

# Summary: quick-kayinleong-009

Assistant chat messages now render Markdown (bold, lists, links, inline/block code,
tables) instead of raw text. Previously the Coach welcome message showed literal `**…**`
and `-` markup.

## Root cause

`app/[lang]/chat/message-list.tsx` rendered the assistant plain-text turn as
`{msg.content}` inside a `whitespace-pre-wrap` `<CardContent>`. The content is GFM
Markdown, but nothing parsed it.

## Change

- New `app/[lang]/chat/markdown-message.tsx` — `<MarkdownMessage>` wraps `react-markdown`
  + `remark-gfm` with a compact `Components` element map (no `@tailwindcss/typography`).
  **No `rehype-raw`** → raw HTML is escaped, never executed (XSS-safe). Links open in a
  new tab with `rel="noopener noreferrer"`.
- `message-list.tsx` — assistant plain-text branch renders `<MarkdownMessage>`;
  `whitespace-pre-wrap` dropped. User bubbles and Reply/Finder cards unchanged.
- Streaming + final both flow through `msg.content`, so both are covered.

## Dependencies added

- `react-markdown ^10.1.0` (React 19 compatible)
- `remark-gfm ^4.0.1`

## Files

- `package.json`, `package-lock.json` — deps.
- `app/[lang]/chat/markdown-message.tsx` (new) — renderer.
- `app/[lang]/chat/message-list.tsx` — wiring.
- `app/[lang]/chat/markdown-message.test.ts` (new) — 6 render/XSS tests.

## Verification

- `npx tsc --noEmit` → 0 errors
- `npx eslint` (3 touched files) → 0 errors
- `npx vitest run` → 650 passed | 186 skipped | 0 failed (incl. 6 new)
- `npx next build` → success, 63 routes, `/[lang]/chat` compiled

Full regression report in `CLAIM.md`. Code commit: `f6081d9`.

Remaining human check: open `/[lang]/chat` in the browser and confirm the Coach welcome
message renders a bulleted list with bold lead-ins (was the reported symptom).
