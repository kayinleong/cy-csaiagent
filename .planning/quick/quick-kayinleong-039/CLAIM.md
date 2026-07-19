# Claim: quick-kayinleong-039
- owner: kayinleong
- session: claude-code
- branch: quick-kayinleong-039-skool-project-scraper
- started: 2026-07-19
- status: done
- summary: Playwright scraper for the Skool "d2andco" classroom — scrape every "Project List: *" section + attached Google Drive collateral, then import the projects into inventory (projects + collateral) with per-project token accounting.

## What will change
- New `scripts/scrape-skool/` tooling (Playwright + tsx), read-only against Skool/Drive:
  - Interactive, WAF/bot-safe logins (`login.ts`, `gdrive-login.ts`) that save a session for headless reuse.
  - `scrape.ts` → `projects.json` (82 projects: body text, links, video, section).
  - `gdrive-crawl.ts` → `drive-documents.json` (full index of every Drive file).
  - `to-inventory.ts` → LLM-extracts `ProjectDoc` fields, dry-runs, and (`--apply`) writes to Firestore via the app's real `createProject`/`attachCollateral`; `--meter` reports exact per-project token usage.
- Data written to Firestore `projects` + `collateral` collections (no existing app code modified).

## What has changed
- **Scrape:** `projects.json` — 9 "Project List" sections, **82/82 projects**, 0 errors. Body text parsed from Skool's `[v2]` rich-text; 417 links captured (243 Drive folders, 84 WhatsApp, 6 Google Docs/Sheets/Forms, 3 Vimeo).
- **Drive index:** `drive-documents.json` — every file in every project's Drive folders enumerated (name/type/folder/project). Per D-09/C2 the app stores Drive links, not files, so this is a standalone index; collateral holds the links.
- **Inventory import (`--apply`):** **82 `projects` + 246 `collateral` docs** written to Firestore (`cy-c…gent`), each embedded via Gemini on create. Import is resumable + paced (recovered 7 projects that hit a Gemini rate-limit on the first pass — no duplicates).
- **Token accounting:** `projects.tokens.json` — exact per-project usage (extraction via Anthropic `usage` [81/82 exact, 1 transient fallback], embedding via Gemini `countTokens` [82/82 exact]). Total **252,038 tokens** over 82 projects: extraction 168,706 in + 15,675 out, embedding 67,657 (avg **3,074/project**).
- New scripts: `login.ts`, `scrape.ts`, `extract.ts`, `gdrive-login.ts`, `gdrive-crawl.ts`, `to-inventory.ts`, `README.md`. Throwaway probe scripts removed.

## Verification
**What was tested**
- Scrape: 82/82 projects mapped, 0 errors; spot-checked body text (Quick Facts: developer, location, land size, tenure, phases, units) and collateral links against source pages.
- Import dry-run: all 82 map to valid `ProjectDoc` (0 validation errors); quality reported (49 plausible prices, 32 unstated, 1 outlier; 53 bedrooms known; tenure 78/82).
- Import apply: every `createProject` returned a real Firestore doc id (82 ids); collateral attached (246).
- Token meter: exact-usage path validated on a 2-project trial (Anthropic usage + Gemini countTokens) before the full run.

**What passed** — full pipeline end-to-end; resumable re-run correctly skipped the 75 already-written and imported only the 7 remaining.

**Regression surface (ruled out)**
- **No existing app code modified** — this claim only adds `scripts/scrape-skool/` and new Firestore documents. No `src/` behavior changed.
- **Inventory reads (`searchProjects`)** — the 82 new `projects` are `status:'active'` and embedded, so they now appear in Finder results (intended). `priceBand` derived via `priceBandFor` (band sync preserved). Data caveat: ~39% of projects have no stated price (source gap) → `priceValue:0` → `under_500k` band; documented, to be enriched later from the Drive "Price Chart" collateral.
- **Collateral (D-09/C2)** — links stored as `externalUrl` only; no Drive-API integration (constraint respected).
- **Secrets** — credentials injected via env only; never logged/committed; `.env.local`/`sa.json`/session files untracked.
