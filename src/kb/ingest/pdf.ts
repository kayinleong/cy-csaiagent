/**
 * src/kb/ingest/pdf.ts
 *
 * Text extraction from PDF, DOCX, DOC, XLSX, PPTX, and TXT files
 * for KB ingestion.
 *
 * Dispatch priority: FILE EXTENSION first (browser MIME is unreliable for
 * Office formats), MIME type as fallback.
 *
 * PDF:   pdfjs-dist (Node legacy path — use the `legacy/build/pdf.mjs` entry;
 *        the standard `build/pdf.mjs` requires DOMMatrix which is not available
 *        in Node; the legacy build omits the DOM-dependent rendering stack).
 *
 * DOCX:  mammoth — converts .docx to plain text.
 *
 * DOC:   word-extractor — handles legacy .doc binary format (mammoth cannot).
 *        Fixes the pre-existing bug where .doc was wrongly routed to mammoth.
 *
 * XLSX:  SheetJS (xlsx) — reads each sheet and converts to CSV text.
 *
 * PPTX:  jszip — unpacks the ZIP, collects ppt/slides/slide*.xml entries
 *        (sorted numerically), and extracts <a:t>…</a:t> text runs.
 *
 * Plain text: returned as-is via UTF-8 decode.
 *
 * All parsers are dynamically imported so this file stays server-only and
 * the bundle is not inflated with Office-parsing code on the client path.
 *
 * References:
 *   - TSD §2.4 (pdfjs-dist, mammoth)
 *   - RESEARCH §Don't-Hand-Roll (pdf → pdfjs-dist; DOCX → mammoth)
 *   - 01-10-PLAN.md Task 1 action
 *
 * Core/shell rule: this file must NOT import from app/ or next.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type MimeType =
  | 'application/pdf'
  | 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  | 'application/msword'
  | 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  | 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
  | 'text/plain'
  | string

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
 * Dispatches based on FILE EXTENSION first (derived from `name`), then MIME
 * type as fallback. Browser-reported MIME types for Office formats are often
 * unreliable, so extension takes priority.
 *
 * Supported formats:
 *   - .pdf  / application/pdf                              → pdfjs-dist Node path
 *   - .docx / wordprocessingml mime                       → mammoth
 *   - .doc  / application/msword                         → word-extractor
 *   - .xlsx / spreadsheetml mime                          → SheetJS (xlsx)
 *   - .pptx / presentationml mime                         → jszip + XML parse
 *   - .txt  / text/plain (or any other)                  → UTF-8 string decode
 *
 * @param buffer    The raw file bytes.
 * @param mimeType  MIME type of the file (used as fallback when name is absent).
 * @param name      Optional filename — extension takes priority over mimeType.
 * @returns         Extracted text.
 */
