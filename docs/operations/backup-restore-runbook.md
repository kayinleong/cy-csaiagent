# Backup + Restore Runbook
## D2 Customer Service AI Agent Platform

**Mechanism:** Managed `gcloud firestore export` and `gcloud firestore import` — the native Firestore backup tool. This is an operational procedure (human-run), NOT app code and NOT an automated scheduled export.

> **Confirm with Derek (A6):** That the managed `gcloud firestore export/import` operational approach is acceptable for the project. If a stricter "no GCP Admin API at all" reading applies, the backup mechanism must be reconsidered before rollout. Document Derek's decision before the first production export.

---

## Prerequisites

```bash
# Google Cloud CLI installed and authenticated
gcloud --version
gcloud auth login
gcloud config set project <PROJECT_ID>

# Verify you have a Cloud Storage bucket for exports
# (create it in the Firebase Console or via gcloud if needed)
gsutil ls gs://<BUCKET_NAME>-backups/
```

---

## 1. Create an Export (Backup)

Run this **before** any significant operation:
- Code deployments that affect Firestore schema
- Bulk data operations (migrations, seeding)
- Any admin erasure drill or PDPA drill

```bash
# Export ALL collections (recommended for full backup)
gcloud firestore export gs://<BUCKET_NAME>-backups/exports/$(date +%Y-%m-%d)/

# Export specific collections only (e.g., before an erasure drill)
gcloud firestore export gs://<BUCKET_NAME>-backups/exports/$(date +%Y-%m-%d)/ \
  --collection-ids=users,agentProfiles,conversations,leads,leadContext,kbDocs,kbChunks
```

**Expected output:**
```
Waiting for [projects/<PROJECT_ID>/databases/(default)/operations/<OP_ID>] to finish...done.
```

This takes a few minutes for a full export. The export is stored at:
`gs://<BUCKET_NAME>-backups/exports/YYYY-MM-DD/`

After export, update the backup age tracker:
```bash
# Update the heartbeats/backup-reminder doc in Firestore (manually, via Firebase Console)
# Set: lastRun = <current timestamp>, status = 'idle'
# This clears the admin watchdog backup alert
```

---

## 2. Restore from an Export

**Warning:** Firestore import MERGES data — it does NOT delete existing documents first. Use a test Firestore project for restore validation drills.

```bash
# Identify the export to restore from
gsutil ls gs://<BUCKET_NAME>-backups/exports/

# Import (restore) from a specific export date
gcloud firestore import gs://<BUCKET_NAME>-backups/exports/YYYY-MM-DD/

# Import specific collections only
gcloud firestore import gs://<BUCKET_NAME>-backups/exports/YYYY-MM-DD/ \
  --collection-ids=users,agentProfiles,kbDocs
```

**For a full production restore after data loss:**
1. Contact Derek immediately — this is a significant operational event.
2. Put the platform in maintenance mode (deploy a maintenance page to App Hosting).
3. Export the current state first (even if damaged — for audit purposes).
4. Import from the last known-good backup.
5. Verify data integrity (spot-check a few agents' profiles and conversations).
6. Remove maintenance mode.

---

## 3. Backup Verification (Restore Drill)

Run this drill before rollout and quarterly thereafter:

1. Create a test Firestore project in the Firebase Console (separate from production).
2. Export production data:
   ```bash
   gcloud firestore export gs://<BUCKET_NAME>-backups/exports/drill-$(date +%Y-%m-%d)/
   ```
3. Import into the test project:
   ```bash
   gcloud config set project <TEST_PROJECT_ID>
   gcloud firestore import gs://<BUCKET_NAME>-backups/exports/drill-$(date +%Y-%m-%d)/
   ```
4. Spot-check: verify 3–5 agent profiles, 2–3 conversations, KB docs.
5. Record the drill in `HARDENING.md §3`.

---

## 4. Backup Schedule (Recommended Operating Posture)

The platform does NOT have an automated scheduled backup (no external scheduler constraint). The recommended default:

| Trigger | Action |
|---------|--------|
| Before any code deployment | Run export |
| Before any PDPA erasure drill | Run export |
| Before any bulk data operation | Run export |
| Weekly (manual reminder) | Run export; lazy-cron watchdog alerts if > 7 days since last export |

If the team needs automated backups, document the requirement and discuss with Derek — the v1 posture is documented on-demand.

---

## 5. Backup Retention

Cloud Storage versioning and lifecycle policies control backup retention. Default recommendation:
- Keep last 30 days of daily exports
- Keep one export per month for the previous 6 months

Configure via the Firebase Console → Cloud Storage → your bucket → Lifecycle rules.

---

## 6. What Is NOT Backed Up Here

| Item | Backup approach |
|------|----------------|
| Cloud Storage files (KB collateral, voice samples if any) | Enable Cloud Storage versioning via Firebase Console |
| Firebase Auth users | Firebase Admin SDK `auth.exportUsers()` (run separately if needed) |
| Remote Config | Export via Firebase Console → Remote Config → Export |
| Secret Manager secrets | Secrets are managed in Secret Manager; rotate keys, don't restore them |
