/**
 * Google Drive documents → KB ingestion (quick-kayinleong-039).
 *
 * Reads drive-documents.json (the file index), downloads each text-bearing doc
 * with the saved Google session (persistent profile), extracts text, and:
 *   - DRY-RUN (default): extract + chunk + count. NO KB writes, NO embeddings.
 *   - --apply: createDoc() → processBatch() through the app's real KB pipeline
 *     (chunk + Gemini embed → kbDocs/kbChunks), pillar = --pillar (default 'finder'),
 *     category = project.
 *
 * Idempotent + resumable via a local ledger (drive-kb-ledger.json): already-done
 * Drive file IDs are skipped. Empty/image-only docs (< KB_MIN_CHARS after extract)
 * are recorded as needing OCR and skipped.
 *
 * Auth: reuses the persistent google-profile (same browser as gdrive-login) so
 * headless Drive access works. Firebase creds load from .env.local.
 *
 * Run:
 *   tsx --env-file=.env.local ... to-kb.ts            # dry-run
 *   tsx --env-file=.env.local ... to-kb.ts --apply    # write to KB
 *   ... --limit N                                      # cap for a trial
 *   ... --pillar coach                                 # load as coach/training content
 */
import * as path from "path";
import * as dotenv from "dotenv";
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

import { readFileSync, writeFileSync, existsSync } from "fs";
import { chromium } from "playwright";
import { extractText } from "./extract";

const OUT = process.env.SCRAPE_OUT!;
const PROFILE = path.join(OUT, "google-profile");
const DRIVE_INDEX = process.env.DRIVE_INDEX || path.resolve(process.cwd(), "drive-documents.json");
const LEDGER = process.env.KB_LEDGER || path.join(OUT, "drive-kb-ledger.json");
const APPLY = process.argv.includes("--apply");
const LIMIT = (() => {
  const i = process.argv.indexOf("--limit");
  return i >= 0 ? Number(process.argv[i + 1]) : Infinity;
})();
/**
 * Target KB pillar (quick-kayinleong-046).
 *
 * Was hard-coded to "finder" at the createDoc() call below, which meant this loader
 * could ONLY ever produce finder-pillar chunks — so no `pillar:'coach'` content could
 * be ingested by any tooling in the repo, and every Coach retrieval returned
 * `kb_miss` because the pre-filtered candidate set was literally empty.
 *
 * Default stays "finder" so the existing Drive-collateral corpus ingests exactly as
 * before. Pass `--pillar coach` (or KB_PILLAR=coach) to load training material.
 */
const PILLAR = (() => {
  const i = process.argv.indexOf("--pillar");
  const raw = (i >= 0 ? process.argv[i + 1] : process.env.KB_PILLAR) || "finder";
  if (raw !== "coach" && raw !== "finder" && raw !== "reply") {
    throw new Error(`--pillar must be coach | finder | reply (got: ${raw})`);
  }
  return raw;
})();
const MIN_CHARS = Number(process.env.KB_MIN_CHARS || 200);
const DELAY_MS = Number(process.env.EMBED_DELAY_MS || 400);
const TEXT_TYPES = ["pdf", "doc", "sheet", "slides", "gdoc"];
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";
const ADMIN = { uid: "skool-kb-039", role: "admin", tenantId: "d2" };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const hasExt = (n: string) => /\.[a-z0-9]{2,5}$/i.test(n);

function downloadPlan(f: { id: string; name: string; type: string }) {
  const native = !hasExt(f.name);
  if (f.type === "gdoc") return { url: `https://docs.google.com/document/d/${f.id}/export?format=txt`, name: `${f.name}.txt`, ct: "text/plain" };
  if (f.type === "sheet" && native) return { url: `https://docs.google.com/spreadsheets/d/${f.id}/export?format=csv`, name: `${f.name}.csv`, ct: "text/csv" };
  if (f.type === "slides" && native) return { url: `https://docs.google.com/presentation/d/${f.id}/export?format=pdf`, name: `${f.name}.pdf`, ct: "application/pdf" };
  return { url: `https://drive.usercontent.google.com/download?id=${f.id}&export=download&confirm=t`, name: f.name, ct: "" };
}

