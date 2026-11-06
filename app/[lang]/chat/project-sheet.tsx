'use client'

/**
 * app/[lang]/chat/project-sheet.tsx — the project sheet around a Finder details answer
 * (quick-kayinleong-103).
 *
 * The user asked for a project's details to read like its Skool page: the PIC and the
 * project WhatsApp group first, then the quick facts, then the project and marketing
 * links, in a form an agent can pass on. The model writes the quick facts (the `answer`
 * markdown). These blocks render the server-built `ProjectSheet`
 * (src/agents/finder/project-sheet.ts). A link or a name here is never model-authored.
 *
 * "Copy to share" copies the quick facts plus the project and marketing links, formatted
 * for WhatsApp. It leaves out the PIC and the WhatsApp group invite. Those are internal:
 * the Skool page itself says to join the group only when actively marketing the project.
 *
 * 'use client' for the clipboard and `useTranslations`. Rendered inside the chat-shell
 * client island, like MatchTable.
 */

import { useCallback } from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { ExternalLinkIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { ProjectSheet } from '@/src/agents/finder/schema'
import { presentCollateral } from './collateral-label'

type SheetLink = ProjectSheet['links'][number]
type Role = ProjectSheet['contacts'][number]['role']

const ROLE_ORDER: Role[] = ['pic', 'leader', 'co_leader']

/** The contacts grouped by role, in Skool order: PIC, then leader, then co-leader. */
function contactsByRole(sheet: ProjectSheet): Array<{ role: Role; names: string[] }> {
  return ROLE_ORDER.map((role) => ({
    role,
    names: sheet.contacts.filter((c) => c.role === role).map((c) => c.name),
  })).filter((g) => g.names.length > 0)
}

/** A translated label for a link type, falling back to the shared collateral label. */
function useLinkLabel(): (link: SheetLink) => string {
  const t = useTranslations('chat.projectSheet.linkTypes')
  return useCallback(
    (link: SheetLink) => {
      // `t.has` is typed against the catalog's literal keys; a collateral type is any string.
      const key = link.type as Parameters<typeof t.has>[0]
      return t.has(key) ? t(key) : presentCollateral(link).label
    },
    [t],
  )
}

/**
 * Convert the answer's markdown to text that reads well pasted into WhatsApp, then add
 * the links (quick-kayinleong-103).
 *
 *   - `[KB:chunkId]` citations are dropped. They are the app's audit trail, not client text.
 *   - `**bold**` becomes WhatsApp's `*bold*`, and a heading becomes a bold line.
 *   - `- item` becomes `• item`, keeping nested indentation.
 *   - `[text](url)` becomes `text: url`.
 *   - A markdown table becomes one `• first cell: other cells` line per row, a `---` rule
 *     becomes a blank line and a `> ` quote marker is dropped. The prompt asks for bullets,
 *     but a model that writes a table must not paste rows of pipes into WhatsApp.
 *
 * Exported for unit testing (no jsdom in this repo).
 */
export function projectSheetShareText(
  answer: string,
  sheets: ProjectSheet[],
  labels: { projectLinks: string; marketingLinks: string; link: (l: SheetLink) => string },
): string {
  const body = answer
    .replace(/\s*\[KB:[^\]\s]+\]/g, '')
    .replace(/^[ \t]*\|?[ \t]*:?-{3,}:?[ \t]*(?:\|[ \t]*:?-{3,}:?[ \t]*)*\|?[ \t]*$\n?/gm, '')
    .replace(/^[ \t]*\|(.+)\|[ \t]*$/gm, (_m, cells: string) => {
      const [first, ...rest] = cells.split('|').map((c) => c.trim())
      return rest.length > 0 ? `- ${first}: ${rest.join(' | ')}` : `- ${first}`
    })
    .replace(/^[ \t]*(?:-{3,}|\*{3,}|_{3,})[ \t]*$/gm, '')
    .replace(/^[ \t]*>[ \t]?/gm, '')
    .replace(/^[ \t]{0,3}#{1,6}[ \t]+(.+?)[ \t]*#*[ \t]*$/gm, (_m, title: string) => `*${title.replace(/\*\*/g, '')}*`)
    .replace(/\*\*(.+?)\*\*/g, '*$1*')
    .replace(/^([ \t]*)[-*+][ \t]+/gm, (_m, indent: string) => `${indent}• `)
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '$1: $2')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

  const parts = [body]
  for (const sheet of sheets) {
    const title = sheets.length > 1 ? ` (${sheet.name})` : ''
    const project = sheet.links.filter((l) => l.group === 'project')
    const marketing = sheet.links.filter((l) => l.group === 'marketing')
    if (project.length > 0) {
      parts.push(
        [`*${labels.projectLinks}${title}*`, ...project.map((l) => `• ${labels.link(l)}: ${l.url}`)].join('\n'),
      )
    }
    if (marketing.length > 0) {
      parts.push(
        [`*${labels.marketingLinks}${title}*`, ...marketing.map((l) => `• ${labels.link(l)}: ${l.url}`)].join('\n'),
      )
    }
  }
  return parts.filter((p) => p.length > 0).join('\n\n')
}

