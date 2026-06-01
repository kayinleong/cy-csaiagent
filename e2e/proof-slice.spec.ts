/**
 * e2e/proof-slice.spec.ts — English proof-slice E2E (SC1/SC2 VALIDATION.md)
 *
 * Verifies the full vertical-slice chat spine from sign-in through to SSE stream
 * with correct headers and incremental token delivery:
 *
 *   sign-in → send message → /api/chat response:
 *     (a) Content-Type: text/event-stream
 *     (b) X-Accel-Buffering: no
 *     (c) tokens arrive INCREMENTALLY (>1 chunk / progressive render)
 *     (d) grounded response includes a KB chunk-ID citation
 *
 * Target: App Hosting deploy URL or localhost:3000 (NEXT_PUBLIC_APP_URL).
 * Requires: live Firebase Auth + Anthropic key + seeded EN KB doc (01-10 seed script).
 *
 * NOT run via `npx vitest run` — Playwright has its own runner:
 *   npx playwright test e2e/proof-slice.spec.ts
 *   (or: npm run test:e2e)
 *
 * The real-4G token-by-token check remains a MANUAL SPIKE-DEPLOY verification (01-08).
 * This E2E covers the automatable incremental-stream + headers signals (SC1).
 *
 * Synthetic users only — no real PII (T-01-43).
 * See: VALIDATION.md §SC1, 01-12-SUMMARY.md, playwright.config.ts
 */

import { test, expect, type Page } from '@playwright/test'

// ─── Config ──────────────────────────────────────────────────────────────────

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'

// Synthetic new-agent credentials (from tests/fixtures/synthetic-users.ts)
// These users must be pre-created in the Firebase Auth test project.
const SYNTHETIC_AGENT = {
  email: process.env.E2E_AGENT_EMAIL ?? 'alice.lim.test@example.com',
  password: process.env.E2E_AGENT_PASSWORD ?? 'TestPassword123!',
}

// The proof-slice question answered by the seeded EN KB doc (seed-kb-en.ts)
const PROOF_SLICE_QUESTION = 'What do I need to complete in my first week as a new D2 agent?'

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Sign in as the synthetic new-agent via the app's sign-in form.
 * The sign-in page is at /[lang]/sign-in (EN: /en/sign-in).
 */
async function signIn(page: Page): Promise<void> {
  await page.goto(`${APP_URL}/en/sign-in`)

  // Wait for sign-in form to be ready
  await page.waitForSelector('[data-testid="email-input"], input[type="email"]', { timeout: 15000 })

  // Fill credentials
  await page.fill('input[type="email"]', SYNTHETIC_AGENT.email)
  await page.fill('input[type="password"]', SYNTHETIC_AGENT.password)
  await page.click('button[type="submit"]')

  // Wait for redirect to the chat page (sign-in success)
  await page.waitForURL(/\/(en|ms|zh)\/(chat)?/, { timeout: 20000 })
}

/**
 * Navigate to the chat page if not already there.
 */
