# Claim: quick-kayinleong-056
- owner: kayinleong
- session: claude-code
- branch: quick-kayinleong-045-whatsapp-ingest
- started: 2026-08-26
- status: claimed
- summary: render guardrail — a JSON envelope must ALWAYS reach the agent as formatted output, never as raw/half-broken JSON or a dangling markdown link

## What will change

User report: "can u add a guardrail to make sure every json output will render just like in
the image", with a raw SSE paste and a screenshot of a correctly-rendered card whose THIRD
collateral link is cut off mid-token and shows as literal `[End Financier Info](https://…`.

Planned:
1. Repair a TRUNCATED JSON envelope instead of giving up on it (the dominant failure).
2. Drop a provably-incomplete tail item rather than emitting a dead half-link.
3. Sanitize a dangling markdown link at one choke point so it can never render literally.
4. Show the project NAME on a match card — the image has one, a match card shows a raw ID.

## Verification

_(pending)_
