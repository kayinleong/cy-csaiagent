# Claim: quick-kayinleong-062
- owner: kayinleong
- session: claude-code
- branch: quick-kayinleong-045-whatsapp-ingest
- started: 2026-08-27
- status: claimed
- summary: match-card footer — three identical "whatsapp-media" pills tell the agent nothing; separate criteria from attachments and give each file a real name

## What will change

User: "update this ui instead of pills, make it look nicer", with a screenshot of a working
match card whose footer is `≤RM900k` `Bangsar` `2 bed` `↗ whatsapp-media` `↗ whatsapp-media`
`↗ whatsapp-media`.

Two real problems, not just styling:
1. **Matched criteria and collateral links render identically.** One is context, the other
   is the thing the agent taps and forwards to a lead — they should not look the same.
2. **Every attachment is labelled `whatsapp-media`**, the raw `type` off the collateral doc.
   The agent cannot tell a sales kit from a floor-plan photo without opening all three.

Planned: derive a readable name and a file kind from the URL, render attachments as a
stacked tappable list (mobile-first — a wrapping pill row is the worst case on a phone), and
demote the criteria to a quiet meta line.

## Verification

_(pending)_
