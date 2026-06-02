/**
 * e2e/disclosure.spec.ts — Playwright test for CHAT-05 AI disclosure modal + persistent badge.
 *
 * Wave-0 scaffold: tests are SKIPPED until SPIKE-DEPLOY closes and a live app
 * URL is available (VALIDATION.md — Manual-Only gate). The skip guard checks
 * for the TEST_BASE_URL environment variable.
 *
 * Behaviors verified (once live):
 *   1. First-time visitor: disclosure modal shown BEFORE first chat interaction.
 *   2. Ack button dismisses the modal and enables the chat input.
 *   3. After ack, the "AI" badge is visible in the chat header.
 *   4. Refreshing after ack: modal does NOT reappear (localStorage gate).
 *
 * Run locally (once live deploy is available):
 *   TEST_BASE_URL=https://your-app.web.app npx playwright test e2e/disclosure.spec.ts
 */

import { test, expect } from '@playwright/test'

const BASE_URL = process.env.TEST_BASE_URL ?? ''

// ─── Skip guard ────────────────────────────────────────────────────────────────
// All tests in this file require a live deploy (SPIKE-DEPLOY gate).
test.beforeEach(({ browserName }) => {
  void browserName
  if (!BASE_URL) {
    test.skip(true, 'Skipped: TEST_BASE_URL not set. Set TEST_BASE_URL to a live deploy URL to run these tests (SPIKE-DEPLOY gate).')
  }
})

// ─── Test 1: Disclosure modal shown on first visit ────────────────────────────

test('CHAT-05: disclosure modal shown before first interaction', async ({ page }) => {
  // Clear localStorage to simulate a first-time visitor
  await page.goto(`${BASE_URL}/en/chat`)
  await page.evaluate(() => localStorage.removeItem('d2-disclosure-ack'))
  await page.reload()

  // Modal should be visible
  const modal = page.getByTestId('disclosure-modal')
  await expect(modal).toBeVisible()

  // Chat input should be inaccessible while modal is open
  // (not testing via tab-trap; just verifying the modal is blocking)
  const ackButton = modal.getByRole('button', { name: /I understand|continue/i })
  await expect(ackButton).toBeVisible()
})

// ─── Test 2: Ack button dismisses modal ──────────────────────────────────────

test('CHAT-05: ack button dismisses modal and reveals chat input', async ({ page }) => {
  await page.goto(`${BASE_URL}/en/chat`)
  await page.evaluate(() => localStorage.removeItem('d2-disclosure-ack'))
  await page.reload()

  const ackButton = page.getByRole('button', { name: /I understand|continue/i })
  await ackButton.click()

  // Modal should no longer be visible
  await expect(page.getByTestId('disclosure-modal')).not.toBeVisible()

  // Chat input should now be visible and usable
  const chatInput = page.getByRole('textbox', { name: /Chat message|Ask anything/i })
  await expect(chatInput).toBeVisible()
})

// ─── Test 3: AI badge is visible after ack ────────────────────────────────────

test('CHAT-05: persistent AI badge visible in header after disclosure ack', async ({ page }) => {
  await page.goto(`${BASE_URL}/en/chat`)
  await page.evaluate(() => localStorage.removeItem('d2-disclosure-ack'))
  await page.reload()

  // Ack the disclosure
  await page.getByRole('button', { name: /I understand|continue/i }).click()

  // AI badge should be visible in the header
  const aiBadge = page.getByTestId('ai-badge')
  await expect(aiBadge).toBeVisible()
  await expect(aiBadge).toHaveText('AI')
})

// ─── Test 4: Modal does NOT reappear after ack + refresh ─────────────────────

test('CHAT-05: modal does not reappear after ack and page refresh', async ({ page }) => {
  await page.goto(`${BASE_URL}/en/chat`)
  await page.evaluate(() => localStorage.removeItem('d2-disclosure-ack'))
  await page.reload()

  // Ack the disclosure
  await page.getByRole('button', { name: /I understand|continue/i }).click()

  // Refresh
  await page.reload()

  // Modal should NOT appear again (localStorage gate)
  await expect(page.getByTestId('disclosure-modal')).not.toBeVisible()

  // Chat should be accessible immediately
  const chatInput = page.getByRole('textbox', { name: /Chat message|Ask anything/i })
  await expect(chatInput).toBeVisible()
})
