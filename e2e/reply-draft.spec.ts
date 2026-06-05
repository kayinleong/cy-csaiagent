/**
 * e2e/reply-draft.spec.ts — Reply copy-only / no-auto-send e2e
 * (Phase 4, 04-01 Wave 0 scaffold → 04-08 Wave 5: relocated + selectors live —
 *  REPLY-04 / QUAL-02 / D-07 / ADMIN-06).
 *
 * Proves the four non-negotiable Reply UX guarantees on the draft card:
 *   (a) the draft card renders an editable textarea + EXACTLY ONE Copy button
 *       (labelled the `chat.copyReply` i18n value) — D-16;
 *   (b) there is NO send / share / post / "send to WhatsApp" affordance — HR-1 / QUAL-02;
 *   (c) after Copy, the card shows the "copied" confirmation and NEVER a "sent" state — HR-2;
 *   (d) selecting Reply with no leadId opens the lead-selector sheet before dispatch — D-07;
 *   (e) a DISTINCT thumbs-down feedback control (`[data-testid="reply-thumbs-down"]`)
 *       is present, is separate from the Copy button, and on click marks itself pressed
 *       (feedback, NOT an egress — ADMIN-06 producer surface, RESEARCH Open-Q4).
 *
 * STATUS: SKIP-GUARDED (runs only with E2E_BASE_URL) — mirrors the Phase-3 finder
 * e2e convention (e2e/finder-flow.spec.ts). The reply-draft-card + lead-selector +
 * thumbs-down control shipped in Plan 04-08 (Wave 5); the selectors below are now
 * HONORED by the live UI. The suite stays skipped without a live deploy (it needs a
 * running stack + seeded reply SOPs to produce a draft), but it is now DISCOVERABLE
 * on the Playwright test path (relocated tests/e2e/ → e2e/ per the 04-01 note).
 *
 * DEVIATION RECONCILED (04-08): playwright.config.ts `testDir` is `./e2e`. This spec
 * was authored under tests/e2e/ by 04-01 and is now relocated to e2e/ so Playwright
 * discovers it. No testDir change needed.
 *
 * DO NOT run in CI — requires a live App Hosting deploy + seeded reply SOPs.
 *
 * Selector contract (honored by app/[lang]/chat/reply-draft-card.tsx + lead-selector.tsx):
 *   - [data-slot="reply-draft-card"]        → the draft card container
 *   - [data-slot="reply-draft-card"][data-state="draft"|"no-sop-match"|"clarifying"]
 *   - [data-testid="reply-draft-textarea"]  → the editable controlled textarea
 *   - [data-testid="reply-copy"]            → the SINGLE Copy button (chat.copyReply)
 *   - [data-state="copied"]                 → the post-copy confirmation state
 *   - [data-testid="reply-thumbs-down"]     → the DISTINCT thumbs-down feedback control
 *   - [data-slot="lead-selector"]           → the "Which lead?" sheet (D-07)
 *   - aria-label="Reply" (chip)             → the Reply pillar override toggle
 *
 * To run (requires the live pilot stack + Plan 04-08 UI shipped):
 *   E2E_BASE_URL=https://your-app.web.app \
 *     E2E_AGENT_EMAIL=alice.lim.test@example.com \
 *     E2E_AGENT_PASSWORD=TestPassword123! \
 *     npx playwright test e2e/reply-draft.spec.ts
 *
 * References: REPLY-04, QUAL-02, D-07/D-16/D-17, ADMIN-06, 04-UI-SPEC §0 HR-1/HR-2 +
 *            §Surface 1/2, 04-VALIDATION Wave-0 list.
 */

import { test, expect, type Page } from '@playwright/test'

// ─── Config ──────────────────────────────────────────────────────────────────

const BASE_URL = process.env.E2E_BASE_URL ?? ''

// Synthetic new-agent credentials — pre-created in the Firebase Auth test project.
const SYNTHETIC_AGENT = {
  email: process.env.E2E_AGENT_EMAIL ?? 'alice.lim.test@example.com',
  password: process.env.E2E_AGENT_PASSWORD ?? 'TestPassword123!',
}

// Synthetic inbound WhatsApp paste — NO real PII (T-04-01).
const INBOUND_PASTE_EN =
  'lead said: "Hi, saw your ad, is the Cheras unit still available?" — draft a reply'

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function signIn(page: Page): Promise<void> {
  await page.goto(`${BASE_URL}/en/sign-in`)
  await page.waitForSelector('input[type="email"]', { timeout: 15000 })
  await page.fill('input[type="email"]', SYNTHETIC_AGENT.email)
  await page.fill('input[type="password"]', SYNTHETIC_AGENT.password)
  await page.click('button[type="submit"]')
  await page.waitForURL(/\/(en|ms|zh)\/(chat)?/, { timeout: 20000 })
}

async function sendMessage(page: Page, message: string): Promise<void> {
  const chatInput = page
    .locator('[data-testid="chat-input"], textarea[placeholder]')
    .first()
  await chatInput.waitFor({ state: 'visible', timeout: 10000 })
  await chatInput.fill(message)
  await chatInput.press('Enter')
}

// ─── Test suite ───────────────────────────────────────────────────────────────

