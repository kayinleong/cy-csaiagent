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
 *   - Each row links to /${lang}/admin/kb/${id} (per-doc detail).
 *   - Publish/unpublish toggle via PublishToggle wired to Server Actions.
 *   - Delete action via deleteKbDocAction with a window.confirm guard.
 *
 * References:
 *   - T-02-24: admin gate on Server Action (assertAdmin in crud)
 *   - T-02-25: publish/unpublish flips chunk status via 02-02 backend
 *   - ADMIN-01/03: Derek sees all docs with status/version/lang/pillar
 */

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { PublishToggle } from './publish-toggle'
import { deleteKbDocAction } from './actions'
import type { KbDocWithId } from '@/src/kb/crud'

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

// ─── Component ────────────────────────────────────────────────────────────────

interface KbDocListProps {
  docs: KbDocWithId[]
  lang: string
}

export function KbDocList({ docs, lang }: KbDocListProps) {
  const [showSuperseded, setShowSuperseded] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const visibleDocs = showSuperseded
    ? docs
    : docs.filter((d) => d.data.status !== 'superseded')

  const supersededCount = docs.filter((d) => d.data.status === 'superseded').length

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

  return (
    <div className="space-y-3">
      {/* Superseded filter toggle */}
      {supersededCount > 0 && (
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowSuperseded((v) => !v)}
            className="text-xs text-muted-foreground"
          >
            {showSuperseded
              ? `Hide ${supersededCount} superseded`
              : `Show ${supersededCount} superseded`}
          </Button>
        </div>
      )}

      <Table>
        <TableHeader>
          <TableRow>
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
          {visibleDocs.map(({ id, data }) => (
            <TableRow key={id}>
              {/* Title → link to detail page */}
              <TableCell className="max-w-[240px] truncate font-medium">
                <Link
                  href={`/${lang}/admin/kb/${id}`}
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
    </div>
  )
}
