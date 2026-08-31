# Claim: quick-kayinleong-076
- owner: kayinleong
- session: claude-code
- branch: quick-kayinleong-045-whatsapp-ingest
- started: 2026-08-28
- status: claimed
- summary: re-enable the Reply pillar — the one-line flip quick-075 was built for

## What will change

User: "enable back the reply function". quick-075 hid it behind `REPLY_PILLAR_ENABLED` and
wrapped rather than deleted everything, precisely so this is a flip rather than a rebuild.

`REPLY_PILLAR_ENABLED = false -> true` restores all three surfaces at once: the pillar tab,
the hero suggestion card, and the hero subtitle's "paste a client message" clause.

One test pins the flag's VALUE and has to move with it. That is the test doing its job —
it documents which state the product is in. The tests that matter, the ones pinning that all
three surfaces read the same flag, are unchanged and keep passing either way.

## Measured before flipping

| pillar | kbDocs | kbChunks |
|---|---|---|
| coach | 3 | 35 |
| finder | 1068 | 25153 |
| **reply** | **0** | **0** |

Reply still has nothing to ground on, so a drafted reply is not yet possible — see the
report. Enabling is the user's call; saying nothing about that would not be.

## Verification

_(pending)_
