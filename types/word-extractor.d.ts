/**
 * Minimal ambient type declaration for word-extractor.
 *
 * The package ships no bundled .d.ts; this declaration satisfies tsc
 * without resorting to `any` casts in business logic.
 */
declare module 'word-extractor' {
  interface WordDocument {
    getBody(): string
    getFootnotes(): string
    getHeaders(opts?: { includeFooters?: boolean }): string
    getAnnotations(): string
  }

  class WordExtractor {
    extract(buffer: Buffer): Promise<WordDocument>
  }

  export = WordExtractor
}
