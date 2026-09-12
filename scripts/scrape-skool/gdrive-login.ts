/**
 * Google interactive login (quick-kayinleong-039) — for the Drive-docs crawl/ingest.
 *
 * Google blocks automated-browser logins aggressively, so this opens a HEADED
 * real-browser window in a PERSISTENT profile and lets a human sign in fully
 * (account chooser + password + 2FA). It starts at the target Drive folder, so a
 * successful sign-in redirects Google straight back to the folder — and success
 * is only declared once the folder's files actually RENDER (not merely when auth
 * cookies appear). The persistent profile (google-profile) is what the headless
 * crawler reuses, so no cross-browser cookie mismatch.
 *
 * No Google credentials are handled here — the human signs in.
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
const TEST_FOLDER = process.env.GDRIVE_TEST_URL || "https://drive.google.com/drive/folders/1tVs81glgu49UVZOgZmuWupuE-mamLkK4";
const EMAIL = process.env.SKOOL_EMAIL || "";
const WAIT_MS = Number(process.env.GLOGIN_WAIT_MS || 600_000); // 10 min

for (const m of [OKM, FAILM]) rmSync(m, { force: true });

async function launch(): Promise<BrowserContext> {
  const opts = {
    headless: false,
    viewport: { width: 1440, height: 1000 },
    args: ["--disable-blink-features=AutomationControlled"],
    ignoreDefaultArgs: ["--enable-automation"],
  };
  try {
    return await chromium.launchPersistentContext(USERDATA, { ...opts, channel: "chrome" });
  } catch {
    return await chromium.launchPersistentContext(USERDATA, opts);
  }
}

async function main() {
  console.log("[glogin] launching headed browser (opens a Chrome window)…");
  const ctx = await launch();
  const page = ctx.pages()[0] ?? (await ctx.newPage());

  // Start AT the target folder — a real sign-in redirects back here (continue=folder).
  await page.goto(TEST_FOLDER, { waitUntil: "domcontentloaded" }).catch(() => {});

  console.log("\n==================================================================");
  console.log(` ACTION NEEDED — sign in to Google in the window as:`);
  console.log(`     ${EMAIL || "your D2 account (the one with Drive access)"}`);
  console.log("   • If an account chooser appears, PICK that account (or 'Use another");
  console.log("     account' and enter it). • Complete the password + any 2FA.");
  console.log("   • WAIT until the Drive folder's files appear on screen.");
  console.log(" I detect success only when the folder actually loads its contents.");
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
    let url = "";
    try {
      url = page.url();
    } catch {
      continue;
    }
    const onFolder = /drive\.google\.com\/drive\/(folders|u\/\d+\/folders)\//.test(url) && !/accounts\.google\.com|signin/i.test(url);
    if (onFolder) {
      const items = await page.$$eval("[data-id]", (els) => els.filter((e) => (e.getAttribute("aria-label") || "").length > 0).length).catch(() => 0);
      if (items > 0) {
        ok = true;
        break;
      }
    }
    const el = Math.floor((Date.now() - (deadline - WAIT_MS)) / 1000);
    if (el - beat >= 30) {
      beat = el;
      console.log(`[glogin] waiting for the Drive folder to load… (${el}s) — current: ${url.slice(0, 60)}`);
    }
  }

  if (ok) {
    await ctx.storageState({ path: STATE });
    writeFileSync(OKM, JSON.stringify({ authed: true, verifiedFolderRender: true, at: new Date().toISOString() }));
    console.log("[glogin] SUCCESS — Drive folder rendered; session + profile saved.");
  } else {
    writeFileSync(FAILM, new Date().toISOString());
    console.log("[glogin] TIMED OUT / folder never rendered — sign-in not completed.");
  }
  await ctx.close().catch(() => {});
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error("[glogin] fatal:", e);
  writeFileSync(FAILM, String(e));
  process.exit(1);
});
