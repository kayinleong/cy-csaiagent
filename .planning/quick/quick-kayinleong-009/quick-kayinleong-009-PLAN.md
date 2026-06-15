---
quick_id: quick-kayinleong-009
status: complete
date: 2026-06-15
---

# Quick Task quick-kayinleong-009: Render assistant chat messages as Markdown

## Problem

Assistant turns emit GitHub-flavored Markdown, but the chat surface shows it raw. The
Coach welcome message renders `- **D2 processes & SOPs** — …` with literal `-`/`**`
because `message-list.tsx` rendered `{msg.content}` verbatim in a `whitespace-pre-wrap`
block. No markdown parser was in the render path.

## Tasks

**1. Add dependencies** — `react-markdown ^10` (React 19), `remark-gfm ^4`.
- verify: present in `package.json`; `npm install` clean.

**2. `app/[lang]/chat/markdown-message.tsx` (new)** — `<MarkdownMessage content>`.
- action: wrap `react-markdown` + `remarkGfm` with a compact `Components` element map
  (p/strong/em/ul/ol/li/a/code/pre/blockquote/h1–3/hr/table). No `rehype-raw`
  (XSS-safe). Links `target="_blank" rel="noopener noreferrer"`.
- verify: `tsc`, `eslint`.
- done: bold/lists/links/code render with bubble-friendly styling.

**3. `app/[lang]/chat/message-list.tsx`** — wire it in.
- action: render `<MarkdownMessage content={msg.content} />` in the assistant
  plain-text branch; drop `whitespace-pre-wrap`. Leave user bubble + Reply/Finder
  cards untouched.
- verify: `next build` (RSC/client boundary + ESM interop).
- done: assistant markdown renders; other branches unchanged.

**4. `app/[lang]/chat/markdown-message.test.ts` (new)** — regression lock.
- action: `react-dom/server` `renderToStaticMarkup` assertions (no new test infra) for
  bold/list/ordered/inline-code/link-rel, plus a raw-HTML escaping (XSS) guard.
- verify: `vitest run`.
- done: 6 tests green.

## Out of scope

- User bubbles stay plain text (their `**`/`-` must remain literal).
- Reply/Finder structured cards (already bespoke render paths).
- `@tailwindcss/typography` (styled inline to avoid a heavier dependency).
- Syntax highlighting / KaTeX (not needed for D2 chat content).
