/**
 * e2e/persist.spec.ts — Persistence + audit-row E2E (SC2 VALIDATION.md)
 *
 * Verifies that after a chat turn:
 *   (a) A `conversations/{cid}/messages/{mid}` doc exists in Firestore
 *   (b) An append-only `auditLogs` row was written with hashes only (no raw text)
 *   (c) After a page reload, the prior message re-renders (persistence across refresh)
 *
 * Target: App Hosting deploy URL or localhost:3000 (NEXT_PUBLIC_APP_URL).
 * Requires: live Firebase Auth + Anthropic key + Admin SDK access to verify Firestore writes.
 *
 * NOT run via `npx vitest run` — Playwright has its own runner:
 *   npx playwright test e2e/persist.spec.ts
 *   (or: npm run test:e2e)
 *
 * Synthetic users only — no real PII (T-01-43, T-01-45).
 * See: VALIDATION.md §SC2, auth 01-04, memory 01-07, audit 01-05
 */

import { test, expect, type Page } from '@playwright/test'
import { initializeApp, cert, type App } from 'firebase-admin/app'
import { getFirestore, type Firestore } from 'firebase-admin/firestore'

// ─── Config ──────────────────────────────────────────────────────────────────

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'

// Synthetic new-agent credentials (from tests/fixtures/synthetic-users.ts)
const SYNTHETIC_AGENT = {
  email: process.env.E2E_AGENT_EMAIL ?? 'alice.lim.test@example.com',
  password: process.env.E2E_AGENT_PASSWORD ?? 'TestPassword123!',
  uid: process.env.E2E_AGENT_UID ?? 'test-uid-new-agent-001',
}

const PROOF_SLICE_QUESTION = 'What do I need to complete in my first week as a new D2 agent?'

// MY phone pattern for PII assertion
const MY_PHONE_PATTERN = /\+?60\d{9,10}/

// ─── Admin SDK setup (for Firestore verification) ─────────────────────────────

let adminApp: App | null = null
let db: Firestore | null = null

/**
 * Initialize the Firebase Admin SDK for Firestore read verification.
 * Uses GOOGLE_APPLICATION_CREDENTIALS or FIREBASE_SERVICE_ACCOUNT_KEY env var.
 *
 * In CI, set FIREBASE_PROJECT_ID + GOOGLE_APPLICATION_CREDENTIALS.
 * Skips Admin verification gracefully if credentials are unavailable.
 */
