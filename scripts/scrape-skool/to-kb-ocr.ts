/**
 * OCR ingest (quick-kayinleong-039): image-based PDFs → Gemini vision transcription → KB.
 *
 * Targets the ledger entries the text ingest marked "skipped-empty" that are PDFs
 * (image-based brochures/plans/price charts). Re-downloads each, transcribes with a
 * Gemini vision model, and — if the transcription has real text — ingests it into the
 * KB via the same createDoc → processBatch pipeline (pillar = --pillar, default 'finder',
 * tagged by project).
 *
 * Idempotent + resumable: entries become "ingested-ocr" (done) or "ocr-empty" (OCR also
 * found nothing). Stops cleanly on Gemini rate-limit. Run AFTER the text ingest (they
 * both hold the Google profile and share the Gemini quota).
 *
 *   tsx --env-file=<skool.env> to-kb-ocr.ts            # dry-run (OCR + count, no KB writes)
 *   tsx --env-file=<skool.env> to-kb-ocr.ts --apply    # transcribe + ingest
 *   ... --limit N
 *   ... --pillar coach                                 # load as coach/training content
 */
import * as path from "path";
import * as dotenv from "dotenv";
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

import { readFileSync, writeFileSync, existsSync } from "fs";
import { chromium } from "playwright";

