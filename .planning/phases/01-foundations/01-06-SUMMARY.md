---
phase: 01-foundations
plan: "06"
subsystem: i18n
tags: [next-intl, proxy.ts, franc-min, trilingual, i18n, locale-routing, app-router]

# Dependency graph
requires:
  - "01-02 (test-infra: vitest + @/* alias — used by detect.test.ts)"
provides:
  - "proxy.ts at repo root: Next.js 16 Proxy with next-intl createMiddleware(routing) — locale redirect en|ms|zh"
  - "src/i18n/routing.ts: defineRouting({locales:['en','ms','zh'], defaultLocale:'en'})"
  - "src/i18n/request.ts: getRequestConfig loading messages/<locale>.json (next-intl server config)"
  - "src/i18n/messages/en.json: full EN catalog (app/auth/chat/kb/handoff/nav/errors)"
  - "src/i18n/messages/ms.json: BM catalog (native-review-pending, D-08)"
  - "src/i18n/messages/zh.json: ZH catalog (native-review-pending, D-08)"
  - "app/[lang]/layout.tsx: locale-scoped layout wrapping children in NextIntlClientProvider"
  - "detectLang(text) → 'en'|'ms'|'zh': franc-min per-message detection, 4 tests green"
affects:
  - "01-04 (sign-in): renders inside app/[lang]/ segment"
  - "01-11 (chat shell): renders inside app/[lang]/ segment"
  - "01-12 (chat route): calls detectLang(message) for userLang → rag.retrieve"
  - "01-08 (SPIKE-RAG): retrieve(query, userLang:'en'|'ms'|'zh') consumes detectLang output"
  - "All subsequent plans: [lang] segment is the root for all user-facing pages"

# Tech tracking
tech-stack:
  added:
    - "next-intl@4.13.0 — App Router i18n with createMiddleware + NextIntlClientProvider"
    - "franc-min@6.2.0 — per-message language detection (ISO-639-3 → app locale)"
  patterns:
    - "proxy.ts (named `proxy` export): Next.js 16 convention — createMiddleware(routing) from next-intl/middleware"
    - "Q2 resolved: next-intl v4 createMiddleware lives in proxy.ts (not middleware.ts) — compatible with Next.js 16 Proxy convention"
    - "ISO-639-3 mapping: zlm/ind/msa/zsm→'ms', cmn/zho/yue→'zh', all others→'en'"
    - "Native-review-pending: ms.json and zh.json carry _review marker (D-08) — not for production use without sign-off"

key-files:
  created:
    - "proxy.ts — Next.js 16 Proxy (NOT middleware.ts): named `proxy` export + createMiddleware(routing)"
    - "src/i18n/routing.ts — defineRouting locales + Locale type"
    - "src/i18n/request.ts — getRequestConfig server config"
    - "src/i18n/messages/en.json — full EN catalog (7 top-level namespaces)"
    - "src/i18n/messages/ms.json — BM catalog (native-review-pending)"
    - "src/i18n/messages/zh.json — ZH catalog (native-review-pending)"
    - "app/[lang]/layout.tsx — locale-scoped layout: NextIntlClientProvider + generateStaticParams"
    - "app/[lang]/page.tsx — placeholder redirecting to /[lang]/sign-in (01-04)"
    - "src/i18n/detect.ts — detectLang: franc-min → 'en'|'ms'|'zh' (pure, framework-free)"
    - "src/i18n/detect.test.ts — 4 TDD tests (EN/BM/ZH/ambiguous)"
  modified:
    - "app/layout.tsx — minimal root layout: fonts + Toaster; removed hard-coded lang='en'"
    - "app/page.tsx — stripped marketing content; root page returns null (proxy handles /"
    - "next.config.ts — withNextIntl plugin wired (createNextIntlPlugin → src/i18n/request.ts)"
    - "package.json — next-intl@4.13.0 + franc-min@6.2.0 added to dependencies"

