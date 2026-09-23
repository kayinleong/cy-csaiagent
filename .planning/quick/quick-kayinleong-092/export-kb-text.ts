/**
 * quick-kayinleong-092 — export already-ingested Drive text from the KB.
 *
 * Read-only. Pulls every kbDoc + its chunk text out of Firestore and writes a plain
 * JSON file that `attach-kb-text.py` folds into the quick-091 "Raw Data" workbook.
 * No embeddings are fetched, no model is called, nothing is written back — the text
 * was paid for once during the quick-088 ingest and is simply being read back.
 *
 * The project name comes from the title, not from sourcePath: `to-kb.ts` builds titles
 * as "<project> — <filename>" and `to-kb-ocr.ts` appends " (OCR)", which
 * rebuild-kb-ledger.ts:19-26 documents as the only reversible join key
 * (`sourcePath` is just `kb/<docId>`).
 *
 *   KB_OUT=<scratch>/kb-text.json node_modules/.bin/tsx \
 *     --env-file=.env.local .planning/quick/quick-kayinleong-092/export-kb-text.ts
 */
import { writeFileSync } from "node:fs";

const OUT = process.env.KB_OUT!;
const EM_DASH = " — ";
const OCR_SUFFIX = " (OCR)";
const PAGE = 400;

interface DocMeta {
  docId: string;
  title: string;
  project: string;
  fileName: string;
  ocr: boolean;
  pillar?: string;
  status?: string;
  lang?: string;
}

/** "Aetas Seputeh — Sales Kit V1.2 (OCR)" -> project + filename + ocr flag. */
function splitTitle(title: string): { project: string; fileName: string; ocr: boolean } {
  const ocr = title.endsWith(OCR_SUFFIX);
  const base = ocr ? title.slice(0, -OCR_SUFFIX.length) : title;
  const i = base.indexOf(EM_DASH);
  if (i === -1) return { project: "", fileName: base.trim(), ocr };
  return {
    project: base.slice(0, i).trim(),
    fileName: base.slice(i + EM_DASH.length).trim(),
    ocr,
  };
}

async function main() {
  if (!OUT) throw new Error("KB_OUT is required");
  const { kbDocsRef, kbChunksRef } = await import("@/src/firebase/collections");
  const { FieldPath } = await import("firebase-admin/firestore");

  // ---- kbDocs: metadata only ------------------------------------------------
  const docs = new Map<string, DocMeta>();
  {
    let cursor: string | null = null;
    for (;;) {
      let q = kbDocsRef()
        .select("title", "pillar", "status", "lang")
        .orderBy(FieldPath.documentId())
        .limit(PAGE);
      if (cursor) q = q.startAfter(cursor);
      const snap = await q.get();
      if (snap.empty) break;
      snap.forEach((d) => {
        const title = String(d.get("title") || "");
        docs.set(d.id, {
          docId: d.id,
          title,
          ...splitTitle(title),
          pillar: d.get("pillar"),
          status: d.get("status"),
          lang: d.get("lang"),
        });
        cursor = d.id;
      });
      if (snap.size < PAGE) break;
      console.log(`[kb] kbDocs so far: ${docs.size}`);
    }
  }
  console.log(`[kb] kbDocs: ${docs.size}`);

  // ---- kbChunks: text only, never the 1024-d vectors ------------------------
  // Chunks carry no ordering field, so they are concatenated in document-id order,
  // which is the order the ingest wrote them.
  const chunksByDoc = new Map<string, string[]>();
  let chunkCount = 0;
  {
    let cursor: string | null = null;
    for (;;) {
      let q = kbChunksRef()
        .select("docId", "text")
        .orderBy(FieldPath.documentId())
        .limit(PAGE);
      if (cursor) q = q.startAfter(cursor);
      const snap = await q.get();
      if (snap.empty) break;
      snap.forEach((d) => {
        const docId = String(d.get("docId") || "");
        const text = String(d.get("text") || "");
        if (!docId || !text) return;
        if (!chunksByDoc.has(docId)) chunksByDoc.set(docId, []);
        chunksByDoc.get(docId)!.push(text);
        chunkCount++;
        cursor = d.id;
      });
      if (snap.size < PAGE) break;
      if (chunkCount % 4000 < PAGE) console.log(`[kb] kbChunks so far: ${chunkCount}`);
    }
  }
  console.log(`[kb] kbChunks: ${chunkCount}`);

  const out = [...docs.values()].map((m) => {
    const parts = chunksByDoc.get(m.docId) || [];
    const text = parts.join("\n").trim();
    return { ...m, chunks: parts.length, chars: text.length, text };
  });

  const withText = out.filter((d) => d.chars > 0);
  const projects = new Set(withText.map((d) => d.project).filter(Boolean));
  writeFileSync(OUT, JSON.stringify({ exportedAt: new Date().toISOString(), docs: out }, null, 2));
  console.log(
    `\n[kb] ${out.length} docs (${withText.length} with text) across ${projects.size} project names`,
  );
  console.log(`[kb] longest doc: ${Math.max(0, ...out.map((d) => d.chars))} chars`);
  console.log(`[kb] wrote ${OUT}`);
  process.exit(0);
}

main().catch((e) => {
  console.error("[kb] fatal:", (e as Error).message);
  process.exit(1);
});
