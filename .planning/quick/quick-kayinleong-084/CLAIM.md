# Claim: quick-kayinleong-084
- owner: kayinleong
- session: claude-code
- branch: quick-kayinleong-045-whatsapp-ingest
- started: 2026-08-29
- status: done
- summary: the AI disclosure modal sits 32px right of centre — `mx-4` on a translate-centred dialog — and three other dialogs lose their mobile gutter the same way

## What is wrong

It was the modal all along. It has been at the centre of every screenshot for four rounds and
I kept fixing the header behind it.

`components/ui/dialog.tsx` already handles mobile properly:

    fixed top-1/2 left-1/2 w-full max-w-[calc(100%-2rem)] -translate-x-1/2 … sm:max-w-sm

16px gutters below `sm`, capped at 384px above. But `disclosure-modal.tsx` passes
`className="max-w-sm mx-4"`, and both parts are wrong:

- **`mx-4`** adds `margin-left: 16px` to an element positioned with `left: 50%` +
  `translate(-50%)`. The margin shifts it right; there is nothing to balance it.
- **`max-w-sm` unprefixed** replaces `max-w-[calc(100%-2rem)]` at EVERY width, so the mobile
  gutter rule is gone.

Measured in the page at the user's own 440x956, using the exact class list:

| | width | left gutter | right gutter | centred |
|---|---|---|---|---|
| `max-w-sm mx-4` (current) | 384px | **44px** | **12px** | **no** |
| base classes only | 408px | 16px | 16px | yes |

32px of asymmetry on a 440px screen. That is the "not responsive" look.

Three other dialogs pass an unprefixed `max-w-md` / `max-w-lg`, which is the same override
mistake without the `mx-4`: below `sm` they go edge-to-edge with no gutter at all.
`conversation-viewer.tsx:239` rendered correctly — it set `w-[calc(100%-2rem)] max-w-lg`
explicitly — but it was normalised to `sm:max-w-lg` anyway so the guard below can be a flat
rule with no exception list. Identical computed width at every breakpoint (checked below).

## What changed

Four call sites, class names only. No component, layout or logic change.

| file | before | after |
|---|---|---|
| `app/[lang]/chat/disclosure-modal.tsx` | `max-w-sm mx-4` | *(no override — base handles it)* |
| `app/[lang]/(admin)/conversations/conversation-viewer.tsx:324` | `max-w-md` | `sm:max-w-md` |
| `app/[lang]/(admin)/conversations/conversation-viewer.tsx:239` | `w-[calc(100%-2rem)] max-w-lg` | `sm:max-w-lg` |
| `app/[lang]/(coach)/_components/inline-correction-dialog.tsx:207` | `max-w-lg` | `sm:max-w-lg` |
| `app/[lang]/(coach)/_components/stall-inbox.tsx:151` | `max-w-lg` | `sm:max-w-lg` |

Plus `tests/dialog-mobile-width.test.ts` (new) — a repo-wide guard, below.

## Verification

### Measured in a real browser, on the rendered modal

`getBoundingClientRect()` on `[data-slot="disclosure-modal"]`, dev server, disclosure open:

