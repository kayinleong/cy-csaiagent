/**
 * Google Drive crawler (quick-kayinleong-039).
 *
 * Reuses the saved Google session, walks every "Project List" project's Drive
 * folders (recursively into subfolders), classifies every file, and:
 *   - downloads + text-extracts DOCUMENTS (pdf/doc/docx/xlsx + native Google
 *     Docs/Sheets/Slides via export endpoints)
 *   - downloads IMAGES (saved, not text-extracted)
 *   - records VIDEOS in the manifest but only downloads them when GDRIVE_VIDEOS=1
 *     (bulk video is huge and has no KB value)
 *
 * Output: drive-documents.json (repo root) — full manifest + extracted text.
 * Files saved under <SCRAPE_OUT>/drive/. Resumable via drive-manifest.json.
 *
 * Env: PROJECTS_JSON, SCRAPE_OUT, GDRIVE_PHASE(enumerate|download|all),
 *      GDRIVE_VIDEOS(0/1), GDRIVE_FOLDER_LIMIT(N), DRIVE_TEST_URL(one folder).
 */
import { chromium, type Browser, type BrowserContext } from "playwright";
import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { extractText } from "./extract";

const OUT = process.env.SCRAPE_OUT!;
const PROFILE = join(OUT, "google-profile");
const STATE = join(OUT, "google-state.json");
const DRIVE_DIR = join(OUT, "drive");
const MANIFEST = join(OUT, "drive-manifest.json");
const INDEX = process.env.DRIVE_INDEX || join(process.cwd(), "drive-documents.json");
const PROJECTS_JSON = process.env.PROJECTS_JSON || join(process.cwd(), "projects.json");
const PHASE = process.env.GDRIVE_PHASE || "all";
const INCLUDE_VIDEO = process.env.GDRIVE_VIDEOS === "1";
const FOLDER_LIMIT = Number(process.env.GDRIVE_FOLDER_LIMIT || 0) || Infinity;
const TEST_URL = process.env.DRIVE_TEST_URL || "";
mkdirSync(DRIVE_DIR, { recursive: true });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface DItem {
  id: string;
  name: string;
  type: string; // pdf|image|video|gdoc|sheet|slides|doc|folder|other
  native: boolean; // native Google file (needs export)
  isFolder: boolean;
}
interface FileRec {
  id: string;
  name: string;
  type: string;
  folderId: string;
  folderName: string;
  projects: string[];
  savedTo?: string;
  bytes?: number;
  extract?: { method: string; chars: number; pages?: number; note?: string; text: string };
  error?: string;
}
interface FolderRec {
  id: string;
  name: string;
  parentId?: string;
  projects: string[];
}

const folderUrl = (id: string) => `https://drive.google.com/drive/folders/${id}`;
const safe = (s: string, f: string) => (s || "").replace(/[^a-z0-9._-]+/gi, "_").replace(/^_+|_+$/g, "").slice(0, 90) || f;

function classify(label: string): DItem | null {
  const isFile = /More info/i.test(label);
  let name = label.replace(/\s*More info.*$/i, "").trim();
  let typeWord = "";
  const tm = name.match(/\s(PDF|Image|Video|Audio|Zip archive|Google Docs|Google Sheets|Google Slides|Google Forms|Microsoft Word|Microsoft Excel|Microsoft PowerPoint|Text|Folder|Spreadsheet|Document|Presentation)$/i);
  if (tm) {
    typeWord = tm[1].toLowerCase();
    name = name.slice(0, tm.index).trim();
  }
  if (!name) return null;
  // Folders carry a "Folder" type word (often with "More info" too) or no type at all.
  if (typeWord === "folder" || (!isFile && !tm)) return { id: "", name, type: "folder", native: false, isFolder: true };
  const ext = (name.match(/\.([a-z0-9]{2,5})$/i)?.[1] || "").toLowerCase();
  const native = /google (docs|sheets|slides|forms)/.test(typeWord);
  let type = "other";
  if (/pdf/.test(typeWord) || ext === "pdf") type = "pdf";
  else if (/image/.test(typeWord) || ["jpg", "jpeg", "png", "gif", "webp", "heic"].includes(ext)) type = "image";
  else if (/video/.test(typeWord) || ["mp4", "mov", "avi", "mkv", "webm", "m4v"].includes(ext)) type = "video";
  else if (/google docs/.test(typeWord)) type = "gdoc";
  else if (/google sheets/.test(typeWord)) type = "sheet";
  else if (/google slides/.test(typeWord)) type = "slides";
  else if (/google forms/.test(typeWord)) type = "form";
  else if (/word/.test(typeWord) || ["doc", "docx"].includes(ext)) type = "doc";
  else if (/excel|spreadsheet/.test(typeWord) || ["xls", "xlsx", "csv"].includes(ext)) type = "sheet";
  else if (/powerpoint|presentation/.test(typeWord) || ["ppt", "pptx"].includes(ext)) type = "slides";
  return { id: "", name, type, native, isFolder: false };
}

