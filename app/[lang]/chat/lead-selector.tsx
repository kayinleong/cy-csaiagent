'use client'

/**
 * app/[lang]/chat/lead-selector.tsx — the Reply lead-selector (Surface 2, D-07).
 *
 * Reply turns REQUIRE a leadId (HR-3). When the agent attempts a Reply dispatch
 * with no active lead, chat-shell opens this picker BEFORE dispatch. It is a cmdk
 * Command inside a bottom Sheet (mobile-first): search + a "Recent leads" group +
 * one CommandItem per downline-scoped lead (server-fetched via listLeadsForReply).
 *
 * HR-3: the agent picks EXPLICITLY. There is no auto-inference. If the agent's
 * most-recent lead is < 24h old it is pre-highlighted at the top with a one-tap
 * confirm affordance — an affordance, NOT auto-selection. If ≥ 24h (or none), the
 * agent must pick explicitly (no pre-highlight). Dismissing the sheet = cancel
 * (no lead picked → no dispatch).
 *
 * Selector contract (tests/e2e/reply-draft.spec.ts):
 *   - [data-slot="lead-selector"]  → the sheet content (the "Which lead?" picker)
 *   - [data-testid="lead-option"]  → one per selectable lead
 *
 * Picking a lead calls onPick(leadId); chat-shell then proceeds with the blocked
 * dispatch. PDPA: lead names are pseudonymized labels; never logged.
 */

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet'
import {
  Command,
  CommandInput,
  CommandList,
  CommandGroup,
  CommandItem,
  CommandEmpty,
} from '@/components/ui/command'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { listLeadsForReply, type LeadOption } from './lead-actions'

const RECENT_WINDOW_MS = 24 * 60 * 60 * 1000 // 24h (HR-3 recent affordance)

interface LeadSelectorProps {
  /** Whether the sheet is open (chat-shell owns this — opens on a leadless Reply). */
  open: boolean
  /** Called when the sheet is dismissed without a pick (cancel → no dispatch). */
  onCancel: () => void
  /** Called with the chosen leadId (chat-shell sets leadId then resumes dispatch). */
  onPick: (leadId: string) => void
}

/** The fetched, pre-partitioned lead list. recent = the single <24h lead (HR-3). */
interface LeadState {
  status: 'idle' | 'loading' | 'loaded'
  recent: LeadOption | null
  others: LeadOption[]
}

const INITIAL_LEAD_STATE: LeadState = { status: 'idle', recent: null, others: [] }

/**
 * Partition the fetched leads into the single recent (<24h) affordance + the rest.
 * Computed in the fetch callback (an event, not render) so Date.now() stays pure
 * relative to rendering (react-hooks/purity).
 */
function partitionLeads(leads: LeadOption[]): { recent: LeadOption | null; others: LeadOption[] } {
  const now = Date.now()
  const recent =
    leads
      .filter((l) => l.lastTouchedAt !== null && now - (l.lastTouchedAt as number) < RECENT_WINDOW_MS)
      .sort((a, b) => (b.lastTouchedAt as number) - (a.lastTouchedAt as number))[0] ?? null
  const others = leads.filter((l) => l.id !== recent?.id)
  return { recent, others }
}

export function LeadSelector({ open, onCancel, onPick }: LeadSelectorProps) {
  const t = useTranslations('chat.leadSelector')
  const [state, setState] = useState<LeadState>(INITIAL_LEAD_STATE)

  // Fetch the downline-scoped lead list each time the picker opens. (Closing does
  // not reset state — reopening re-fetches and re-enters the loading state.)
  useEffect(() => {
    if (!open) return
    let cancelled = false
    // Mount/open-time fetch start — a one-shot transition into the loading state,
    // not a cascading render (the .then callback below carries the result).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setState({ status: 'loading', recent: null, others: [] })
    void listLeadsForReply().then((res) => {
      if (cancelled) return
      const leads = res.ok && res.leads ? res.leads : []
      const { recent, others } = partitionLeads(leads)
      setState({ status: 'loaded', recent, others })
    })
    return () => {
      cancelled = true
    }
  }, [open])

  const loading = state.status === 'loading'
  const recentLead = state.recent
  const otherLeads = state.others
  const totalLeads = (recentLead ? 1 : 0) + otherLeads.length

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) onCancel()
      }}
    >
      <SheetContent side="bottom" data-slot="lead-selector" className="max-h-[70vh]">
        <SheetHeader>
          <SheetTitle>{t('title')}</SheetTitle>
          {/* When there is no recent (<24h) lead, prompt an explicit pick (HR-3). */}
          {!recentLead && !loading && totalLeads > 0 && (
            <SheetDescription>{t('pickExplicit')}</SheetDescription>
          )}
        </SheetHeader>

        <Command className="bg-transparent">
          <CommandInput placeholder={t('searchPlaceholder')} className="text-base" />
          <CommandList>
            {loading ? (
              <div className="flex flex-col gap-2 p-2">
                <Skeleton className="h-11 w-full rounded-md" />
                <Skeleton className="h-11 w-full rounded-md" />
                <Skeleton className="h-11 w-full rounded-md" />
              </div>
            ) : (
              <>
                <CommandEmpty>{t('empty')}</CommandEmpty>

                {/* Recent (<24h) lead — pre-highlighted at top with a confirm
                    affordance. An affordance, NOT auto-selection (HR-3). */}
                {recentLead && (
                  <CommandGroup heading={t('recentGroup')}>
                    <CommandItem
                      key={recentLead.id}
                      value={`${recentLead.name} ${recentLead.id}`}
                      data-testid="lead-option"
                      onSelect={() => onPick(recentLead.id)}
                      className="min-h-11"
                    >
                      <span className="truncate">{recentLead.name}</span>
                      <Badge
                        variant="secondary"
                        className="ml-2 text-[0.625rem] px-1.5 py-0.5 h-auto font-normal"
                      >
                        {t('recentBadge')}
                      </Badge>
                    </CommandItem>
                  </CommandGroup>
                )}

                {/* All other leads — explicit pick, no pre-highlight. */}
                {otherLeads.length > 0 && (
                  <CommandGroup heading={recentLead ? undefined : t('recentGroup')}>
                    {otherLeads.map((lead) => (
                      <CommandItem
                        key={lead.id}
                        value={`${lead.name} ${lead.id}`}
                        data-testid="lead-option"
                        onSelect={() => onPick(lead.id)}
                        className="min-h-11"
                      >
                        <span className="truncate">{lead.name}</span>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                )}
              </>
            )}
          </CommandList>
        </Command>
      </SheetContent>
    </Sheet>
  )
}
