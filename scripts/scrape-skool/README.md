# Skool → inventory pipeline (`quick-kayinleong-039`)

Scrapes the D2 & Co Skool classroom (`d2andco/classroom/50b424ff`) — every project
under each **"Project List: *"** section — reads the attached Google Drive
collateral, and imports the result into the app's **inventory** (`projects` +
`collateral`).

## Pipeline

```
login.ts ─▶ scrape.ts ─▶ projects.json ─▶ to-inventory.ts (dry-run ─▶ --apply) ─▶ Firestore
                              │
gdrive-login.ts ─▶ gdrive-crawl.ts ─▶ drive-documents.json  (index of every Drive file)
```

## Files

| File | Role |
| --- | --- |
| `login.ts` | One-time **interactive** Skool login → saves `skool-state.json` |
| `scrape.ts` | Reads the classroom tree, opens every project, writes `projects.json` |
| `extract.ts` | Attachment → text (pdfjs / mammoth / word-extractor / xlsx) |
| `gdrive-login.ts` | One-time **interactive** Google login → saves `google-state.json` |
| `gdrive-crawl.ts` | Walks all Drive folders, indexes every file → `drive-documents.json` |
| `to-inventory.ts` | `projects.json` → inventory (LLM-extract → dry-run → `--apply` + token meter) |

## Outputs

| File | Contents |
| --- | --- |
| `projects.json` | 82 projects: body text, links, video, section (the scrape) |
| `drive-documents.json` | Full index of every Drive file (name, type, folder, project) |
| `projects.inventory.json` | Dry-run preview: each project mapped to a `ProjectDoc` + collateral |
| `projects.tokens.json` | Per-project token usage for the LLM extraction + embedding |

## Auth — why the interactive logins

Both **Skool (AWS WAF)** and **Google** block headless automated logins. So
`login.ts` / `gdrive-login.ts` open a **headed, de-automated real browser**, let a
human finish the login (password / emailed code / 2FA + any challenge), then save
the session for the (headless, automated) `scrape.ts` / `gdrive-crawl.ts` to reuse.

> **Drive = links, not files (D-09/C2).** The app stores Drive folders as plain
> `collateral.externalUrl` — it never integrates the Drive API (no-GCP constraint).
> `gdrive-crawl.ts` builds a standalone *index* of Drive contents; the app only gets
> the links.

## Run

Credentials/paths come from an env file kept **outside the repo** (never committed):
`SKOOL_EMAIL`, `SKOOL_PASSWORD`, `SKOOL_CLASSROOM_URL`, `SCRAPE_OUT`.

```bash
ENV=<scratch>/skool.env; TSX=node_modules/.bin/tsx

# 1) Skool: interactive login, then scrape
$TSX --env-file=$ENV scripts/scrape-skool/login.ts       # finish login in the window
PROJECTS_JSON=./projects.json $TSX --env-file=$ENV scripts/scrape-skool/scrape.ts

# 2) Drive: interactive Google login, then index every file
$TSX --env-file=$ENV scripts/scrape-skool/gdrive-login.ts
GDRIVE_PHASE=enumerate $TSX --env-file=$ENV scripts/scrape-skool/gdrive-crawl.ts

# 3) Inventory import (creds from .env.local; DRY-RUN by default)
EXTRACT_MODEL=<valid-model-id> $TSX scripts/scrape-skool/to-inventory.ts            # dry-run → preview
EXTRACT_MODEL=<valid-model-id> $TSX scripts/scrape-skool/to-inventory.ts --apply    # write to Firestore (resumable, paced)
EXTRACT_MODEL=<valid-model-id> $TSX scripts/scrape-skool/to-inventory.ts --meter    # exact per-project token usage
```

Knobs: `SKOOL_LIMIT` / `--limit` (cap for trials), `SKOOL_HEADLESS=0` (watch it),
`GDRIVE_VIDEOS=1` (also download videos), `EMBED_DELAY_MS` (pace embeddings),
`EXTRACT_MODEL` (extraction model — the app's `modelFor('finder')` id must be a
valid live model; override here for ETL).

- `to-inventory.ts --apply` is **not idempotent-by-write** but **is resumable**: it
  skips projects already in `projects.tokens.json` (by name), so re-running only
  imports the remaining/failed ones — no duplicates.

## Security

- Credentials inject at runtime via `--env-file` / `.env.local`; never logged or
  committed. `.env*`, `sa.json`, session files stay out of the repo (`SCRAPE_OUT`
  is the scratch dir).
- Scrapers are **read-only** against Skool/Drive. Only `to-inventory.ts --apply`
  writes — to Firestore, via the app's real admin-gated `createProject` /
  `attachCollateral` pipeline (embed-on-create, priceBand sync).