key-decisions:
  - "Q2 RESOLVED: next-intl v4 createMiddleware from 'next-intl/middleware' placed in proxy.ts (named `proxy` export) — fully compatible with Next.js 16 Proxy convention; NO middleware.ts created (lint gate from 01-02 enforced)"
  - "franc-min ISO-639-3 mapping verified at runtime: 'zlm' for Standard Malay (not 'msa'), 'cmn' for Mandarin, 'und' for ambiguous — defensive mapping added for all known BM codes (zlm/ind/msa/zsm)"
  - "Root layout (app/layout.tsx) is lang-neutral: no lang attr on <html>; locale injected by app/[lang]/layout.tsx which awaits async params per Next.js 16"
  - "BM/ZH catalogs carry _review:native-review-pending — not shipped to users without D-08 native sign-off"

# Metrics
duration: 7min
completed: "2026-05-31"
---

# Phase 01 Plan 06: Trilingual i18n Machinery + proxy.ts + franc-min Detection Summary

**next-intl v4 createMiddleware in proxy.ts (NOT middleware.ts) for locale redirect; all three catalogs (en/ms/zh) day 1; detectLang(franc-min) → 'en'|'ms'|'zh' with 4 tests green; app/[lang]/ segment + NextIntlClientProvider wired**

## Performance

- **Duration:** ~7 min
- **Started:** 2026-05-31T10:56:49Z
- **Completed:** 2026-05-31T11:03:49Z
- **Tasks:** 2 (Task 1: proxy+routing+catalogs+layouts; Task 2: TDD franc-min detection)
- **Files created:** 10 | **Files modified:** 4

## Accomplishments

- `proxy.ts` at repo root exports named `proxy` function using `createMiddleware(routing)` from `next-intl/middleware` — satisfies the Next.js 16 Proxy convention and the project "no middleware.ts" rule simultaneously
- **Q2 resolved:** next-intl v4 composable middleware works inside `proxy.ts` (the docs themselves use `proxy` as the function name) — no conflict with the project rule
- All three next-intl catalogs created from day 1 (D-08): EN fully filled; BM/ZH carry `_review: "native-review-pending"` markers
- `app/[lang]/layout.tsx` wraps children in `NextIntlClientProvider` with async `params` await (Next.js 16 gotcha honored)
- Root `app/layout.tsx` minimized to fonts + Toaster; locale-specific `<html lang>` lives in `app/[lang]/layout.tsx`
- `next.config.ts` updated with `withNextIntl` plugin
- `detectLang` passes all 4 TDD tests: EN, BM, ZH detection + ambiguous→'en' fallback
- franc-min ISO-639-3 mapping verified at runtime (key correction: BM returns `'zlm'` not `'msa'`)

## Task Commits

| Task | Phase | Commit | Description |
|------|-------|--------|-------------|
| 1 | feat | `0acb86f` | proxy.ts + next-intl routing + three catalogs + [lang] segment |
| 2 | test (RED) | `a646d78` | TDD RED: failing detect.test.ts |
| 2 | feat (GREEN) | `91ab70c` | TDD GREEN: detectLang franc-min (4 tests pass) |

## Decisions Made

1. **Q2 resolution: proxy.ts + next-intl v4 createMiddleware** — next-intl v4 ships `createMiddleware` from `next-intl/middleware`. Its own docs show the pattern as a `proxy` named export in `proxy.ts`, exactly matching Next.js 16's convention. We use `createMiddleware(routing)` inside `proxy.ts` — zero conflict with the project "no middleware.ts" rule. No `middleware.ts` created.

2. **franc-min ISO code correction** — research docs assumed franc returns `'msa'` for Malay. Verified at runtime: franc-min 6.2.0 returns `'zlm'` (Standard Malay) and `'ind'` (Indonesian, common for BM text). Both map to `'ms'`. Defensive mapping also includes `'msa'`/`'zsm'` for robustness.

3. **Root layout is lang-neutral** — `app/layout.tsx` does not set `lang` on `<html>` because it renders before the `[lang]` param is known. The locale is injected by `app/[lang]/layout.tsx` which awaits the async `params`.

