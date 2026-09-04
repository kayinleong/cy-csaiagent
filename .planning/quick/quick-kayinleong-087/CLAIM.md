# Claim: quick-kayinleong-087
- owner: kayinleong
- session: claude-code
- branch: main
- started: 2026-09-04
- status: claimed
- summary: `npm ci` fails on package.json/package-lock.json drift, so CI dies at the install step and the App Hosting build cannot install dependencies — nothing can deploy until the lockfile is regenerated

## What is wrong

CI has been red since at least 2026-09-03, failing at **Install dependencies**, before lint or
tests ever run:

    npm error `npm ci` can only install packages when your package.json and
    npm error package-lock.json ... are in sync.
    npm error Missing: gcp-metadata@7.0.1 from lock file
    npm error Missing: @swc/helpers@0.5.23 from lock file

Pre-existing, not introduced by quick-085/086 — the identical two packages failed run
`8c9b86f9` before those commits were pushed.

The committed lockfile carries different versions than resolution now demands:

| package | in lockfile | required |
|---|---|---|
| `gcp-metadata` | 8.1.2 (+ 6.1.1 nested x2) | 7.0.1 |
| `@swc/helpers` | 0.5.15 | 0.5.23 |

Consistent with a Dependabot bump landing in `package.json` without the lock tree being fully
regenerated (two Dependabot merges — `qs`, `fast-uri` — are adjacent in the run history).

**Why this blocks the current work:** Firebase App Hosting installs dependencies as part of its
build. A repo whose `npm ci` cannot resolve is a repo that cannot deploy, so quick-085's Finder
table cannot reach the user regardless of how well it is verified locally.

## What will change

Regenerate `package-lock.json` from `package.json` with `npm install --package-lock-only` — lock
only, no `node_modules` mutation — then prove `npm ci` resolves and the full gate still passes.

## What has changed

_(pending)_

## Verification

_(pending)_
