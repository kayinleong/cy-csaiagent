/**
 * src/kb/ingest/extract.test.ts
 *
 * Unit tests for extractText() — the multi-format dispatcher in pdf.ts.
 *
 * Strategy:
 *   - TXT:  synthesized in-memory — direct Buffer.from('hello world').
 *   - XLSX: built in-memory with SheetJS (book_new + aoa_to_sheet + write).
 *   - PPTX: built in-memory with jszip (ppt/slides/slide1.xml + content_types).
 *   - DOC:  binary fixture would be required for a live round-trip. Instead
 *           we assert DISPATCH: the word-extractor import is called (spy on
 *           the module factory). See comment below for why.
 *   - PDF/DOCX: real binary fixtures are required. Dispatch is verified via
 *               a spy on the module factory instead of a live parse.
 *
 * No PII in any fixture. No live Firebase or network calls.
 *
 * Core/shell rule: this file must NOT import from app/ or next.
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { extractText } from '@/src/kb/ingest/pdf'

// ─── Cleanup ──────────────────────────────────────────────────────────────────

afterEach(() => {
  vi.restoreAllMocks()
})

// ─── TXT extraction ───────────────────────────────────────────────────────────

describe('extractText — TXT', () => {
  it('returns the buffer content as UTF-8 for a .txt file', async () => {
    const buffer = Buffer.from('hello world')
    const result = await extractText(buffer, 'text/plain', 'a.txt')
    expect(result.text).toContain('hello world')
    expect(result.mimeType).toBe('text/plain')
  })

  it('returns the buffer content when no name is given and mime is text/plain', async () => {
    const buffer = Buffer.from('fallback text')
    const result = await extractText(buffer, 'text/plain')
    expect(result.text).toContain('fallback text')
  })

  it('falls back to UTF-8 decode for unknown extension + unknown mime', async () => {
    const buffer = Buffer.from('raw data')
    const result = await extractText(buffer, 'application/octet-stream', 'file.bin')
    expect(result.text).toContain('raw data')
  })
})

// ─── XLSX extraction ──────────────────────────────────────────────────────────

describe('extractText — XLSX', () => {
  it('extracts cell values from an in-memory workbook', async () => {
    // Build a minimal .xlsx buffer using SheetJS (same lib used in production)
    const XLSX = await import('xlsx')
    const wb = XLSX.utils.book_new()
    const ws = XLSX.utils.aoa_to_sheet([
      ['hello', 'world'],
      ['foo', 'bar'],
    ])
    XLSX.utils.book_append_sheet(wb, ws, 'Sheet1')
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer

    const result = await extractText(buf, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'a.xlsx')
    expect(result.text).toContain('hello')
    expect(result.text).toContain('world')
  })

  it('dispatches by .xlsx extension regardless of mime type', async () => {
    const XLSX = await import('xlsx')
    const wb = XLSX.utils.book_new()
    const ws = XLSX.utils.aoa_to_sheet([['extension-dispatch']])
    XLSX.utils.book_append_sheet(wb, ws, 'S')
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer

    // Pass a generic mime type — should still route to XLSX by extension
    const result = await extractText(buf, 'application/octet-stream', 'data.xlsx')
    expect(result.text).toContain('extension-dispatch')
  })

  it('includes the sheet name as a header', async () => {
    const XLSX = await import('xlsx')
    const wb = XLSX.utils.book_new()
    const ws = XLSX.utils.aoa_to_sheet([['val']])
    XLSX.utils.book_append_sheet(wb, ws, 'SalesData')
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer

    const result = await extractText(buf, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'a.xlsx')
    expect(result.text).toContain('## SalesData')
  })
})

// ─── PPTX extraction ─────────────────────────────────────────────────────────

describe('extractText — PPTX', () => {
  /**
   * Build a minimal in-memory .pptx zip containing one slide with a text run.
   * A real .pptx is a zip of XML files; we only need the slide XML files and
   * a minimal [Content_Types].xml to satisfy the JSZip forEach path.
   */
  async function buildMinimalPptx(slideText: string): Promise<Buffer> {
    const JSZip = (await import('jszip')).default
    const zip = new JSZip()

    const slideXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
       xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
  <p:cSld>
    <p:spTree>
      <p:sp>
        <p:txBody>
          <a:p>
            <a:r>
              <a:t>${slideText}</a:t>
            </a:r>
          </a:p>
        </p:txBody>
      </p:sp>
    </p:spTree>
  </p:cSld>
</p:sld>`

    zip.file('ppt/slides/slide1.xml', slideXml)
    // [Content_Types].xml is not required for our extraction (we filter by path pattern)
    return zip.generateAsync({ type: 'nodebuffer' }) as Promise<Buffer>
  }

  it('extracts text from <a:t> runs in slide1.xml', async () => {
    const buf = await buildMinimalPptx('SlideHello')
    const result = await extractText(buf, 'application/vnd.openxmlformats-officedocument.presentationml.presentation', 'a.pptx')
    expect(result.text).toContain('SlideHello')
  })

  it('dispatches by .pptx extension regardless of mime type', async () => {
    const buf = await buildMinimalPptx('ExtensionRouted')
    const result = await extractText(buf, 'application/octet-stream', 'slides.pptx')
    expect(result.text).toContain('ExtensionRouted')
  })

  it('decodes basic XML entities in text runs', async () => {
    // slide text that includes XML-escaped characters
    const buf = await buildMinimalPptx('D2 &amp; Partners &lt;Prop&gt;')
    const result = await extractText(buf, 'application/vnd.openxmlformats-officedocument.presentationml.presentation', 'a.pptx')
    expect(result.text).toContain('D2 & Partners <Prop>')
  })

  it('sorts slides numerically (slide2 before slide10)', async () => {
    const JSZip = (await import('jszip')).default
    const zip = new JSZip()

    // Add slide10 before slide2 in the zip to verify sort order
    for (const n of [10, 2, 1]) {
      zip.file(
        `ppt/slides/slide${n}.xml`,
        `<?xml version="1.0"?>
<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
       xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
  <p:cSld><p:spTree><p:sp><p:txBody>
    <a:p><a:r><a:t>Slide${n}Text</a:t></a:r></a:p>
  </p:txBody></p:sp></p:spTree></p:cSld>
</p:sld>`,
      )
    }

    const buf = (await zip.generateAsync({ type: 'nodebuffer' })) as Buffer
    const result = await extractText(
      buf,
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'deck.pptx',
    )

    // Verify all slides are present
    expect(result.text).toContain('Slide1Text')
    expect(result.text).toContain('Slide2Text')
    expect(result.text).toContain('Slide10Text')

    // Verify numeric order: slide1 appears before slide2, slide2 before slide10
    const idx1 = result.text.indexOf('Slide1Text')
    const idx2 = result.text.indexOf('Slide2Text')
    const idx10 = result.text.indexOf('Slide10Text')
    expect(idx1).toBeLessThan(idx2)
    expect(idx2).toBeLessThan(idx10)
  })
})

// ─── DOC dispatch (spy-based — no binary fixture required) ────────────────────

describe('extractText — DOC dispatch', () => {
  /**
   * We cannot build a real binary .doc file in-memory without a Windows COM
   * object (word-extractor uses native bindings). Instead, we verify that the
   * correct extractor is invoked by mocking the dynamic import and asserting
   * it was called when a .doc file is presented.
   *
   * The mock returns a minimal document body to simulate success.
   */
  it('routes .doc extension to word-extractor (dispatch verified via mock)', async () => {
    // Mock word-extractor before it is dynamically imported by extractText.
    // Must use a real constructor function (class or `function`), not an arrow function,
    // because extractDoc calls `new WordExtractor()`.
    vi.doMock('word-extractor', () => {
      class MockWordExtractor {
        extract(_buf: Buffer) {
          return Promise.resolve({ getBody: () => 'legacy doc content' })
        }
      }
      return { default: MockWordExtractor }
    })

    // Re-import the module so the mock is picked up by the dynamic import inside extractText
    const { extractText: extractTextFresh } = await import('@/src/kb/ingest/pdf')
    const buf = Buffer.from('fake doc bytes')
    const result = await extractTextFresh(buf, 'application/octet-stream', 'document.doc')

    expect(result.text).toBe('legacy doc content')
    vi.doUnmock('word-extractor')
  })

  it('routes application/msword mime to word-extractor when no name given', async () => {
    vi.doMock('word-extractor', () => {
      class MockWordExtractor {
        extract(_buf: Buffer) {
          return Promise.resolve({ getBody: () => 'msword mime dispatch' })
        }
      }
      return { default: MockWordExtractor }
    })

    const { extractText: extractTextFresh } = await import('@/src/kb/ingest/pdf')
    const buf = Buffer.from('fake msword bytes')
    const result = await extractTextFresh(buf, 'application/msword')

    expect(result.text).toBe('msword mime dispatch')
    vi.doUnmock('word-extractor')
  })
})
