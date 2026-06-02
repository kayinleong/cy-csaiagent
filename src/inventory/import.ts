/**
 * src/inventory/import.ts
 *
 * Pluggable project import adapter — ProjectSource interface + CSV default + validation.
 *
 * Architecture:
 *   - `ProjectSource` interface: { parse(raw: string): Array<Partial<ProjectDoc>> }
 *     Any parser that maps a raw string to partial project rows implements this.
 *     The parser is swappable — when Derek confirms the G4 D2 export format, replace
 *     `csvProjectSource` with a parser that reads that format (Assumption A1).
 *
 *   - `csvProjectSource`: the default CSV implementation.
 *     Reads the first row as a header; maps each subsequent row's values to the
 *     corresponding ProjectDoc fields by name. No new dependency — pure string split.
 *
 *   - `importProjects(raw, source, user)`:
 *     1. assertAdmin(user) — admin gate (T-03-07, ADMIN-04)
 *     2. source.parse(raw) → Array<Partial<ProjectDoc>>
 *     3. Validate each row against REQUIRED_FIELDS
 *     4. Per valid row: call createProject(user, validRow) which embeds + writes
 *     5. Accumulate per-row errors for invalid rows (T-03-08 — malformed source reported,
 *        not silently dropped; ASVS V5 input validation)
 *     6. Return { created: number, errors: Array<{row:number, message:string}> }
 *
 * Seam comment (Assumption A1):
 *   // G4 FORMAT TBD (A1): swap csvProjectSource for the real D2 export parser here
 *   // once Derek confirms the format.
 *
 * STRIDE T-03-08: Untrusted CSV/JSON crosses into the DB — each row is schema-validated
 * against required ProjectDoc fields before any write.
 *
 * Core/shell rule: this file must NOT import from app/ or next.
 *
 * References:
 *   - 03-03-PLAN.md Task 3
 *   - 03-RESEARCH.md Pattern 8 import + Assumption A1 + Open Question 1 (G4 format)
 *   - src/firebase/collections.ts (ProjectDoc)
 *   - src/inventory/crud.ts (assertAdmin, createProject)
 */

import type { ProjectDoc } from '@/src/firebase/collections'
import type { AuthenticatedUser } from '@/src/firebase/auth'
import { assertAdmin, createProject, type CreateProjectInput } from '@/src/inventory/crud'

// ─── ProjectSource interface ────────────────────────────────────────────────────

/**
 * Pluggable parser interface for project import sources.
 *
 * Implement this interface for any new import format (G4, Excel, JSON, etc.)
 * and pass it to importProjects without touching the validation or write logic.
 *
 * // G4 FORMAT TBD (A1): swap csvProjectSource for the real D2 export parser here
 * // once Derek confirms the format.
 */
export interface ProjectSource {
  /**
   * Parse a raw string (CSV, JSON, etc.) into an array of partial ProjectDoc shapes.
   * May return incomplete rows — validation runs in importProjects.
   */
  parse(raw: string): Array<Partial<ProjectDoc>>
}

// ─── Required field list ────────────────────────────────────────────────────────

/**
 * Fields that every imported project row MUST have.
 * Used by importProjects for row-level validation before any write.
 *
 * Not included:
 *   - tenantId, priceBand, embedding — stamped/derived by createProject
 *   - vpDate — nullable (null when vpStatus:false)
 *
 * Boolean fields (vpStatus, bumiQuota, foreignEligible) are required but
 * may be provided as string 'true'/'false' in CSV — coerced during parse.
 */
const REQUIRED_FIELDS: ReadonlyArray<keyof Omit<ProjectDoc, 'tenantId' | 'priceBand' | 'embedding'>> = [
  'name',
  'status',
  'priceValue',
  'tenure',
  'vpStatus',
  'bumiQuota',
  'foreignEligible',
  'description',
  'locationText',
  'bedrooms',
]

// ─── Type helpers ───────────────────────────────────────────────────────────────

function parseBool(val: unknown): boolean | undefined {
  if (typeof val === 'boolean') return val
  if (val === 'true') return true
  if (val === 'false') return false
  return undefined
}

function parseNum(val: unknown): number | undefined {
  if (typeof val === 'number') return val
  if (typeof val === 'string') {
    const n = parseFloat(val)
    return isNaN(n) ? undefined : n
  }
  return undefined
}

// ─── CSV parser ─────────────────────────────────────────────────────────────────

/**
 * Minimal CSV parser — header row defines field names; data rows map by position.
 * No new dependency: uses String.split() only.
 *
 * Limitations (v1 — flagged for Derek if needed):
 *   - Fields with embedded commas are NOT supported (D2 export is expected to be simple).
 *   - Quoted values are stripped of surrounding double-quotes.
 *   - Blank rows are skipped.
 *   - Boolean strings 'true'/'false' are coerced to boolean.
 *   - Numeric strings are coerced to number for priceValue and bedrooms.
 */
