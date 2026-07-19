# Claim: quick-kayinleong-039
- owner: kayinleong
- session: claude-code
- branch: quick-kayinleong-039-skool-project-scraper
- started: 2026-07-19
- status: in-progress
- summary: Playwright scraper for the Skool "d2andco" classroom — scrape every "Project List: *" section + all attached documents into projects.json, pause for user verification, then route the data into KB or inventory.

## What will change
- New Playwright + `tsx` scraper under `scripts/scrape-skool/` that:
  - Logs into skool.com using **runtime-injected** credentials (read from an env file kept outside the repo — never committed, never logged).
  - Opens the "D2 & Co Projects" classroom and enumerates every left-nav section whose title starts with `Project List`.
  - Expands each section, enumerates its child project lessons, and opens each one.
  - Extracts each project's on-page content (title, body text, structured metadata) + the list of attached documents/links.
  - Downloads every attachment and extracts its text using already-vendored parsers (`pdfjs-dist`, `mammoth`, `word-extractor`, `xlsx`).
  - Writes a normalized `projects.json` (raw scrape output) to the repo root.
- **After user verification** (checkpoint): ingest the verified data into either `src/kb` (knowledge base) or `src/inventory` (structured project records) — decision made from the observed data shape and documented here.

## What has changed
- _(filled as work completes)_

## Verification
- _(Regression Report — filled before status → done)_
