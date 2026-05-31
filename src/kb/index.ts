/**
 * src/kb/index.ts
 *
 * KB module public API.
 *
 * Re-exports the ingestion pipeline and CRUD operations so callers import
 * from '@/src/kb' rather than from nested submodules.
 *
 * Core/shell rule: this file must NOT import from app/ or next.
 */

export { chunk, type Chunk, type ChunkOptions } from '@/src/kb/ingest/chunker'
export { extractText, type ExtractedText, type MimeType } from '@/src/kb/ingest/pdf'
export {
  shardJob,
  processBatch,
  type IngestFile,
  type ShardJobResult,
  type ProcessBatchResult,
} from '@/src/kb/ingest/pipeline'
export {
  createDoc,
  updateDoc,
  listDocs,
  deleteDoc,
  type CreateDocInput,
  type UpdateDocInput,
  type KbDocWithId,
  type CreateDocResult,
} from '@/src/kb/crud'
