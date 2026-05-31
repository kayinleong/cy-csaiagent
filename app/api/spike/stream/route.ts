/**
 * SPIKE-DEPLOY — SSE streaming endpoint
 *
 * Purpose: verify that token-by-token SSE delivery works on Firebase App Hosting
 * asia-southeast1 over a real 4G mobile network (the blocking SPIKE-DEPLOY).
 *
 * The three load-bearing headers (from 01-RESEARCH.md Pitfall C + TSD §3.4):
 *   Content-Type: text/event-stream  — signals the client to parse SSE frames
 *   Cache-Control: no-store          — prevents buffering at CDN/proxy layers
 *   X-Accel-Buffering: no            — disables nginx-level buffering (App Hosting)
 *
 * Without X-Accel-Buffering: no, App Hosting's nginx proxy buffers the entire
 * response body before forwarding it — the client sees a "thinking…" pause then
 * a single dump, not token-by-token streaming.
 *
 * NOT a Server Action — streaming MUST be a Route Handler (TSD §3.4, ARCH anti-pattern 4).
 * maxDuration = 90 caps runaway responses; App Hosting (Cloud Run) allows more.
 *
 * Human-action checkpoint: after deploying with apphosting.yaml, visit
 *   GET /api/spike/stream
 * on a real 4G device (WiFi OFF) and observe incremental token arrival.
 *
 * References:
 *   - SPIKE-DEPLOY pass: SSE chunk-by-chunk on App Hosting asia-southeast1 over 4G
 *   - 01-RESEARCH.md lines 262–267 (streaming headers + App Hosting streaming)
 *   - TSD §3.4: Node-runtime Route Handler; the three required headers
 *   - CLAUDE.md: Next.js 16 — 'export const runtime = "nodejs"' on route handlers
 */

export const runtime = 'nodejs'

/**
 * Cap: 90 seconds. App Hosting Cloud Run supports longer timeouts,
 * but the spike only needs ~30 seconds of incremental tokens.
 */
export const maxDuration = 90

/**
 * GET /api/spike/stream
 *
 * Returns a server-sent-events stream that emits 20 tokens at 500ms intervals.
 * Each token is a simple "word" so the client can see visible gaps between tokens.
 *
 * SPIKE-DEPLOY pass: all 20 tokens arrive INCREMENTALLY on real 4G — not as
 * a single dump after a 10s wait.
 */
export async function GET(_req: Request): Promise<Response> {
  const TOKENS = [
    'D2', 'Property', '—', 'streaming', 'spike', 'test.',
    'If', 'you', 'see', 'these', 'words', 'appear',
    'one', 'by', 'one', 'on', 'a', 'real', '4G', 'network,',
    'the', 'spike', 'has', 'PASSED.', 'Token-by-token', 'SSE',
    'confirmed', 'on', 'App', 'Hosting', 'asia-southeast1.',
  ]

  const INTERVAL_MS = 300 // 300ms between tokens — visible on mobile

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder()
      for (const token of TOKENS) {
        const sseFrame = `data: ${JSON.stringify({ token })}\n\n`
        controller.enqueue(encoder.encode(sseFrame))
        await new Promise((resolve) => setTimeout(resolve, INTERVAL_MS))
      }
      // SSE end-of-stream signal
      controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'))
      controller.close()
    },
  })

  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-store',
      /**
       * X-Accel-Buffering: no
       * This is THE critical header for App Hosting. Without it, nginx at the
       * App Hosting edge buffers the entire stream before forwarding to the client.
       * See: RESEARCH Pitfall C (lines 358–362) and TSD §3.4.
       */
      'X-Accel-Buffering': 'no',
      /**
       * Connection: keep-alive
       * Keeps the underlying TCP connection open for the duration of the stream.
       * Some reverse proxies close idle connections; this prevents premature teardown.
       */
      Connection: 'keep-alive',
    },
  })
}
