# Deploy + Secrets Runbook
## D2 Customer Service AI Agent Platform

**Audience:** Engineers performing deployments and secret rotations.

---

## Prerequisites

```bash
# Ensure these are installed
firebase --version      # Firebase CLI (latest)
gcloud --version        # Google Cloud CLI (for backup operations)
node --version          # Node 20+ (matching App Hosting)
```

Log in:
```bash
firebase login
gcloud auth login
```

---

## 1. Deploying App Code (App Hosting)

The platform deploys via Firebase App Hosting (Next.js 16 monolith). **Do NOT use `firebase deploy` for the app itself** — App Hosting uses git-push deployment.

### Standard deploy flow

1. Merge your changes to the `main` branch (after PR review — Claude never merges its own PR).
2. App Hosting automatically detects the push and starts a build + rollout.
3. Monitor in Firebase Console → App Hosting → Rollouts.

### Deploying Firestore rules + indexes separately

Firestore rules and indexes deploy independently of App Hosting:

```bash
# Deploy rules only (after any firestore.rules change)
firebase deploy --only firestore:rules

# Deploy indexes only (after any firestore.indexes.json change)
firebase deploy --only firestore:indexes

# Deploy both
firebase deploy --only firestore:rules,firestore:indexes
```

**Important:** Indexes can take several minutes to build. Wait for the build to complete before testing. Run `firebase firestore:indexes` to check index status.

---

## 2. Secrets (Secret Manager)

All sensitive values are stored in Firebase Secret Manager and accessed by App Hosting at build/runtime. **Never commit secrets to git. Never log secrets. Never paste them into these docs — use placeholders.**

### Secret names

| Secret name | Purpose | How to update |
|------------|---------|--------------|
| `ANTHROPIC_API_KEY` | Claude API access | Firebase Console → App Hosting → Environment Variables |
| `GOOGLE_GENERATIVE_AI_API_KEY` | Gemini embedding API (Developer API — NOT Vertex AI) | Firebase Console → App Hosting → Environment Variables |
| `FIREBASE_SERVICE_ACCOUNT` | Admin SDK auth (auto-managed by App Hosting) | Do not rotate manually |

### Rotating a secret

1. Generate a new key from the provider (Anthropic Console / Google AI Studio).
2. Firebase Console → App Hosting → your backend → Environment Variables.
3. Update the secret value.
4. Trigger a new App Hosting rollout (push a commit to main, or use the Firebase Console rollout button).
5. Verify the new key works: check the platform chat — a model response confirms auth.
6. Revoke the old key from the provider console after confirming the new one is live.

### Checking a secret is present

Never echo secrets. Instead verify the runtime behavior:
```bash
# If the ANTHROPIC_API_KEY is missing, the chat route returns 500 with "LLM provider error"
# Visit /api/health (if implemented) or test a chat turn
```

---

## 3. Remote Config (Model IDs)

Model IDs are stored in Firebase Remote Config — **never hard-coded**. This satisfies QUAL-01 (model-agnostic).

### Current model assignments

| Config key | Default value | Notes |
|-----------|--------------|-------|
| `claude_model_coach` | `claude-sonnet-4-6` | Onboarding Coach |
| `claude_model_finder` | `claude-sonnet-4-6` | Property Finder |
| `claude_model_reply` | `claude-sonnet-4-6` | Reply Assistant |
| `claude_model_judge` | `claude-opus-4-7` | Promptfoo eval judge |
| `gemini_embedding_model` | `gemini-embedding-001` | Embedding (Developer API) |

### Swapping a model (e.g. model outage)

1. Firebase Console → Remote Config.
2. Find the relevant key (e.g. `claude_model_coach`).
3. Update the value to the new model ID.
4. Click **Publish changes**.
5. The change takes effect within seconds (no redeploy needed).
6. Verify by running a chat turn and checking the admin usage dashboard (pillar token counts should shift).

**Note:** After a model swap, run the QUAL-01 model-swap integration test to verify capability parity.

---

## 4. Firestore Security Rules

Security rules gate what clients can read/write. The Admin SDK (server-side) bypasses rules entirely — server-side code is responsible for its own gating.

### Rule change checklist

Before deploying a rules change:

- [ ] Run `npm run test:rules` (requires Firestore emulator — `firebase emulators:start`)
- [ ] All 19 collections remain enumerated in `src/firebase/__tests__/rules.test.ts`
- [ ] No existing `allow` statement is widened (only narrow or add)
- [ ] Deploy with: `firebase deploy --only firestore:rules`

### Confirming rules are live

```bash
firebase firestore:rules  # Lists current deployed rules version
```

---

## 5. Post-Deploy Verification Checklist

After any significant deploy:

- [ ] Visit `<APP_HOSTING_URL>/<lang>/chat` as a `new-agent` — confirm chat responds
- [ ] Visit `<APP_HOSTING_URL>/<lang>/dashboard` as a `senior-coach` — confirm dashboard loads
- [ ] Visit `<APP_HOSTING_URL>/<lang>/usage` as `admin` — confirm usage dashboard loads
- [ ] Check stale watchdog: confirm the usage rollup date is recent
- [ ] Run `npm test` locally — confirm no regressions
- [ ] Check Firebase Console → App Hosting → Logs for 5xx errors

---

## 6. Environment-Specific Notes

| Environment | Branch | App Hosting Backend |
|------------|--------|-------------------|
| Production | `main` | `<PROJECT_ID>` backend |
| Staging (if configured) | `staging` | Separate backend (if provisioned) |

All infrastructure is in `asia-southeast1`. **This is immovable once set.**