let _browser: Browser | undefined;
async function open(): Promise<BrowserContext> {
  // Bundled Chromium + saved storageState is the proven path (see gdrive-probe).
  _browser = await chromium.launch({ headless: true });
  return _browser.newContext({
    storageState: STATE,
    viewport: { width: 1440, height: 1200 },
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  });
}

async function listFolder(ctx: BrowserContext, id: string): Promise<{ name: string; items: DItem[] }> {
  const page = await ctx.newPage();
  try {
    await page.goto(folderUrl(id), { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(3000);
    if (/accounts\.google\.com|signin/i.test(page.url())) throw new Error("not-authed");
    let prev = -1;
    for (let i = 0; i < 25; i++) {
      const n = await page.$$eval("[data-id]", (els) => els.length);
      if (n === prev) break;
      prev = n;
      await page.mouse.wheel(0, 4000);
      await page.waitForTimeout(600);
    }
    const name = (await page.title()).replace(/ - Google Drive$/, "").trim() || id;
    const raw = await page.$$eval("[data-id]", (els) => {
      const seen = new Set<string>();
      const out: { id: string; label: string }[] = [];
      for (const e of els) {
        const id = e.getAttribute("data-id") || "";
        const label = (e.getAttribute("aria-label") || "").trim();
        if (id && label && !seen.has(id)) {
          seen.add(id);
          out.push({ id, label });
        }
      }
      return out;
    });
    const items: DItem[] = [];
    for (const r of raw) {
      const c = classify(r.label);
      if (c) items.push({ ...c, id: r.id });
    }
    return { name, items };
  } finally {
    await page.close();
  }
}

// ---------- enumerate ----------
async function enumerate(ctx: BrowserContext): Promise<{ folders: FolderRec[]; files: FileRec[] }> {
  // seed folders from projects.json (folderId -> project titles)
  const data = JSON.parse(readFileSync(PROJECTS_JSON, "utf8"));
  const seed = new Map<string, Set<string>>();
  if (TEST_URL) {
    const m = TEST_URL.match(/folders\/([A-Za-z0-9_-]+)/);
    if (m) seed.set(m[1], new Set(["<test>"]));
  } else {
    for (const p of data.projects) {
      for (const l of p.body.links || []) {
        const m = String(l.href).match(/drive\.google\.com\/drive\/folders\/([A-Za-z0-9_-]+)/);
        if (m) {
          if (!seed.has(m[1])) seed.set(m[1], new Set());
          seed.get(m[1])!.add(p.titleClean);
        }
      }
    }
  }

  const queue: { id: string; parentId?: string; projects: string[] }[] = [...seed].map(([id, ps]) => ({ id, projects: [...ps] }));
  const visited = new Set<string>();
  const folders: FolderRec[] = [];
  const files: FileRec[] = [];
  let processed = 0;

  while (queue.length && processed < FOLDER_LIMIT) {
    const f = queue.shift()!;
    if (visited.has(f.id)) continue;
    visited.add(f.id);
    processed++;
    let items: DItem[] = [];
    let fname = f.id;
    try {
      const r = await listFolder(ctx, f.id);
      fname = r.name;
      items = r.items;
    } catch (e) {
      console.log(`  ! folder ${f.id} error: ${(e as Error).message}`);
    }
    folders.push({ id: f.id, name: fname, parentId: f.parentId, projects: f.projects });
    let sub = 0,
      fil = 0;
    for (const it of items) {
      if (it.isFolder) {
        sub++;
        if (!visited.has(it.id)) queue.push({ id: it.id, parentId: f.id, projects: f.projects });
      } else {
        fil++;
        files.push({ id: it.id, name: it.name, type: it.type, folderId: f.id, folderName: fname, projects: f.projects });
      }
    }
    console.log(`[enum ${processed}] "${fname}" — ${fil} files, ${sub} subfolders (queue ${queue.length})`);
    writeFileSync(MANIFEST, JSON.stringify({ folders, files }, null, 2));
    await sleep(400 + Math.floor(Math.random() * 300));
  }
  return { folders, files };
}

// ---------- download ----------
async function downloadOne(ctx: BrowserContext, rec: FileRec, native: boolean): Promise<void> {
  const api = ctx.request;
  const { id, type } = rec;
  let url: string;
  if (type === "gdoc") url = `https://docs.google.com/document/d/${id}/export?format=txt`;
  else if (type === "sheet" && native) url = `https://docs.google.com/spreadsheets/d/${id}/export?format=csv`;
  else if (type === "slides" && native) url = `https://docs.google.com/presentation/d/${id}/export?format=pdf`;
  else if (type === "form") {
    rec.error = "google form (no export)";
    return;
  } else url = `https://drive.usercontent.google.com/download?id=${id}&export=download&confirm=t`;

  try {
    let resp = await api.get(url, { timeout: 120000, maxRedirects: 8 });
    let ct = resp.headers()["content-type"] || "";
    let buf = Buffer.from(await resp.body());
    // virus-scan interstitial for large files
    if (ct.includes("text/html") && buf.length < 20000 && /confirm=/.test(buf.toString("utf8"))) {
      const html = buf.toString("utf8");
      const conf = html.match(/confirm=([0-9A-Za-z_-]+)/)?.[1];
      const uuid = html.match(/name="uuid" value="([^"]+)"/)?.[1];
      let u2 = `https://drive.usercontent.google.com/download?id=${id}&export=download&confirm=${conf || "t"}`;
      if (uuid) u2 += `&uuid=${uuid}`;
      resp = await api.get(u2, { timeout: 180000, maxRedirects: 8 });
      ct = resp.headers()["content-type"] || "";
      buf = Buffer.from(await resp.body());
    }
    if (!resp.ok()) {
      rec.error = `HTTP ${resp.status()}`;
      return;
    }
    const projectDir = join(DRIVE_DIR, safe(rec.projects[0] || rec.folderName, rec.folderId), safe(rec.folderName, rec.folderId));
    mkdirSync(projectDir, { recursive: true });
    let fname = rec.name;
    if (type === "gdoc") fname += ".txt";
    if (type === "sheet" && native) fname += ".csv";
    if (type === "slides" && native) fname += ".pdf";
    const dest = join(projectDir, safe(fname, `${id}`));
    writeFileSync(dest, buf);
    rec.savedTo = dest.replace(OUT + "/", "");
    rec.bytes = buf.length;
    // extract text for document-ish types
    if (["pdf", "doc", "sheet", "slides", "gdoc"].includes(type)) {
      rec.extract = await extractText(buf, { filename: fname, contentType: ct, url });
    } else if (type === "image") {
      rec.extract = { method: "skip", chars: 0, text: "", note: "image saved, not text-extracted" };
    }
  } catch (e) {
    rec.error = (e as Error).message;
  }
}

async function main() {
  if (!existsSync(STATE)) throw new Error("no google-state.json — run gdrive-login.ts first");
  const ctx = await open();

  let manifest: { folders: FolderRec[]; files: FileRec[] };
  if (PHASE === "download" && existsSync(MANIFEST)) {
    manifest = JSON.parse(readFileSync(MANIFEST, "utf8"));
    console.log(`[crawl] loaded manifest: ${manifest.folders.length} folders, ${manifest.files.length} files`);
  } else {
    console.log("[crawl] enumerating…");
    manifest = await enumerate(ctx);
  }

  // type histogram
  const hist: Record<string, number> = {};
  for (const f of manifest.files) hist[f.type] = (hist[f.type] || 0) + 1;
  console.log(`\n[crawl] folders=${manifest.folders.length} files=${manifest.files.length}`);
  console.log("[crawl] file types:", JSON.stringify(hist));

  if (PHASE !== "enumerate") {
    const want = (t: string) => t !== "video" || INCLUDE_VIDEO;
    const targets = manifest.files.filter((f) => want(f.type) && f.type !== "form");
    console.log(`\n[crawl] downloading ${targets.length} files (videos ${INCLUDE_VIDEO ? "included" : "SKIPPED"})…`);
    let n = 0;
    for (const rec of targets) {
      n++;
      const native = ["gdoc", "sheet", "slides"].includes(rec.type); // heuristic; native handled in downloadOne
      await downloadOne(ctx, rec, native);
      const tag = rec.error ? `ERR ${rec.error}` : `${rec.extract ? rec.extract.chars + "c" : (rec.bytes || 0) + "b"}`;
      if (n % 10 === 0 || rec.extract?.chars || rec.error) console.log(`  [${n}/${targets.length}] ${rec.type} ${rec.name.slice(0, 40)} — ${tag}`);
      writeFileSync(INDEX, JSON.stringify(buildIndex(manifest), null, 2));
      await sleep(300 + Math.floor(Math.random() * 300));
    }
  }

  writeFileSync(INDEX, JSON.stringify(buildIndex(manifest), null, 2));
  const docs = manifest.files.filter((f) => f.extract && f.extract.chars > 0).length;
  console.log(`\n[crawl] DONE — ${manifest.files.length} files, ${docs} with extracted text. Index → ${INDEX}`);
  await ctx.close();
  await _browser?.close();
}

function buildIndex(m: { folders: FolderRec[]; files: FileRec[] }) {
  const hist: Record<string, number> = {};
  let bytes = 0;
  for (const f of m.files) {
    hist[f.type] = (hist[f.type] || 0) + 1;
    bytes += f.bytes || 0;
  }
  return {
    source: "google-drive:d2 project folders",
    crawledAt: new Date().toISOString(),
    folderCount: m.folders.length,
    fileCount: m.files.length,
    fileTypes: hist,
    downloadedBytes: bytes,
    documentsWithText: m.files.filter((f) => f.extract && f.extract.chars > 0).length,
    folders: m.folders,
    files: m.files,
  };
}

main().catch((e) => {
  console.error("[crawl] fatal:", e);
  process.exit(1);
});
