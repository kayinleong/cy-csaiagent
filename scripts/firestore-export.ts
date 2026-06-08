/**
 * scripts/firestore-export.ts — Managed Firestore backup via the Admin SDK (NO gcloud CLI).
 *
 * Uses @google-cloud/firestore `v1.FirestoreAdminClient.exportDocuments` — the SDK-surface
 * equivalent of `gcloud firestore export`. This keeps the backup mechanism within the Firebase
 * Admin SDK surface (firebase-admin → @google-cloud/firestore) and requires no gcloud CLI.
 *
 * Auth: service account from GOOGLE_APPLICATION_CREDENTIALS (the SA needs the
 *       "Cloud Datastore Import Export Admin" role, or Owner).
 * Project + destination bucket are read from .env.local
 *   (FIREBASE_PROJECT_ID / NEXT_PUBLIC_FIREBASE_PROJECT_ID, NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET).
 *
 * Usage:
 *   npx tsx scripts/firestore-export.ts                 # export ALL collections to a timestamped prefix
 *   npx tsx scripts/firestore-export.ts gs://bucket/x   # export to an explicit prefix
 *
 * Restore (drill): import the exported prefix into a SCRATCH project via
 *   `FirestoreAdminClient.importDocuments` — NEVER import onto production.
 */

import { config } from 'dotenv'
config({ path: '.env.local' })

import { v1 } from '@google-cloud/firestore'

async function main() {
  const projectId =
    process.env.FIREBASE_PROJECT_ID || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID
  const bucket = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET

  if (!projectId) throw new Error('FIREBASE_PROJECT_ID / NEXT_PUBLIC_FIREBASE_PROJECT_ID not set')
  if (!bucket) throw new Error('NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET not set')

  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const outputUriPrefix =
    process.argv[2] || `gs://${bucket}/firestore-backups/${stamp}`

  const client = new v1.FirestoreAdminClient()
  const name = client.databasePath(projectId, '(default)')

  console.log(`[firestore-export] project=${projectId}`)
  console.log(`[firestore-export] destination=${outputUriPrefix}`)
  console.log('[firestore-export] starting managed export (all collections)…')

  const [operation] = await client.exportDocuments({ name, outputUriPrefix })
  console.log(`[firestore-export] operation started: ${operation.name}`)
  console.log('[firestore-export] awaiting completion…')

  const [response] = await operation.promise()
  console.log('[firestore-export] ✓ export complete')
  console.log(`[firestore-export] output: ${response.outputUriPrefix ?? outputUriPrefix}`)
}

main().catch((err) => {
  console.error('[firestore-export] ✗ export failed:', err?.message ?? err)
  process.exit(1)
})
