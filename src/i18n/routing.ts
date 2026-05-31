import { defineRouting } from 'next-intl/routing'

// Supported locales for the D2 Customer Service AI Agent Platform.
// EN is the proof-slice language (D-07); BM and Mandarin are full machinery
// from day 1 per D-08 (native review pending before shipping to users).
export const routing = defineRouting({
  locales: ['en', 'ms', 'zh'],
  defaultLocale: 'en',
})

export type Locale = (typeof routing.locales)[number]