async function fetchDoc(api: any, f: any): Promise<{ buffer: Buffer; ct: string; name: string } | { error: string }> {
  const plan = downloadPlan(f);
  try {
    let resp = await api.get(plan.url, { timeout: 120000, maxRedirects: 8, headers: { "user-agent": UA } });
    let ct = resp.headers()["content-type"] || plan.ct || "";
    let buf = Buffer.from(await resp.body());
    // Drive virus-scan interstitial for large files
    if (ct.includes("text/html") && buf.length < 20000 && /confirm=/.test(buf.toString("utf8"))) {
      const html = buf.toString("utf8");
      const conf = html.match(/confirm=([0-9A-Za-z_-]+)/)?.[1];
      const uuid = html.match(/name="uuid" value="([^"]+)"/)?.[1];
      let u2 = `https://drive.usercontent.google.com/download?id=${f.id}&export=download&confirm=${conf || "t"}`;
      if (uuid) u2 += `&uuid=${uuid}`;
      resp = await api.get(u2, { timeout: 180000, maxRedirects: 8 });
      ct = resp.headers()["content-type"] || "";
      buf = Buffer.from(await resp.body());
    }
    if (!resp.ok()) return { error: `HTTP ${resp.status()}` };
    if (/accounts\.google\.com|signin/i.test(resp.url())) return { error: "not-authed (redirected to sign-in)" };
    return { buffer: buf, ct, name: plan.name };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

function loadLedger(): any[] {
  if (!existsSync(LEDGER)) return [];
  try {
    return JSON.parse(readFileSync(LEDGER, "utf8"));
  } catch {
    return [];
  }
}

async function main() {
  if (!existsSync(PROFILE)) throw new Error(`no google-profile at ${PROFILE} — run gdrive-login.ts first`);
  const data = JSON.parse(readFileSync(DRIVE_INDEX, "utf8"));
  const files = (data.files || []).filter((f: any) => TEXT_TYPES.includes(f.type));
  const ledger = loadLedger();
  // Only fully-done docs are skipped; "partial" docs are resumed (not skipped).
  const done = new Set<string>(ledger.filter((r: any) => ["ingested", "ingested-ocr", "ocr-empty", "skipped-empty"].includes(r.status)).map((r: any) => r.fileId));
  console.log(`[to-kb] ${APPLY ? "APPLY" : "DRY-RUN"} — ${files.length} text-bearing docs in index, ${done.size} already in ledger`);

  const ctx = await chromium.launchPersistentContext(PROFILE, {
    headless: true,
    viewport: { width: 1440, height: 1000 },
    args: ["--disable-blink-features=AutomationControlled"],
    ignoreDefaultArgs: ["--enable-automation"],
  });
  const api = ctx.request;

  const { chunk } = await import("@/src/kb/ingest/chunker");
  let createDoc: any, processBatch: any;
  if (APPLY) {
    ({ createDoc } = await import("@/src/kb/crud"));
    ({ processBatch } = await import("@/src/kb/ingest/pipeline"));
  }

  const st = { seen: 0, textReal: 0, imageOnly: 0, chunks: 0, ingested: 0, errors: 0, skipped: 0 };
  const targets = files.slice(0, LIMIT);
  for (const f of targets) {
    if (done.has(f.id)) {
      st.skipped++;
      continue;
    }
    st.seen++;
    const dl = await fetchDoc(api, f);
    if ("error" in dl) {
      st.errors++;
      console.log(`  ✗ ${f.name} — ${dl.error}`);
      await sleep(DELAY_MS);
      continue;
    }
    const ex = await extractText(dl.buffer, { filename: dl.name, contentType: dl.ct });
    const text = (ex.text || "").trim();
    const project = (f.projects && f.projects[0]) || f.folderName || "";

    if (text.length < MIN_CHARS) {
      st.imageOnly++;
      ledger.push({ fileId: f.id, name: f.name, project, status: "skipped-empty", chars: text.length, method: ex.method });
      writeFileSync(LEDGER, JSON.stringify(ledger, null, 2));
      done.add(f.id);
      console.log(`  ~ ${f.name} — ${text.length} chars (image/empty; needs OCR) [skipped]`);
      await sleep(DELAY_MS);
      continue;
    }

    const chunks = chunk(text);
    st.textReal++;
    st.chunks += chunks.length;

    if (!APPLY) {
      console.log(`  ✓ ${f.name} — ${text.length} chars → ${chunks.length} chunks`);
      await sleep(DELAY_MS);
      continue;
    }

    const title = (project ? project + " — " : "") + f.name;
    // Resume a partial doc (created but not fully embedded) instead of re-creating it.
    let entry: any = ledger.find((r: any) => r.fileId === f.id && r.status === "partial");
    try {
      if (!entry) {
        const res = await createDoc(ADMIN, { title, content: text, lang: "en", pillar: PILLAR, category: project || undefined });
        entry = { fileId: f.id, name: f.name, project, status: "partial", docId: res.docId, jobId: res.jobId, total: res.total };
        ledger.push(entry);
        writeFileSync(LEDGER, JSON.stringify(ledger, null, 2));
      }
      let remaining = 1;
      while (remaining > 0) {
        ({ remaining } = await processBatch(entry.jobId, 10));
        await sleep(DELAY_MS);
      }
      entry.status = "ingested";
      writeFileSync(LEDGER, JSON.stringify(ledger, null, 2));
      done.add(f.id);
      st.ingested++;
      console.log(`  [${st.ingested}] ${title} → kbDoc ${entry.docId} (${entry.total} chunks)`);
    } catch (e) {
      const msg = (e as Error).message;
      st.errors++;
      console.log(`  ✗ ${f.name} — ${msg}`);
      if (/quota|rate|resource_exhausted|429|exceeded/i.test(msg)) {
        console.log(`\n[to-kb] Gemini throttled — stopping cleanly. Progress saved; re-run --apply to resume from the ledger.`);
        break;
      }
    }
    await sleep(DELAY_MS);
  }

  await ctx.close();
  console.log(`\n[to-kb] ${APPLY ? "APPLIED" : "DRY-RUN DONE"} — processed ${st.seen}, text-real ${st.textReal}, image/empty ${st.imageOnly}, errors ${st.errors}, skipped(ledger) ${st.skipped}`);
  console.log(`[to-kb] chunks ${APPLY ? "embedded" : "that would embed"}: ${st.chunks}${APPLY ? `, kbDocs created: ${st.ingested}` : ""}`);
  console.log(`[to-kb] ledger → ${LEDGER}`);
}

main().catch((e) => {
  console.error("[to-kb] fatal:", e);
  process.exit(1);
});
