/**
 * ocr-token-split.ts — read-only accounting: split KB embedding tokens by source.
 *
 * Joins kbChunks.docId → kbDocs to attribute chunk tokens to:
 *   - OCR docs        (title ends "(OCR)")  → also ≈ the Gemini OCR *output* tokens,
 *                                             since the transcription IS the doc text
 *   - WhatsApp docs   (title starts "WhatsApp — ")
 *   - Drive text docs (everything else)
 *
 * Fetches only the `tokens`/`docId`/`title` fields — never the 1024-d vectors.
 *   tsx --env-file=.env.local scripts/scrape-skool/ocr-token-split.ts
 */
import * as path from "path";
import * as dotenv from "dotenv";
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

(async () => {
  const { kbChunksRef, kbDocsRef } = await import("@/src/firebase/collections");

  type Kind = "ocr" | "whatsapp" | "text";
  const kindOf = (title: string): Kind =>
    /\(OCR\)\s*$/.test(title) ? "ocr" : /^WhatsApp\s+—/.test(title) ? "whatsapp" : "text";

  const docKind = new Map<string, Kind>();
  const docCount: Record<Kind, number> = { ocr: 0, whatsapp: 0, text: 0 };
  const docSnap = await kbDocsRef().select("title").get();
  docSnap.forEach((d) => {
    const k = kindOf((d.data() as { title?: string }).title || "");
    docKind.set(d.id, k);
    docCount[k]++;
  });

  const tokens: Record<Kind, number> = { ocr: 0, whatsapp: 0, text: 0 };
  const chunks: Record<Kind, number> = { ocr: 0, whatsapp: 0, text: 0 };
  let orphanChunks = 0;
  let orphanTokens = 0;

  const chunkSnap = await kbChunksRef().select("docId", "tokens").get();
  chunkSnap.forEach((c) => {
    const { docId, tokens: t } = c.data() as { docId?: string; tokens?: number };
    const n = typeof t === "number" ? t : 0;
    const k = docId ? docKind.get(docId) : undefined;
    if (!k) {
      orphanChunks++;
      orphanTokens += n;
      return;
    }
    chunks[k]++;
    tokens[k] += n;
  });

  console.log(
    JSON.stringify({ docs: docCount, chunks, tokens, orphanChunks, orphanTokens }, null, 2),
  );
  process.exit(0);
})().catch((e) => {
  console.error("ocr-token-split fatal:", (e as Error).message);
  process.exit(1);
});
