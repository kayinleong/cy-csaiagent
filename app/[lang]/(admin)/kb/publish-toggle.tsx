'use client'

/**
 * app/[lang]/(admin)/kb/publish-toggle.tsx
 *
 * Publish/unpublish toggle (Switch) for a KB document.
 *
 * Wired to publishKbDocAction / unpublishKbDocAction (Server Actions).
 * Optimistic UI — toggles immediately, reverts on error.
 * Disabled for 'superseded' docs (cannot re-publish a superseded version).
 *
 * References:
 *   - T-02-25: publish/unpublish affects retrieval via the 02-02 backend
 *   - T-02-24: admin gate enforced inside crud (assertAdmin)
 */

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Switch } from '@/components/ui/switch'
import { publishKbDocAction, unpublishKbDocAction } from './actions'

interface PublishToggleProps {
  docId: string
  initialStatus: 'published' | 'unpublished' | 'superseded' | undefined
}

export function PublishToggle({ docId, initialStatus }: PublishToggleProps) {
  const isSuperseded = initialStatus === 'superseded'
  const [published, setPublished] = useState(initialStatus === 'published')
  const [isPending, startTransition] = useTransition()

  function handleToggle(checked: boolean) {
    // Optimistic UI — flip immediately
    setPublished(checked)

    startTransition(async () => {
      const action = checked ? publishKbDocAction : unpublishKbDocAction
      const result = await action(docId)

      if (!result.ok) {
        // Revert on failure
        setPublished(!checked)
        toast.error(result.error ?? (checked ? 'Failed to publish' : 'Failed to unpublish'))
        return
      }

      toast.success(checked ? 'Document published' : 'Document unpublished')
    })
  }

  return (
    <Switch
      checked={published}
      onCheckedChange={handleToggle}
      disabled={isSuperseded || isPending}
      aria-label={published ? 'Unpublish document' : 'Publish document'}
    />
  )
}