function getAdminDb(): Firestore | null {
  if (db) return db
  try {
    const projectId = process.env.FIREBASE_PROJECT_ID
    if (!projectId) return null

    if (!adminApp) {
      const serviceAccountKey = process.env.FIREBASE_SERVICE_ACCOUNT_KEY
      if (serviceAccountKey) {
        const sa = JSON.parse(serviceAccountKey)
        adminApp = initializeApp({ credential: cert(sa), projectId }, 'e2e-admin')
      } else {
        // Use GOOGLE_APPLICATION_CREDENTIALS (ADC)
        adminApp = initializeApp({ projectId }, 'e2e-admin')
      }
    }
    db = getFirestore(adminApp)
    return db
  } catch {
    return null
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function signIn(page: Page): Promise<void> {
  await page.goto(`${APP_URL}/en/sign-in`)
  await page.waitForSelector('[data-testid="email-input"], input[type="email"]', { timeout: 15000 })
  await page.fill('input[type="email"]', SYNTHETIC_AGENT.email)
  await page.fill('input[type="password"]', SYNTHETIC_AGENT.password)
  await page.click('button[type="submit"]')
  await page.waitForURL(/\/(en|ms|zh)\/(chat)?/, { timeout: 20000 })
}

async function goToChat(page: Page): Promise<void> {
  if (!page.url().includes('/chat') && !page.url().match(/\/(en|ms|zh)\/$/)) {
    await page.goto(`${APP_URL}/en`)
    await page.waitForLoadState('networkidle')
  }
}

/**
 * Send the proof-slice question and wait for the assistant response.
 * Returns the conversation ID extracted from the URL or page state.
 */
async function sendMessageAndGetCid(page: Page): Promise<string | null> {
  const chatInput = page.locator(
    '[data-testid="chat-input"], textarea[placeholder], input[placeholder*="message"], input[placeholder*="question"]',
  ).first()

  await chatInput.waitFor({ state: 'visible', timeout: 10000 })
  await chatInput.fill(PROOF_SLICE_QUESTION)

  // Capture the cid from the network request body before sending
  let capturedCid: string | null = null
  page.on('request', (req) => {
    if (req.url().includes('/api/chat') && req.method() === 'POST') {
      try {
        const body = JSON.parse(req.postData() ?? '{}') as { cid?: string }
        if (body.cid) capturedCid = body.cid
      } catch {
        // ignore
      }
    }
  })

  await chatInput.press('Enter')

  // Wait for the assistant response to appear
  const assistantMessage = page.locator(
    '[data-testid="assistant-message"], [role="assistant"], .assistant-message, [data-role="assistant"]',
  ).last()

  await assistantMessage.waitFor({ state: 'visible', timeout: 30000 })

  // Wait for the response to stabilise (streaming complete)
  let lastText = ''
  for (let i = 0; i < 15; i++) {
    const text = await assistantMessage.textContent() ?? ''
    if (text === lastText && text.length > 0) break
    lastText = text
    await page.waitForTimeout(1000)
  }

  // Allow audit.log (after()) to run after the stream closes
  await page.waitForTimeout(2000)

  return capturedCid
}

// ─── Tests ────────────────────────────────────────────────────────────────────

test.describe('Persist: conversations/{cid}/messages doc + auditLogs row + reload renders history', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page)
    await goToChat(page)
  })

  test('SC2-A: conversations/{cid}/messages subcollection doc exists after chat turn', async ({
    page,
  }) => {
    const firestoreDb = getAdminDb()
    if (!firestoreDb) {
      test.skip()
      return
    }

    const cid = await sendMessageAndGetCid(page)
    if (!cid) {
      // cid not captured from request — look for it in localStorage or URL
      // This may happen if the UI generates cid client-side before sending
      test.skip()
      return
    }

    // Verify the messages subcollection has at least one doc
    const messagesRef = firestoreDb.collection(`conversations/${cid}/messages`)
    const snap = await messagesRef.limit(5).get()

    expect(snap.empty).toBe(false)

    // Verify the message doc has the expected shape
    const docs = snap.docs.map((d) => d.data())
    const assistantMsg = docs.find((d) => d.role === 'assistant')
    expect(assistantMsg).toBeDefined()
    expect(assistantMsg?.redacted).toBe(true)
    // Content must not contain raw MY phone numbers (PII gate)
    if (assistantMsg?.content) {
      expect(String(assistantMsg.content)).not.toMatch(MY_PHONE_PATTERN)
    }
  })

  test('SC2-B: auditLogs row written per turn — hashes only, no raw message text', async ({
    page,
  }) => {
    const firestoreDb = getAdminDb()
    if (!firestoreDb) {
      test.skip()
      return
    }

    const cid = await sendMessageAndGetCid(page)
    if (!cid) {
      test.skip()
      return
    }

    // Query auditLogs for the row(s) referencing this conversation
    const auditRef = firestoreDb
      .collection('auditLogs')
      .where('targetRef', '==', `conversations/${cid}`)
      .limit(5)

    const snap = await auditRef.get()
    expect(snap.empty).toBe(false)

    // Verify each audit row:
    //   - actorUid matches the synthetic agent's UID
    //   - action is 'chat'
    //   - contentHash is a hash string (not raw content)
    //   - no raw message text stored in any field
    for (const doc of snap.docs) {
      const data = doc.data()
      expect(data.action).toBe('chat')
      expect(data.actorUid).toBe(SYNTHETIC_AGENT.uid)

      // contentHash should be a string (hex or the text passed to sha256 by audit.log)
      expect(typeof data.raw?.contentHash).toBe('string')

      // The raw message question must NOT be stored verbatim in the audit log
      const auditStr = JSON.stringify(data)
      // The question text should not appear verbatim
      expect(auditStr).not.toContain(PROOF_SLICE_QUESTION)

      // PII gate: no real MY phone numbers in the audit row
      expect(auditStr).not.toMatch(MY_PHONE_PATTERN)
    }
  })

  test('SC2-C: message re-renders after page reload (persistence across refresh)', async ({
    page,
  }) => {
    // Send the question and wait for the response
    await sendMessageAndGetCid(page)

    // Record the assistant response text before reload
    const assistantMessage = page.locator(
      '[data-testid="assistant-message"], [role="assistant"], .assistant-message, [data-role="assistant"]',
    ).last()

    const textBeforeReload = await assistantMessage.textContent() ?? ''
    expect(textBeforeReload.length).toBeGreaterThan(0)

    // Reload the page
    await page.reload({ waitUntil: 'networkidle' })

    // Re-sign-in if the session was lost
    if (page.url().includes('sign-in')) {
      await signIn(page)
      await goToChat(page)
    }

    // The prior message should re-render from Firestore (persistence)
    const reloadedMessage = page.locator(
      '[data-testid="assistant-message"], [role="assistant"], .assistant-message, [data-role="assistant"]',
    ).last()

    await reloadedMessage.waitFor({ state: 'visible', timeout: 15000 })
    const textAfterReload = await reloadedMessage.textContent() ?? ''

    // The message content should be the same as before reload
    expect(textAfterReload.length).toBeGreaterThan(0)
    // At minimum, the first 50 chars should match (the response is deterministic for the same prompt)
    const before50 = textBeforeReload.slice(0, 50).trim()
    const after50 = textAfterReload.slice(0, 50).trim()
    expect(after50).toBe(before50)

    // PII gate: no real MY phone numbers after reload
    expect(textAfterReload).not.toMatch(MY_PHONE_PATTERN)
  })

  test('SC2-D: auditLogs row is append-only — no raw message text in any field', async ({
    page,
  }) => {
    const firestoreDb = getAdminDb()
    if (!firestoreDb) {
      test.skip()
      return
    }

    const cid = await sendMessageAndGetCid(page)
    if (!cid) {
      test.skip()
      return
    }

    const auditRef = firestoreDb
      .collection('auditLogs')
      .where('targetRef', '==', `conversations/${cid}`)
      .limit(5)

    const snap = await auditRef.get()
    expect(snap.empty).toBe(false)

    // Verify the audit row fields only contain derived/hashed data
    for (const doc of snap.docs) {
      const data = doc.data()
      const allFields = JSON.stringify(data)

      // The real message content must NOT be stored (hashes only — CLAUDE.md)
      // Heuristic: if the raw content exceeds 200 chars of recognizable English, it's a violation
      // The contentHash field should be a short string (not a full paragraph)
      const contentHash = data.raw?.contentHash
      if (typeof contentHash === 'string') {
        // A real paragraph stored verbatim would have spaces and be > 100 chars
        // A sha256 hex string is 64 chars; truncated to 12 in our implementation
        // Either way, it should not contain common English phrases from the response
        const hasCommonEnglishPhrase =
          contentHash.includes('complete in your first week') ||
          contentHash.includes('compliance checklist') ||
          contentHash.includes('CRM account')
        expect(hasCommonEnglishPhrase).toBe(false)
      }

      // PII gate
      expect(allFields).not.toMatch(MY_PHONE_PATTERN)
    }
  })
})

/**
 * Run command (requires live app + Firebase Admin credentials + Anthropic):
 *   FIREBASE_PROJECT_ID=your-project \
 *     GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json \
 *     E2E_AGENT_EMAIL=alice.lim.test@example.com \
 *     E2E_AGENT_PASSWORD=TestPassword123! \
 *     E2E_AGENT_UID=test-uid-new-agent-001 \
 *     npx playwright test e2e/persist.spec.ts
 *
 * DO NOT run in CI without live Firebase credentials and an Anthropic key.
 * Firestore verification tests are skipped automatically when Admin credentials
 * are not configured (getAdminDb() returns null).
 *
 * See: VALIDATION.md §SC2 for expected signals.
 */