export async function extractText(
  buffer: Buffer,
  mimeType: MimeType,
  name?: string,
): Promise<ExtractedText> {
  const mime = (mimeType || '').toLowerCase()
  const ext = name ? getExt(name) : ''

  // ── PDF ──────────────────────────────────────────────────────────────────
  if (ext === '.pdf' || mime === 'application/pdf') {
    const text = await extractPdf(buffer)
    return { text, mimeType }
  }

  // ── DOCX ─────────────────────────────────────────────────────────────────
  if (
    ext === '.docx' ||
    mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ) {
    const text = await extractDocx(buffer)
    return { text, mimeType }
  }

  // ── DOC (legacy binary Word format) ──────────────────────────────────────
  if (ext === '.doc' || mime === 'application/msword') {
    const text = await extractDoc(buffer)
    return { text, mimeType }
  }

  // ── XLSX ─────────────────────────────────────────────────────────────────
  if (
    ext === '.xlsx' ||
    mime === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ) {
    const text = await extractXlsx(buffer)
    return { text, mimeType }
  }

  // ── PPTX ─────────────────────────────────────────────────────────────────
  if (
    ext === '.pptx' ||
    mime === 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
  ) {
    const text = await extractPptx(buffer)
    return { text, mimeType }
  }

  // ── TXT / default ─────────────────────────────────────────────────────────
  const text = buffer.toString('utf-8')
  return { text, mimeType }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Returns the lowercased file extension including the dot, e.g. ".docx". */
function getExt(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot === -1 ? '' : name.slice(dot).toLowerCase()
}

// ─── PDF extraction (pdfjs-dist legacy Node path) ────────────────────────────

async function extractPdf(buffer: Buffer): Promise<string> {
  // Use the legacy build — the standard build requires DOMMatrix (Node-incompatible)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pdfjsLib = (await import('pdfjs-dist/legacy/build/pdf.mjs')) as any

  // Disable the worker in Node.js (no Worker thread context available)
  if (pdfjsLib.GlobalWorkerOptions) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = ''
  }

  const uint8Array = new Uint8Array(buffer)
  const loadingTask = pdfjsLib.getDocument({
    data: uint8Array,
    useWorkerFetch: false,
    isEvalSupported: false,
  })
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

// ─── DOC extraction (word-extractor) ─────────────────────────────────────────

async function extractDoc(buffer: Buffer): Promise<string> {
  // word-extractor handles the legacy binary .doc format that mammoth cannot parse.
  const WordExtractor = (await import('word-extractor')).default
  const extractor = new WordExtractor()
  const doc = await extractor.extract(buffer)
  return doc.getBody()
}

// ─── XLSX extraction (SheetJS) ───────────────────────────────────────────────

async function extractXlsx(buffer: Buffer): Promise<string> {
  const XLSX = await import('xlsx')
  const workbook = XLSX.read(buffer, { type: 'buffer' })

  const sheetTexts: string[] = []
  for (const sheetName of workbook.SheetNames) {
    const ws = workbook.Sheets[sheetName]
    const csv = XLSX.utils.sheet_to_csv(ws)
    if (csv.trim()) {
      sheetTexts.push(`## ${sheetName}\n${csv}`)
    }
  }

  return sheetTexts.join('\n\n')
}

// ─── PPTX extraction (jszip + XML parse) ─────────────────────────────────────

/**
 * Decode basic XML entities in a text node value.
 * Handles &amp; &lt; &gt; &quot; &apos; — sufficient for PowerPoint text runs.
 */
function decodeXmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
}

/**
 * Extract all <a:t>…</a:t> text runs from a slide XML string.
 * Runs are joined with spaces; returns empty string if none found.
 */
function extractSlideText(xml: string): string {
  const runs: string[] = []
  const re = /<a:t[^>]*>([^<]*)<\/a:t>/g
  let match: RegExpExecArray | null
  while ((match = re.exec(xml)) !== null) {
    const decoded = decodeXmlEntities(match[1])
    if (decoded.trim()) {
      runs.push(decoded)
    }
  }
  return runs.join(' ')
}

/**
 * Sort slide filenames numerically by the integer N in "slideN.xml".
 * Files that don't match the pattern sort to the end.
 */
function slideOrder(a: string, b: string): number {
  const numRe = /slide(\d+)\.xml$/i
  const numA = parseInt(numRe.exec(a)?.[1] ?? '9999', 10)
  const numB = parseInt(numRe.exec(b)?.[1] ?? '9999', 10)
  return numA - numB
}

async function extractPptx(buffer: Buffer): Promise<string> {
  const JSZip = (await import('jszip')).default
  const zip = await JSZip.loadAsync(buffer)

  // Collect ppt/slides/slide*.xml files
  const slideFiles: string[] = []
  zip.forEach((relativePath) => {
    if (/^ppt\/slides\/slide\d+\.xml$/i.test(relativePath)) {
      slideFiles.push(relativePath)
    }
  })

  slideFiles.sort(slideOrder)

  const slideTexts: string[] = []
  for (const path of slideFiles) {
    const xmlFile = zip.file(path)
    if (!xmlFile) continue
    const xml = await xmlFile.async('string')
    const text = extractSlideText(xml)
    if (text) {
      slideTexts.push(text)
    }
  }

  return slideTexts.join('\n\n')
}
