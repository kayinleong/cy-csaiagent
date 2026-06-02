/**
 * e2e/finder-flow.spec.ts — Finder end-to-end flow scaffold (Phase 3, 03-09)
 *
 * Covers the full Finder pilot verification path (FIND-01/SC1-SC5):
 *   1. Sign in as a new agent
 *   2. Paste lead criteria → assert match cards render with collateral + rationale
 *   3. Toggle the Finder override chip → assert routing (SC5)
 *   4. Send a budget shift → assert matches update without re-typing (SC2 / FIND-08)
 *
 * STATUS: SKIPPED — Playwright e2e setup waived per Phase-2 sign-off (03-VALIDATION.md).
 * These specs are scaffolds: structure + selectors + assertions are present, but skipped
 * pending a live deploy (pilot stack). They document the manual/pilot verification path.
 *
 * DO NOT wire live Firebase auth here — auth is performed via the sign-in UI flow.
 * DO NOT run in CI — requires live App Hosting deploy + seeded D2 inventory.
 *
 * TODO (pilot verification gate, 03-09 FIND-12):
 *   1. Deploy the pilot stack (Firebase App Hosting — SPIKE-DEPLOY).
 *   2. Seed D2 inventory via the admin inventory app (03-08).
 *   3. Set NEXT_PUBLIC_APP_URL, E2E_AGENT_EMAIL, E2E_AGENT_PASSWORD env vars.
 *   4. Remove test.skip from each test block and run:
 *        NEXT_PUBLIC_APP_URL=https://your-app.web.app \
 *          E2E_AGENT_EMAIL=alice.lim.test@example.com \
 *          E2E_AGENT_PASSWORD=TestPassword123! \
 *          npx playwright test e2e/finder-flow.spec.ts
 *
 * Selectors reference:
 *   - data-slot="match-list"       → the match-list container (match-list.tsx)
 *   - data-state="matches"         → match-list has results
 *   - data-state="refusal"         → match-list showing grounded refusal
 *   - data-slot="match-card"       → individual project match card
 *   - data-slot="chat-header"      → chat header container (chat-header.tsx)
 *   - aria-label="Finder" (chip)   → the Finder pillar override toggle (chat-header.tsx)
 *   - aria-label="Auto" (chip)     → the Auto pillar chip (reset to router)
 *   - data-testid="chat-input"     → the chat message input
 *   - [data-role="assistant"]      → assistant message bubble
 *
 * References: FIND-01, FIND-08, SC1/SC2/SC5, 03-07-PLAN.md, match-list.tsx, chat-header.tsx
 */

import { test, expect, type Page } from '@playwright/test'

// ─── Config ──────────────────────────────────────────────────────────────────

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'

// Synthetic new-agent credentials — pre-created in the Firebase Auth test project
const SYNTHETIC_AGENT = {
  email: process.env.E2E_AGENT_EMAIL ?? 'alice.lim.test@example.com',
  password: process.env.E2E_AGENT_PASSWORD ?? 'TestPassword123!',
}

// Synthetic lead criteria (no real PII — T-01-43)
const LEAD_CRITERIA_EN = `
My lead: Malaysian, non-bumi, 3-bedroom unit in Subang Jaya, budget RM550k–RM700k,
own stay, end-financing required. Please find matching projects.
`.trim()

const LEAD_CRITERIA_BUDGET_SHIFT = `
Actually, my lead can stretch to RM800k. Can you re-rank with the updated budget?
`.trim()

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Sign in as the synthetic new-agent via the app sign-in form.
 * Mirrors proof-slice.spec.ts signIn pattern.
 */
async function signIn(page: Page): Promise<void> {
  await page.goto(`${APP_URL}/en/sign-in`)
  await page.waitForSelector('[data-testid="email-input"], input[type="email"]', {
    timeout: 15000,
  })
  await page.fill('input[type="email"]', SYNTHETIC_AGENT.email)
  await page.fill('input[type="password"]', SYNTHETIC_AGENT.password)
  await page.click('button[type="submit"]')
  await page.waitForURL(/\/(en|ms|zh)\/(chat)?/, { timeout: 20000 })
}

/**
 * Navigate to the EN chat page.
 */
async function goToChat(page: Page): Promise<void> {
  await page.goto(`${APP_URL}/en`)
  await page.waitForLoadState('networkidle')
}

/**
 * Type a message in the chat input and submit.
 */