function parseCsvRow(headers: string[], values: string[]): Partial<ProjectDoc> {
  const row: Record<string, unknown> = {}

  headers.forEach((header, i) => {
    const raw = values[i]?.replace(/^"|"$/g, '').trim() ?? ''
    const key = header.trim()

    // Type coercions for specific ProjectDoc fields
    if (key === 'priceValue' || key === 'bedrooms') {
      const n = parseNum(raw)
      if (n !== undefined) row[key] = n
      else if (raw !== '') row[key] = raw // preserve for validation error
    } else if (key === 'vpStatus' || key === 'bumiQuota' || key === 'foreignEligible') {
      const b = parseBool(raw)
      if (b !== undefined) row[key] = b
      else if (raw !== '') row[key] = raw // preserve for validation error
    } else {
      row[key] = raw !== '' ? raw : undefined
    }
  })

  return row as Partial<ProjectDoc>
}

/**
 * Default CSV import source.
 *
 * First row = header (field names matching ProjectDoc keys).
 * Subsequent rows = data.
 *
 * // G4 FORMAT TBD (A1): swap csvProjectSource for the real D2 export parser here
 * // once Derek confirms the format.
 */
export const csvProjectSource: ProjectSource = {
  parse(raw: string): Array<Partial<ProjectDoc>> {
    const lines = raw.split('\n').map((l) => l.trim()).filter(Boolean)
    if (lines.length < 2) return [] // header-only or empty

    const headers = lines[0].split(',')
    const rows: Array<Partial<ProjectDoc>> = []

    for (let i = 1; i < lines.length; i++) {
      const values = lines[i].split(',')
      rows.push(parseCsvRow(headers, values))
    }

    return rows
  },
}

// ─── Import result type ─────────────────────────────────────────────────────────

export interface ImportResult {
  /** Number of rows successfully created + embedded. */
  created: number
  /** Per-row validation or write errors. Invalid rows are NOT written. */
  errors: Array<{ row: number; message: string }>
}

// ─── importProjects ─────────────────────────────────────────────────────────────

/**
 * Parse, validate, and bulk-create projects from a raw source string.
 *
 * Security (T-03-08 / ASVS V5):
 *   Each row is validated against REQUIRED_FIELDS before any write.
 *   Invalid rows generate a per-row error and are NOT written to Firestore.
 *   A malformed source is reported (errors array), never silently dropped.
 *
 * @param raw    Raw string to pass to source.parse() (CSV, JSON, etc.)
 * @param source A ProjectSource implementation (use csvProjectSource as default)
 * @param user   Verified user — must have role 'admin' (assertAdmin gate).
 * @returns      { created, errors } — created = rows successfully written + embedded.
 */
export async function importProjects(
  raw: string,
  source: ProjectSource,
  user: AuthenticatedUser,
): Promise<ImportResult> {
  // Admin gate — T-03-07 / ADMIN-04 (same gate as CRUD operations)
  assertAdmin(user)

  // Parse the raw string into partial project rows
  const rows = source.parse(raw)

  const errors: Array<{ row: number; message: string }> = []
  let created = 0

  for (let i = 0; i < rows.length; i++) {
    const rowIndex = i + 1 // 1-based row number for error messages (matches spreadsheet convention)
    const row = rows[i]

    // ── Row validation (T-03-08 — validate before write) ─────────────────────
    const missingFields: string[] = []
    for (const field of REQUIRED_FIELDS) {
      const val = row[field as keyof typeof row]
      // A field is missing if it is undefined, null, or an empty string
      if (val === undefined || val === null || val === '') {
        missingFields.push(field)
      }
    }

    if (missingFields.length > 0) {
      errors.push({
        row: rowIndex,
        message: `Row ${rowIndex}: missing required fields: ${missingFields.join(', ')}`,
      })
      continue // Do NOT write this row
    }

    // ── Write the valid row via createProject (embed-on-create) ──────────────
    try {
      const input: CreateProjectInput = {
        name: row.name as string,
        status: row.status as 'active' | 'sold_out' | 'hidden',
        priceValue: row.priceValue as number,
        tenure: row.tenure as string,
        vpStatus: row.vpStatus as boolean,
        vpDate: row.vpDate ?? null,
        bumiQuota: row.bumiQuota as boolean,
        foreignEligible: row.foreignEligible as boolean,
        description: row.description as string,
        locationText: row.locationText as string,
        bedrooms: row.bedrooms as number,
        // Note: lang from the CSV row is not a field on ProjectDoc itself.
        // embedding is NOT included — createProject derives it via embedProject.
      }
      await createProject(user, input)
      created++
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      errors.push({ row: rowIndex, message: `Row ${rowIndex}: write error — ${message}` })
    }
  }

  return { created, errors }
}
