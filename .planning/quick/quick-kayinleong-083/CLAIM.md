# Claim: quick-kayinleong-083
- owner: kayinleong
- session: claude-code
- branch: quick-kayinleong-045-whatsapp-ingest
- started: 2026-08-29
- status: claimed
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

## Verification

_(pending)_
