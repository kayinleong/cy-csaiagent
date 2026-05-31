// src/i18n/detect.ts — per-message language detection
// Pure, framework-free (no Next.js imports — core/shell rule, TSD §3.1).
//
// Uses franc-min to detect the language of a message and maps the ISO-639-3
// code to the three app locales: 'en' | 'ms' | 'zh'.
//
// Called by the chat handler (01-11) to pick the response language, and
// passed as `userLang` to rag.retrieve (01-08) for cross-lingual retrieval.
//
// ISO-639-3 code mapping (verified by testing franc-min 6.2.0 against BM/ZH):
//   zlm (Standard Malay)   → 'ms'
//   ind (Indonesian)       → 'ms'  (Indonesian ≈ BM; both map to ms locale)
//   msa (Malay, macro)     → 'ms'  (alternate code, defensive mapping)
//   zsm (Standard Malay)   → 'ms'  (alternate code, defensive mapping)
//   cmn (Mandarin Chinese) → 'zh'
//   zho (Chinese, macro)   → 'zh'
//   yue (Cantonese)        → 'zh'  (treat Cantonese as zh locale)
//   eng (English)          → 'en'
//   und (undetermined)     → 'en'  (fallback — short/ambiguous text)
//   everything else        → 'en'  (safe default per D-07)

import { franc } from 'franc-min'

/** Supported app locales. Mirrors routing.ts locales. */
export type AppLocale = 'en' | 'ms' | 'zh'

/** Map from franc ISO-639-3 code to app locale. */
const FRANC_TO_LOCALE: Record<string, AppLocale> = {
  zlm: 'ms', // Standard Malay (franc's primary BM code)
  ind: 'ms', // Indonesian — linguistically close to BM; treated as ms locale
  msa: 'ms', // Malay, macrolanguage (alternate code)
  zsm: 'ms', // Standard Malay (alternate code)
  cmn: 'zh', // Mandarin Chinese (franc's primary ZH code)
  zho: 'zh', // Chinese, macrolanguage
  yue: 'zh', // Cantonese — treated as zh locale
}

/**
 * Detect the language of a message and return the app locale.
 *
 * @param text - The message text to detect (can be short or ambiguous)
 * @returns 'en' | 'ms' | 'zh' — always returns a supported locale, never throws
 */
export function detectLang(text: string): AppLocale {
  const code = franc(text)
  // Map known codes; everything else (including 'eng', 'und', or any other
  // language) defaults to 'en'. This guarantees we always return a valid locale.
  return FRANC_TO_LOCALE[code] ?? 'en'
}
