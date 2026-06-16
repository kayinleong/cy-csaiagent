'use client'

/**
 * app/[lang]/(admin)/users/user-list.tsx — read-only directory of all users.
 *
 * Thin client island: renders the serialized user rows (email + role + senior
 * coach) passed from the RSC. Email is resolved server-side by listUsersWithRoles
 * (Auth-only PII); a missing email falls back to a truncated UID. The senior-coach
 * column reuses the same roster to show the coach's email (no extra lookup).
 *
 * No mutations here — role changes live on /roles, coach reassignment on
 * /coach-assignment. This is a directory view.
 */

import { useTranslations } from 'next-intl'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import type { UserWithRole } from '../roles/actions'
import type { Role } from '@/src/firebase/auth'

interface UserListProps {
  users: UserWithRole[]
}

function roleBadgeVariant(role: Role): 'default' | 'secondary' | 'outline' {
  if (role === 'admin') return 'default'
  if (role === 'senior-coach') return 'secondary'
  return 'outline'
}

function roleLabelKey(role: Role): string {
  switch (role) {
    case 'senior-coach':
      return 'roleSeniorCoach'
    case 'admin':
      return 'roleAdmin'
    case 'read-only':
      return 'roleReadOnly'
    default:
      return 'roleNewAgent'
  }
}

export function UserList({ users }: UserListProps) {
  const t = useTranslations('adminUsers')

  if (users.length === 0) {
    return <p className="text-sm text-muted-foreground">{t('emptyList')}</p>
  }

  // Resolve a senior-coach UID to their email from the same roster (no extra read).
  const emailByUid = new Map(users.map((u) => [u.id, u.email]))

  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('colEmail')}</TableHead>
            <TableHead>{t('colRole')}</TableHead>
            <TableHead>{t('colCoach')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {users.map((u) => {
            const coachEmail = u.seniorCoachId ? (emailByUid.get(u.seniorCoachId) ?? null) : null
            return (
              <TableRow key={u.id}>
                <TableCell className={u.email ? 'text-sm' : 'font-mono text-xs'}>
                  {u.email ?? `${u.displayRef}…`}
                </TableCell>
                <TableCell>
                  <Badge variant={roleBadgeVariant(u.role)}>
                    {t(roleLabelKey(u.role) as Parameters<typeof t>[0])}
                  </Badge>
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {u.seniorCoachId
                    ? (coachEmail ?? `${u.seniorCoachId.slice(0, 8)}…`)
                    : '—'}
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}
