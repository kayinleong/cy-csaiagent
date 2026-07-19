/**
 * Document text extraction (quick-kayinleong-039).
 *
 * Turns a downloaded attachment (any of the common Skool attachment types) into
 * plain text using parsers ALREADY vendored in this repo — no new deps:
 *   - PDF   → pdfjs-dist (legacy Node build)
 *   - DOCX  → mammoth
 *   - DOC   → word-extractor
 *   - XLSX/XLS/CSV → xlsx
 *   - txt/md/json/html → utf-8 decode (html stripped to text)
 * Anything else (images, zips, video) is recorded as binary with metadata only.
 */
import { writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface ExtractResult {
  method: string; // parser used
  text: string; // extracted text (may be empty)
  chars: number;
  pages?: number;
  note?: string; // set when extraction was skipped or failed
}

function extFromName(name?: string): string {
  if (!name) return "";
  const m = name.toLowerCase().match(/\.([a-z0-9]+)(?:\?|#|$)/);
  return m ? m[1] : "";
}

function classify(hint: { filename?: string; contentType?: string; url?: string }): string {
  const ct = (hint.contentType || "").toLowerCase();
  const ext = extFromName(hint.filename) || extFromName(hint.url);
  if (ct.includes("pdf") || ext === "pdf") return "pdf";
  if (ct.includes("wordprocessingml") || ext === "docx") return "docx";
  if (ct.includes("msword") || ext === "doc") return "doc";
  if (ct.includes("sheet") || ct.includes("excel") || ["xlsx", "xls"].includes(ext)) return "xlsx";
  if (ct.includes("csv") || ext === "csv") return "csv";
  if (ct.includes("json") || ext === "json") return "json";
  if (ct.includes("html") || ["html", "htm"].includes(ext)) return "html";
  if (ct.startsWith("text/") || ["txt", "md", "markdown"].includes(ext)) return "text";
  if (ct.startsWith("image/") || ["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(ext)) return "image";
  return "binary";
}

async function pdfToText(data: Uint8Array): Promise<{ text: string; pages: number }> {
  // Legacy build runs in Node without a DOM/worker.
  const pdfjs: any = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({ data, isEvalSupported: false, useSystemFonts: true }).promise;
  let text = "";
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    text += content.items.map((it: any) => ("str" in it ? it.str : "")).join(" ") + "\n\n";
  }
  await doc.destroy?.();
  return { text: text.trim(), pages: doc.numPages };
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

export async function extractText(
  buffer: Buffer,
  hint: { filename?: string; contentType?: string; url?: string },
): Promise<ExtractResult> {
  const kind = classify(hint);
  try {
    switch (kind) {
      case "pdf": {
        const { text, pages } = await pdfToText(new Uint8Array(buffer));
        return { method: "pdfjs", text, chars: text.length, pages };
      }
      case "docx": {
        const mammoth: any = await import("mammoth");
        const { value } = await mammoth.extractRawText({ buffer });
        return { method: "mammoth", text: (value || "").trim(), chars: (value || "").length };
      }
      case "doc": {
        const WordExtractor: any = (await import("word-extractor")).default;
        const tmp = join(tmpdir(), `skool-${Date.now()}-${Math.random().toString(36).slice(2)}.doc`);
        writeFileSync(tmp, buffer);
        try {
          const ex = new WordExtractor();
          const d = await ex.extract(tmp);
          const text = (d.getBody() || "").trim();
          return { method: "word-extractor", text, chars: text.length };
        } finally {
          rmSync(tmp, { force: true });
        }
      }
      case "xlsx": {
        const XLSX: any = await import("xlsx");
        const wb = XLSX.read(buffer, { type: "buffer" });
        let text = "";
        for (const name of wb.SheetNames) {
          text += `# Sheet: ${name}\n` + XLSX.utils.sheet_to_csv(wb.Sheets[name]) + "\n\n";
        }
        return { method: "xlsx", text: text.trim(), chars: text.length };
      }
      case "csv":
      case "json":
      case "text": {
        const text = buffer.toString("utf8").trim();
        return { method: kind, text, chars: text.length };
      }
      case "html": {
        const text = stripHtml(buffer.toString("utf8"));
        return { method: "html-strip", text, chars: text.length };
      }
      case "image":
        return { method: "skip", text: "", chars: 0, note: "image — not text-extracted" };
      default:
        return { method: "skip", text: "", chars: 0, note: `binary (${hint.contentType || "unknown"}) — not text-extracted` };
    }
  } catch (e) {
    return { method: kind, text: "", chars: 0, note: `extraction failed: ${(e as Error).message}` };
  }
}
