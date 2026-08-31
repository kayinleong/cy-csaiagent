# Claim: quick-kayinleong-083
- owner: kayinleong
- session: claude-code
- branch: quick-kayinleong-045-whatsapp-ingest
- started: 2026-08-29
- status: done
- summary: I gated the header wrap on `sm` (640px), so a 440px iPhone 16 Pro Max gets a two-row header it has ample width for

## The detail that unlocked this

The user's screenshot finally included the DevTools bar: **iPhone 16 Pro Max, 440 x 956**.

Tailwind's `sm` is **640px**. Everything I have been calling "mobile" applies all the way up
to 639px — so at 440px the header still wraps the pillar strip onto its own row, even though
a single row needs only ~390px there.

That is why it still looks wrong on their actual device. The tabs are readable (quick-082 did
that), but the header is two rows tall for no reason on a large phone.

I had been testing 320 and 375 and never the width they were actually on. Their earlier
screenshots were device mockups with no dimensions, and I did not ask.

## What will change

Gate the wrap on the width where it is actually needed, not on `sm`. With the icon-only coach
button and the hidden logo mark, a single row fits from about 400px, so wrap below that and
sit on one row above it.

## What has changed

`chat-header.tsx` — the wrap is gated on `min-[400px]` instead of `sm`:

- container `flex-wrap … min-[400px]:h-14 min-[400px]:flex-nowrap min-[400px]:py-0`
- tab strip `basis-full … min-[400px]:order-none min-[400px]:basis-0 min-[400px]:flex-1`
- left group `flex-1 min-[400px]:flex-none`

The icon-only coach button and hidden logo mark (quick-081) stay below `sm` — those are what
make a single row fit at 400px at all.

## Verification

- `npx tsc --noEmit` -> **0 errors**
- `npx vitest run` -> **1145 passed**, 197 skipped, 0 failed
- `npx eslint app src` -> **0 errors**; `npm run build` -> exit 0

### Measured, not eyeballed
Rather than judging screenshots, I measured the header box in the page at each width:

| viewport | rows | header height | overflows | all four tabs fully visible |
|---|---|---|---|---|
| 320 | TWO | 92px | no | **yes** |
| 399 | TWO | 92px | no | **yes** |
| **400** | **ONE** | **56px** | **no** | **yes** |
| **440** (their device) | **ONE** | 56px | no | **yes** |
| desktop | ONE | unchanged | no | yes |

399 wraps, 400 does not — the threshold lands exactly where intended, and 440 now gets the
single row it has room for.

### Regression surface
- Desktop re-checked by looking: logo, wordmark, centred tabs, EN/BM/中文 chips, full coach
  pill — unchanged.
- A guard asserts `sm:flex-nowrap` and `sm:basis-0` appear NOWHERE, so a stray `sm`-gated
  wrap rule cannot reintroduce the 440px regression.

## What I got wrong, three times

| claim | change | why it was not enough |
|---|---|---|
| 081 | shrink the tabs' neighbours | fixed 375, still clipped at 320 |
| 082 | wrap below `sm` | fixed every width, but `sm` is 640px so it wasted a row on real phones |
| 083 | wrap below 400px | the wrap now happens only where it is needed |

The root cause of the loop is simpler than any of the CSS: **I never tested the width they
were on.** I picked 320 and 375 because they are the widths I think of as "mobile"; their
device is 440. Their first three screenshots were device mockups with no dimensions, and I
did not ask for them — the DevTools bar in this one gave me the answer in seconds.

## Honest gaps

1. **400px is a measured threshold for THIS header.** Add another control and it silently
   becomes wrong. The guard pins the number, not the reasoning behind it.
2. **Landscape is untested** — a 956x440 phone is above 400 and would use a single row, which
   should be right, but I did not check.
3. **I still cannot reproduce a problem with the AI disclosure modal** that has been in the
   centre of every one of these screenshots. At 320, 375, 400 and 440 it fits with margins.
   If that is what "still same" has meant all along, I need you to say so — I have been
   fixing the header behind it.
