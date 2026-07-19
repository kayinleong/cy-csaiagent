/**
 * Skool "Project List" scraper (quick-kayinleong-039).
 *
 * Reuses the saved session (skool-state.json), reads the classroom course tree
 * once, then opens every project under each "Project List: *" section to pull:
 *   - body text (Skool's [v2] rich-text → plain text + links)
 *   - Vimeo video link/thumbnail
 *   - attachments: `metadata.resources` + any file/asset links embedded in the
 *     body → downloaded (authenticated) and text-extracted via ./extract
 * Output: projects.json (repo root by default) + raw attachments on disk.
 *
 * Env: SKOOL_CLASSROOM_URL, SCRAPE_OUT (session/attachments dir),
 *      PROJECTS_JSON (output path), SKOOL_LIMIT (cap projects, for trial runs),
 *      SKOOL_HEADLESS (default headless).
 * Run:
 *   node_modules/.bin/tsx --env-file=<scratch>/skool.env scripts/scrape-skool/scrape.ts
 */
import { chromium, type APIRequestContext, type Page } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { extractText } from "./extract";

const OUT = process.env.SCRAPE_OUT || process.cwd();
const STATE = join(OUT, "skool-state.json");
const ATTACH_DIR = join(OUT, "attachments");
const PROJECTS_JSON = process.env.PROJECTS_JSON || join(process.cwd(), "projects.json");
const CLASSROOM_URL = process.env.SKOOL_CLASSROOM_URL!;
const BASE = CLASSROOM_URL.split("?")[0]; // https://www.skool.com/d2andco/classroom/50b424ff
const HEADLESS = process.env.SKOOL_HEADLESS !== "0";
const LIMIT = Number(process.env.SKOOL_LIMIT || 0) || Infinity;
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

mkdirSync(ATTACH_DIR, { recursive: true });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------- types ----------
interface TreeNode {
  course: any;
  children?: TreeNode[];
}
interface Attachment {
  source: "resources" | "body";
  url: string;
  label?: string;
  fileName?: string;
  contentType?: string;
  bytes?: number;
  savedTo?: string;
  extract?: { method: string; chars: number; pages?: number; note?: string; text: string };
  error?: string;
}
interface Project {
  section: string;
  sectionId: string;
  title: string;
  titleClean: string;
  heat: number;
  id: string;
  url: string;
  body: { text: string; links: { text: string; href: string }[] };
  video: { link: string; thumbnail?: string } | null;
  attachments: Attachment[];
  raw: { descRaw?: string; resourcesRaw?: string };
  error?: string;
}

// ---------- helpers ----------
const metaOf = (n: TreeNode) => n.course?.metadata || {};
const titleOf = (n: TreeNode) => metaOf(n).title ?? n.course?.name ?? "(untitled)";
const idOf = (n: TreeNode) => n.course?.id as string;

function cleanTitle(t: string) {
  return t.replace(/🔥/g, "").replace(/\s+/g, " ").trim();
}
function heatOf(t: string) {
  return (t.match(/🔥/g) || []).length;
}

