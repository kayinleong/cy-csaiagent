'use client'

/**
 * app/[lang]/(coach)/_components/kb-doc-explorer.tsx
 *
 * CDASH-04 (UX): A browsable table of KB documents so a coach can SEE and PICK
 * the document to correct — instead of typing a Firestore document ID that
 * business users do not know. Picking a row opens the inline correction dialog
 * pre-bound to that document.
 *
 * Data: listKbDocsForCorrection() Server Action (gated senior-coach|admin,
 * read-only metadata only). The full /kb admin management page stays admin-only.
 */

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import {
  listKbDocsForCorrection,
  type KbDocSummary,
} from '../dashboard/actions'
import { InlineCorrectionDialog, type CorrectionTarget } from './inline-correction-dialog'

interface KbDocExplorerProps {
  /** Firebase ID token for the correction dialog's ingest poll. */
  idToken: string
}

export function KbDocExplorer({ idToken }: KbDocExplorerProps) {
  const t = useTranslations('dashboard')
  const [docs, setDocs] = useState<KbDocSummary[] | null>(null)
  const [error, setError] = useState(false)
  const [search, setSearch] = useState('')
  const [correcting, setCorrecting] = useState<CorrectionTarget | null>(null)

  async function load() {
    // First statement is the await — no synchronous setState inside the effect.
    const result = await listKbDocsForCorrection()
    if (result.ok && result.docs) {
      setDocs(result.docs)
      setError(false)
    } else {
      setError(true)
      toast.error(result.error ?? t('kbExplorerError'))
    }
  }

  useEffect(() => {
    let ignore = false
    listKbDocsForCorrection().then((result) => {
      if (ignore) return
      if (result.ok && result.docs) {
        setDocs(result.docs)
        setError(false)
      } else {
        setError(true)
      }
    })
    return () => {
      ignore = true
    }
  }, [])

  function handleClose() {
    setCorrecting(null)
    // Reload — a successful correction bumps the version / supersedes the old doc.
    void load()
  }

  const filtered = (docs ?? []).filter((d) =>
    d.title.toLowerCase().includes(search.trim().toLowerCase()),
  )

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{t('kbExplorerDescription')}</p>

      <Input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder={t('kbExplorerSearch')}
        className="max-w-sm"
      />

      {docs === null && !error && (
        <p className="text-sm text-muted-foreground">{t('kbExplorerLoading')}</p>
      )}

      {error && (
        <div className="flex items-center gap-3">
          <p className="text-sm text-destructive">{t('kbExplorerError')}</p>
          <Button size="sm" variant="outline" onClick={() => void load()}>
            {t('kbExplorerLoading')}
          </Button>
        </div>
      )}

      {docs !== null && !error && filtered.length === 0 && (
        <p className="text-sm text-muted-foreground">{t('kbExplorerEmpty')}</p>
      )}

      {docs !== null && !error && filtered.length > 0 && (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('kbExplorerColTitle')}</TableHead>
                <TableHead>{t('kbExplorerColLang')}</TableHead>
                <TableHead>{t('kbExplorerColPillar')}</TableHead>
                <TableHead>{t('kbExplorerColVersion')}</TableHead>
                <TableHead>{t('kbExplorerColStatus')}</TableHead>
                <TableHead className="text-right" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((doc) => (
                <TableRow key={doc.id}>
                  <TableCell className="font-medium">{doc.title}</TableCell>
                  <TableCell className="uppercase text-xs text-muted-foreground">
                    {doc.lang}
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary">{doc.pillar}</Badge>
                  </TableCell>
                  <TableCell className="text-sm tabular-nums">v{doc.version}</TableCell>
                  <TableCell>
                    <Badge variant={doc.status === 'published' ? 'default' : 'outline'}>
                      {doc.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setCorrecting({ id: doc.id, title: doc.title })}
                    >
                      {t('kbExplorerCorrect')}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <InlineCorrectionDialog idToken={idToken} doc={correcting} onClose={handleClose} />
    </div>
  )
}
