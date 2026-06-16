'use client'

/**
 * app/[lang]/(admin)/users/add-user-form.tsx — Add-user form (client island).
 *
 * Creates a brand-new Firebase Auth account and grants it a role via the
 * admin-gated createUser Server Action. Submits with useTransition + sonner
 * toast (same pattern as role-assignment.tsx / cohort-management.tsx).
 *
 * The cohort picker appears ONLY when role === 'new-agent' (the only role with an
 * agentProfiles doc, and therefore the only role that can join an intake batch).
 * Selecting a cohort closes the previously-orphaned cohort write-gap (COH-02).
 *
 * All strings resolve from the adminUsers.* namespace (trilingual — hard constraint).
 * Server-side error codes are mapped to localized copy via errorKey().
 */

import { useState, useTransition } from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { createUser, type CreateUserErrorCode } from './actions'
import type { CohortSummary } from '../cohorts/actions'
import type { Role } from '@/src/firebase/auth'

const NO_COHORT = '__none__'

interface AddUserFormProps {
  cohorts: CohortSummary[]
}

export function AddUserForm({ cohorts }: AddUserFormProps) {
  const t = useTranslations('adminUsers')

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [role, setRole] = useState<Role | ''>('')
  const [cohortId, setCohortId] = useState<string>(NO_COHORT)

  const [isPending, startTransition] = useTransition()

  /** Map a server error code to a localized message. */
  function errorMessage(code: CreateUserErrorCode): string {
    // The `errors.*` keys are defined for every code; fall back to a generic one.
    return t(`errors.${code}` as Parameters<typeof t>[0])
  }

  function resetForm() {
    setEmail('')
    setPassword('')
    setDisplayName('')
    setRole('')
    setCohortId(NO_COHORT)
  }

  function handleSubmit() {
    if (!email || !password || !role) return

    startTransition(async () => {
      const result = await createUser({
        email,
        password,
        displayName: displayName || undefined,
        role,
        // Only forward a cohort for a new-agent with an explicit selection.
        cohortId: role === 'new-agent' && cohortId !== NO_COHORT ? cohortId : undefined,
      })

      if (result.ok) {
        toast.success(t('created'))
        resetForm()
      } else {
        toast.error(errorMessage(result.error))
      }
    })
  }

  const canSubmit = Boolean(email && password && role) && !isPending

  return (
    <div className="space-y-6">
      {/* Email */}
      <div className="space-y-2">
        <Label htmlFor="add-user-email">{t('emailLabel')}</Label>
        <Input
          id="add-user-email"
          type="email"
          autoComplete="off"
          placeholder={t('emailPlaceholder')}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </div>

      {/* Password */}
      <div className="space-y-2">
        <Label htmlFor="add-user-password">{t('passwordLabel')}</Label>
        <Input
          id="add-user-password"
          type="password"
          autoComplete="new-password"
          placeholder={t('passwordPlaceholder')}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <p className="text-xs text-muted-foreground">{t('passwordHint')}</p>
      </div>

      {/* Display name (optional) */}
      <div className="space-y-2">
        <Label htmlFor="add-user-name">{t('nameLabel')}</Label>
        <Input
          id="add-user-name"
          type="text"
          autoComplete="off"
          placeholder={t('namePlaceholder')}
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
        />
      </div>

      {/* Role */}
      <div className="space-y-2">
        <Label>{t('roleLabel')}</Label>
        <Select value={role} onValueChange={(v) => setRole(v as Role)}>
          <SelectTrigger className="w-64">
            <SelectValue placeholder={t('rolePlaceholder')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="new-agent">{t('roleNewAgent')}</SelectItem>
            <SelectItem value="senior-coach">{t('roleSeniorCoach')}</SelectItem>
            <SelectItem value="admin">{t('roleAdmin')}</SelectItem>
            <SelectItem value="read-only">{t('roleReadOnly')}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Cohort — only for new-agent (the only role with an agent profile) */}
      {role === 'new-agent' && (
        <div className="space-y-2">
          <Label>{t('cohortLabel')}</Label>
          <Select value={cohortId} onValueChange={setCohortId}>
            <SelectTrigger className="w-64">
              <SelectValue placeholder={t('cohortPlaceholder')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_COHORT}>{t('cohortNone')}</SelectItem>
              {cohorts.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            {cohorts.length === 0 ? t('cohortEmptyHint') : t('cohortHint')}
          </p>
        </div>
      )}

      <Button onClick={handleSubmit} disabled={!canSubmit}>
        {isPending ? '…' : t('submit')}
      </Button>
    </div>
  )
}
