// app/page.tsx — root page (no locale prefix)
// The proxy.ts locale redirect handles users arriving at `/` — they are
// redirected to `/{detected-locale}/...` by next-intl's createMiddleware.
// This page should never render in normal usage; it exists as a fallback.
// 01-04 will implement the real sign-in surface inside app/[lang]/.

export default function RootPage() {
  return null
}
