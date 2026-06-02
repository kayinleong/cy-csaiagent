/**
 * e2e/inventory-admin.spec.ts — Admin inventory management e2e scaffold (Phase 3, 03-09)
 *
 * Covers the admin inventory CRUD surface (ADMIN-04):
 *   1. Admin loads /en/inventory → project list renders
 *   2. Admin adds a project → project appears in list
 *   3. Admin hides a project → project hidden from agent-facing search
 *   4. Admin attaches collateral → collateral accessible from the match card
 *   5. Admin runs a CSV import → per-row errors surface for bad rows
 *   6. Non-admin user → redirected (role gate verified)
 *
 * STATUS: SKIPPED — Playwright e2e setup waived per Phase-2 sign-off (03-VALIDATION.md).
 * These specs are scaffolds: structure + selectors + assertions are present, but skipped
 * pending a live deploy (pilot stack). They document the manual/pilot verification path.
 *
 * DO NOT wire live Firebase admin credentials here — admin auth is performed via UI.
 * DO NOT run in CI — requires live App Hosting deploy + admin account.
 *
 * TODO (pilot verification gate, 03-09 FIND-12 / ADMIN-04):
 *   1. Deploy the pilot stack (Firebase App Hosting — SPIKE-DEPLOY).
 *   2. Set NEXT_PUBLIC_APP_URL, E2E_ADMIN_EMAIL, E2E_ADMIN_PASSWORD env vars.
 *   3. Ensure the admin account has role='admin' custom claims (scripts/set-claims.ts).
 *   4. Remove test.skip from each test block and run:
 *        NEXT_PUBLIC_APP_URL=https://your-app.web.app \
 *          E2E_ADMIN_EMAIL=admin.test@example.com \
 *          E2E_ADMIN_PASSWORD=AdminPassword123! \
 *          npx playwright test e2e/inventory-admin.spec.ts
 *
 * Selectors reference (03-08 inventory admin — app/[lang]/(admin)/inventory/):
 *   - [data-testid="project-list"]          → the project list table/grid (project-list.tsx)
 *   - [data-testid="project-row"]           → a single project row in the list
 *   - [data-testid="add-project-button"]    → opens the project add/edit form
 *   - [data-testid="project-form"]          → project creation/edit form (project-form.tsx)
 *   - [data-testid="hide-project-button"]   → hide/archive a project (sets status=hidden)
 *   - [data-testid="collateral-form"]       → collateral attach form (collateral-form.tsx)
 *   - [data-testid="import-form"]           → CSV import form (import-form.tsx)
 *   - [data-testid="import-error-row"]      → per-row error surface in import results
 *   - [aria-label="Import results"]         → import results panel
 *
 * References: ADMIN-04, FIND-02/04, D-08/D-09, 03-08-PLAN.md, 03-09-PLAN.md,
 *             app/[lang]/(admin)/inventory/*
 */

import { test, expect, type Page } from '@playwright/test'

// ─── Config ──────────────────────────────────────────────────────────────────

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'

// Synthetic admin credentials — pre-created with role='admin' custom claims
const SYNTHETIC_ADMIN = {
  email: process.env.E2E_ADMIN_EMAIL ?? 'admin.test@example.com',
  password: process.env.E2E_ADMIN_PASSWORD ?? 'AdminPassword123!',
}

// Synthetic non-admin credentials — for role-gate redirect verification
const SYNTHETIC_NON_ADMIN = {
  email: process.env.E2E_AGENT_EMAIL ?? 'alice.lim.test@example.com',
  password: process.env.E2E_AGENT_PASSWORD ?? 'TestPassword123!',
}

