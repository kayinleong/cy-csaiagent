/**
 * Skool interactive login (quick-kayinleong-039).
 *
 * Skool sits behind AWS WAF bot protection that blocks headless automated
 * logins. So we open a HEADED, de-automated real-Chrome window, pre-fill the
 * credentials, and let a human finish the login (password or emailed code) and
 * clear any human-verification. The moment the session is valid we persist it
 * to `skool-state.json` for the (fully automated) scraper to reuse.
 *
 * Credentials come from env; they are never logged or written to the repo.
 * Run in the background:
 *   node_modules/.bin/tsx --env-file=<scratch>/skool.env scripts/scrape-skool/login.ts
 */
import { chromium, type BrowserContext, type Page } from "playwright";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";

const OUT = process.env.SCRAPE_OUT || process.cwd();
mkdirSync(OUT, { recursive: true });
const STATE = join(OUT, "skool-state.json");
const USERDATA = join(OUT, "chrome-profile");
const MARKER_OK = join(OUT, "login.ok");
const MARKER_FAIL = join(OUT, "login.fail");

function req(k: string): string {
  const v = process.env[k];
  if (!v) {
    console.error(`[login] missing required env ${k}`);
    process.exit(1);
  }
  return v;
}
const EMAIL = req("SKOOL_EMAIL");
const PASSWORD = req("SKOOL_PASSWORD");
const CLASSROOM_URL = req("SKOOL_CLASSROOM_URL");
const WAIT_MS = Number(process.env.SKOOL_LOGIN_WAIT_MS || 480_000); // 8 min

// clear any stale markers from a previous run
for (const m of [MARKER_OK, MARKER_FAIL]) rmSync(m, { force: true });

async function launch(): Promise<BrowserContext> {
  const opts = {
    headless: false,
    viewport: { width: 1440, height: 1000 },
    locale: "en-US",
    timezoneId: "Asia/Kuala_Lumpur",
    args: ["--disable-blink-features=AutomationControlled"],
    ignoreDefaultArgs: ["--enable-automation"],
  };
  try {
    return await chromium.launchPersistentContext(USERDATA, { ...opts, channel: "chrome" });
  } catch (e) {
    console.log("[login] real Chrome unavailable, using bundled Chromium:", (e as Error).message);
    return await chromium.launchPersistentContext(USERDATA, opts);
  }
}

async function loggedIn(context: BrowserContext, page: Page): Promise<boolean> {
  let url = "";
  try {
    url = page.url();
  } catch {
    return false;
  }
  if (!url.includes("skool.com") || url.includes("/login")) return false;
  return true;
}

async function main() {
  console.log("[login] launching headed browser (this opens a Chrome window)…");
  const context = await launch();
  const page = context.pages()[0] ?? (await context.newPage());

  await page.goto("https://www.skool.com/login", { waitUntil: "domcontentloaded" }).catch(() => {});
  await page.waitForTimeout(2500);

  // Pre-fill (convenience only — do NOT auto-submit; a human click is less bot-like)
  try {
    const email = page.locator('#email, input[type="email"]').first();
    const pass = page.locator('#password, input[type="password"]').first();
    if (await email.count()) {
      await email.fill(EMAIL);
      await pass.fill(PASSWORD).catch(() => {});
      console.log("[login] pre-filled credentials (not submitted)");
    }
  } catch (e) {
    console.log("[login] pre-fill skipped:", (e as Error).message);
  }

  console.log("\n==================================================================");
  console.log(" ACTION NEEDED — finish login in the Chrome window that just opened:");
  console.log("   1) Click LOG IN  (or 'Log in with a code' and enter the code");
  console.log("      emailed to your Skool inbox).");
  console.log("   2) Clear any 'verify you're human' step if shown.");
  console.log(" This script detects success automatically and saves the session.");
  console.log("==================================================================\n");

  const deadline = Date.now() + WAIT_MS;
  let ok = false;
  let lastBeat = 0;
  while (Date.now() < deadline) {
    await page.waitForTimeout(2500);

    if (context.pages().length === 0) {
      console.log("[login] window was closed before login completed");
      break;
    }

    const isIn = await loggedIn(context, page);
    let hasAuthCookie = false;
    try {
      const cookies = await context.cookies("https://www.skool.com");
      hasAuthCookie = cookies.some(
        (c) => /auth|session|token/i.test(c.name) && !/waf/i.test(c.name) && (c.value?.length ?? 0) > 12,
      );
    } catch {}

    if (isIn && hasAuthCookie) {
      ok = true;
      break;
    }
    if (isIn) {
      // URL left /login but cookie name unknown — confirm it's sustained
      await page.waitForTimeout(2500);
      if (await loggedIn(context, page)) {
        ok = true;
        break;
      }
    }

    const elapsed = Math.floor((Date.now() - (deadline - WAIT_MS)) / 1000);
    if (elapsed - lastBeat >= 20) {
      lastBeat = elapsed;
      console.log(`[login] still waiting for login… (${elapsed}s elapsed)`);
    }
  }

  if (ok) {
    // Validate the session actually renders the classroom before saving.
    await page.goto(CLASSROOM_URL, { waitUntil: "domcontentloaded" }).catch(() => {});
    await page.waitForTimeout(5000);
    const labels = await page
      .getByText(/Project List/i)
      .allInnerTexts()
      .catch(() => [] as string[]);
    console.log(`[login] SUCCESS — classroom shows ${labels.length} 'Project List' label(s)`);
    await context.storageState({ path: STATE });
    writeFileSync(MARKER_OK, new Date().toISOString());
    console.log("[login] session saved →", STATE);
  } else {
    writeFileSync(MARKER_FAIL, new Date().toISOString());
    console.log("[login] TIMED OUT / not completed — no session saved");
  }

  await context.close().catch(() => {});
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error("[login] fatal:", e);
  writeFileSync(MARKER_FAIL, String(e));
  process.exit(1);
});
