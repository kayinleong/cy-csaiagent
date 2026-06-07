'use client'

/**
 * app/[lang]/(admin)/roles/role-assignment.tsx — Role matrix + guarded assignment (ADMIN-07).
 *
 * Client island for the admin role surface. Two regions:
 *
 *   Region 1 (read-only matrix): Table mapping roles × capabilities with check/dash cells.
 *   Region 2 (guarded assignment): Agent picker + role select + Assign Button → assignRole
 *     via useTransition + sonner toast. A role change that DEMOTES an admin opens a
 *     single-click AlertDialog confirm (HR-6) before the write.
 *
 * All strings from adminRoles.* namespace (HR-2).
 * Analog: stall-inbox.tsx (useTransition+sonner) + alert-dialog.tsx (demotion confirm).
 *
 * References:
 *   - ADMIN-07 (role matrix + guarded assignment)
 *   - HR-2 (trilingual copy), HR-6 (demotion AlertDialog — single-click, NOT type-to-confirm)
 *   - 05-UI-SPEC.md §Surface 3
 *   - 05-PATTERNS.md §role-assignment.tsx
 */

import { useState, useTransition } from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { Check, Minus, ShieldAlert } from 'lucide-react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { assignRole, listUsersWithRoles } from './actions'
import type { UserWithRole, AssignableRole } from './actions'

// ─── Capability matrix definition ─────────────────────────────────────────────

interface Capability {
  /** i18n key in adminRoles namespace */
  key: string
  /** Which roles have this capability */
  roles: AssignableRole[]
}

const CAPABILITIES: Capability[] = [
  { key: 'capChat',               roles: ['new-agent', 'senior-coach', 'admin'] },
  { key: 'capDownline',          roles: ['senior-coach', 'admin'] },
  { key: 'capOrg',               roles: ['admin'] },
  { key: 'capManageKb',          roles: ['admin'] },
  { key: 'capManageInventory',   roles: ['admin'] },
  { key: 'capViewConversations', roles: ['admin'] },
  { key: 'capRunErasure',        roles: ['admin'] },
  { key: 'capAssignRoles',       roles: ['admin'] },
]

const ALL_ROLES: AssignableRole[] = ['new-agent', 'senior-coach', 'admin']

// ─── Component ────────────────────────────────────────────────────────────────

interface RoleAssignmentProps {
  initialUsers: UserWithRole[]
  lang: string
}

