'use client'

/**
 * app/[lang]/(admin)/leads/lead-management.tsx — Lead registry CRUD island
 * (quick-kayinleong-046).
 *
 * Regions:
 *   - A `Table` of leads (label / owner / segment / nationality / consent) with row
 *     Edit + Delete.
 *   - Create/edit `Dialog`: pseudonym label, OWNER picker, transient phone, consent
 *     switch, nationality, segment.
 *   - Delete `AlertDialog` (destructive — deletes the lead AND its context doc).
 *   - `Empty` state + shared `Paginator`.
 *
 * Mirrors cohort-management.tsx: useState rows + useTransition + sonner toasts +
 * optimistic local setState (no router.refresh()), inline `.trim()` validation only.
 * No zod, no react-hook-form — neither exists anywhere in the (admin) group.
 *
 * ── THE OWNER PICKER IS THE WHOLE FEATURE ───────────────────────────────────
 * The chat Reply selector lists leads via `where('ownerUid','==',uid)` against the
 * VERIFIED signed-in uid (app/[lang]/chat/lead-actions.ts:71). So the owner chosen
 * here is the ONLY thing that decides whose picker the lead shows up in. That is
 * surfaced explicitly, not implied: the picker is labelled with its consequence,
 * carries help copy, marks the signed-in admin's own account with "(you)", and the
 * table has a dedicated Owner column.
 *
 * ── PDPA ────────────────────────────────────────────────────────────────────
 *   - The label field is "Lead label", NOT "Name". It defaults to a generated
 *     `<LEAD_ID:…>` token and its help copy says to use a pseudonym. Whatever is
 *     typed here becomes a redaction needle in every draft for this lead
 *     (app/api/chat/route.ts:355-371).
 *   - The phone input is TRANSIENT: it is posted to the Server Action, hashed there
 *     and discarded. It is never read back (a lead with a hash on file shows a
 *     "leave blank to keep" hint instead of the number), never put in a URL.
 */

import { useMemo, useState, useTransition } from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { Plus, Pencil, Trash2, RefreshCw } from 'lucide-react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
} from '@/components/ui/empty'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { createLead, updateLead, deleteLead, type LeadSummary } from './actions'
import { Paginator, usePagination } from '../../_components/paginator'

/** An owner candidate from the user roster (projected in the RSC). */
export interface LeadOwner {
  id: string
  displayRef: string
  email: string | null
  role: string
}

interface LeadManagementProps {
  initialLeads: LeadSummary[]
  /** Roster of possible owners (read-only users already filtered out server-side). */
  owners: LeadOwner[]
  /** The signed-in admin's uid — used only to mark their own row with "(you)". */
  currentUid: string
}

/**
 * Generate a pseudonym label of the documented `<LEAD_ID:…>` shape (TSD.md:146,
 * rules.test.ts:380). 12 hex chars from the Web Crypto CSPRNG — no PII, no
 * collision worry at pilot scale.
 */
function generateLeadLabel(): string {
  const bytes = new Uint8Array(6)
  crypto.getRandomValues(bytes)
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
  return `<LEAD_ID:${hex}>`
}

/** Minimum label length — kept in sync with MIN_LABEL_LENGTH in ./actions.ts. */
const MIN_LABEL_LENGTH = 3

