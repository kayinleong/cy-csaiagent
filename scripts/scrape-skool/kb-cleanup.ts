/**
 * kb-cleanup.ts — ⚠ DESTRUCTIVE. Delete orphaned kbDocs (quick-kayinleong-039).
 *
 * Targets ledger rows with status "partial": a kbDoc that `createDoc` created but that was
 * never embedded (originally, because the Gemini key was invalid). For each one it deletes
 * the kbDoc, its ingestion job and any stray chunks, then strips the row from the ledger so
 * `to-kb.ts` will re-ingest the file cleanly on the next pass.
 *
 * WHY THIS IS COMMITTED
 * ---------------------
 * It is the canonical definition of what a `partial` ledger row MEANS, and the only tool
 * that acts on one. `rebuild-kb-ledger.ts` is written against that contract and cites this
 * file by name (it deliberately never emits `partial`, precisely because this script deletes
 * those docs and guessing wrong destroys good data). Losing this script would leave the
 * ledger's most destructive status undefined in the repo.
 *
 * There is NO dry-run and NO confirmation prompt — it deletes on sight. Inspect the ledger
 * first (`jq '[.[]|select(.status=="partial")]|length' <ledger>`) so you know the blast
 * radius before running it.
 *
 * Firestore creds are loaded from .env.local into process.env by dotenv below; no value is
 * ever printed. Output is counts only — no chunk text, no personal data.
 *
 * Usage:
 *   node_modules/.bin/tsx scripts/scrape-skool/kb-cleanup.ts
 *
 * Env: KB_LEDGER (explicit ledger path) or SCRAPE_OUT (dir holding drive-kb-ledger.json) —
 * same resolution as rebuild-kb-ledger.ts. Falls back to ./drive-kb-ledger.json in cwd.
 * Exits quietly if no ledger is present.
 */
import * as path from "path";
import * as dotenv from "dotenv";
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
import { readFileSync, writeFileSync, existsSync } from "fs";

const LEDGER = process.env.KB_LEDGER || path.join(process.env.SCRAPE_OUT || process.cwd(), "drive-kb-ledger.json");

(async () => {
  if (!existsSync(LEDGER)) {
    console.log("no ledger — nothing to clean");
    return;
  }
  const { kbDocsRef, kbChunksRef, kbIngestionJobsRef } = await import("@/src/firebase/collections");
  const ledger = JSON.parse(readFileSync(LEDGER, "utf8"));
  const partials = ledger.filter((r: any) => r.status === "partial" && r.docId);
  console.log(`cleaning ${partials.length} orphaned kbDocs…`);
  let docs = 0,
    jobs = 0,
    chunks = 0;
  for (const r of partials) {
    const cs = await kbChunksRef().where("docId", "==", r.docId).get();
    for (const c of cs.docs) {
      await c.ref.delete();
      chunks++;
    }
    await kbDocsRef().doc(r.docId).delete().catch(() => {});
    docs++;
    if (r.jobId) {
      await kbIngestionJobsRef().doc(r.jobId).delete().catch(() => {});
      jobs++;
    }
  }
  const kept = ledger.filter((r: any) => r.status !== "partial");
  writeFileSync(LEDGER, JSON.stringify(kept, null, 2));
  console.log(`deleted ${docs} kbDocs, ${jobs} jobs, ${chunks} chunks. Ledger now ${kept.length} entries.`);
})().catch((e) => {
  console.error("[kb-cleanup] fatal:", e);
  process.exit(1);
});