const OUT = process.env.SCRAPE_OUT!;
const PROFILE = path.join(OUT, "google-profile");
const LEDGER = process.env.KB_LEDGER || path.join(OUT, "drive-kb-ledger.json");
const APPLY = process.argv.includes("--apply");
const LIMIT = (() => {
  const i = process.argv.indexOf("--limit");
  return i >= 0 ? Number(process.argv[i + 1]) : Infinity;
})();
/**
 * Target KB pillar (quick-kayinleong-046) — see the twin block in to-kb.ts.
 * Was hard-coded "finder", which made coach-pillar ingestion impossible.
 * Default stays "finder"; pass `--pillar coach` (or KB_PILLAR=coach) for training material.
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
const DELAY_MS = Number(process.env.EMBED_DELAY_MS || 800);
const OCR_MODEL = process.env.OCR_MODEL || "gemini-2.5-flash";
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";
const ADMIN = { uid: "skool-kb-039", role: "admin", tenantId: "d2" };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const OCR_PROMPT = "Transcribe ALL text visible in this document verbatim — headings, labels, numbers, table cells, prices, specs, addresses, floor-plan annotations. Output only the transcribed text; no commentary, no summary.";

async function downloadPdf(api: any, id: string): Promise<Buffer> {
  let resp = await api.get(`https://drive.usercontent.google.com/download?id=${id}&export=download&confirm=t`, { timeout: 120000, maxRedirects: 8, headers: { "user-agent": UA } });
  let ct = resp.headers()["content-type"] || "";
  let buf = Buffer.from(await resp.body());
  if (ct.includes("text/html") && buf.length < 20000 && /confirm=/.test(buf.toString("utf8"))) {
    const html = buf.toString("utf8");
    const conf = html.match(/confirm=([0-9A-Za-z_-]+)/)?.[1];
    const uuid = html.match(/name="uuid" value="([^"]+)"/)?.[1];
    let u2 = `https://drive.usercontent.google.com/download?id=${id}&export=download&confirm=${conf || "t"}`;
    if (uuid) u2 += `&uuid=${uuid}`;
    resp = await api.get(u2, { timeout: 180000, maxRedirects: 8 });
    buf = Buffer.from(await resp.body());
  }
  if (!resp.ok()) throw new Error(`download HTTP ${resp.status()}`);
  return buf;
}

async function main() {
  if (!existsSync(PROFILE)) throw new Error(`no google-profile — run gdrive-login.ts first`);
  if (!existsSync(LEDGER)) throw new Error(`no ledger at ${LEDGER}`);
  const ledger = JSON.parse(readFileSync(LEDGER, "utf8"));
  const targets = ledger.filter((r: any) => r.status === "skipped-empty" && /\.pdf$/i.test(r.name)).slice(0, LIMIT);
  console.log(`[ocr] ${APPLY ? "APPLY" : "DRY-RUN"} — ${targets.length} image-only PDFs to OCR (model ${OCR_MODEL})`);
  if (targets.length === 0) {
    console.log("[ocr] nothing to do (no skipped-empty PDFs in ledger).");
    return;
  }

  const ctx = await chromium.launchPersistentContext(PROFILE, {
    headless: true,
    viewport: { width: 1440, height: 1000 },
    args: ["--disable-blink-features=AutomationControlled"],
    ignoreDefaultArgs: ["--enable-automation"],
  });
  const api = ctx.request;
  const { createGoogleGenerativeAI } = await import("@ai-sdk/google");
  const { generateText } = await import("ai");
  const google = createGoogleGenerativeAI({ apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY });
  const ocrModel = google(OCR_MODEL);
  let createDoc: any, processBatch: any;
  if (APPLY) {
    ({ createDoc } = await import("@/src/kb/crud"));
    ({ processBatch } = await import("@/src/kb/ingest/pipeline"));
  }

  const st = { seen: 0, ocrReal: 0, ocrEmpty: 0, ingested: 0, errors: 0 };
  for (const entry of targets) {
    st.seen++;
    let text = "";
    try {
      const buf = await downloadPdf(api, entry.fileId);
      const res = await generateText({
        model: ocrModel,
        messages: [{ role: "user", content: [{ type: "file", data: buf, mediaType: "application/pdf" }, { type: "text", text: OCR_PROMPT }] }],
      });
      text = (res.text || "").trim();
    } catch (e) {
      const msg = (e as Error).message;
      st.errors++;
      console.log(`  ✗ ${entry.name} — ${msg}`);
      if (/quota|rate|resource_exhausted|429|exceeded/i.test(msg)) {
        console.log(`\n[ocr] Gemini throttled — stopping. Re-run --apply to resume.`);
        break;
      }
      await sleep(DELAY_MS);
      continue;
    }

    if (text.length < MIN_CHARS) {
      st.ocrEmpty++;
      if (APPLY) {
        entry.status = "ocr-empty";
        entry.ocrChars = text.length;
        writeFileSync(LEDGER, JSON.stringify(ledger, null, 2));
      }
      console.log(`  ~ ${entry.name} — OCR ${text.length} chars (still empty) ${APPLY ? "[ocr-empty]" : ""}`);
      await sleep(DELAY_MS);
      continue;
    }
    st.ocrReal++;

    if (!APPLY) {
      console.log(`  ✓ ${entry.name} — OCR ${text.length} chars`);
      await sleep(DELAY_MS);
      continue;
    }

    try {
      const title = (entry.project ? entry.project + " — " : "") + entry.name + " (OCR)";
      const dc = await createDoc(ADMIN, { title, content: text, lang: "en", pillar: PILLAR, category: entry.project || undefined });
      let remaining = 1;
      while (remaining > 0) {
        ({ remaining } = await processBatch(dc.jobId, 10));
        await sleep(DELAY_MS);
      }
      entry.status = "ingested-ocr";
      entry.docId = dc.docId;
      entry.chunks = dc.total;
      entry.ocrChars = text.length;
      writeFileSync(LEDGER, JSON.stringify(ledger, null, 2));
      st.ingested++;
      console.log(`  [${st.ingested}] ${title} → kbDoc ${dc.docId} (${dc.total} chunks, ${text.length} OCR chars)`);
    } catch (e) {
      const msg = (e as Error).message;
      st.errors++;
      console.log(`  ✗ ${entry.name} — ${msg}`);
      if (/quota|rate|resource_exhausted|429|exceeded/i.test(msg)) {
        console.log(`\n[ocr] Gemini throttled — stopping. Re-run --apply to resume.`);
        break;
      }
    }
    await sleep(DELAY_MS);
  }

  await ctx.close();
  console.log(`\n[ocr] ${APPLY ? "APPLIED" : "DRY-RUN DONE"} — processed ${st.seen}, OCR-real ${st.ocrReal}, OCR-empty ${st.ocrEmpty}, ingested ${st.ingested}, errors ${st.errors}`);
  console.log(`[ocr] ledger → ${LEDGER}`);
}

main().catch((e) => {
  console.error("[to-kb-ocr] fatal:", e);
  process.exit(1);
});
