# Claim: quick-kayinleong-084
- owner: kayinleong
- session: claude-code
- branch: quick-kayinleong-045-whatsapp-ingest
- started: 2026-08-29
- status: claimed
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
`conversation-viewer.tsx:239` is fine — it sets `w-[calc(100%-2rem)]` explicitly.

## Verification

_(pending)_