export function LeadManagement({ initialLeads, owners, currentUid }: LeadManagementProps) {
  const t = useTranslations('adminLeads')

  const [leads, setLeads] = useState<LeadSummary[]>(initialLeads)
  const { page, setPage, pageItems, pageCount } = usePagination(leads)
  const [isPending, startTransition] = useTransition()

  // Create/edit dialog state
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<LeadSummary | null>(null)
  const [label, setLabel] = useState('')
  const [ownerUid, setOwnerUid] = useState('')
  const [phone, setPhone] = useState('')
  const [consentFlag, setConsentFlag] = useState(false)
  const [nationality, setNationality] = useState('')
  const [segment, setSegment] = useState('')

  // Delete confirm state
  const [deleteTarget, setDeleteTarget] = useState<LeadSummary | null>(null)

  const ownerById = useMemo(() => {
    const map = new Map<string, LeadOwner>()
    for (const o of owners) map.set(o.id, o)
    return map
  }, [owners])

  /** Human label for an owner: email when resolvable, else the truncated uid ref. */
  const ownerLabel = (uid: string): string => {
    const owner = ownerById.get(uid)
    const base = owner ? (owner.email ?? owner.displayRef) : uid.slice(0, 8)
    return uid === currentUid ? `${base} ${t('ownerYouSuffix')}` : base
  }

  function resetForm() {
    setEditing(null)
    setLabel('')
    setOwnerUid('')
    setPhone('')
    setConsentFlag(false)
    setNationality('')
    setSegment('')
  }

  function openCreate() {
    resetForm()
    // Pre-fill a pseudonym so the default path never invites a raw legal name.
    setLabel(generateLeadLabel())
    setFormOpen(true)
  }

  function openEdit(lead: LeadSummary) {
    setEditing(lead)
    setLabel(lead.label)
    setOwnerUid(lead.ownerUid)
    // The raw phone is unrecoverable by design — blank means "keep the stored hash".
    setPhone('')
    setConsentFlag(lead.consentFlag)
    setNationality(lead.nationality)
    setSegment(lead.segment)
    setFormOpen(true)
  }

  const canSubmit =
    label.trim().length >= MIN_LABEL_LENGTH && ownerUid.trim().length > 0 && !isPending

  function handleSubmit() {
    if (!canSubmit) return
    const payload = {
      label: label.trim(),
      ownerUid: ownerUid.trim(),
      phone: phone.trim(),
      consentFlag,
      nationality: nationality.trim(),
      segment: segment.trim(),
    }

    startTransition(async () => {
      const result = editing
        ? await updateLead(editing.id, payload)
        : await createLead(payload)

      if (result.ok) {
        toast.success(editing ? t('updated') : t('created'))
        const row: Omit<LeadSummary, 'id'> = {
          label: payload.label,
          ownerUid: payload.ownerUid,
          hasPhone: payload.phone.length > 0 || (editing?.hasPhone ?? false),
          consentFlag: payload.consentFlag,
          nationality: payload.nationality,
          segment: payload.segment,
        }
        if (editing) {
          setLeads((prev) => prev.map((l) => (l.id === editing.id ? { ...row, id: l.id } : l)))
        } else if (result.id) {
          setLeads((prev) => [...prev, { ...row, id: result.id! }])
        }
        setFormOpen(false)
        resetForm()
      } else {
        toast.error(result.error ?? t('genericError'))
      }
    })
  }

  function handleDeleteConfirm() {
    const target = deleteTarget
    if (!target) return
    startTransition(async () => {
      const result = await deleteLead(target.id)
      if (result.ok) {
        toast.success(t('deleted'))
        setLeads((prev) => prev.filter((l) => l.id !== target.id))
      } else {
        toast.error(result.error ?? t('genericError'))
      }
      setDeleteTarget(null)
    })
  }

  return (
    <div className="space-y-6">
      {/* Toolbar — single accent CTA */}
      <div className="flex justify-end">
        <Button onClick={openCreate} disabled={isPending}>
          <Plus className="size-4" />
          {t('createCta')}
        </Button>
      </div>

      {/* Lead list */}
      {leads.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>{t('emptyTitle')}</EmptyTitle>
            <EmptyDescription>{t('emptyBody')}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('colLabel')}</TableHead>
                  <TableHead>{t('colOwner')}</TableHead>
                  <TableHead>{t('colSegment')}</TableHead>
                  <TableHead>{t('colNationality')}</TableHead>
                  <TableHead className="w-24">{t('colConsent')}</TableHead>
                  <TableHead className="w-28 text-right">{t('colActions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pageItems.map((lead) => (
                  <TableRow key={lead.id}>
                    <TableCell className="font-mono text-xs font-medium">{lead.label}</TableCell>
                    <TableCell className="text-sm">{ownerLabel(lead.ownerUid)}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {lead.segment || '—'}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {lead.nationality || '—'}
                    </TableCell>
                    <TableCell className="text-sm">
                      {lead.consentFlag ? t('consentYes') : t('consentNo')}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => openEdit(lead)}
                          disabled={isPending}
                          aria-label={t('editCta')}
                        >
                          <Pencil className="size-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => setDeleteTarget(lead)}
                          disabled={isPending}
                          aria-label={t('deleteCta')}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <Paginator page={page} pageCount={pageCount} onPageChange={setPage} />
        </div>
      )}

      {/* Create / edit dialog */}
      <Dialog open={formOpen} onOpenChange={(open) => { setFormOpen(open); if (!open) resetForm() }}>
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? t('editTitle') : t('createTitle')}</DialogTitle>
            <DialogDescription>
              {editing ? t('editDescription') : t('createDescription')}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* Pseudonym label — NOT a name field (PDPA) */}
            <div className="space-y-2">
              <label htmlFor="lead-label" className="text-sm font-medium">
                {t('fieldLabel')}
              </label>
              <div className="flex gap-2">
                <Input
                  id="lead-label"
                  className="font-mono"
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder={t('fieldLabelPlaceholder')}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={() => setLabel(generateLeadLabel())}
                  disabled={isPending}
                  aria-label={t('fieldLabelRegenerate')}
                >
                  <RefreshCw className="size-4" />
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">{t('fieldLabelHelp')}</p>
            </div>

            {/* Owner — the integration detail that decides whose picker shows this lead */}
            <div className="space-y-2">
              <label htmlFor="lead-owner" className="text-sm font-medium">
                {t('fieldOwner')}
              </label>
              <Select value={ownerUid} onValueChange={setOwnerUid} disabled={isPending}>
                <SelectTrigger id="lead-owner" className="w-full">
                  <SelectValue placeholder={t('fieldOwnerPlaceholder')} />
                </SelectTrigger>
                <SelectContent>
                  {owners.length === 0 ? (
                    <div className="px-2 py-1.5 text-sm text-muted-foreground">
                      {t('noOwners')}
                    </div>
                  ) : (
                    owners.map((o) => (
                      <SelectItem key={o.id} value={o.id}>
                        {ownerLabel(o.id)}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">{t('fieldOwnerHelp')}</p>
            </div>

            {/* Transient phone — hashed server-side, never stored raw */}
            <div className="space-y-2">
              <label htmlFor="lead-phone" className="text-sm font-medium">
                {t('fieldPhone')}
              </label>
              <Input
                id="lead-phone"
                type="tel"
                inputMode="tel"
                autoComplete="off"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder={t('fieldPhonePlaceholder')}
              />
              <p className="text-xs text-muted-foreground">
                {editing && editing.hasPhone ? t('fieldPhoneOnFile') : t('fieldPhoneHelp')}
              </p>
            </div>

            {/* Consent */}
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-1">
                <label htmlFor="lead-consent" className="text-sm font-medium">
                  {t('fieldConsent')}
                </label>
                <p className="text-xs text-muted-foreground">{t('fieldConsentHelp')}</p>
              </div>
              <Switch
                id="lead-consent"
                checked={consentFlag}
                onCheckedChange={setConsentFlag}
                disabled={isPending}
              />
            </div>

            {/* Nationality + segment */}
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <label htmlFor="lead-nationality" className="text-sm font-medium">
                  {t('fieldNationality')}
                </label>
                <Input
                  id="lead-nationality"
                  value={nationality}
                  onChange={(e) => setNationality(e.target.value)}
                  placeholder={t('fieldNationalityPlaceholder')}
                />
              </div>
              <div className="space-y-2">
                <label htmlFor="lead-segment" className="text-sm font-medium">
                  {t('fieldSegment')}
                </label>
                <Input
                  id="lead-segment"
                  value={segment}
                  onChange={(e) => setSegment(e.target.value)}
                  placeholder={t('fieldSegmentPlaceholder')}
                />
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setFormOpen(false)} disabled={isPending}>
              {t('cancel')}
            </Button>
            <Button onClick={handleSubmit} disabled={!canSubmit}>
              {isPending ? '…' : t('save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm (destructive — removes the lead AND its context doc) */}
      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('deleteConfirmTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('deleteConfirmBody')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setDeleteTarget(null)}>
              {t('cancel')}
            </AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={handleDeleteConfirm}>
              {t('deleteConfirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
