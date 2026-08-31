# Claim: quick-kayinleong-076
- owner: kayinleong
- session: claude-code
- branch: quick-kayinleong-045-whatsapp-ingest
- started: 2026-08-28
- status: done
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

## What has changed

`REPLY_PILLAR_ENABLED = true`. All three surfaces come back together, because quick-075 made
them read one flag: the pillar tab, the hero suggestion card, and the hero subtitle's "paste
a client message" clause.

The flag's doc comment now records the KB state at the moment of re-enabling, so the next
reader knows why a Reply turn may refuse rather than draft.

The test file was renamed `reply-hidden.test.ts` -> `reply-pillar-flag.test.ts`: it is about
the flag and its wiring, not about one particular value of it.

## Verification

- `npx tsc --noEmit` -> **0 errors**
- `npx vitest run` -> **1125 passed**, 197 skipped, 0 failed
- `npx eslint app src` -> **0 errors**; `npm run build` -> exit 0

Loaded `/en/chat` in a browser with a minted session: header reads
**Auto · Coach · Finder · Reply**, the "Draft: loan eligibility…" card is back, and the
subtitle again ends "Or paste a client message and I'll draft a reply in your voice."

Only one assertion changed — the one pinning the flag's value, which tracks the product
decision. The five that pin the WIRING (tab gated not deleted, hero card on the same flag,
subtitle swap, locale variants, server still accepts the override) passed untouched, which
is the point of testing the wiring rather than the value.

## Honest gaps

1. **Reply is visible but cannot draft yet.** Measured at re-enable: `pillar:'reply'` has
   **0 kbDocs, 0 kbChunks**, so `retrieveReplySop` finds nothing and the agent answers
   `no_sop_match` instead of a draft. That is the designed, honest behaviour — Reply refuses
   rather than inventing SOP content — but the pillar now appears before it is useful.
   The admin KB page can copy or move documents into the Reply pillar (quick-064/065).
2. **There is 1 lead in the system.** Reply fails closed without a `leadId` (D-07), so
   testing needs that lead selected.
3. **No Reply turn was run end to end** here — the flag flip is verified, the pillar's
   behaviour with real content is not.