| viewport | width | left gutter | right gutter | centred | margin-left | computed max-width |
|---|---|---|---|---|---|---|
| 440 (user's iPhone 16 Pro Max) | 408px | 16px | 16px | yes | 0px | `calc(100% - 32px)` |
| 320 (narrowest phone) | 288px | 16px | 16px | yes | 0px | `calc(100% - 32px)` |
| 1280 (desktop) | 384px | 448px | 448px | yes | 0px | `384px` |

Before, at 440: **384px wide, 44px left, 12px right, not centred.**

Desktop width is **unchanged at 384px** — `sm:max-w-sm` from the base component resolves to
exactly what the removed `max-w-sm` did at that width. The only desktop difference is that the
dialog is now actually centred instead of sitting 16px right. Confirmed by screenshot.

### The guard was verified by reintroducing the bug

Three mutants, each reverted after the run. A guard that has never failed is not a guard:

| mutant | result |
|---|---|
| put `className="max-w-sm mx-4"` back on the disclosure modal | **2 tests fail**, naming the file and both offending classes |
| bare `max-w-lg` on `stall-inbox.tsx` (the other three dialogs' bug) | **1 test fails**, naming the file |
| strip `max-w-[calc(100%-2rem)]` out of the vendored `components/ui/dialog.tsx` | **1 test fails** — the guards above assume the base handles phones, so that assumption is itself asserted |

The suite also asserts the grep finds call sites at all, so the scan cannot pass vacuously if
`<DialogContent` stops matching.

### Regression surface

Everything that renders a `DialogContent`. All eight call sites enumerated by grep:

| call site | change | why it cannot regress |
|---|---|---|
| `disclosure-modal.tsx` | override removed | measured at 320 / 440 / 1280 above |
| `conversation-viewer.tsx:239` (thread viewer) | `w-[calc(100%-2rem)] max-w-lg` → `sm:max-w-lg` | at 440: was `min(408, 512)` = 408, now `min(440, 408)` = 408. At 1280: was `min(1248, 512)` = 512, now `min(1280, 512)` = 512. Identical at every width. |
| `conversation-viewer.tsx:324` (flag reason) | `max-w-md` → `sm:max-w-md` | ≥640px unchanged (448px). Below 640 it now gets the 16px gutter instead of going edge-to-edge. |
| `inline-correction-dialog.tsx:207` | `max-w-lg` → `sm:max-w-lg` | same shape as above |
| `stall-inbox.tsx:151` | `max-w-lg` → `sm:max-w-lg` | same shape as above |
| `lead-management.tsx:315` | untouched | sets `max-h`/`overflow-y` only, no width override |
| `cohort-management.tsx:318, 364` | untouched | no className at all — already on the base |
| `components/ui/command.tsx:55` | untouched | vendored; the guard scans `app/` only and asserts this file keeps its mobile rule |

**Ruled out:**
- *Dialog height / scrolling* — no `max-h`, `h-*` or `overflow` class was touched.
- *The header work from quick-081/082/083* — different file, different element. `mobile-layout.test.ts` (13 assertions) still passes.
- *Desktop layout* — the only ≥`sm` change is the removal of `mx-4`, which corrects a 16px offset. Widths measured identical.
- *Close-button / focus behaviour* — `showCloseButton={false}`, `onInteractOutside`, `onEscapeKeyDown` on the disclosure modal are untouched, so it still cannot be dismissed without acknowledging (CHAT-05).

### Gate

| check | result |
|---|---|
| `npx tsc --noEmit` | exit 0 |
| `npx vitest run` | **1150 passed**, 0 failed, 197 skipped (75 files) — two consecutive clean runs |
| `npx eslint app src tests` | 0 errors (77 pre-existing warnings) |
| `npm run build` | success |

**Flake noted, not caused here:** the first full-suite run showed 1 failure in
`src/agents/reply/reply.test.ts`, which passed on the next three runs (once alone, twice in the
full suite). That file is an `it.fails` RED suite from Wave 0 whose header says it flips to
failing once `src/agents/reply` exists — which it now does. It is unrelated to this
CSS-only claim (nothing in `app/**/*.tsx` reaches `src/agents/reply`), but the `.fails`
markers there are stale and should be removed in their own claim.

## What I got wrong, and why it took four rounds

The modal was the problem from the first screenshot. I fixed the header three times behind it
because I never asked which element looked wrong, and never checked what viewport the user was
on — quick-082 gated the header wrap on `sm` (640px) while the user was at 440px. The screenshot
had the answer in it each time.

Two habits this reinforces, both already earned earlier this session:
- **Measure the width the user is actually on**, not a convenient one.
- **Break the guard on purpose.** Grepping that a class exists proves nothing; the mutants above
  are the only reason I believe this test would catch a regression.
