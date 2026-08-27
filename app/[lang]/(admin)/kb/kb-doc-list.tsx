'use client'

/**
 * app/[lang]/(admin)/kb/kb-doc-list.tsx
 *
 * Multi-doc KB list with status badges and publish toggles.
 *
 * Features:
 *   - Table of all KB docs showing title, lang, pillar, version, status badge.
 *   - Status badge: published (default/green) | unpublished (outline) | superseded (secondary).
 *   - Superseded docs hidden by default; toggle to show.
 *   - Each row links to /${lang}/kb/${id} (per-doc detail). `(admin)` is a Next.js
 *     route GROUP — it never appears in the URL, so the href must NOT include it
 *     (Pitfall 1 / T-06-16). The two sibling links in kb/[docId]/page.tsx:138,178
 *     are fixed in plan 06-07 which owns that file.
 *   - Publish/unpublish toggle via PublishToggle wired to Server Actions.
 *   - Delete action via deleteKbDocAction with a window.confirm guard.
 *
 * References:
 *   - T-02-24: admin gate on Server Action (assertAdmin in crud)
 *   - T-02-25: publish/unpublish flips chunk status via 02-02 backend
 *   - ADMIN-01/03: Derek sees all docs with status/version/lang/pillar
 *   - ADMIN-05 (04-09): pillar filter (All / Coach / Reply) over the fetched docs;
 *     Reply tab + zero Reply SOPs → kb.noReplySops empty state. Client-side filter
 *     on d.data.pillar — same useState pattern as the showSuperseded toggle. (D-10)
 */

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from '@/components/ui/table'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { PublishToggle } from './publish-toggle'
import { deleteKbDocAction, repillarKbDocsAction } from './actions'
import { Paginator, usePagination } from '../../_components/paginator'
import type { KbDocDoc } from '@/src/firebase/collections'

// ─── Client-serializable KB doc ─────────────────────────────────────────────────

/**
 * The RSC→Client boundary only accepts plain objects. A KB doc's `publishedAt` is
 * a Firestore `Timestamp` (a class instance) — passing it raw throws "Only plain
 * objects… can be passed to Client Components". The server shell (kb/page.tsx)
 * serializes it to epoch millis (or null) before handing the docs to this list.
 * `publishedAt` is the only non-serializable field on KbDocDoc; this component
 * never renders it, but it is kept on the type so the shape stays a faithful,
 * type-checked projection of KbDocDoc.
 */
export interface SerializedKbDocWithId {
  id: string
  data: Omit<KbDocDoc, 'publishedAt'> & { publishedAt: number | null }
}

// ─── Status badge helper ──────────────────────────────────────────────────────

type DocStatus = 'published' | 'unpublished' | 'superseded' | undefined

function StatusBadge({ status }: { status: DocStatus }) {
  if (status === 'published') {
    return <Badge variant="default">published</Badge>
  }
  if (status === 'superseded') {
    return <Badge variant="secondary">superseded</Badge>
  }
  // unpublished or undefined (legacy docs without status)
  return <Badge variant="outline">unpublished</Badge>
}

// ─── Lang / pillar display helpers ────────────────────────────────────────────

const LANG_LABEL: Record<string, string> = { en: 'EN', ms: 'BM', zh: '中文' }
const PILLAR_LABEL: Record<string, string> = {
  coach: 'Coach',
  finder: 'Finder',
  reply: 'Reply',
}

// ─── Pillar filter ────────────────────────────────────────────────────────────

// ADMIN-05 (D-10) originally exposed All / Coach / Reply only, on the reasoning that
// Finder inventory was not managed through this editor. quick-kayinleong-064 adds Finder:
// 1068 of the 1069 documents in the corpus are Finder, so leaving it out meant the entire
// KB was reachable only under "All" — which reads as the documents being somewhere else.
type PillarFilter = 'all' | 'coach' | 'finder' | 'reply'

// ─── Component ────────────────────────────────────────────────────────────────

interface KbDocListProps {
  docs: SerializedKbDocWithId[]
  lang: string
}

