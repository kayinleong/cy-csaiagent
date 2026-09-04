/**
 * scripts/diag-finder-toolpick.ts — drive the REAL Finder model loop for one prompt and
 * print which tool it chose, with what arguments, how many rows came back, and whether the
 * row sink was populated (quick-kayinleong-086).
 *
 * WHY THIS EXISTS: the Finder result table renders only when `output.rows` is non-empty, and
 * `rows` is populated by a request-scoped sink inside `makeSearchProjectsTool`. Nothing about
 * that chain can be verified from a unit test — it depends on which tool the model actually
 * picks at runtime. Before this script the only way to check was to sign into a browser, which
 * is exactly the gap that let a stale dev server masquerade as a code defect for two rounds.
 *
 * It needs no authenticated session: it calls the model and the tools directly.
 *
 *   npx tsx --env-file=.env.local scripts/diag-finder-toolpick.ts
 *   npx tsx --env-file=.env.local scripts/diag-finder-toolpick.ts "your prompt here"
 *
 * Expected healthy output for "show me > 1.5mils house within klang valley":
 *   step 1  TOOL: searchProjects  input {... priceMin 1500000, locationPref "Klang Valley" ...}
 *           -> searchProjects returned 50 items
 *   SINK ROWS: 50
 *
 * `SINK ROWS: 0` means no table can render, whatever the UI does.
 *
 * BASE-URL PIN: `.env.local` sets ANTHROPIC_BASE_URL without the `/v1` suffix, which makes the
 * SDK build `/messages` and 404 from a script. The Next runtime is unaffected. We normalise it
 * here rather than editing the env file.
 *
 * Diagnostic only — reads Firestore and calls the model, writes nothing.
 */
import { generateText, stepCountIs } from 'ai'
import { createAnthropic } from '@ai-sdk/anthropic'
import { finderAgent } from '@/src/agents/finder'
import { appConfigRef, MODEL_CONFIG_DOC_ID } from '@/src/firebase/collections'
import type { FinderRow } from '@/src/agents/finder/schema'

async function main() {
  const base = (process.env.ANTHROPIC_BASE_URL ?? 'https://api.anthropic.com').replace(/\/+$/, '')
  const anthropic = createAnthropic({ baseURL: base.endsWith('/v1') ? base : `${base}/v1` })
  const snap = await appConfigRef().doc(MODEL_CONFIG_DOC_ID).get()
  const modelId = (snap.data()?.models?.finder as string) ?? 'claude-sonnet-4-6'
  console.log(`model = ${modelId} (from appConfig/modelConfig)\n`)

  const sink = { rows: [] as FinderRow[] }
  const tools = finderAgent.makeTools('en', 'diag-uid', undefined, sink)
  const system = finderAgent.buildSystemPrompt({})
  const prompt = process.argv[2] ?? 'show me > 1.5mils house within klang valley'

  const res = await generateText({
    model: anthropic(modelId), system, tools,
    stopWhen: stepCountIs(5),
    messages: [{ role: 'user', content: prompt }],
  })

  console.log(`PROMPT: ${prompt}\n`)
  let i = 0
  for (const step of res.steps) {
    i++
    for (const c of step.toolCalls ?? []) {
      console.log(`step ${i}  TOOL: ${c.toolName}`)
      console.log(`         input: ${JSON.stringify(c.input)}`)
    }
    for (const r of step.toolResults ?? []) {
      const out = r.output as unknown
      const n = Array.isArray(out) ? out.length
        : out && typeof out === 'object' && 'matches' in (out as Record<string, unknown>)
          ? ((out as Record<string, unknown>).matches as unknown[])?.length : 'n/a'
      console.log(`         -> ${r.toolName} returned ${n} items`)
    }
  }
  console.log(`\nSINK ROWS: ${sink.rows.length}   <-- 0 means NO TABLE can render`)
  const text = res.text ?? ''
  try {
    const o = JSON.parse(text) as Record<string, unknown>
    console.log(`ENVELOPE keys=[${Object.keys(o).join(',')}] matches=${(o.matches as unknown[])?.length ?? 'n/a'}`)
  } catch { console.log(`TEXT: ${text.slice(0, 200).replace(/\s+/g, ' ')}`) }
}
main().then(() => process.exit(0)).catch((e) => { console.error('FAILED:', (e as Error).message); process.exit(1) })