test.describe('Reply draft: copy-only, no auto-send, lead-selector, thumbs-down feedback', () => {
  test.beforeEach(async ({ page }) => {
    // Skip-guard: only run against a live deploy (mirrors the finder e2e convention).
    test.skip(!process.env.E2E_BASE_URL, 'Requires E2E_BASE_URL (live pilot stack + Plan 04-08 UI)')
    await signIn(page)
    await page.goto(`${BASE_URL}/en`)
    await page.waitForLoadState('networkidle')
  })

  // ── (a) editable textarea + EXACTLY ONE Copy button (D-16) ──────────────────
  test('REPLY-04: draft card has an editable textarea and EXACTLY ONE copy button', async ({ page }) => {
    await sendMessage(page, INBOUND_PASTE_EN)

    const card = page.locator('[data-slot="reply-draft-card"][data-state="draft"]')
    await card.waitFor({ state: 'visible', timeout: 30000 })

    // Editable textarea seeded with the model draft.
    const textarea = card.locator('[data-testid="reply-draft-textarea"]')
    await expect(textarea).toBeVisible()
    await expect(textarea).toBeEditable()

    // EXACTLY ONE copy button (the only send-path action — D-16).
    const copyButtons = card.locator('[data-testid="reply-copy"]')
    await expect(copyButtons).toHaveCount(1)
    // Labelled with the chat.copyReply i18n value (English).
    await expect(copyButtons.first()).toContainText(/copy/i)
  })

  // ── (b) NO send / share / post affordance (HR-1 / QUAL-02) ──────────────────
  test('QUAL-02: draft card has NO send/share/post/"send to whatsapp" affordance', async ({ page }) => {
    await sendMessage(page, INBOUND_PASTE_EN)

    const card = page.locator('[data-slot="reply-draft-card"][data-state="draft"]')
    await card.waitFor({ state: 'visible', timeout: 30000 })

    // Every egress affordance must have COUNT 0 on the draft card (HR-1).
    await expect(card.getByRole('button', { name: /send|share|post|send to whatsapp/i })).toHaveCount(0)
    await expect(card.locator('a[href*="wa.me"], a[href*="api.whatsapp.com"], a[href*="whatsapp://"]')).toHaveCount(0)
    await expect(card.locator('[data-testid="reply-send"], [data-testid="reply-share"]')).toHaveCount(0)
  })

  // ── (c) after Copy → "copied" confirmation, NEVER a "sent" state (HR-2) ─────
  test('QUAL-02: after Copy the card shows copied confirmation and never a sent state', async ({ page }) => {
    await sendMessage(page, INBOUND_PASTE_EN)

    const card = page.locator('[data-slot="reply-draft-card"][data-state="draft"]')
    await card.waitFor({ state: 'visible', timeout: 30000 })

    await card.locator('[data-testid="reply-copy"]').click()

    // The card collapses to a copied confirmation ("Copied — go send it from WhatsApp").
    await expect(page.locator('[data-slot="reply-draft-card"][data-state="copied"]')).toBeVisible({ timeout: 5000 })
    // It must NEVER claim it sent the message (copy-only posture).
    await expect(card.locator('[data-state="sent"]')).toHaveCount(0)
    await expect(card.getByText(/\bsent\b/i)).toHaveCount(0)
  })

  // ── (d) Reply with no leadId opens the lead-selector before dispatch (D-07) ─
  test('D-07: selecting Reply with no leadId opens the lead-selector sheet before dispatch', async ({ page }) => {
    // Force the Reply pillar via the override chip with NO lead selected.
    await page.locator('[aria-label="Reply"]').click()
    await sendMessage(page, INBOUND_PASTE_EN)

    // The "Which lead?" downline-scoped selector must appear BEFORE any draft dispatch.
    const leadSelector = page.locator('[data-slot="lead-selector"]')
    await expect(leadSelector).toBeVisible({ timeout: 10000 })
    // No draft card should have rendered yet (dispatch is blocked until a lead is picked).
    await expect(page.locator('[data-slot="reply-draft-card"]')).toHaveCount(0)
  })

  // ── (e) DISTINCT thumbs-down feedback control (ADMIN-06, NOT an egress) ─────
  test('ADMIN-06: a distinct thumbs-down feedback control exists, separate from Copy, and marks pressed on click', async ({ page }) => {
    await sendMessage(page, INBOUND_PASTE_EN)

    const card = page.locator('[data-slot="reply-draft-card"][data-state="draft"]')
    await card.waitFor({ state: 'visible', timeout: 30000 })

    const thumbsDown = card.locator('[data-testid="reply-thumbs-down"]')
    // The thumbs-down control exists and is exactly one element.
    await expect(thumbsDown).toHaveCount(1)
    // It is DISTINCT from the Copy button (feedback, not the send-path CTA).
    const copyTestId = await card.locator('[data-testid="reply-copy"]').getAttribute('data-testid')
    const tdTestId = await thumbsDown.getAttribute('data-testid')
    expect(tdTestId).not.toBe(copyTestId)
    expect(tdTestId).toBe('reply-thumbs-down')

    // On click it marks itself pressed (feedback sent) — it is NOT an egress affordance.
    await thumbsDown.click()
    await expect(thumbsDown).toHaveAttribute('aria-pressed', 'true')
  })
})