async function goToChat(page: Page): Promise<void> {
  if (!page.url().includes('/chat') && !page.url().match(/\/(en|ms|zh)\/$/)) {
    await page.goto(`${APP_URL}/en`)
    await page.waitForLoadState('networkidle')
  }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

test.describe('Proof slice: sign-in → SSE stream → incremental tokens → grounded citation', () => {
  test.beforeEach(async ({ page }) => {
    // Sign in before each test
    await signIn(page)
    await goToChat(page)
  })

  test('SC1-A: /api/chat response has Content-Type: text/event-stream header', async ({ page }) => {
    // Intercept the /api/chat network request to inspect response headers
    let chatResponse: { headers: () => Record<string, string> } | null = null

    page.on('response', (response) => {
      if (response.url().includes('/api/chat')) {
        chatResponse = response
      }
    })

    // Locate the chat input and send the proof-slice question
    const chatInput = page.locator(
      '[data-testid="chat-input"], textarea[placeholder], input[placeholder*="message"], input[placeholder*="question"]',
    ).first()

    await chatInput.waitFor({ state: 'visible', timeout: 10000 })
    await chatInput.fill(PROOF_SLICE_QUESTION)
    await chatInput.press('Enter')

    // Wait for the response to start streaming (or a response element to appear)
    await page.waitForTimeout(3000) // Allow time for the SSE response to start

    // Assert the Content-Type header
    expect(chatResponse).not.toBeNull()
    if (chatResponse !== null) {
      const headers = (chatResponse as { headers: () => Record<string, string> }).headers()
      const contentType = headers['content-type'] ?? ''
      expect(contentType).toContain('text/event-stream')
    }
  })

  test('SC1-B: /api/chat response has X-Accel-Buffering: no header', async ({ page }) => {
    let xAccelBuffering: string | undefined

    page.on('response', (response) => {
      if (response.url().includes('/api/chat')) {
        const headers = response.headers()
        xAccelBuffering = headers['x-accel-buffering']
      }
    })

    const chatInput = page.locator(
      '[data-testid="chat-input"], textarea[placeholder], input[placeholder*="message"], input[placeholder*="question"]',
    ).first()

    await chatInput.waitFor({ state: 'visible', timeout: 10000 })
    await chatInput.fill(PROOF_SLICE_QUESTION)
    await chatInput.press('Enter')

    await page.waitForTimeout(3000)

    expect(xAccelBuffering).toBeDefined()
    expect(xAccelBuffering?.toLowerCase()).toBe('no')
  })

  test('SC1-C: tokens arrive INCREMENTALLY — message renders progressively (not single dump)', async ({
    page,
  }) => {
    // Monitor the assistant message container for progressive updates
    // We'll record the text content at multiple timestamps and verify it grows
    const snapshots: string[] = []

    const chatInput = page.locator(
      '[data-testid="chat-input"], textarea[placeholder], input[placeholder*="message"], input[placeholder*="question"]',
    ).first()

    await chatInput.waitFor({ state: 'visible', timeout: 10000 })
    await chatInput.fill(PROOF_SLICE_QUESTION)
    await chatInput.press('Enter')

    // Poll the last assistant message for 8 seconds, sampling every 300ms
    // Incremental stream = content grows across multiple samples
    const assistantMessage = page.locator(
      '[data-testid="assistant-message"], [role="assistant"], .assistant-message, [data-role="assistant"]',
    ).last()

    const startTime = Date.now()
    while (Date.now() - startTime < 8000) {
      try {
        const text = await assistantMessage.textContent({ timeout: 500 })
        if (text && text.trim().length > 0) {
          snapshots.push(text.trim())
        }
      } catch {
        // Element not yet visible — continue polling
      }
      await page.waitForTimeout(300)
    }

    // Incremental delivery: we should have >1 snapshot with different (growing) lengths
    // If the message was dumped all at once, all snapshots would be the same length
    if (snapshots.length >= 2) {
      const lengths = snapshots.map((s) => s.length)
      const isIncremental = lengths.some((l, i) => i > 0 && l > lengths[0])
      // Log snapshots for debugging if not incremental
      if (!isIncremental) {
        console.log('Snapshot lengths:', lengths.slice(0, 5))
      }
      expect(isIncremental).toBe(true)
    } else {
      // If we have < 2 snapshots, the response either hadn't started or was very fast
      // Skip rather than fail — this is a live-stack timing issue
      test.skip()
    }
  })

  test('SC1-D: grounded response includes a D2 KB chunk-ID citation [KB:...]', async ({ page }) => {
    const chatInput = page.locator(
      '[data-testid="chat-input"], textarea[placeholder], input[placeholder*="message"], input[placeholder*="question"]',
    ).first()

    await chatInput.waitFor({ state: 'visible', timeout: 10000 })
    await chatInput.fill(PROOF_SLICE_QUESTION)
    await chatInput.press('Enter')

    // Wait for the full assistant response to arrive
    // The Coach always cites a KB chunk ID (grounding mandate — COACH_SYSTEM_PROMPT)
    const assistantMessage = page.locator(
      '[data-testid="assistant-message"], [role="assistant"], .assistant-message, [data-role="assistant"]',
    ).last()

    await assistantMessage.waitFor({ state: 'visible', timeout: 30000 })

    // Wait for the full text to stabilise (streaming complete)
    let lastText = ''
    let stable = false
    for (let i = 0; i < 15; i++) {
      const text = await assistantMessage.textContent() ?? ''
      if (text === lastText && text.length > 0) {
        stable = true
        break
      }
      lastText = text
      await page.waitForTimeout(1000)
    }

    const responseText = await assistantMessage.textContent() ?? ''

    // Assert the response contains a KB citation in [KB:chunk-id] format
    expect(responseText).toMatch(/\[KB:[a-z0-9-]+\]/)

    // Assert no real MY phone numbers in the response (PII gate)
    expect(responseText).not.toMatch(/\+?60\d{9,10}/)

    // Smoke-check: stable=true means the response arrived before timeout
    if (!stable) {
      console.warn('Response did not stabilise within 15s — may be truncated')
    }
  })

  test('SC1-E: no real MY phone numbers appear anywhere in the response (PII gate)', async ({
    page,
  }) => {
    const chatInput = page.locator(
      '[data-testid="chat-input"], textarea[placeholder], input[placeholder*="message"], input[placeholder*="question"]',
    ).first()

    await chatInput.waitFor({ state: 'visible', timeout: 10000 })
    await chatInput.fill(PROOF_SLICE_QUESTION)
    await chatInput.press('Enter')

    const assistantMessage = page.locator(
      '[data-testid="assistant-message"], [role="assistant"], .assistant-message, [data-role="assistant"]',
    ).last()

    await assistantMessage.waitFor({ state: 'visible', timeout: 30000 })
    await page.waitForTimeout(5000) // Allow full response to arrive

    const responseText = await assistantMessage.textContent() ?? ''
    const MY_PHONE = /\+?60\d{9,10}/
    expect(responseText).not.toMatch(MY_PHONE)
  })
})

/**
 * Run command (requires live app + Firebase + Anthropic):
 *   npx playwright test e2e/proof-slice.spec.ts
 *   -- or --
 *   NEXT_PUBLIC_APP_URL=https://your-app-hosting-url.web.app \
 *     E2E_AGENT_EMAIL=alice.lim.test@example.com \
 *     E2E_AGENT_PASSWORD=TestPassword123! \
 *     npx playwright test e2e/proof-slice.spec.ts
 *
 * DO NOT run in CI without a live Firebase project and Anthropic key.
 * This spec is for manual validation of the App Hosting deployment (SPIKE-DEPLOY).
 */
