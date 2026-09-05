/**
 * Rebuild drive-kb-ledger.json from Firestore (quick-kayinleong-088).
 *
 * WHY THIS EXISTS
 * ---------------
 * `drive-kb-ledger.json` is the idempotency guard for Drive → KB ingestion. Both
 * `to-kb.ts` and `to-kb-ocr.ts` depend on it:
 *
 *   - `to-kb.ts` skips any Drive fileId whose ledger status is one of
 *     ingested | ingested-ocr | ocr-empty | skipped-empty. With no ledger it treats all
 *     1,051 text-bearing Drive files as new and re-ingests every one of them as a
 *     duplicate kbDoc.
 *   - `to-kb-ocr.ts` hard-fails immediately (`no ledger at …`) — its entire work queue is
 *     the ledger's `skipped-empty` PDF entries.
 *
 * The ledger and the `google-profile` session directory were both lost from disk. The
 * profile has to be re-created interactively (`gdrive-login.ts`); the ledger can be
 * reconstructed, because Firestore still holds a kbDoc per ingested file and `to-kb.ts`
 * derives each kbDoc title deterministically from the Drive index:
 *
 *     project = f.projects[0] || f.folderName || ''
 *     title   = (project ? project + ' — ' : '') + f.name          // to-kb.ts
 *     title   = (project ? project + ' — ' : '') + f.name + ' (OCR)' // to-kb-ocr.ts
 *
 * So the title is a reversible join key back to `drive-documents.json`. That is the only
 * available key: `kbDocs.sourcePath` is `kb/<docId>` (see `createDoc` in src/kb/crud.ts),
 * which carries no Drive provenance at all.
 *
 * WHAT IT CANNOT RECOVER — read before trusting the output
 * -------------------------------------------------------
 *   1. `skipped-empty` entries. Image-only PDFs never produced a kbDoc, so they leave no
 *      trace in Firestore and cannot be reconstructed. They come back as "remaining to
 *      ingest". Re-running `to-kb.ts --apply` re-downloads them, finds < KB_MIN_CHARS and
 *      re-marks them `skipped-empty` — which restores exactly the queue `to-kb-ocr.ts`
 *      needs. The OCR stage therefore has to run AFTER a full text pass, not before.
 *   2. `partial` entries. A kbDoc created but not fully embedded is indistinguishable
 *      from a finished one by title alone, so everything matched is recorded as
 *      `ingested`. This is deliberate: `kb-cleanup.ts` DELETES kbDocs for `partial`
 *      entries, and guessing wrong there destroys good data. A genuinely half-embedded
 *      doc will simply stay half-embedded — detectable later by comparing kbChunks counts.
 *   3. `jobId` / `total`. Only ever read when resuming a `partial` entry, which this
 *      rebuild never emits. Omitted rather than fabricated.
 *
 * Entries carry `rebuilt: true` so a future reader knows they are reconstructed.
 *
 * PDPA: prints counts, Drive file names and kbDoc titles (which are built from those same
 * file names) only. Never reads or prints chunk text or any personal data.
 *
 * Usage — Firestore creds come from .env.local via --env-file, never read in-process:
 *   node_modules/.bin/tsx --env-file=.env.local scripts/scrape-skool/rebuild-kb-ledger.ts
 *   ...                                                                          --apply
 *   ... --apply --force              overwrite an existing ledger (refused by default)
 *   ... --reingest-duplicates        leave same-titled Drive twins unclaimed (see below)
 *
 * Env: KB_LEDGER / SCRAPE_OUT (ledger path — same resolution as kb-cleanup.ts),
 *      DRIVE_INDEX (Drive file index, default ./drive-documents.json).
 */
import * as path from "path";
import * as dotenv from "dotenv";
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

import { readFileSync, writeFileSync, existsSync } from "fs";

const APPLY = process.argv.includes("--apply");
const FORCE = process.argv.includes("--force");
/**
 * 31 expected titles are claimed by more than one Drive file (identical names in the same
 * project folder — duplicate uploads). One kbDoc cannot tell you which twin produced it.
 *
 * Default: claim ALL twins as ingested, giving the docId to the first and marking the rest
 * `ambiguousTitle` with no docId. Rationale — same name in the same folder almost always
 * means the same content, and the failure this ledger exists to prevent is duplicate
 * kbDocs. An entry with no docId is inert: `to-kb.ts` skips it on status alone and
 * `kb-cleanup.ts` only ever acts on `partial` entries that HAVE a docId.
 *
 * `--reingest-duplicates` inverts the trade-off: only the first twin is claimed, so the
 * others get re-ingested (and may land as genuine duplicates in the KB).
 */
const REINGEST_DUPES = process.argv.includes("--reingest-duplicates");

const LEDGER = process.env.KB_LEDGER || path.join(process.env.SCRAPE_OUT || process.cwd(), "drive-kb-ledger.json");
const DRIVE_INDEX = process.env.DRIVE_INDEX || path.resolve(process.cwd(), "drive-documents.json");

