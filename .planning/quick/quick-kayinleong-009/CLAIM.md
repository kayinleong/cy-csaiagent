# Claim: quick-kayinleong-009

- owner: kayinleong
- session: claude-code
- branch: main
- started: 2026-06-15
- status: done
- summary: Render assistant chat messages as Markdown (bold, lists, links, code, tables) instead of raw text. The Coach welcome message showed literal `**…**` and `-` markup because the assistant plain-text bubble rendered msg.content verbatim in a whitespace-pre-wrap block.

## What will change

**Symptom (UAT, see screenshot):** The Coach welcome turn renders as raw markdown —
`- **D2 processes & SOPs** — how things work at D2` shows the literal `-` and `**` instead
of a bulleted list with bold lead-ins.

**Root cause:** `app/[lang]/chat/message-list.tsx` assistant plain-text branch rendered
`{msg.content}` directly inside a `<CardContent className="… whitespace-pre-wrap">`. The
content is GitHub-flavored Markdown (the agent system prompts emit `**bold**` + `-` lists),
but nothing parsed it — `whitespace-pre-wrap` only preserved newlines.

**Planned edits:**
- Add deps `react-markdown` + `remark-gfm` (GFM: lists, bold, tables, strikethrough, links).
- NEW `app/[lang]/chat/markdown-message.tsx` — a `<MarkdownMessage content>` wrapper with a
  compact `components` element map sized for the dense chat bubble (no
  `@tailwindcss/typography` dependency). **No `rehype-raw`** → raw HTML is never rendered,
  XSS-safe by construction. Links open in a new tab with `rel="noopener noreferrer"`.
- `message-list.tsx` — assistant plain-text branch renders `<MarkdownMessage>` instead of
  `{msg.content}`; drop `whitespace-pre-wrap` (markdown now owns block layout).
- NEW `markdown-message.test.ts` — render assertions + XSS-escaping guard.

## What has changed

- `package.json` / `package-lock.json` — added `react-markdown ^10.1.0` (React 19 compatible)
  and `remark-gfm ^4.0.1`.
- **NEW** `app/[lang]/chat/markdown-message.tsx` — `MarkdownMessage` renders `content` via
  `react-markdown` + `remarkGfm`, with a `Components` map styling p / strong / em / ul / ol /
  li / a / code (inline pill vs fenced block) / pre / blockquote / h1–h3 / hr / table / th /
  td for the compact bubble. No `rehype-raw`. Links: `target="_blank"
  rel="noopener noreferrer"`.
- `app/[lang]/chat/message-list.tsx` — imported `MarkdownMessage`; the assistant plain-text
  `<CardContent>` now renders `<MarkdownMessage content={msg.content} />` and no longer uses
  `whitespace-pre-wrap`. No other branch touched.
- **NEW** `app/[lang]/chat/markdown-message.test.ts` — 6 tests via `react-dom/server`
  `renderToStaticMarkup` (no new test infra): `**bold**`→`<strong>`, `-`→`<ul>/<li>`,
  `1.`→`<ol>`, inline `` `code` ``→`<code>`, links carry safe `rel`/`target`, and raw
  `<img onerror>` / `<script>` are escaped (never emitted as live tags).

## Verification

**Self-audit of the diff (regression-prevention):** Only the assistant **plain-text**
branch of `message-list.tsx` changed. The three other render branches are untouched:
- *User bubble* — still renders `{msg.content}` as plain text. Deliberate: user input
  (incl. pasted WhatsApp) must NOT be markdown-interpreted (their `**`/`-` should stay
  literal). Verified unchanged.
- *Reply turn (`ReplyDraftCard`)* — untouched; still the copy-only client island.
- *Finder turn (`MatchList`)* — untouched.
- *Citations footer* — untouched.

**Regression surface (each ruled out):**
- *Streaming render* — assistant text is accumulated into `messages[].content`
  (`chat-input.tsx` `content: m.content + delta`); the same plain-text branch renders both
  streaming and final, so markdown now applies to both. react-markdown renders whatever
  parses each tick (partial `**` simply renders as text until closed). No streaming-path
  code changed.
- *XSS* — no `rehype-raw`; react-markdown escapes raw HTML to inert text. Locked by the
  `<script>`/`<img onerror>` escaping test.
- *RSC/client boundary* — `message-list` is consumed by the `'use client'` `chat-shell` /
  `chat-input` tree; `next build` succeeded (63 routes incl. `/[lang]/chat`), proving the
  ESM-only react-markdown resolves and the boundary is valid.
- *i18n / trilingual* — purely presentational; markdown rendering is language-agnostic and
  does not touch copy or routing.
- *New dependency footprint* — `npm install` reported pre-existing audit findings only; no
  new high-sev advisories attributable to react-markdown/remark-gfm. `next build` clean.

**Automated gates (HEAD f6081d9):**
- `npx tsc --noEmit` → **0 errors**.
- `npx eslint markdown-message.tsx message-list.tsx markdown-message.test.ts` → **0 errors**.
- `npx vitest run app/[lang]/chat/markdown-message.test.ts` → **6 passed**.
- `npx vitest run` (full suite) → **650 passed | 186 skipped | 0 failed** (55 files).
- `npx next build` → **success**, 63 routes generated, `/[lang]/chat` compiled.

**Not verified here:** the live browser render of the Coach welcome message (no auth'd
dev-server session this session). The unit test reproduces the exact failing markup
(`- **D2 processes & SOPs**`) at the render layer and proves it becomes `<ul>/<li>` + 
`<strong>`, so the fix is locked; a manual "open /chat → welcome message shows a bulleted,
bold list" check is the remaining human confirmation.
