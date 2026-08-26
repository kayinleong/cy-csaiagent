/**
 * scripts/inspect-usage-distribution.ts — READ-ONLY Firestore probe (quick-kayinleong-050).
 *
 * Answers: "what does a real chat turn actually cost, and is TOKEN_CAP = 50_000 / 24h
 * sensible?" A tester hit the cap after ~10 questions, so this measures the real
 * distribution instead of guessing at a new number.
 *
 * Writes NOTHING.
 *
 * PDPA: usageEvents are counts-only by design (no message content). This prints
 * per-turn token statistics and per-user-per-day totals with uids TRUNCATED — never an
 * email, never any content.
 *
 * Run:
 *   npx tsx --env-file=.env.local scripts/inspect-usage-distribution.ts
 */

import { adminDb } from '@/src/firebase/admin'
import { TOKEN_CAP, REQUEST_CAP } from '@/src/ratelimit/window'

const line = (s = '') => console.log(s)

function pct(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0
  const i = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))
  return sorted[i]
}

async function main() {
  line('═══ Usage distribution probe (read-only) ═══')
  line(`  configured caps: TOKEN_CAP=${TOKEN_CAP.toLocaleString()}  REQUEST_CAP=${REQUEST_CAP}`)
  line()

  let docs
  try {
    // Bounded read — this is a diagnostic, not a report.
    docs = await adminDb.collection('usageEvents').limit(3000).get()
  } catch (err) {
    line(`! usageEvents read failed: ${(err as Error).message.slice(0, 200)}`)
    return
  }

  if (docs.empty) {
    line('  usageEvents: EMPTY — no turns recorded yet, cannot size the cap from data.')
    return
  }

  const perTurn: number[] = []
  const byUserDay = new Map<string, { tokens: number; turns: number }>()
  const byPillar = new Map<string, { tokens: number; turns: number }>()

  for (const d of docs.docs) {
    const x = d.data() as Record<string, unknown>
    const inTok = Number(x.inputTokens ?? 0)
    const outTok = Number(x.outputTokens ?? 0)
    const cachedIn = Number(x.cachedInputTokens ?? 0)
    const cacheWrite = Number(x.cacheCreationInputTokens ?? 0)
    // What the rate limiter actually decrements is total tokens for the turn.
    const total = inTok + outTok + cachedIn + cacheWrite
    perTurn.push(total)

    const uid = String(x.uid ?? 'unknown')
    const day = String(x.day ?? 'unknown')
    const key = `${uid}|${day}`
    const cur = byUserDay.get(key) ?? { tokens: 0, turns: 0 }
    cur.tokens += total
    cur.turns += 1
    byUserDay.set(key, cur)

    const pillar = String(x.pillar ?? 'unknown')
    const p = byPillar.get(pillar) ?? { tokens: 0, turns: 0 }
    p.tokens += total
    p.turns += 1
    byPillar.set(pillar, p)
  }

  perTurn.sort((a, b) => a - b)
  const sum = perTurn.reduce((a, b) => a + b, 0)

  line(`── per-turn tokens (n=${perTurn.length}) ──`)
  line(`  mean:   ${Math.round(sum / perTurn.length).toLocaleString()}`)
  line(`  p50:    ${pct(perTurn, 50).toLocaleString()}`)
  line(`  p90:    ${pct(perTurn, 90).toLocaleString()}`)
  line(`  p99:    ${pct(perTurn, 99).toLocaleString()}`)
  line(`  max:    ${perTurn[perTurn.length - 1].toLocaleString()}`)
  line()

  line('── per-turn cost by pillar ──')
  for (const [pillar, v] of [...byPillar.entries()].sort((a, b) => b[1].tokens - a[1].tokens)) {
    line(
      `  ${pillar.padEnd(8)} turns=${String(v.turns).padStart(5)}  mean=${Math.round(
        v.tokens / v.turns,
      ).toLocaleString()}`,
    )
  }
  line()

  line('── how many turns until TOKEN_CAP is hit ──')
  for (const [label, v] of [
    ['at mean', Math.round(sum / perTurn.length)],
    ['at p90', pct(perTurn, 90)],
    ['at p99', pct(perTurn, 99)],
  ] as const) {
    line(`  ${label.padEnd(8)} (${v.toLocaleString()} tok/turn) -> ${Math.floor(TOKEN_CAP / (v || 1))} turns`)
  }
  line()

  line('── per user-day totals (top 12, uid truncated) ──')
  const top = [...byUserDay.entries()].sort((a, b) => b[1].tokens - a[1].tokens).slice(0, 12)
  for (const [key, v] of top) {
    const [uid, day] = key.split('|')
    const over = v.tokens >= TOKEN_CAP ? '  <-- OVER CAP' : ''
    line(
      `  ${uid.slice(0, 8)}…  ${day}  turns=${String(v.turns).padStart(4)}  tokens=${v.tokens
        .toLocaleString()
        .padStart(10)}${over}`,
    )
  }
  const overCapDays = [...byUserDay.values()].filter((v) => v.tokens >= TOKEN_CAP).length
  line()
  line(`  user-days at/over TOKEN_CAP: ${overCapDays} of ${byUserDay.size}`)

  line()
  line('═══ done (no writes performed) ═══')
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('probe failed:', (e as Error).message)
    process.exit(1)
  })
