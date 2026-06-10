/**
 * src/i18n/__tests__/i18n-parity.test.ts — trilingual catalog key PARITY (i18n / Phase 6).
 *
 * CONTEXT mandates EN / BM / 中文 parity in CI; no parity check existed before
 * (Pitfall 5). This asserts the THREE message catalogs (en / ms / zh) expose an
 * IDENTICAL set of translatable dotted key paths. If any catalog is missing a key
 * the others have (or carries an extra one), this FAILS — which is how new Phase-6
 * nav/surface strings are forced into all three locales before they ship.
 *
 * Unlike most Wave-0 stubs this is a REAL, fully-implemented test (no not-yet-built
 * dependency): it stays GREEN as long as parity holds, and goes RED the moment a
 * key is added to one catalog but not the others.
 *
 * Metadata convention: top-level keys prefixed with `_` (e.g. `_review`, `_note`)
 * are translator/process annotations, NOT user-facing UI strings — ms/zh carry a
 * `_note` "machine-assisted draft" marker (D-08) that en intentionally lacks. These
 * are excluded from the parity comparison because parity is an invariant over
 * TRANSLATABLE keys, not over per-catalog review metadata.
 *
 * Logic-only: plain Vitest over the static JSON catalogs. No emulator, no network,
 * no @testing-library/react (not installed) — mirrors src/i18n/detect.test.ts.
 *
 * Requirements: i18n (EN/BM/中文 parity), CONTEXT 06 lock, Pitfall 5.
 */

import { describe, it, expect } from 'vitest'
import en from '../messages/en.json'
import ms from '../messages/ms.json'
import zh from '../messages/zh.json'

type Catalog = Record<string, unknown>

/**
 * Recursively collect every leaf dotted key path in a catalog.
 * Top-level `_`-prefixed metadata keys are skipped (translator annotations,
 * not UI strings). Arrays are treated as leaves (next-intl values, not nesting).
 */
function collectKeys(obj: Catalog, prefix = ''): string[] {
  let keys: string[] = []
  for (const key of Object.keys(obj)) {
    // Exclude top-level process/metadata markers (e.g. _review, _note — D-08).
    if (prefix === '' && key.startsWith('_')) continue
    const path = prefix ? `${prefix}.${key}` : key
    const value = (obj as Record<string, unknown>)[key]
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      keys = keys.concat(collectKeys(value as Catalog, path))
    } else {
      keys.push(path)
    }
  }
  return keys.sort()
}

const enKeys = collectKeys(en as Catalog)
const msKeys = collectKeys(ms as Catalog)
const zhKeys = collectKeys(zh as Catalog)

function missingFrom(reference: string[], candidate: string[]): string[] {
  const set = new Set(candidate)
  return reference.filter((k) => !set.has(k))
}

describe('i18n catalog parity — en / ms / zh translatable key sets are identical', () => {
  it('every catalog exposes at least one key (sanity)', () => {
    expect(enKeys.length).toBeGreaterThan(0)
    expect(msKeys.length).toBeGreaterThan(0)
    expect(zhKeys.length).toBeGreaterThan(0)
  })

  it('ms.json has no key missing relative to en.json', () => {
    expect(missingFrom(enKeys, msKeys)).toEqual([])
  })

  it('ms.json has no extra key relative to en.json', () => {
    expect(missingFrom(msKeys, enKeys)).toEqual([])
  })

  it('zh.json has no key missing relative to en.json', () => {
    expect(missingFrom(enKeys, zhKeys)).toEqual([])
  })

  it('zh.json has no extra key relative to en.json', () => {
    expect(missingFrom(zhKeys, enKeys)).toEqual([])
  })

  it('all three catalogs have exactly the same key set', () => {
    expect(msKeys).toEqual(enKeys)
    expect(zhKeys).toEqual(enKeys)
  })
})