export function KbDocList({ docs, lang }: KbDocListProps) {
  const t = useTranslations('kb')
  const [showSuperseded, setShowSuperseded] = useState(false)
  // Same useState filter shape as showSuperseded — client-side over the fetched docs.
  const [pillarFilter, setPillarFilter] = useState<PillarFilter>('all')
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  // Bulk re-pillar (quick-kayinleong-064). Selection is by id and survives paging, so
  // "select all" on several pages accumulates rather than resetting.
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [moving, setMoving] = useState<{ done: number; total: number } | null>(null)

  // Apply the pillar filter first (ADMIN-05), then the superseded toggle.
  const pillarFilteredDocs =
    pillarFilter === 'all'
      ? docs
      : docs.filter((d) => d.data.pillar === pillarFilter)

  const visibleDocs = showSuperseded
    ? pillarFilteredDocs
    : pillarFilteredDocs.filter((d) => d.data.status !== 'superseded')

  const supersededCount = pillarFilteredDocs.filter(
    (d) => d.data.status === 'superseded',
  ).length

  const { page, setPage, pageItems, pageCount } = usePagination(visibleDocs)

  const pageAllSelected = pageItems.length > 0 && pageItems.every((d) => selected.has(d.id))

  function togglePage(next: boolean | 'indeterminate') {
    setSelected((prev) => {
      const out = new Set(prev)
      for (const d of pageItems) {
        if (next === true) out.add(d.id)
        else out.delete(d.id)
      }
      return out
    })
  }

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  /**
   * Move every selected document to `pillar`, in bounded slices.
   *
   * The Server Action moves at most REPILLAR_DOC_LIMIT documents per call and returns the
   * ids it did not reach; this loops until that list is empty. Same client-driven shape as
   * KB ingestion, and for the same reason — the corpus is ~25k chunks and one request
   * cannot rewrite them.
   */
  function handleMove(pillar: 'coach' | 'finder' | 'reply') {
    const ids = [...selected]
    if (ids.length === 0) return
    const label = PILLAR_LABEL[pillar]
    if (
      !window.confirm(
        `Move ${ids.length} document${ids.length === 1 ? '' : 's'} to ${label}?\n\n` +
          'Their chunks move too, so the agents will retrieve them under the new pillar.',
      )
    ) {
      return
    }

    startTransition(async () => {
      let queue = ids
      let docsMoved = 0
      let chunksMoved = 0
      setMoving({ done: 0, total: ids.length })

      while (queue.length > 0) {
        const result = await repillarKbDocsAction(queue, pillar)
        if (!result.ok) {
          setMoving(null)
          toast.error(result.error ?? 'Failed to move documents')
          // Not a rollback: what already moved stays moved, which is honest and safe to
          // re-run — moving a doc to the pillar it is already in is a no-op.
          if (docsMoved > 0) window.location.reload()
          return
        }
        docsMoved += result.docsMoved
        chunksMoved += result.chunksMoved
        // Guard against a call that reports no progress, so a bad id cannot spin forever.
        if (result.remaining.length >= queue.length) break
        queue = result.remaining
        setMoving({ done: ids.length - queue.length, total: ids.length })
      }

      setMoving(null)
      toast.success(
        `Moved ${docsMoved} document${docsMoved === 1 ? '' : 's'} (${chunksMoved} chunks) to ${label}`,
      )
      window.location.reload()
    })
  }

  function handleDelete(docId: string, title: string) {
    if (!window.confirm(`Delete "${title}"? This will also remove all its chunks.`)) return

    setDeletingId(docId)
    startTransition(async () => {
      const result = await deleteKbDocAction(docId)
      setDeletingId(null)
      if (!result.ok) {
        toast.error(result.error ?? 'Failed to delete document')
        return
      }
      toast.success('Document deleted')
      // Reload the page to reflect the deletion (RSC will re-fetch listDocs)
      window.location.reload()
    })
  }

  if (docs.length === 0) {
    return <p className="text-sm text-muted-foreground">No knowledge base documents yet.</p>
  }

  // Pillar filter control (ADMIN-05) — always shown when there are docs so Derek
  // can narrow to Reply SOPs even when none exist yet (the empty state guides him).
  const pillarTabs = (
    <Tabs
      value={pillarFilter}
      onValueChange={(v) => { setPillarFilter(v as PillarFilter); setPage(1) }}
    >
      <TabsList>
        <TabsTrigger value="all">{t('pillarFilter.all')}</TabsTrigger>
        <TabsTrigger value="coach">{t('pillarFilter.coach')}</TabsTrigger>
        <TabsTrigger value="finder">Finder</TabsTrigger>
        <TabsTrigger value="reply">{t('pillarFilter.reply')}</TabsTrigger>
      </TabsList>
    </Tabs>
  )

  // Reply tab selected but no Reply SOPs → reuse the existing empty-state pattern.
  if (pillarFilter === 'reply' && pillarFilteredDocs.length === 0) {
    return (
      <div className="space-y-3">
        {pillarTabs}
        <p className="text-sm text-muted-foreground">{t('noReplySops')}</p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {pillarTabs}

      {/* Superseded filter toggle */}
      {supersededCount > 0 && (
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => { setShowSuperseded((v) => !v); setPage(1) }}
            className="text-xs text-muted-foreground"
          >
            {showSuperseded
              ? `Hide ${supersededCount} superseded`
              : `Show ${supersededCount} superseded`}
          </Button>
        </div>
      )}

      {/* Bulk re-pillar bar (quick-kayinleong-064). Only rendered when something is
          selected, so the default view is unchanged. Coach retrieval filters on the CHUNK
          pillar, so this is what makes a document answerable by a different agent — not the
          label in the table. */}
      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2">
          <span className="text-sm font-medium">
            {moving
              ? `Moving ${moving.done}/${moving.total}…`
              : `${selected.size} selected`}
          </span>
          <span className="text-xs text-muted-foreground">Move to</span>
          {(['coach', 'finder', 'reply'] as const).map((p) => (
            <Button
              key={p}
              variant="outline"
              size="sm"
              disabled={isPending}
              onClick={() => handleMove(p)}
            >
              {PILLAR_LABEL[p]}
            </Button>
          ))}
          <Button
            variant="ghost"
            size="sm"
            disabled={isPending}
            className="ml-auto text-xs text-muted-foreground"
            onClick={() => setSelected(new Set())}
          >
            Clear
          </Button>
        </div>
      )}

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-10">
              {/* Selects the CURRENT page only — the label says so, and selection
                  accumulates across pages rather than resetting. */}
              <Checkbox
                aria-label="Select all on this page"
                checked={pageAllSelected}
                onCheckedChange={togglePage}
              />
            </TableHead>
            <TableHead>Title</TableHead>
            <TableHead>Lang</TableHead>
            <TableHead>Pillar</TableHead>
            <TableHead>Version</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Publish</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {pageItems.map(({ id, data }) => (
            <TableRow key={id} data-selected={selected.has(id) ? 'true' : undefined}>
              <TableCell className="w-10">
                <Checkbox
                  aria-label={`Select ${data.title}`}
                  checked={selected.has(id)}
                  onCheckedChange={() => toggleOne(id)}
                />
              </TableCell>

              {/* Title → link to detail page */}
              <TableCell className="max-w-[240px] truncate font-medium">
                <Link
                  href={`/${lang}/kb/${id}`}
                  className="underline-offset-2 hover:underline"
                >
                  {data.title}
                </Link>
              </TableCell>

              <TableCell>{LANG_LABEL[data.lang] ?? data.lang}</TableCell>
              <TableCell>{PILLAR_LABEL[data.pillar] ?? data.pillar}</TableCell>
              <TableCell>v{data.version ?? 1}</TableCell>

              {/* Status badge */}
              <TableCell>
                <StatusBadge status={data.status} />
              </TableCell>

              {/* Publish toggle */}
              <TableCell>
                <PublishToggle
                  docId={id}
                  initialStatus={data.status}
                />
              </TableCell>

              {/* Delete */}
              <TableCell className="text-right">
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                  disabled={isPending && deletingId === id}
                  onClick={() => handleDelete(id, data.title)}
                >
                  {deletingId === id ? 'Deleting…' : 'Delete'}
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <Paginator page={page} pageCount={pageCount} onPageChange={setPage} />
    </div>
  )
}
