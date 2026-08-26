/**
 * scripts/inspect-history-persistence.ts — READ-ONLY Firestore probe
 * (quick-kayinleong-057).
 *
 * Answers one question: "when an agent revisits an older chat, why is the transcript
 * empty?" That has two possible causes and they need opposite fixes:
 *   A. the WRITE never happened  -> the messages subcollection is short or missing
 *   B. the READ drops them       -> the docs are there but the loader filters them out
 *
 * So this counts what is actually stored, per conversation, and prints the exact fields
 * mapConversationMessages() keys off (role / content / createdAt / routeDecision).
 *
 * Writes NOTHING.
 *
 * PDPA: never prints message CONTENT — only its length — and truncates every uid.
 *
 * Run:
 *   npx tsx --env-file=.env.local scripts/inspect-history-persistence.ts
 */

import { adminDb } from '@/src/firebase/admin'

const line = (s = '') => console.log(s)

/** The 055 fix landed at this commit time; turns after it exercise the new writer. */
const FIX_055 = new Date('2026-08-26T23:35:38+08:00')

type Row = {
  cid: string
  owner: string
  user: number
  assistant: number
  noRole: number
  emptyContent: number
  noCreatedAt: number
  markers: string[]
  latest: Date | null
}

async function main() {
  line('═══ Chat-history persistence probe (read-only) ═══')
  line(`  055 assistant-writer landed: ${FIX_055.toISOString()}`)
  line()

  const convs = await adminDb.collection('conversations').limit(60).get()
  line(`conversations: ${convs.size}`)
  line()

  const rows: Row[] = []
  let totalMsgs = 0
  let msgsAfterFix = 0
  let assistantAfterFix = 0

  for (const c of convs.docs) {
    const msgs = await adminDb.collection('conversations').doc(c.id).collection('messages').get()
    const row: Row = {
      cid: c.id,
      owner: String((c.data() as Record<string, unknown>).ownerUid ?? '—').slice(0, 8),
      user: 0,
      assistant: 0,
      noRole: 0,
      emptyContent: 0,
      noCreatedAt: 0,
      markers: [],
      latest: null,
    }

    for (const m of msgs.docs) {
      totalMsgs++
      const x = m.data() as Record<string, unknown>
      const role = x.role
      const created = (x.createdAt as { toDate?: () => Date } | undefined)?.toDate?.() ?? null

      if (role === 'user') row.user++
      else if (role === 'assistant') row.assistant++
      else row.noRole++

      const content = typeof x.content === 'string' ? x.content : ''
      if (content.length === 0) row.emptyContent++
      if (!created) row.noCreatedAt++
      if (created && (!row.latest || created > row.latest)) row.latest = created

      if (created && created > FIX_055) {
        msgsAfterFix++
        if (role === 'assistant') assistantAfterFix++
      }

      const rd = typeof x.routeDecision === 'string' ? x.routeDecision : ''
      if (rd.endsWith(':error') || rd.endsWith(':aborted')) row.markers.push(rd)
    }

    rows.push(row)
  }

  rows.sort((a, b) => (b.latest?.getTime() ?? 0) - (a.latest?.getTime() ?? 0))

  line('── per conversation, most recent first ──')
  line('  cid                              owner      user  asst  noRole  empty  noTS  latest')
  for (const r of rows.slice(0, 30)) {
    const flag =
      r.user > 0 && r.assistant === 0
        ? '  <-- NO ASSISTANT REPLY'
        : r.user + r.assistant === 0
          ? '  <-- EMPTY THREAD'
          : ''
    line(
      `  ${r.cid.slice(0, 32).padEnd(32)} ${r.owner.padEnd(9)} ${String(r.user).padStart(4)} ${String(
        r.assistant,
      ).padStart(5)} ${String(r.noRole).padStart(7)} ${String(r.emptyContent).padStart(6)} ${String(
        r.noCreatedAt,
      ).padStart(5)}  ${r.latest ? r.latest.toISOString().slice(0, 19) : '—'}${flag}`,
    )
  }

  const totalUser = rows.reduce((a, r) => a + r.user, 0)
  const totalAsst = rows.reduce((a, r) => a + r.assistant, 0)
  const missing = rows.filter((r) => r.user > 0 && r.assistant === 0).length
  const allMarkers = rows.flatMap((r) => r.markers)

  line()
  line('── totals ──')
  line(`  messages stored:            ${totalMsgs}`)
  line(`  user / assistant:           ${totalUser} / ${totalAsst}   (deficit ${totalUser - totalAsst})`)
  line(`  threads with 0 assistant:   ${missing} of ${rows.length}`)
  line(`  no role field:              ${rows.reduce((a, r) => a + r.noRole, 0)}`)
  line(`  empty content:              ${rows.reduce((a, r) => a + r.emptyContent, 0)}`)
  line(`  missing createdAt:          ${rows.reduce((a, r) => a + r.noCreatedAt, 0)}`)
  line()
  line('── since the 055 writer landed ──')
  line(`  messages written after fix: ${msgsAfterFix}   (assistant: ${assistantAfterFix})`)
  line(
    `  incomplete-turn markers:    ${allMarkers.length}${
      allMarkers.length ? '  e.g. ' + allMarkers.slice(0, 3).join(', ') : ''
    }`,
  )
  if (msgsAfterFix === 0) {
    line('  !! NOTHING has been written since the fix — the running server does not have it,')
    line('     or no one has chatted since. Cannot judge the fix from this data.')
  }

  line()
  line('═══ done (no writes performed) ═══')
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('probe failed:', (e as Error).message)
    process.exit(1)
  })
