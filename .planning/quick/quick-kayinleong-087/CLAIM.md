# Claim: quick-kayinleong-087
- owner: kayinleong
- session: claude-code
- branch: main
- started: 2026-09-04
- status: done
- summary: CI pins Node 20 on a project that needs >=22.13.0, so npm 10 resolved a different tree than the npm 11 lockfile and `npm ci` died at install — the lockfile was never drifted; the runtime was wrong, and nothing declared the requirement

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

## The lockfile was NOT the problem

The first hypothesis — Dependabot drift — was wrong, and disproving it was the whole diagnosis.
`npm install --package-lock-only` produced **a zero-byte diff**: the lockfile is already exactly
what `package.json` resolves to. So the "Missing from lock file" error had to come from something
resolving *differently*, not from a stale lock.

The answer was two lines above the error in the same CI log:

    npm warn EBADENGINE package: 'pdfjs-dist@6.0.227'
    npm warn EBADENGINE required: { node: '>=22.13.0 || >=24' }
    npm warn EBADENGINE current:  { node: 'v20.20.2', npm: '10.8.2' }

| environment | node | npm | result |
|---|---|---|---|
| local | 24.14.1 | 11.11.0 | lockfile resolves cleanly, `npm ci` fine |
| CI (`ci.yml:21`) | **20.20.2** | 10.8.2 | demands `gcp-metadata@7.0.1`, `@swc/helpers@0.5.23` |

Node 20 / npm 10 walks to different transitive versions than the npm 11 lockfile records, and
reports the difference as "Missing from lock file". **The runtime was wrong, not the lock.**

Nothing in the repo declared the requirement: `package.json` had **no `engines` field**, so the
Node-20 pin looked legitimate and the mismatch was invisible to every contributor and to
App Hosting's runtime selection.

## What changed

| file | change | why |
|---|---|---|
| `.github/workflows/ci.yml:21` | `node-version: '20'` → `'22'` | satisfies `pdfjs-dist >=22.13.0`, so npm resolves the tree the lockfile records |
| `package.json` | added `"engines": { "node": ">=22.13.0" }` | declares the real requirement. Firebase App Hosting reads `engines.node` for runtime selection, so this is also what stops the **deploy** hitting the identical failure |

`package-lock.json` is **untouched** — deliberately. Regenerating a lock to paper over a runtime
mismatch would have hidden the cause and churned the dependency tree for nothing.

## Verification

| check | result |
|---|---|
| `npm install --package-lock-only` | **zero diff** — proves the lock was never stale |
| `git status package-lock.json` | clean, untouched by this claim |
| `git diff --stat` | 2 files, +4 −1 — CI pin and the engines block only |
| `npx tsc --noEmit` | exit 0 |
| `npx vitest run` | **1248 passed**, 0 failed, 197 skipped |
| `npx eslint app src tests` | **0 errors**, 77 warnings (all pre-existing) |
| `npm run build` | compiled successfully |

**The real gate is CI itself** — the failure only reproduces under Node 20, which cannot be
exercised from this machine (local Node is 24). Confirmed green on the pushed commit before this
claim was closed; see the run referenced in STATE.

### Regression surface

- **CI Node 20 → 22:** the only consumer of that pin is the `Lint + Unit Tests + PII Scan` job,
  which previously never got past `npm ci`. It cannot regress a step that never ran.
- **`engines.node`:** advisory to npm by default (`engine-strict` is not set), so it cannot break a
  local install. It *is* read by App Hosting for runtime selection — the intended effect, and the
  reason the deploy is expected to succeed now. Flagged rather than buried: this changes the
  deployed Node runtime from whatever App Hosting defaulted to, to >=22.13.0.
- **Not touched:** no application code, no dependency versions, no lockfile.

## Known gaps

- The Node-20 resolution cannot be reproduced locally, so the fix is verified by CI rather than on
  this machine.
- GitHub reports 94 Dependabot vulnerabilities (1 critical, 40 high) on the default branch. Out of
  scope here and left alone deliberately — it wants its own claim, not a drive-by `audit fix`.
