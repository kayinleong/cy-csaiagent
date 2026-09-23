/**
 * quick-kayinleong-091 — targeted re-scrape for the verification pass.
 *
 * A full second crawl of the classroom gets throttled: past roughly 65 projects
 * Skool stops embedding the SSR payload and `desc` comes back empty, so the tail
 * of the roster never gets independently re-verified. Re-running the full crawl
 * just reproduces the same cutoff at the same depth.
 *
 * So this fetches ONLY the named project ids, slowly, with a retry — enough to
 * finish the second pass over the projects the full crawl could not answer for.
 * Read-only; reuses the session saved by scrape-skool/login.ts.
 *
 *   TAIL_IDS=<scratch>/tail-ids.json TAIL_OUT=<scratch>/projects-tail.json \
 *     node_modules/.bin/tsx --env-file=<scratch>/skool.env \
 *     .planning/quick/quick-kayinleong-091/verify-tail-scrape.ts
 */
import { chromium, type Page } from "playwright";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const OUT = process.env.SCRAPE_OUT || process.cwd();
const STATE = join(OUT, "skool-state.json");
const CLASSROOM_URL = process.env.SKOOL_CLASSROOM_URL!;
const BASE = CLASSROOM_URL.split("?")[0];
const IDS: string[] = JSON.parse(readFileSync(process.env.TAIL_IDS!, "utf8"));
const TAIL_OUT = process.env.TAIL_OUT!;
const PAUSE = Number(process.env.TAIL_PAUSE_MS || 6000);
const TRIES = Number(process.env.TAIL_TRIES || 4);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Same rich-text walk as scripts/scrape-skool/scrape.ts — kept local so the
// verification does not depend on the code path it is checking.
function parseDesc(desc?: string): { text: string; links: { text: string; href: string }[] } {
  if (!desc) return { text: "", links: [] };
  let raw = desc;
  const m = desc.match(/^\[v\d+\]([\s\S]*)$/);
  if (m) raw = m[1];
  let nodes: any;
  try {
    nodes = JSON.parse(raw);
  } catch {
    return { text: desc, links: [] };
  }
  const links: { text: string; href: string }[] = [];
  let out = "";
  const walk = (n: any) => {
    if (n == null) return;
    if (Array.isArray(n)) return n.forEach(walk);
    if (typeof n !== "object") return;
    if (n.type === "text" && typeof n.text === "string") {
      out += n.text;
      const href = (n.marks || []).find((mk: any) => mk.type === "link")?.attrs?.href;
      if (href) links.push({ text: n.text, href });
    }
    if (["hardBreak", "paragraph", "horizontalRule", "listItem", "heading"].includes(n.type)) out += "\n";
    if (n.content) walk(n.content);
  };
  walk(nodes);
  return { text: out.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim(), links };
}

const find = (n: any, id: string): any => {
  if (!n) return null;
  if (n.course?.id === id) return n;
  for (const k of n.children || []) {
    const r = find(k, id);
    if (r) return r;
  }
  return null;
};

const readTree = (page: Page) =>
  page
    .evaluate(() => {
      const el = document.getElementById("__NEXT_DATA__");
      return el ? JSON.parse(el.textContent || "{}")?.props?.pageProps?.course ?? null : null;
    })
    .catch(() => null);

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    storageState: STATE,
    viewport: { width: 1440, height: 1000 },
    locale: "en-US",
    timezoneId: "Asia/Kuala_Lumpur",
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  });
  const page = await context.newPage();

  const projects: any[] = [];
  for (const [i, id] of IDS.entries()) {
    let rec: any = null;
    for (let attempt = 1; attempt <= TRIES; attempt++) {
      try {
        await page.goto(`${BASE}?md=${id}`, { waitUntil: "domcontentloaded" });
        await page.waitForTimeout(2500);
        if (page.url().includes("/login")) throw new Error("session expired");
        const node = find(await readTree(page), id);
        const md = node?.course?.metadata || {};
        const parsed = parseDesc(md.desc);
        if (parsed.text.trim()) {
          rec = {
            titleClean: (md.title ?? node?.course?.name ?? "").replace(/🔥/g, "").replace(/\s+/g, " ").trim(),
            id,
            url: `${BASE}?md=${id}`,
            body: { text: parsed.text, links: parsed.links },
          };
          console.log(`[${i + 1}/${IDS.length}] ${rec.titleClean} — desc=${parsed.text.length} (try ${attempt})`);
          break;
        }
        console.log(`[${i + 1}/${IDS.length}] ${id} — empty, retrying (try ${attempt})`);
      } catch (e) {
        console.log(`[${i + 1}/${IDS.length}] ${id} — ${(e as Error).message} (try ${attempt})`);
      }
      await sleep(PAUSE * attempt); // back off harder each retry
    }
    if (!rec) {
      rec = { titleClean: "", id, url: `${BASE}?md=${id}`, body: { text: "", links: [] } };
      console.log(`[${i + 1}/${IDS.length}] ${id} — STILL EMPTY after ${TRIES} tries`);
    }
    projects.push(rec);
    await sleep(PAUSE);
  }

  const got = projects.filter((p) => p.body.text.trim()).length;
  writeFileSync(
    TAIL_OUT,
    JSON.stringify({ scrapedAt: new Date().toISOString(), projects, errors: [] }, null, 2),
  );
  console.log(`\n[tail] ${got}/${IDS.length} projects returned content → ${TAIL_OUT}`);
  await browser.close();
}

main().catch((e) => {
  console.error("[tail] fatal:", e);
  process.exit(1);
});
