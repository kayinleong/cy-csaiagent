/**
 * scripts/scrape-skool/gdrive-save-state.ts — turn an already-signed-in google-profile
 * into the `google-state.json` the crawler needs (quick-kayinleong-088).
 *
 * WHY THIS EXISTS
 * ---------------
 * `gdrive-login.ts` declares success only when it counts `[data-id]` elements carrying an
 * aria-label inside the target Drive folder, and it writes `google-state.json` ONLY on that
 * path. `gdrive-crawl.ts` then hard-fails without that file ("no google-state.json — run
 * gdrive-login.ts first").
 *
 * That couples a working sign-in to one brittle DOM assumption. Observed 2026-09-05: the
 * operator completed sign-in twice, the browser sat on
 * `drive.google.com/drive/folders/<id>` for over two minutes with content on screen, and the
 * selector matched nothing — so no state was saved and the crawl stayed blocked. Drive's DOM
 * is not a stable contract; a sign-in should not be discarded because a selector drifted.
 *
 * WHAT IT DOES DIFFERENTLY
 * ------------------------
 * Reopens the SAME persistent profile (so no new sign-in is needed), navigates to the
 * folder, and decides readiness from evidence that does not depend on one selector:
 *   1. the URL is a Drive folder URL and NOT an accounts/signin URL
 *   2. the page does not show an access-denied state ("Request access" / "need access")
 *   3. item count probed across SEVERAL selectors, reported but NOT required
 * (1) and (2) gate the save. (3) is printed so a zero count is visible rather than silently
 * fatal — an empty folder is a legitimate state, an unauthenticated one is not.
 *
 * Then it writes `google-state.json`, and clears any stale `google-login.fail` marker.
 *
 *   SCRAPE_OUT=<dir> node_modules/.bin/tsx scripts/scrape-skool/gdrive-save-state.ts
 *
 * Env: SCRAPE_OUT (required — must be the SAME dir the login used, or the profile is not
 * there), GDRIVE_TEST_URL (folder to verify against), GSAVE_HEADLESS=1 to run hidden.
 *
 * ⚠ The profile is an exclusive lock. Any other Playwright process using it (a running
 * gdrive-login.ts) must be stopped first, or launch fails.
 *
 * No credentials are handled here — it only reuses a session a human already established.
 */
import { chromium, type BrowserContext } from 'playwright'
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const OUT = process.env.SCRAPE_OUT || process.cwd()
const USERDATA = join(OUT, 'google-profile')
const STATE = join(OUT, 'google-state.json')
const OKM = join(OUT, 'google-login.ok')
const FAILM = join(OUT, 'google-login.fail')
const TEST_FOLDER =
  process.env.GDRIVE_TEST_URL ||
  'https://drive.google.com/drive/folders/1tVs81glgu49UVZOgZmuWupuE-mamLkK4'
const HEADLESS = process.env.GSAVE_HEADLESS === '1'

// Probed for reporting only — deliberately several, because any one of them can drift.
const ITEM_SELECTORS = [
  '[data-id]',
  '[role="gridcell"]',
  '[role="row"]',
  'c-wiz div[data-target="doc"]',
  'div[aria-label][data-tooltip]',
]

async function launch(): Promise<BrowserContext> {
  const opts = {
    headless: HEADLESS,
    viewport: { width: 1440, height: 1000 },
    args: ['--disable-blink-features=AutomationControlled'],
    ignoreDefaultArgs: ['--enable-automation'],
  }
  try {
    return await chromium.launchPersistentContext(USERDATA, { ...opts, channel: 'chrome' })
  } catch {
    return await chromium.launchPersistentContext(USERDATA, opts)
  }
}

async function main() {
  if (!existsSync(USERDATA)) {
    console.error(`[gsave] no profile at ${USERDATA}`)
    console.error('[gsave] run gdrive-login.ts with the SAME SCRAPE_OUT first.')
    process.exit(1)
  }

  console.log(`[gsave] profile: ${USERDATA}`)
  console.log(`[gsave] opening ${HEADLESS ? 'headless' : 'headed'} and checking Drive access…`)
  const ctx = await launch()
  const page = ctx.pages()[0] ?? (await ctx.newPage())

  await page.goto(TEST_FOLDER, { waitUntil: 'domcontentloaded' }).catch(() => {})
  // Drive renders its grid well after domcontentloaded; give the SPA time to settle rather
  // than racing it. networkidle is unreliable on Drive (long-poll), so this is a plain wait.
  await page.waitForTimeout(9000)

  const url = page.url()
  const signedOut = /accounts\.google\.com|\/signin/i.test(url)
  const onFolder = /drive\.google\.com\/drive\/(u\/\d+\/)?folders\//.test(url)

  const bodyText = await page.evaluate(() => document.body?.innerText?.slice(0, 4000) ?? '').catch(() => '')
  const denied = /request access|you need access|don't have permission|no access/i.test(bodyText)

  const counts: Record<string, number> = {}
  for (const sel of ITEM_SELECTORS) {
    counts[sel] = await page.$$eval(sel, (els) => els.length).catch(() => 0)
  }
  const maxCount = Math.max(0, ...Object.values(counts))

  console.log(`[gsave] url:        ${url.slice(0, 96)}`)
  console.log(`[gsave] on folder:  ${onFolder}`)
  console.log(`[gsave] signed out: ${signedOut}`)
  console.log(`[gsave] denied:     ${denied}`)
  console.log(`[gsave] item probe: ${JSON.stringify(counts)}  → max ${maxCount}`)

  const ok = onFolder && !signedOut && !denied

  if (ok) {
    await ctx.storageState({ path: STATE })
    rmSync(FAILM, { force: true })
    writeFileSync(
      OKM,
      JSON.stringify({ authed: true, itemProbeMax: maxCount, url, at: new Date().toISOString() }),
    )
    console.log(`\n[gsave] SUCCESS — session saved to ${STATE}`)
    if (maxCount === 0) {
      console.log('[gsave] ⚠ zero items matched any selector. Session IS valid (signed in, not')
      console.log('[gsave]   denied), but confirm the folder is not simply empty before crawling.')
    }
  } else {
    writeFileSync(FAILM, JSON.stringify({ url, signedOut, denied, at: new Date().toISOString() }))
    console.log('\n[gsave] FAILED — not a signed-in Drive folder view.')
    if (signedOut) console.log('[gsave]   still on an accounts/signin URL → sign-in did not persist.')
    if (denied) console.log('[gsave]   the account lacks access to this folder → try GDRIVE_TEST_URL=<a folder it can open>.')
  }

  await ctx.close().catch(() => {})
  process.exit(ok ? 0 : 1)
}

main().catch((e) => {
  console.error('[gsave] fatal:', e)
  writeFileSync(FAILM, String(e))
  process.exit(1)
})
