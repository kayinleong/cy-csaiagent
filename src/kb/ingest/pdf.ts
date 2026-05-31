/**
 * src/kb/ingest/pdf.ts
 *
 * Text extraction from PDF and DOCX files for KB ingestion.
 *
 * PDF:  pdfjs-dist (Node legacy path — use the `legacy/build/pdf.mjs` entry;
 *       the standard `build/pdf.mjs` requires DOMMatrix which is not available
 *       in Node; the legacy build omits the DOM-dependent rendering stack).
 *
 * DOCX: mammoth — converts .docx to plain text.
 *
 * Plain text: returned as-is.
 *
 * References:
 *   - TSD §2.4 (pdfjs-dist, mammoth)
 *   - RESEARCH §Don't-Hand-Roll (pdf → pdfjs-dist; DOCX → mammoth)
 *   - 01-10-PLAN.md Task 1 action
 *
 * Core/shell rule: this file must NOT import from app/ or next.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type MimeType = 'application/pdf' | 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' | 'text/plain' | string

export interface ExtractedText {
  /** The full extracted text content */
  text: string
  /** MIME type that was detected/used */
  mimeType: MimeType
}

// ─── Implementation ───────────────────────────────────────────────────────────

/**
 * Extract plain text from a file buffer.
 *
 * Dispatches based on mimeType:
 *   - 'application/pdf'                                 → pdfjs-dist Node path
 *   - 'application/vnd.openxmlformats-...'             → mammoth
 *   - 'text/plain' or anything else                    → UTF-8 string decode
 *
 * @param buffer    The raw file bytes.
 * @param mimeType  MIME type of the file (used to select the extraction path).
 * @returns         Extracted text.
 */
export async function extractText(buffer: Buffer, mimeType: MimeType): Promise<ExtractedText> {
  const mime = (mimeType || '').toLowerCase()

  if (mime === 'application/pdf') {
    const text = await extractPdf(buffer)
    return { text, mimeType }
  }

  if (
    mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    mime === 'application/msword' ||
    mime.endsWith('.docx') ||
    mime.endsWith('.doc')
  ) {
    const text = await extractDocx(buffer)
    return { text, mimeType }
  }

  // Default: treat as plain text (UTF-8)
  const text = buffer.toString('utf-8')
  return { text, mimeType }
}

// ─── PDF extraction (pdfjs-dist legacy Node path) ────────────────────────────

async function extractPdf(buffer: Buffer): Promise<string> {
  // Use the legacy build — the standard build requires DOMMatrix (Node-incompatible)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs') as any

  // Disable the worker in Node.js (no Worker thread context available)
  if (pdfjsLib.GlobalWorkerOptions) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = ''
  }

  const uint8Array = new Uint8Array(buffer)
  const loadingTask = pdfjsLib.getDocument({ data: uint8Array, useWorkerFetch: false, isEvalSupported: false })
  const pdfDocument = await loadingTask.promise

  const textParts: string[] = []

  for (let pageNum = 1; pageNum <= pdfDocument.numPages; pageNum++) {
    const page = await pdfDocument.getPage(pageNum)
    const textContent = await page.getTextContent()

    const pageText = textContent.items
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .filter((item: any) => 'str' in item)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((item: any) => item.str)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim()

    if (pageText) {
      textParts.push(pageText)
    }
  }

  return textParts.join('\n\n')
}

// ─── DOCX extraction (mammoth) ───────────────────────────────────────────────

async function extractDocx(buffer: Buffer): Promise<string> {
  const mammoth = await import('mammoth')
  const result = await mammoth.extractRawText({ buffer })
  return result.value || ''
}
