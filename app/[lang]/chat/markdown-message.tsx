/**
 * app/[lang]/chat/markdown-message.tsx — Render assistant message text as Markdown.
 *
 * Assistant turns return GitHub-flavored Markdown (bold, lists, links, tables, code).
 * Rendered WITHOUT raw HTML (no rehype-raw) — model-generated content is never injected
 * as HTML, so this is XSS-safe by construction.
 *
 * Styling is a compact element map (not @tailwindcss/typography) to match the dense chat
 * bubble. Used by message-list.tsx for the plain-text assistant branch. Safe to render
 * partial/streaming markdown — react-markdown renders whatever parses on each tick.
 */

import { memo } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { cn } from '@/lib/utils'

const components: Components = {
  p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  ul: ({ children }) => (
    <ul className="mb-2 last:mb-0 list-disc space-y-1 pl-5">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="mb-2 last:mb-0 list-decimal space-y-1 pl-5">{children}</ol>
  ),
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="font-medium underline underline-offset-2 hover:text-primary"
    >
      {children}
    </a>
  ),
  code: ({ className, children }) => {
    // Fenced code blocks carry a `language-*` class (and render inside <pre>);
    // inline code does not. Only inline code gets the pill background — block code
    // inherits the <pre> background below.
    const isBlock = /language-/.test(className ?? '')
    return isBlock ? (
      <code className={className}>{children}</code>
    ) : (
      <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]">{children}</code>
    )
  },
  pre: ({ children }) => (
    <pre className="mb-2 overflow-x-auto rounded-md bg-muted p-3 font-mono text-[0.8em] last:mb-0">
      {children}
    </pre>
  ),
  blockquote: ({ children }) => (
    <blockquote className="mb-2 border-l-2 border-foreground/20 pl-3 italic text-muted-foreground last:mb-0">
      {children}
    </blockquote>
  ),
  h1: ({ children }) => <h1 className="mb-2 mt-1 text-base font-semibold first:mt-0">{children}</h1>,
  h2: ({ children }) => <h2 className="mb-2 mt-1 text-sm font-semibold first:mt-0">{children}</h2>,
  h3: ({ children }) => <h3 className="mb-1 mt-1 text-sm font-semibold first:mt-0">{children}</h3>,
  hr: () => <hr className="my-3 border-foreground/10" />,
  table: ({ children }) => (
    <div className="mb-2 overflow-x-auto last:mb-0">
      <table className="w-full border-collapse text-left">{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th className="border-b border-foreground/15 px-2 py-1 font-semibold">{children}</th>
  ),
  td: ({ children }) => (
    <td className="border-b border-foreground/10 px-2 py-1">{children}</td>
  ),
}

interface MarkdownMessageProps {
  content: string
  className?: string
}

/**
 * Render Markdown `content` with compact, chat-bubble-friendly element styling.
 *
 * memo'd (quick-kayinleong-046). Every streamed SSE token calls setMessages, and
 * chat-shell mirrors that state, so the whole message tree re-rendered TWICE per token
 * — re-running the full remark/micromark pipeline for EVERY message in the transcript
 * each time. Cost per token was O(conversation length), i.e. quadratic over a turn,
 * which is the single biggest contributor to the chat surface feeling laggy. Only the
 * final assistant bubble's `content` actually changes mid-stream; with this memo every
 * other bubble re-parses zero times.
 */
export const MarkdownMessage = memo(function MarkdownMessage({
  content,
  className,
}: MarkdownMessageProps) {
  return (
    <div data-slot="markdown-message" className={cn('break-words', className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  )
})
