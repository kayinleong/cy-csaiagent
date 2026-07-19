/**
 * Google interactive login (quick-kayinleong-039) — for the Drive-docs crawl.
 *
 * Google blocks automated-browser logins aggressively, so this opens a HEADED
 * real-Chrome window, lets a human sign in fully (incl. 2FA), then verifies the
 * account can actually open a restricted D2 Drive folder before saving the
 * session (google-state.json) for the crawler to reuse.
 *
 * No Google credentials are handled by this script — the human signs in.
 */
import { chromium, type BrowserContext } from "playwright";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";

const OUT = process.env.SCRAPE_OUT || process.cwd();
mkdirSync(OUT, { recursive: true });
const STATE = join(OUT, "google-state.json");
const USERDATA = join(OUT, "google-profile");
const OKM = join(OUT, "google-login.ok");
const FAILM = join(OUT, "google-login.fail");
const TEST_FOLDER = process.env.GDRIVE_TEST_URL || "https://drive.google.com/drive/folders/1tVs81glgu49UVZOgZmuWupuE-mamLkK4?usp=sharing";
const EMAIL = process.env.SKOOL_EMAIL || "";
const WAIT_MS = Number(process.env.GLOGIN_WAIT_MS || 600_000); // 10 min

for (const m of [OKM, FAILM]) rmSync(m, { force: true });

async function launch(): Promise<BrowserContext> {
  const opts = {
    headless: false,
    viewport: { width: 1440, height: 1000 },
    args: ["--disable-blink-features=AutomationControlled"],
    ignoreDefaultArgs: ["--enable-automation"],
  } as const;
  try {
    return await chromium.launchPersistentContext(USERDATA, { ...opts, channel: "chrome" });
  } catch (e) {
    console.log("[glogin] real Chrome unavailable, using bundled Chromium:", (e as Error).message);
    return await chromium.launchPersistentContext(USERDATA, opts);
  }
}

async function googleAuthed(ctx: BrowserContext): Promise<boolean> {
  try {
    const cs = await ctx.cookies("https://drive.google.com");
    return cs.some((c) => /^(SAPISID|SID|__Secure-1PSID|__Secure-3PSID)$/.test(c.name) && (c.value?.length ?? 0) > 10);
  } catch {
    return false;
  }
}

async function main() {
  console.log("[glogin] launching headed browser (opens a Chrome window)…");
  const ctx = await launch();
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  await page.goto("https://accounts.google.com/", { waitUntil: "domcontentloaded" }).catch(() => {});
  await page.waitForTimeout(2000);

  console.log("\n==================================================================");
  console.log(` ACTION NEEDED — sign in to Google as ${EMAIL || "your D2 account"}`);
  console.log("   (the account with access to the D2 project Drive folders).");
  console.log("   Complete any 2FA. I detect success automatically.");
  console.log("==================================================================\n");

  const deadline = Date.now() + WAIT_MS;
  let ok = false;
  let beat = 0;
  while (Date.now() < deadline) {
    await page.waitForTimeout(3000);
    if (ctx.pages().length === 0) {
      console.log("[glogin] window closed before completion");
      break;
    }
    if (await googleAuthed(ctx)) {
      ok = true;
      break;
    }
    const el = Math.floor((Date.now() - (deadline - WAIT_MS)) / 1000);
    if (el - beat >= 30) {
      beat = el;
      console.log(`[glogin] waiting for Google sign-in… (${el}s)`);
    }
  }

  if (ok) {
    await page.goto(TEST_FOLDER, { waitUntil: "domcontentloaded" }).catch(() => {});
    await page.waitForTimeout(5000);
    const url = page.url();
    const blocked = /accounts\.google\.com|signin/i.test(url);
    const denied = await page.getByText(/request access|you need access|don't have permission|no access/i).count().catch(() => 0);
    console.log(`[glogin] signed in. testFolder → blocked=${blocked} accessDenied=${denied > 0}`);
    await ctx.storageState({ path: STATE });
    writeFileSync(OKM, JSON.stringify({ authed: true, blocked, accessDenied: denied > 0, at: new Date().toISOString() }));
    console.log("[glogin] session saved →", STATE);
  } else {
    writeFileSync(FAILM, new Date().toISOString());
    console.log("[glogin] TIMED OUT / not completed");
  }
  await ctx.close().catch(() => {});
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error("[glogin] fatal:", e);
  writeFileSync(FAILM, String(e));
  process.exit(1);
});