/** The Skool page's opening lines: PIC / leaders and the project WhatsApp group. */
export function ProjectSheetContacts({ sheet, className }: { sheet: ProjectSheet; className?: string }) {
  const t = useTranslations('chat.projectSheet')
  const groups = contactsByRole(sheet)
  if (groups.length === 0 && !sheet.whatsappGroupUrl) return null

  return (
    <div data-slot="project-sheet-contacts" className={cn('flex flex-col gap-1.5', className)}>
      {groups.map(({ role, names }) => (
        <p key={role}>
          <span className="font-semibold">{t(`roles.${role}`)}:</span> {names.join(', ')}
        </p>
      ))}
      {sheet.whatsappGroupUrl && (
        <div>
          <p>
            <span className="font-semibold">{t('whatsapp')}:</span>{' '}
            <a
              href={sheet.whatsappGroupUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="break-all font-medium underline underline-offset-2 hover:text-primary"
            >
              {sheet.whatsappGroupUrl}
            </a>
          </p>
          <p className="text-xs italic text-muted-foreground">{t('whatsappNote')}</p>
        </div>
      )}
    </div>
  )
}

/** The Skool "Sales Resources" and "Marketing Resources" links. */
export function ProjectSheetLinks({
  sheet,
  showName,
  className,
}: {
  sheet: ProjectSheet
  /** Name the project above its links, for an answer that covers several projects. */
  showName?: boolean
  className?: string
}) {
  const t = useTranslations('chat.projectSheet')
  const linkLabel = useLinkLabel()
  const project = sheet.links.filter((l) => l.group === 'project')
  const marketing = sheet.links.filter((l) => l.group === 'marketing')
  if (project.length === 0 && marketing.length === 0) return null

  const list = (title: string, links: SheetLink[]) =>
    links.length === 0 ? null : (
      <div className="flex flex-col gap-1">
        <span className="text-[0.6875rem] font-semibold uppercase tracking-wide text-muted-foreground">
          {title}
        </span>
        <ul className="flex flex-col gap-0.5">
          {links.map((link) => (
            <li key={link.url}>
              <a
                href={link.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-8 items-center gap-1.5 font-medium underline underline-offset-2 hover:text-primary"
              >
                {linkLabel(link)}
                <ExternalLinkIcon aria-hidden className="size-3.5 shrink-0" />
              </a>
            </li>
          ))}
        </ul>
      </div>
    )

  return (
    <div
      data-slot="project-sheet-links"
      data-project-id={sheet.projectId}
      className={cn('flex flex-col gap-3 border-t border-foreground/10 pt-3', className)}
    >
      {showName && <p className="font-semibold">{sheet.name}</p>}
      {list(t('projectLinks'), project)}
      {list(t('marketingLinks'), marketing)}
    </div>
  )
}

/** Copy the quick facts and the links, formatted for WhatsApp. */
export function ProjectSheetShare({ answer, sheets }: { answer: string; sheets: ProjectSheet[] }) {
  const t = useTranslations('chat.projectSheet')
  const linkLabel = useLinkLabel()

  const handleCopy = useCallback(async () => {
    const text = projectSheetShareText(answer, sheets, {
      projectLinks: t('projectLinks'),
      marketingLinks: t('marketingLinks'),
      link: linkLabel,
    })
    try {
      await navigator.clipboard.writeText(text)
      toast.success(t('copied'))
    } catch {
      toast.error(t('copyFailed'))
    }
  }, [answer, sheets, t, linkLabel])

  return (
    <div data-slot="project-sheet-share" className="flex flex-col items-start gap-1">
      <Button variant="outline" size="sm" className="min-h-11" onClick={handleCopy}>
        {t('copy')}
      </Button>
      <span className="text-xs text-muted-foreground">{t('copyHint')}</span>
    </div>
  )
}