/** Must stay identical to TEXT_TYPES in to-kb.ts — it defines what "ingestable" means. */
const TEXT_TYPES = ["pdf", "doc", "sheet", "slides", "gdoc"];
const OCR_SUFFIX = " (OCR)";
const PAGE = 500;

interface DriveFile {
  id: string;
  name: string;
  type: string;
  folderName?: string;
  projects?: string[];
}
interface LedgerEntry {
  fileId: string;
  name: string;
  project: string;
  status: "ingested" | "ingested-ocr";
  docId?: string;
  rebuilt: true;
  /** Set when this file shares its title with another Drive file — see REINGEST_DUPES. */
  ambiguousTitle?: true;
}

/** to-kb.ts: `const project = (f.projects && f.projects[0]) || f.folderName || ""`. */
const projectOf = (f: DriveFile) => (f.projects && f.projects[0]) || f.folderName || "";
/** to-kb.ts: `const title = (project ? project + " — " : "") + f.name`. */
const titleOf = (f: DriveFile) => (projectOf(f) ? projectOf(f) + " — " : "") + f.name;

/** Tier-2 fallback key: collapse whitespace and unify the dash variants writers mix. */
const norm = (s: string) =>
  String(s || "")
    .replace(/[‐-―−]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

/**
 * Where the ledger must land.
 *
 * `to-kb.ts` reads `process.env.SCRAPE_OUT!` with a non-null assertion, so with SCRAPE_OUT
 * unset its own `path.join(OUT, 'drive-kb-ledger.json')` throws — it can NEVER read a
 * ledger written to the repo root. `kb-cleanup.ts` tolerates the cwd fallback, which is
 * why the resolution here mirrors it, but writing there on --apply would produce a file
 * that looks like a successful rebuild and is silently invisible to the only consumer
 * that matters. It would also drop a PII-bearing scrape artifact (Drive file names,
 * project data) into the repo root, where — unlike projects.json and
 * drive-documents.json — it is not gitignored.
 *
 * So: dry-run anywhere, but --apply demands an explicit destination.
 */
function assertLedgerDestination() {
  if (process.env.KB_LEDGER || process.env.SCRAPE_OUT) return;
  throw new Error(
    "refusing to --apply with neither SCRAPE_OUT nor KB_LEDGER set: the ledger would land in the repo root, " +
      "where to-kb.ts cannot read it (it asserts SCRAPE_OUT) and where it is not gitignored. " +
      "Re-run with the same env file to-kb.ts uses (which defines SCRAPE_OUT), or set KB_LEDGER to an explicit path outside the repo.",
  );
}

async function main() {
  if (!existsSync(DRIVE_INDEX)) throw new Error(`no Drive index at ${DRIVE_INDEX}`);
  if (APPLY) assertLedgerDestination();
  if (existsSync(LEDGER) && APPLY && !FORCE) {
    throw new Error(`a ledger already exists at ${LEDGER} — refusing to overwrite it with a reconstruction. Pass --force if that is really what you want.`);
  }

  const index = JSON.parse(readFileSync(DRIVE_INDEX, "utf8"));
  const all: DriveFile[] = index.files || [];
  const files = all.filter((f) => TEXT_TYPES.includes(f.type));

  // Expected title → the Drive file(s) that would produce it, exact and normalized.
  const byTitle = new Map<string, DriveFile[]>();
  const byNormTitle = new Map<string, DriveFile[]>();
  const push = (m: Map<string, DriveFile[]>, k: string, f: DriveFile) => {
    const bucket = m.get(k);
    if (bucket) bucket.push(f);
    else m.set(k, [f]);
  };
  for (const f of files) {
    const t = titleOf(f);
    push(byTitle, t, f);
    push(byNormTitle, norm(t), f);
  }

  const { kbDocsRef } = await import("@/src/firebase/collections");
  const { FieldPath } = await import("firebase-admin/firestore");

  // Page by document id — cheap, index-free, and stable under concurrent writes.
  // select() keeps the read to the two fields we actually need; no chunk text is fetched.
  let cursor: string | null = null;
  let scanned = 0;
  const matched = new Map<string, { docId: string; ocr: boolean; title: string }>(); // fileId → best match
  const unmatchedTitles: string[] = [];
  let extraKbDocsForSameFile = 0;
  let ambiguousKbDocs = 0;
  let fuzzyMatches = 0;

  // withConverter(null) drops the typed converter: this read wants raw fields only, and
  // select() + a converter that casts to a full KbDocDoc would be a lie about the shape.
  const rawKbDocs = kbDocsRef().withConverter(null);

  for (;;) {
    let q = rawKbDocs.select("title").orderBy(FieldPath.documentId()).limit(PAGE);
    if (cursor) q = q.startAfter(cursor);
    const snap = await q.get();
    if (snap.empty) break;

    for (const d of snap.docs) {
      scanned++;
      const title = String(d.get("title") || "");
      const ocr = title.endsWith(OCR_SUFFIX);
      const base = ocr ? title.slice(0, -OCR_SUFFIX.length) : title;

      let cands = byTitle.get(base);
      if (!cands?.length) {
        cands = byNormTitle.get(norm(base));
        if (cands?.length) fuzzyMatches++;
      }
      if (!cands?.length) {
        unmatchedTitles.push(title);
        continue;
      }
      if (cands.length > 1) ambiguousKbDocs++;

      // First kbDoc wins the docId for a given file. A second kbDoc with the same title is
      // either a cross-pillar copy (copiedFromId) or a superseded version — both mean the
      // file WAS ingested, which is all the ledger records.
      const claim = REINGEST_DUPES ? cands.slice(0, 1) : cands;
      for (const [i, f] of claim.entries()) {
        const prev = matched.get(f.id);
        if (prev?.docId) {
          // A second kbDoc for a file already claimed with a real docId.
          if (i === 0) extraKbDocsForSameFile++;
          continue;
        }
        // i === 0 gets the docId; later twins are recorded without one (inert placeholder).
        if (prev && i > 0) continue;
        matched.set(f.id, { docId: i === 0 ? d.id : "", ocr, title });
      }
    }

    cursor = snap.docs[snap.docs.length - 1].id;
    if (snap.size < PAGE) break;
  }

  // ─── build the ledger ─────────────────────────────────────────────────────
  const ledger: LedgerEntry[] = [];
  for (const f of files) {
    const m = matched.get(f.id);
    if (!m) continue;
    const entry: LedgerEntry = {
      fileId: f.id,
      name: f.name,
      project: projectOf(f),
      status: m.ocr ? "ingested-ocr" : "ingested",
      rebuilt: true,
    };
    if (m.docId) entry.docId = m.docId;
    else entry.ambiguousTitle = true;
    ledger.push(entry);
  }

  const ocrCount = ledger.filter((e) => e.status === "ingested-ocr").length;
  const noDocId = ledger.filter((e) => !e.docId).length;
  const remaining = files.length - ledger.length;

  // ─── coverage summary ─────────────────────────────────────────────────────
  console.log("─".repeat(72));
  console.log(`Drive index            ${DRIVE_INDEX}`);
  console.log(`  files indexed        ${all.length}`);
  console.log(`  text-bearing         ${files.length}   (types: ${TEXT_TYPES.join(", ")})`);
  console.log(`  distinct titles      ${byTitle.size}   (${files.length - byTitle.size} files share a title with another)`);
  console.log("");
  console.log(`Firestore kbDocs`);
  console.log(`  scanned              ${scanned}`);
  console.log(`  matched to Drive     ${scanned - unmatchedTitles.length}`);
  console.log(`    via exact title    ${scanned - unmatchedTitles.length - fuzzyMatches}`);
  console.log(`    via normalized     ${fuzzyMatches}`);
  console.log(`  unmatched            ${unmatchedTitles.length}   (non-Drive origin: SOPs, coach content, cross-pillar copies)`);
  console.log(`  same-title collisions ${ambiguousKbDocs} kbDocs hit >1 Drive file · ${extraKbDocsForSameFile} extra kbDocs for an already-claimed file`);
  console.log("");
  console.log(`COVERAGE`);
  console.log(`  text-bearing Drive files      ${files.length}`);
  console.log(`  already have a kbDoc          ${ledger.length}  (${((ledger.length / files.length) * 100).toFixed(1)}%)`);
  console.log(`    of which OCR-ingested       ${ocrCount}`);
  console.log(`    claimed without a docId     ${noDocId}  (same-title twins; inert, skipped by to-kb.ts)`);
  console.log(`  REMAINING TO INGEST           ${remaining}  (${((remaining / files.length) * 100).toFixed(1)}%)`);
  console.log("─".repeat(72));
  if (unmatchedTitles.length) {
    console.log(`Sample unmatched kbDoc titles (first 10 of ${unmatchedTitles.length}):`);
    for (const t of unmatchedTitles.slice(0, 10)) console.log(`  · ${t.slice(0, 100)}`);
  }
  console.log("");
  console.log(`NOTE: 'skipped-empty' (image-only PDF) entries cannot be reconstructed — they`);
  console.log(`      never produced a kbDoc. They are counted in REMAINING above. A full`);
  console.log(`      to-kb.ts --apply pass re-marks them, which is what to-kb-ocr.ts needs.`);

  if (!APPLY) {
    console.log(`\n[dry-run] would write ${ledger.length} entries → ${LEDGER}`);
    if (!process.env.KB_LEDGER && !process.env.SCRAPE_OUT) {
      console.log(`[dry-run] ⚠ that path is the cwd fallback. --apply will REFUSE it: to-kb.ts asserts`);
      console.log(`[dry-run]   SCRAPE_OUT and cannot read a repo-root ledger. Set SCRAPE_OUT (use the same`);
      console.log(`[dry-run]   env file as to-kb.ts) or KB_LEDGER before applying.`);
    }
    console.log(`[dry-run] re-run with --apply to write it.`);
    return;
  }
  writeFileSync(LEDGER, JSON.stringify(ledger, null, 2));
  console.log(`\n[apply] wrote ${ledger.length} entries → ${LEDGER}`);
}

main().catch((e) => {
  console.error("[rebuild-kb-ledger] fatal:", e instanceof Error ? e.message : e);
  process.exit(1);
});