4. **Native-review markers in BM/ZH catalogs** — ms.json and zh.json carry `_review: "native-review-pending"` at the top level per D-08. Machine-assisted drafts; not to be shipped to users without native reviewer sign-off.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] franc ISO code mismatch: franc returns 'zlm'/'ind' for BM, not 'msa'**
- **Found during:** Task 2 implementation (before writing tests, verified franc output at runtime)
- **Issue:** Research/plan assumed franc returns `'msa'` for Bahasa Malaysia. Actual output is `'zlm'` (Standard Malay) for clearly BM text and `'ind'` (Indonesian) for some BM phrases.
- **Fix:** Added all known BM codes to the mapping: `zlm`, `ind`, `msa`, `zsm` all map to `'ms'`. This is defensive and correct.
- **Files modified:** `src/i18n/detect.ts`
- **Impact:** Zero — tests pass, detection correct.

### None — plan executed as written (with the one auto-fixed franc code mapping)

## Known Stubs

**app/[lang]/page.tsx** — redirects to `/[lang]/sign-in` which does not exist yet (01-04 will create it). This is intentional scaffolding; the redirect will land on Next.js's default 404 until 01-04 ships. Not a functional stub blocking the plan's goal (the [lang] segment itself is working, the sign-in page is a dependency of 01-04).

## Threat Flags

No new security surfaces beyond what the plan's threat model covers.

- **T-01-18 (mitigated):** proxy.ts comment explicitly states "This is NOT the real authorization boundary" and points to `requireUser` in 01-04/01-12.
- **T-01-19 (mitigated):** `middleware.ts` absent; 01-02 lint gate enforces this; Q2 verified.

## TDD Gate Compliance

- [x] RED commit `a646d78` — `test(phase-kayinleong-01): 01-06 — TDD RED` (failing detect.test.ts)
- [x] GREEN commit `91ab70c` — `feat(phase-kayinleong-01): 01-06 — TDD GREEN` (4 tests pass)
- No REFACTOR needed — implementation is clean as written.

---
*Phase: 01-foundations | Plan: 06*
*Completed: 2026-05-31*

## Self-Check: PASSED

**Files verified:**

- [x] `proxy.ts` — exists at repo root, exports `proxy` function and `config` with `matcher`
- [x] `middleware.ts` — ABSENT (verified: `ls middleware.ts` → No such file)
- [x] `src/i18n/routing.ts` — exists, defineRouting with 'en'|'ms'|'zh'
- [x] `src/i18n/request.ts` — exists, getRequestConfig
- [x] `src/i18n/messages/en.json` — exists, 7 top-level namespaces
- [x] `src/i18n/messages/ms.json` — exists, matching keys + _review marker
- [x] `src/i18n/messages/zh.json` — exists, matching keys + _review marker
- [x] `app/[lang]/layout.tsx` — exists, contains NextIntlClientProvider
- [x] `app/[lang]/page.tsx` — exists
- [x] `src/i18n/detect.ts` — exists, exports detectLang, imports franc-min
- [x] `src/i18n/detect.test.ts` — exists, 4 tests

**Tests verified:**

- [x] `npx vitest run src/i18n/detect.test.ts` → 4/4 passed
- [x] `npm run lint` → 0 errors (4 pre-existing warnings, unrelated)
- [x] `npx tsc --noEmit` → 1 pre-existing error in vendored `components/ui/calendar.tsx` (out of scope, from initial scaffold commit 6a4bc80)

**Commits verified:**

- [x] `0acb86f` — feat(phase-kayinleong-01): 01-06 — proxy.ts locale routing + next-intl ^4 + [lang] segment
- [x] `a646d78` — test(phase-kayinleong-01): 01-06 — TDD RED: failing detect.test.ts (4 behaviors)
- [x] `91ab70c` — feat(phase-kayinleong-01): 01-06 — TDD GREEN: detectLang franc-min detection (4 tests pass)