export function RoleAssignment({ initialUsers, lang: _lang }: RoleAssignmentProps) {
  const t = useTranslations('adminRoles')

  // Users + roles list (refreshed after assignment)
  const [users, setUsers] = useState<UserWithRole[]>(initialUsers)

  // Assignment form state
  const [selectedUid, setSelectedUid] = useState<string>('')
  const [selectedRole, setSelectedRole] = useState<AssignableRole | ''>('')

  // Demotion confirm dialog state
  const [demoteDialogOpen, setDemoteDialogOpen] = useState(false)
  const [pendingAssignment, setPendingAssignment] = useState<{
    uid: string
    role: AssignableRole
  } | null>(null)

  const [isPending, startTransition] = useTransition()

  /** Refresh the users list after a role change. */
  async function refreshUsers() {
    try {
      const result = await listUsersWithRoles()
      if (result.ok) {
        setUsers(result.users)
      }
    } catch {
      // Non-blocking — existing list is stale but still usable
    }
  }

  /** Execute the actual role assignment (called after any demotion confirm). */
  function executeAssignment(uid: string, role: AssignableRole) {
    startTransition(async () => {
      const result = await assignRole(uid, role)
      if (result.ok) {
        toast.success(t('assigned'))
        setSelectedUid('')
        setSelectedRole('')
        await refreshUsers()
      } else {
        toast.error(result.error ?? t('assignError'))
      }
    })
  }

  /** Handle the Assign button click — check for demotion before writing. */
  function handleAssign() {
    if (!selectedUid || !selectedRole) return

    const targetUser = users.find((u) => u.id === selectedUid)
    const isDemotion = targetUser?.role === 'admin' && selectedRole !== 'admin'

    if (isDemotion) {
      // HR-6: admin demotion requires single-click AlertDialog confirm before the write.
      setPendingAssignment({ uid: selectedUid, role: selectedRole })
      setDemoteDialogOpen(true)
    } else {
      executeAssignment(selectedUid, selectedRole)
    }
  }

  /** Confirm demotion (AlertDialog Confirm button). */
  function handleDemoteConfirm() {
    if (pendingAssignment) {
      executeAssignment(pendingAssignment.uid, pendingAssignment.role)
    }
    setDemoteDialogOpen(false)
    setPendingAssignment(null)
  }

  function roleBadgeVariant(role: UserWithRole['role']): 'default' | 'secondary' | 'outline' {
    if (role === 'admin') return 'default'
    if (role === 'senior-coach') return 'secondary'
    return 'outline'
  }

  return (
    <div className="space-y-10">
      {/* ── Region 1: Read-only capability matrix ── */}
      <section>
        <h2 className="mb-4 text-lg font-semibold">{t('matrixTitle')}</h2>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-48">Capability</TableHead>
              <TableHead className="text-center">{t('roleNewAgent')}</TableHead>
              <TableHead className="text-center">{t('roleSeniorCoach')}</TableHead>
              <TableHead className="text-center">{t('roleAdmin')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {CAPABILITIES.map((cap) => (
              <TableRow key={cap.key}>
                <TableCell className="text-sm">{t(cap.key as Parameters<typeof t>[0])}</TableCell>
                {ALL_ROLES.map((role) => (
                  <TableCell key={role} className="text-center">
                    {cap.roles.includes(role) ? (
                      <Check className="mx-auto size-4 text-green-600" />
                    ) : (
                      <Minus className="mx-auto size-4 text-muted-foreground" />
                    )}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </section>

      {/* ── Region 2: Guarded assignment ── */}
      <section>
        <h2 className="mb-4 text-lg font-semibold">{t('assignTitle')}</h2>

        <div className="space-y-4">
          {/* Agent picker */}
          <div>
            <p className="mb-2 text-sm font-medium">{t('agentLabel')}</p>
            {users.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('noAgents')}</p>
            ) : (
              <Select value={selectedUid} onValueChange={setSelectedUid}>
                <SelectTrigger className="w-72">
                  <SelectValue placeholder={t('agentLabel')} />
                </SelectTrigger>
                <SelectContent>
                  {users.map((u) => (
                    <SelectItem key={u.id} value={u.id}>
                      <span className="font-mono text-xs">{u.displayRef}…</span>
                      &nbsp;
                      <Badge variant={roleBadgeVariant(u.role)} className="text-xs">
                        {u.role}
                      </Badge>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          {/* Role picker */}
          <div>
            <p className="mb-2 text-sm font-medium">{t('roleLabel')}</p>
            <Select value={selectedRole} onValueChange={(v) => setSelectedRole(v as AssignableRole)}>
              <SelectTrigger className="w-48">
                <SelectValue placeholder={t('roleLabel')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="new-agent">{t('roleNewAgent')}</SelectItem>
                <SelectItem value="senior-coach">{t('roleSeniorCoach')}</SelectItem>
                <SelectItem value="admin">{t('roleAdmin')}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Assign button */}
          <Button
            onClick={handleAssign}
            disabled={!selectedUid || !selectedRole || isPending}
          >
            {isPending ? '…' : t('assign')}
          </Button>
        </div>
      </section>

      {/* ── Demotion AlertDialog confirm (HR-6 — single-click, NOT type-to-confirm) ── */}
      <AlertDialog open={demoteDialogOpen} onOpenChange={setDemoteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogMedia>
              <ShieldAlert />
            </AlertDialogMedia>
            <AlertDialogTitle>{t('demoteConfirmTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('demoteConfirmBody')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => { setDemoteDialogOpen(false); setPendingAssignment(null) }}>
              {t('cancel')}
            </AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={handleDemoteConfirm}>
              {t('demoteConfirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
