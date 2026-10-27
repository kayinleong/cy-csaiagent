// Run 3: drive the REAL Finder loop for every queued prompt, the way app/api/chat/route.ts does
// for a Finder turn: buildSystemPrompt({}) + makeTools + pseudonymize + modelFor('finder') +
// stopWhen(12) + maxOutputTokens 32k. No sign-in, no UI. Read-only against Firestore.
// usage: LOCAL_MODEL_OVERRIDE=gemini-3.5-flash tsx --env-file=.env run3.ts <queue.json> <results.json> [concurrency]
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
const REPO = '/Users/ka.yin.leong/Documents/Personal/cy-csaiagent'

type Item = { id: string; name?: string; prompt: string }

async function main() {
  const { assertSafeTarget } = await import(`${REPO}/src/inventory/client-workbook-safety`)
  assertSafeTarget(process.env)
  if (!process.env.LOCAL_MODEL_OVERRIDE) throw new Error('set LOCAL_MODEL_OVERRIDE')
  const [{ generateText, stepCountIs }, { finderAgent }, { modelFor }, { pseudonymize, assertRedacted }] = await Promise.all([
    import(`${REPO}/node_modules/ai/dist/index.mjs`),
    import(`${REPO}/src/agents/finder`),
    import(`${REPO}/src/llm/provider`),
    import(`${REPO}/src/audit`),
  ])
  const queue: Item[] = JSON.parse(readFileSync(process.argv[2], 'utf8'))
  const outPath = process.argv[3]
  const conc = Number(process.argv[4] ?? 3)
  const results: Record<string, any> = existsSync(outPath) ? JSON.parse(readFileSync(outPath, 'utf8')) : {}
  const save = () => writeFileSync(outPath, JSON.stringify(results, null, 1))
  const todo = queue.filter((q) => !results[q.id] || results[q.id].error)
  console.log(`model override: ${process.env.LOCAL_MODEL_OVERRIDE} | todo ${todo.length} of ${queue.length} | concurrency ${conc}`)

  async function runOne(item: Item) {
    const started = Date.now()
    const sink = { rows: [] as unknown[] }
    const tools = finderAgent.makeTools('en', 'uat-run3', undefined, sink as never)
    const system = finderAgent.buildSystemPrompt({})
    const { redacted, pdpa_redacted } = pseudonymize({ messages: [{ role: 'user', content: item.prompt }] }, [])
    assertRedacted({ pdpa_redacted })
    const model = await modelFor('finder')
    const res = await generateText({
      model,
      system,
      tools,
      messages: redacted.messages as Array<{ role: 'user'; content: string }>,
      stopWhen: stepCountIs(12),
      maxOutputTokens: 32_000,
    })
    const calls: any[] = []
    for (const step of res.steps) {
      for (const c of step.toolCalls ?? []) calls.push({ tool: c.toolName, input: c.input })
      for (const r of step.toolResults ?? []) {
        const o: any = r.output
        const last = calls.filter((c) => c.tool === r.toolName && c.output === undefined).pop() ?? calls[calls.length - 1]
        if (r.toolName === 'projectDetail') {
          last.output = {
            found: o?.found, name: o?.project?.name, projectId: o?.project?.projectId,
            kbCitations: (o?.kb?.citations ?? []).map((c: any) => c.chunkId),
            kbContext: o?.kb?.context,
          }
        } else if (r.toolName === 'searchProjects') {
          last.output = { found: o?.found, reason: o?.reason, gate: o?.gate, matches: (o?.matches ?? []).map((m: any) => m.name) }
        } else last.output = { keys: o && typeof o === 'object' ? Object.keys(o) : typeof o }
      }
    }
    results[item.id] = {
      id: item.id, name: item.name ?? null, prompt: item.prompt, ms: Date.now() - started,
      finishReason: res.finishReason, steps: res.steps.length, usage: res.usage,
      text: res.text, calls, sinkRows: sink.rows.length, at: new Date().toISOString(),
    }
  }

  let idx = 0, done = 0
  async function worker() {
    while (idx < todo.length) {
      const item = todo[idx++]
      for (let attempt = 1; attempt <= 3; attempt++) {
        try { await runOne(item); break } catch (e) {
          const msg = e instanceof Error ? e.message : String(e)
          results[item.id] = { id: item.id, name: item.name ?? null, prompt: item.prompt, error: msg.slice(0, 300), attempt }
          if (attempt < 3) await new Promise((r) => setTimeout(r, 15_000 * attempt))
        }
      }
      done++
      save()
      const r = results[item.id]
      console.log(`[${done}/${todo.length}] ${item.id} ${r.error ? 'ERROR ' + r.error.slice(0, 120) : `${r.finishReason} ${r.steps} steps ${Math.round(r.ms / 1000)}s ${r.text.length} chars`}`)
    }
  }
  await Promise.all(Array.from({ length: conc }, worker))
  save()
  const errs = Object.values(results).filter((r: any) => r.error).length
  console.log(`finished: ${Object.keys(results).length} results, ${errs} errors`)
}
main().then(() => process.exit(0), (e) => { console.error('failed:', e instanceof Error ? e.message : e); process.exit(1) })
