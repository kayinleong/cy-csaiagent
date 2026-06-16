# Claim: quick-kayinleong-027

- owner: kayinleong
- session: claude-code
- branch: main
- started: 2026-06-16
- status: claimed
- summary: Ensure every index / list / table page in the app is paginated. Survey all row-based list surfaces, add a consistent pagination control (reuse the vendored components/ui/pagination), and apply it — preferring client-side pagination over the already-bounded server reads (pilot scale ≤200) where no cursor exists, and respecting any surface that already paginates.

## What will change

TBD after survey — enumerate every list/table surface (users, agents, cohorts, conversations, audit-log, inventory, kb, flags, erasure, dashboard downline/feeds, etc.), note which already paginate, then add a shared pagination control to the rest.

## What has changed

(pending)

## Verification

(pending)