/** Parse Skool's `[v2][...]` rich-text into plain text + links + embedded asset urls. */
function parseDesc(desc?: string): { text: string; links: { text: string; href: string }[]; assetUrls: string[] } {
  if (!desc) return { text: "", links: [], assetUrls: [] };
  let raw = desc;
  const m = desc.match(/^\[v\d+\]([\s\S]*)$/);
  if (m) raw = m[1];
  let nodes: any;
  try {
    nodes = JSON.parse(raw);
  } catch {
    return { text: desc, links: [], assetUrls: [] };
  }
  const links: { text: string; href: string }[] = [];
  const assets = new Set<string>();
  let out = "";
  const isFileUrl = (u: string) => /assets\.skool\.com|\.(pdf|docx?|xlsx?|pptx?|csv|png|jpe?g|gif|webp)(\?|#|$)/i.test(u);
  const walk = (n: any) => {
    if (n == null) return;
    if (Array.isArray(n)) return n.forEach(walk);
    if (typeof n !== "object") return;
    if (n.type === "text" && typeof n.text === "string") {
      out += n.text;
      const link = (n.marks || []).find((mk: any) => mk.type === "link");
      const href = link?.attrs?.href;
      if (href) {
        links.push({ text: n.text, href });
        if (isFileUrl(href)) assets.add(href);
      }
    }
    if (n.type === "image" || n.type === "file" || n.type === "attachment") {
      const src = n.attrs?.src || n.attrs?.url || n.attrs?.href;
      if (typeof src === "string") assets.add(src);
    }
    if (n.attrs?.src && typeof n.attrs.src === "string" && isFileUrl(n.attrs.src)) assets.add(n.attrs.src);
    if (["hardBreak", "paragraph", "horizontalRule", "listItem", "heading"].includes(n.type)) out += "\n";
    if (n.content) walk(n.content);
  };
  walk(nodes);
  return { text: out.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim(), links, assetUrls: [...assets] };
}

/** Normalize an unknown `resources` entry into {url,label,fileName}. */
function normalizeResource(r: any): { url?: string; label?: string; fileName?: string } {
  if (!r || typeof r !== "object") return {};
  const url = r.url || r.link || r.href || r.src || r.fileUrl || r.downloadUrl;
  const label = r.label || r.title || r.name || r.text;
  const fileName = r.fileName || r.filename || r.name;
  return { url, label, fileName };
}

function extFromContentType(ct = ""): string {
  const map: Record<string, string> = {
    "application/pdf": "pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
    "application/msword": "doc",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
    "application/vnd.ms-excel": "xls",
    "text/csv": "csv",
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp",
    "image/gif": "gif",
  };
  const base = ct.split(";")[0].trim();
  return map[base] || "bin";
}

function safeName(s: string, fallback: string) {
  const n = (s || "").replace(/[^a-z0-9._-]+/gi, "_").replace(/^_+|_+$/g, "").slice(0, 80);
  return n || fallback;
}

async function downloadAndExtract(
  api: APIRequestContext,
  url: string,
  hint: { label?: string; fileName?: string },
  projectDir: string,
  source: "resources" | "body",
): Promise<Attachment> {
  const att: Attachment = { source, url, label: hint.label, fileName: hint.fileName };
  try {
    const resp = await api.get(url, { headers: { referer: CLASSROOM_URL, "user-agent": UA }, timeout: 45000 });
    if (!resp.ok()) {
      att.error = `HTTP ${resp.status()}`;
      return att;
    }
    const ct = resp.headers()["content-type"] || "";
    const buf = Buffer.from(await resp.body());
    att.contentType = ct;
    att.bytes = buf.length;
    const fname = safeName(hint.fileName || hint.label || "", `file.${extFromContentType(ct)}`);
    const finalName = /\.[a-z0-9]{2,5}$/i.test(fname) ? fname : `${fname}.${extFromContentType(ct)}`;
    const dest = join(projectDir, finalName);
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(dest, buf);
    att.savedTo = dest.replace(OUT + "/", "");
    const ex = await extractText(buf, { filename: finalName, contentType: ct, url });
    att.extract = ex;
    return att;
  } catch (e) {
    att.error = (e as Error).message;
    return att;
  }
}

async function extractTree(page: Page): Promise<TreeNode | null> {
  return page
    .evaluate(() => {
      const el = document.getElementById("__NEXT_DATA__");
      return el ? JSON.parse(el.textContent || "{}")?.props?.pageProps?.course ?? null : null;
    })
    .catch(() => null);
}
function findById(n: TreeNode | null, id: string): TreeNode | null {
  if (!n) return null;
  if (n.course?.id === id) return n;
  for (const k of n.children || []) {
    const r = findById(k, id);
    if (r) return r;
  }
  return null;
}

// ---------- main ----------
async function main() {
  const browser = await chromium.launch({ headless: HEADLESS });
  const context = await browser.newContext({
    storageState: STATE,
    viewport: { width: 1440, height: 1000 },
    locale: "en-US",
    timezoneId: "Asia/Kuala_Lumpur",
    userAgent: UA,
  });
  const page = await context.newPage();

  console.log("[scrape] loading classroom tree…");
  await page.goto(CLASSROOM_URL, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(5000);
  const root = await extractTree(page);
  if (!root) throw new Error("could not read course tree (session expired?)");

  // Build the work list from the 9 Project List sections.
  const work: { section: string; sectionId: string; title: string; id: string }[] = [];
  const sections: string[] = [];
  for (const sec of (root.children || []) as TreeNode[]) {
    const st = titleOf(sec);
    if (!/^Project List/i.test(st)) continue;
    sections.push(st);
    for (const leaf of sec.children || []) {
      work.push({ section: st, sectionId: idOf(sec), title: titleOf(leaf), id: idOf(leaf) });
    }
  }
  console.log(`[scrape] ${sections.length} sections, ${work.length} projects (limit=${LIMIT})`);

  const projects: Project[] = [];
  const errors: { id: string; title: string; error: string }[] = [];
  let done = 0;

  for (const w of work) {
    if (done >= LIMIT) break;
    done++;
    const rec: Project = {
      section: w.section,
      sectionId: w.sectionId,
      title: w.title,
      titleClean: cleanTitle(w.title),
      heat: heatOf(w.title),
      id: w.id,
      url: `${BASE}?md=${w.id}`,
      body: { text: "", links: [] },
      video: null,
      attachments: [],
      raw: {},
    };
    try {
      await page.goto(rec.url, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(1200);
      if (page.url().includes("/login")) throw new Error("redirected to /login — session expired");

      let node = findById(await extractTree(page), w.id);
      let md = node ? metaOf(node) : {};
      if (!md.desc && !md.resources) {
        // one retry in case SSR hadn't populated
        await page.reload({ waitUntil: "domcontentloaded" });
        await page.waitForTimeout(1800);
        node = findById(await extractTree(page), w.id);
        md = node ? metaOf(node) : {};
      }

      rec.raw.descRaw = md.desc;
      rec.raw.resourcesRaw = md.resources;
      const parsed = parseDesc(md.desc);
      rec.body = { text: parsed.text, links: parsed.links };
      if (md.videoLink) rec.video = { link: md.videoLink, thumbnail: md.videoThumbnail };

      // Gather attachment candidates: resources[] + file/asset urls embedded in body.
      const projectDir = join(ATTACH_DIR, safeName(rec.titleClean, w.id));
      const seen = new Set<string>();

      let resources: any[] = [];
      try {
        resources = JSON.parse(md.resources || "[]");
      } catch {}
      for (const r of Array.isArray(resources) ? resources : []) {
        const nr = normalizeResource(r);
        if (!nr.url) {
          // non-file resource (e.g. plain text/link with no url) — keep as body link if any
          continue;
        }
        if (seen.has(nr.url)) continue;
        seen.add(nr.url);
        // Only download file-like/asset urls; record external links without downloading.
        if (/assets\.skool\.com|\.(pdf|docx?|xlsx?|pptx?|csv|png|jpe?g|gif|webp)(\?|#|$)/i.test(nr.url)) {
          rec.attachments.push(await downloadAndExtract(context.request, nr.url, nr, projectDir, "resources"));
        } else {
          rec.attachments.push({ source: "resources", url: nr.url, label: nr.label, fileName: nr.fileName, extract: { method: "link", chars: 0, text: "", note: "external link (not downloaded)" } });
        }
      }
      for (const url of parsed.assetUrls) {
        if (seen.has(url)) continue;
        seen.add(url);
        rec.attachments.push(await downloadAndExtract(context.request, url, {}, projectDir, "body"));
      }

      const nDocs = rec.attachments.filter((a) => a.extract && a.extract.chars > 0).length;
      console.log(
        `[${done}/${work.length}] ${rec.section} :: ${rec.titleClean} — desc=${rec.body.text.length} video=${rec.video ? "y" : "n"} att=${rec.attachments.length}(${nDocs} w/text)`,
      );
    } catch (e) {
      rec.error = (e as Error).message;
      errors.push({ id: w.id, title: w.title, error: rec.error });
      console.log(`[${done}/${work.length}] ${rec.titleClean} — ERROR: ${rec.error}`);
      if (rec.error.includes("session expired")) {
        console.log("[scrape] aborting early — session expired. Saving partial results.");
        projects.push(rec);
        break;
      }
    }
    projects.push(rec);
    await sleep(500 + Math.floor(Math.random() * 400)); // politeness
  }

  const out = {
    source: `skool:${BASE.replace("https://www.skool.com/", "")}`,
    classroomUrl: CLASSROOM_URL,
    scrapedAt: new Date().toISOString(),
    sectionCount: sections.length,
    sections,
    projectCount: projects.length,
    projectTotalDiscovered: work.length,
    attachmentsExtracted: projects.reduce((a, p) => a + p.attachments.filter((x) => x.extract && x.extract.chars > 0).length, 0),
    errors,
    projects,
  };
  writeFileSync(PROJECTS_JSON, JSON.stringify(out, null, 2));
  // also keep a copy next to the session
  writeFileSync(join(OUT, "projects.json"), JSON.stringify(out, null, 2));
  console.log(`\n[scrape] DONE — ${projects.length}/${work.length} projects, ${out.attachmentsExtracted} docs w/ text, ${errors.length} errors`);
  console.log(`[scrape] wrote ${PROJECTS_JSON}`);
  await browser.close();
}

main().catch((e) => {
  console.error("[scrape] fatal:", e);
  process.exit(1);
});
