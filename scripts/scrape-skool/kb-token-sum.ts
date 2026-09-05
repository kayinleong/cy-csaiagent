/**
 * kb-token-sum.ts — read-only accounting: sum Gemini embedding tokens across the KB.
 *
 * Every kbChunks doc stores `tokens` (gpt-tokenizer countTokens of the chunk text),
 * written by the ingest pipeline. Summing them gives the EXACT Gemini embedding-token
 * total for ALL KB ingestion (Drive text + OCR-transcribed text + WhatsApp transcript).
 * Also counts kbDocs and OCR docs (title ends "(OCR)") to size the OCR vision pass.
 *
 * Fetches ONLY the `tokens` / `title` fields via .select() — never the 1024-d vectors.
 *   tsx --env-file=.env.local scripts/scrape-skool/kb-token-sum.ts
 */
import * as path from "path";
import * as dotenv from "dotenv";
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

(async () => {
  const { kbChunksRef, kbDocsRef } = await import("@/src/firebase/collections");

  // kbChunks: count + sum(tokens), lightweight (tokens field only)
  const chunkSnap = await kbChunksRef().select("tokens").get();
  let chunks = 0;
  let embeddingTokens = 0;
  chunkSnap.forEach((d) => {
    chunks++;
    const t = (d.data() as { tokens?: number }).tokens;
    if (typeof t === "number") embeddingTokens += t;
  });

  // kbDocs: total + OCR count (title ends with "(OCR)")
  const docSnap = await kbDocsRef().select("title").get();
  let docs = 0;
  let ocrDocs = 0;
  docSnap.forEach((d) => {
    docs++;
    const title = (d.data() as { title?: string }).title || "";
    if (/\(OCR\)\s*$/.test(title)) ocrDocs++;
  });

  console.log(
    JSON.stringify(
      { kbDocs: docs, ocrDocs, kbChunks: chunks, kbEmbeddingTokens: embeddingTokens },
      null,
      2,
    ),
  );
  process.exit(0);
})().catch((e) => {
  console.error("kb-token-sum fatal:", (e as Error).message);
  process.exit(1);
});