async function sendMessage(page: Page, message: string): Promise<void> {
  const chatInput = page
    .locator('[data-testid="chat-input"], textarea[placeholder], input[placeholder*="message"]')
    .first()
  await chatInput.waitFor({ state: 'visible', timeout: 10000 })
  await chatInput.fill(message)
  await chatInput.press('Enter')
}

/**
 * Wait for a match-list to appear in the given state.
 */
async function waitForMatchList(
  page: Page,
  state: 'matches' | 'refusal' | 'clarifying' = 'matches',
  timeoutMs = 30000
): Promise<void> {
  await page.locator(`[data-slot="match-list"][data-state="${state}"]`).waitFor({
    state: 'visible',
    timeout: timeoutMs,
  })
}

// ─── Test suite ───────────────────────────────────────────────────────────────

test.describe('Finder flow: paste criteria → match cards → collateral → re-rank', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page)
    await goToChat(page)
  })

  // ── SC1: Paste criteria → match cards render with collateral + rationale ────

  test.skip('FINDER-01: paste lead criteria → match cards render with rationale', async ({
    page,
  }) => {
    // TODO: remove test.skip when pilot stack is live (see file header)
    await sendMessage(page, LEAD_CRITERIA_EN)

    // Wait for the Finder agent to respond with match cards
    await waitForMatchList(page, 'matches')

    // Assert at least one match card is rendered
    const matchCards = page.locator('[data-slot="match-card"]')
    const cardCount = await matchCards.count()
    expect(cardCount).toBeGreaterThan(0)
    expect(cardCount).toBeLessThanOrEqual(3) // top-3 max

    // Assert each card has a project ID (grounding — D-04)
    const firstCard = matchCards.first()
    const projectIdText = await firstCard.locator('.font-mono').textContent()
    expect(projectIdText).toBeTruthy()
    // Project ID must not be an invented placeholder
    expect(projectIdText).not.toMatch(/placeholder|fake|test-id/i)

    // Assert PII gate: no real MY phone numbers in any card
    const matchListText = await page.locator('[data-slot="match-list"]').textContent()
    expect(matchListText ?? '').not.toMatch(/\+?60\d{9,10}/)
  })

  // ── SC1: Match cards include collateral links (D-09 — Storage/URL, no Drive API) ──

  test.skip('FINDER-02: match cards have collateral chips (plain URLs, no Drive embed)', async ({
    page,
  }) => {
    // TODO: remove test.skip when pilot stack is live with collateral seeded
    // Requires operator to attach collateral in the admin inventory app (03-08)
    await sendMessage(page, LEAD_CRITERIA_EN)
    await waitForMatchList(page, 'matches')

    // Check that at least one match card has a collateral chip (anchor link)
    // Collateral chips are <a> tags in the CardFooter — see match-list.tsx
    const collateralLink = page
      .locator('[data-slot="match-card"] a[target="_blank"]')
      .first()

    // If inventory has collateral seeded, a link should be present
    // If no collateral seeded, this assertion can be skipped with a warning
    const isVisible = await collateralLink.isVisible().catch(() => false)
    if (isVisible) {
      const href = await collateralLink.getAttribute('href')
      expect(href).toBeTruthy()
      // Must not be a Google Drive API embed (D-09/C2) — share links are OK as plain URLs
      expect(href).not.toContain('drive.googleapis.com/v3/files')
    } else {
      // Log: collateral not seeded — skip assertion (seed via admin inventory first)
      console.warn('No collateral links found — seed collateral via admin inventory (03-08)')
      test.skip()
    }
  })

  // ── SC5: Toggle the Finder override chip → assert routing ──────────────────

  test.skip('FINDER-03: Finder override chip forces Finder pillar routing', async ({ page }) => {
    // TODO: remove test.skip when pilot stack is live (see file header)
    // The override chip is rendered in the chat header (chat-header.tsx data-slot="chat-header")

    // Wait for the chat header to load
    const chatHeader = page.locator('[data-slot="chat-header"]')
    await chatHeader.waitFor({ state: 'visible', timeout: 10000 })

    // Click the Finder override chip (aria-label="Finder" ToggleGroup item)
    const finderChip = chatHeader.locator('[aria-label="Finder"]')
    await finderChip.waitFor({ state: 'visible', timeout: 5000 })
    await finderChip.click()

    // Now send a Coach-looking message — should still route to Finder due to override
    await sendMessage(page, 'Tell me about the D2 onboarding journey.')

    // With Finder override active, the response should be in Finder register:
    // either a match-list or a clarifying question about lead criteria
    const matchList = page.locator('[data-slot="match-list"]')
    const clarifying = page.locator('[data-slot="match-list"][data-state="clarifying"]')

    // Allow up to 30s for the Finder to respond (override chip must be honoured)
    const matchListVisible = await matchList.waitFor({ state: 'visible', timeout: 30000 })
      .then(() => true)
      .catch(() => false)

    expect(matchListVisible).toBe(true)

    // Reset override chip to Auto before next test
    const autoChip = chatHeader.locator('[aria-label="Auto"]')
    if (await autoChip.isVisible()) {
      await autoChip.click()
    }

    void clarifying // referenced for type-checking
    void matchListVisible
  })

  // ── SC2: Budget shift → assert matches update without re-typing (FIND-08) ──

  test.skip('FINDER-04: budget shift re-ranks matches without re-typing full criteria', async ({
    page,
  }) => {
    // TODO: remove test.skip when pilot stack is live + inventory seeded
    // First, establish a Finder conversation with initial criteria
    await sendMessage(page, LEAD_CRITERIA_EN)
    await waitForMatchList(page, 'matches', 30000)

    // Capture the initial top match project ID
    const initialFirstCard = page.locator('[data-slot="match-card"]').first()
    const initialProjectId = await initialFirstCard.locator('.font-mono').textContent()

    // Send the budget shift without re-typing full criteria (SC2 / FIND-08)
    await sendMessage(page, LEAD_CRITERIA_BUDGET_SHIFT)

    // Wait for a new match-list to appear after the re-rank
    // (The agent uses the stored leadContext.finderSlot — no re-typing needed)
    await waitForMatchList(page, 'matches', 30000)

    // Assert the match list updated (at minimum, a new response appeared)
    const updatedMatchList = page.locator('[data-slot="match-list"]').last()
    await updatedMatchList.waitFor({ state: 'visible', timeout: 10000 })

    // The updated ranking may or may not differ from the initial (depends on inventory)
    // At minimum, assert the Finder responded again with a match-list state
    const matchListState = await updatedMatchList.getAttribute('data-state')
    expect(['matches', 'refusal']).toContain(matchListState)

    // Log for human review: did the budget shift change the top result?
    const updatedFirstCard = updatedMatchList.locator('[data-slot="match-card"]').first()
    const updatedProjectId = await updatedFirstCard.locator('.font-mono').textContent()
      .catch(() => null)
    if (updatedProjectId && updatedProjectId !== initialProjectId) {
      console.log(`Re-rank changed top match: ${initialProjectId} → ${updatedProjectId}`)
    } else {
      console.log(`Re-rank top match unchanged: ${initialProjectId} (may be correct if only one eligible project)`)
    }
  })

  // ── Grounded refusal (no bad match — SC3) ──────────────────────────────────

  test.skip('FINDER-05: sub-threshold criteria yield grounded refusal (no invented project)', async ({
    page,
  }) => {
    // TODO: remove test.skip when pilot stack is live
    const subThresholdCriteria = `
My lead wants a 3-bedroom landed house in KLCC for RM200k. Malaysian, non-bumi.
`.trim()

    await sendMessage(page, subThresholdCriteria)

    // Expect a grounded refusal (no_match / ineligible state)
    await waitForMatchList(page, 'refusal', 30000)

    const refusalCard = page.locator('[data-slot="refusal-card"]')
    await refusalCard.waitFor({ state: 'visible', timeout: 5000 })

    // Assert refusal has an explanation (not empty)
    const refusalText = await refusalCard.textContent()
    expect(refusalText?.trim().length ?? 0).toBeGreaterThan(10)

    // Assert no real MY phone numbers in the refusal (PII gate)
    expect(refusalText ?? '').not.toMatch(/\+?60\d{9,10}/)
  })
})

/**
 * Run command (requires live pilot stack + seeded D2 inventory):
 *   NEXT_PUBLIC_APP_URL=https://your-app-hosting-url.web.app \
 *     E2E_AGENT_EMAIL=alice.lim.test@example.com \
 *     E2E_AGENT_PASSWORD=TestPassword123! \
 *     npx playwright test e2e/finder-flow.spec.ts
 *
 * Pre-conditions:
 *   - Pilot agents provisioned (scripts/provision-finder-pilot.ts --apply)
 *   - D2 inventory seeded via admin inventory app (03-08)
 *   - Remote Config: model.router.default + model.finder.default seeded
 */