// Synthetic project data (no real PII or real project IDs)
const SYNTHETIC_PROJECT = {
  name: 'Test Project Alam Damai',
  location: 'Cheras, Kuala Lumpur',
  priceBand: '500k_800k',
  tenure: 'freehold',
  bedrooms: '3',
  // These values must match the ProjectDoc schema (src/firebase/collections.ts)
  status: 'active',
  foreignEligible: 'true',
  bumiQuota: '30',
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function signInAs(page: Page, credentials: { email: string; password: string }): Promise<void> {
  await page.goto(`${APP_URL}/en/sign-in`)
  await page.waitForSelector('[data-testid="email-input"], input[type="email"]', {
    timeout: 15000,
  })
  await page.fill('input[type="email"]', credentials.email)
  await page.fill('input[type="password"]', credentials.password)
  await page.click('button[type="submit"]')
  await page.waitForURL(/\/(en|ms|zh)/, { timeout: 20000 })
}

async function goToInventory(page: Page): Promise<void> {
  await page.goto(`${APP_URL}/en/inventory`)
  await page.waitForLoadState('networkidle')
}

// ─── Test suite ───────────────────────────────────────────────────────────────

test.describe('Admin inventory: CRUD + collateral + CSV import + role gate', () => {
  // ── Non-admin redirect (role gate) ──────────────────────────────────────────

  test.skip('ADMIN-01: non-admin user is redirected from /en/inventory', async ({ page }) => {
    // TODO: remove test.skip when pilot stack is live
    await signInAs(page, SYNTHETIC_NON_ADMIN)
    await goToInventory(page)

    // Non-admin should be redirected away from the inventory page
    // The admin route group applies role-gate middleware (proxy.ts + requireRole)
    await expect(page).not.toHaveURL(/\/inventory/, { timeout: 5000 })
    // Expect redirect to the chat page or a 403 page
    const url = page.url()
    expect(url).not.toContain('/inventory')
  })

  // ── Admin loads inventory list ──────────────────────────────────────────────

  test.skip('ADMIN-02: admin loads /en/inventory → project list renders', async ({ page }) => {
    // TODO: remove test.skip when pilot stack is live
    await signInAs(page, SYNTHETIC_ADMIN)
    await goToInventory(page)

    // Wait for the inventory page to load with the project list
    await page.waitForURL(/\/inventory/, { timeout: 10000 })
    const projectList = page.locator('[data-testid="project-list"]')
    await projectList.waitFor({ state: 'visible', timeout: 10000 })

    // The list renders (may be empty if no projects seeded — that's OK)
    expect(await projectList.isVisible()).toBe(true)
  })

  // ── Add project ────────────────────────────────────────────────────────────

  test.skip('ADMIN-03: admin adds a project → appears in project list', async ({ page }) => {
    // TODO: remove test.skip when pilot stack is live
    await signInAs(page, SYNTHETIC_ADMIN)
    await goToInventory(page)

    // Click the Add Project button
    const addButton = page.locator('[data-testid="add-project-button"]')
    await addButton.waitFor({ state: 'visible', timeout: 10000 })
    await addButton.click()

    // Fill out the project form with synthetic data
    const projectForm = page.locator('[data-testid="project-form"]')
    await projectForm.waitFor({ state: 'visible', timeout: 10000 })

    // Fill name field
    const nameInput = projectForm.locator('input[name="name"], input[placeholder*="name"], input[placeholder*="Name"]').first()
    await nameInput.fill(SYNTHETIC_PROJECT.name)

    // Fill location field
    const locationInput = projectForm.locator('input[name="location"], input[placeholder*="location"]').first()
    await locationInput.fill(SYNTHETIC_PROJECT.location)

    // Submit the form
    const submitButton = projectForm.locator('button[type="submit"]').first()
    await submitButton.click()

    // Wait for the project to appear in the list
    const projectList = page.locator('[data-testid="project-list"]')
    await projectList.waitFor({ state: 'visible', timeout: 10000 })

    // Assert the new project name appears in the list
    await expect(projectList).toContainText(SYNTHETIC_PROJECT.name, { timeout: 10000 })
  })

  // ── Hide project ───────────────────────────────────────────────────────────

  test.skip('ADMIN-04: admin hides a project → status changes to hidden', async ({ page }) => {
    // TODO: remove test.skip when pilot stack is live + project seeded
    // Precondition: a project must exist in the list (run ADMIN-03 first or seed directly)
    await signInAs(page, SYNTHETIC_ADMIN)
    await goToInventory(page)

    await page.locator('[data-testid="project-list"]').waitFor({ state: 'visible', timeout: 10000 })

    // Click the Hide button on the first project row
    const firstHideButton = page
      .locator('[data-testid="project-row"]')
      .first()
      .locator('[data-testid="hide-project-button"]')

    await firstHideButton.waitFor({ state: 'visible', timeout: 5000 })
    await firstHideButton.click()

    // Confirm dialog if present
    const confirmButton = page.locator('[data-testid="confirm-hide"], button:has-text("Confirm"), button:has-text("Hide")')
    if (await confirmButton.isVisible({ timeout: 2000 }).catch(() => false)) {
      await confirmButton.click()
    }

    // Assert the project row now shows hidden/archived status
    // The status badge should reflect 'hidden' after the action
    const firstRow = page.locator('[data-testid="project-row"]').first()
    await expect(firstRow).toContainText(/hidden|archived/i, { timeout: 10000 })
  })

  // ── Attach collateral ──────────────────────────────────────────────────────

  test.skip('ADMIN-05: admin attaches collateral to a project', async ({ page }) => {
    // TODO: remove test.skip when pilot stack is live
    // Precondition: a project must exist in the list
    await signInAs(page, SYNTHETIC_ADMIN)
    await goToInventory(page)

    await page.locator('[data-testid="project-list"]').waitFor({ state: 'visible', timeout: 10000 })

    // Open the collateral form for the first project
    const collateralButton = page
      .locator('[data-testid="project-row"]')
      .first()
      .locator('[data-testid="collateral-form"], button:has-text("Collateral"), button:has-text("Attach")')
      .first()

    await collateralButton.waitFor({ state: 'visible', timeout: 5000 })
    await collateralButton.click()

    const collateralForm = page.locator('[data-testid="collateral-form"]')
    await collateralForm.waitFor({ state: 'visible', timeout: 10000 })

    // Fill collateral URL (plain URL — not a Drive API call; D-09/C2)
    const urlInput = collateralForm.locator('input[name="externalUrl"], input[placeholder*="url"], input[placeholder*="URL"]').first()
    await urlInput.fill('https://example.com/synthetic-brochure.pdf')

    // Submit
    const submitButton = collateralForm.locator('button[type="submit"]').first()
    await submitButton.click()

    // Assert collateral was attached (success toast or updated row)
    const successSignal = page.locator('[data-testid="toast-success"], [role="status"]:has-text("success"), [role="alert"]:has-text("saved")')
    const appeared = await successSignal.waitFor({ state: 'visible', timeout: 10000 })
      .then(() => true)
      .catch(() => false)

    // If toast not detected, check the collateral count updated in the row
    if (!appeared) {
      console.warn('Success toast not detected — check collateral-form success signal selector')
    }
    expect(appeared).toBe(true)
  })

  // ── CSV import with per-row error surface ──────────────────────────────────

  test.skip('ADMIN-06: CSV import surfaces per-row errors for bad rows', async ({ page }) => {
    // TODO: remove test.skip when pilot stack is live
    await signInAs(page, SYNTHETIC_ADMIN)
    await goToInventory(page)

    // Open the import form
    const importButton = page.locator(
      '[data-testid="import-form"], button:has-text("Import"), button:has-text("CSV")'
    ).first()
    await importButton.waitFor({ state: 'visible', timeout: 10000 })
    await importButton.click()

    const importForm = page.locator('[data-testid="import-form"]')
    await importForm.waitFor({ state: 'visible', timeout: 10000 })

    // Upload a CSV file with one valid row and one invalid row (missing required field)
    // The CSV importer (import-form.tsx) validates each row and surfaces per-row errors
    const csvContent = [
      'name,location,priceBand,tenure,status,foreignEligible,bumiQuota',
      // Valid row
      'Test Project Bukit Jalil,Bukit Jalil KL,500k_800k,freehold,active,true,30',
      // Invalid row — missing priceBand (required)
      'Bad Project Row,,,,active,true,30',
    ].join('\n')

    // Create a synthetic CSV file buffer and upload it
    const fileInput = importForm.locator('input[type="file"]')
    if (await fileInput.isVisible({ timeout: 2000 }).catch(() => false)) {
      await fileInput.setInputFiles({
        name: 'synthetic-inventory.csv',
        mimeType: 'text/csv',
        buffer: Buffer.from(csvContent),
      })
    } else {
      // Some import forms use drag-and-drop or a textarea paste
      const csvTextarea = importForm.locator('textarea[placeholder*="CSV"], textarea[name="csvContent"]')
      if (await csvTextarea.isVisible({ timeout: 2000 }).catch(() => false)) {
        await csvTextarea.fill(csvContent)
      }
    }

    // Submit the import
    const submitButton = importForm.locator('button[type="submit"]').first()
    await submitButton.click()

    // Wait for import results to surface
    const importResults = page.locator('[aria-label="Import results"], [data-testid="import-results"]')
    await importResults.waitFor({ state: 'visible', timeout: 30000 })

    // Assert per-row errors are surfaced for the bad row
    const errorRows = page.locator('[data-testid="import-error-row"]')
    const errorCount = await errorRows.count()
    expect(errorCount).toBeGreaterThan(0)

    // Assert the valid row was imported (success indication)
    const successRows = page.locator('[data-testid="import-success-row"], [data-state="success"]')
    const successCount = await successRows.count()
    expect(successCount).toBeGreaterThan(0)
  })

  // ── PII gate across all admin operations ──────────────────────────────────

  test.skip('ADMIN-07: admin inventory page contains no real MY phone numbers (PII gate)', async ({
    page,
  }) => {
    // TODO: remove test.skip when pilot stack is live
    await signInAs(page, SYNTHETIC_ADMIN)
    await goToInventory(page)

    const pageText = await page.locator('body').textContent()
    expect(pageText ?? '').not.toMatch(/\+?60\d{9,10}/)

    const icPattern = /\d{6}-\d{2}-\d{4}/
    expect(pageText ?? '').not.toMatch(icPattern)
  })
})

/**
 * Run command (requires live pilot stack + admin account provisioned):
 *   NEXT_PUBLIC_APP_URL=https://your-app-hosting-url.web.app \
 *     E2E_ADMIN_EMAIL=admin.test@example.com \
 *     E2E_ADMIN_PASSWORD=AdminPassword123! \
 *     npx playwright test e2e/inventory-admin.spec.ts
 *
 * Pre-conditions:
 *   - Admin account provisioned: npm run set-claims -- --uid <ADMIN_UID> --role admin
 *   - Pilot agents provisioned: scripts/provision-finder-pilot.ts --apply
 *   - App deployed: Firebase App Hosting (SPIKE-DEPLOY)
 */
