# Claim: quick-kayinleong-103
- owner: kayinleong
- session: claude-code
- branch: quick-kayinleong-103
- started: 2026-11-06
- status: in-progress
- summary: Finder result presentation. The table no longer cuts off names and locations. Projects that only sit around the requested area are labelled as nearby alternatives. A project's details read like its Skool page, with the PIC, the WhatsApp group link and the project and marketing links.

## What will change
Three reports from the user, all on the Finder result surface. Example query: "i just need damansara height projects".

1. **Text cut off.** `app/[lang]/chat/match-table.tsx` truncates Name, Location and Highlight to one line with an ellipsis ("The Cedar Damansara H…"). The cells will wrap instead, so the full text shows.
2. **Nearby projects shown as if they were in the area.** The DH search returns 6 projects. Two of them are in another area: One Eleven Menerung @ Bangsar ("Bangsar, between BSC & Pavilion Damansara Heights, …") and Majestic @ Kiara Reserve ("Mont Kiara / Damansara Heights, …").
   - `src/inventory/search.ts` will mark each location match `in_area` or `nearby`. It is `in_area` when the area is in the project name or in the first part of its address, otherwise `nearby`. In-area projects rank first.
   - The table will show the nearby ones under "Other projects around <area>".
   - `src/agents/finder/prompt.ts` will tell the model to present them the same way and never call them in the area.
3. **Details in the Skool quick-facts format.**
   - The projectDetail answer will follow the Skool layout: Quick Facts, Built-Up Sizes & Layouts, prices and fees, Facilities.
   - Below it, a server-attached project sheet shows the PIC / project leaders, the WhatsApp group link, and the project and marketing links. These are parsed from the stored write-up and the collateral records, never typed out by the model.
   - A Copy button lets the agent paste everything into WhatsApp.

## What has changed
(filled in as work lands)

## Verification
(filled in at the end)
