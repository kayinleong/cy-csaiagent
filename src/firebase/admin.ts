/**
 * Firebase Admin SDK initializer — server-only.
 *
 * Exports `adminDb`, `adminAuth`, and `remoteConfig` for use by every
 * server-side src/ module (audit, ratelimit, memory, rag, kb, etc.).
 *
 * Security:
 *  - NEVER import this file from app/ client components (core/shell rule, TSD §3.1).
 *  - Credentials come from Application Default Credentials (ADC) — the App Hosting
 *    service account in production, or GOOGLE_APPLICATION_CREDENTIALS / the env var
 *    FIREBASE_SERVICE_ACCOUNT_KEY during local development. We NEVER read a key file
 *    into context here.
 *  - The Admin SDK bypasses Firestore Security Rules — route handlers must still
 *    enforce ownership / role checks before calling Admin SDK write paths.
 *
 * Import pattern (always use the @/ alias, never relative):
 *   import { adminDb, adminAuth, remoteConfig } from '@/src/firebase/admin'
 */

// This file must remain server-only — Node.js APIs are fine here.
// If Next.js ever tree-shakes this into a client bundle, the service account
// ADC will not be present in the browser environment.

import { getApps, initializeApp, cert, getApp } from 'firebase-admin/app'
import { getFirestore, type Firestore } from 'firebase-admin/firestore'
import { getAuth, type Auth } from 'firebase-admin/auth'
import { getRemoteConfig, type RemoteConfig } from 'firebase-admin/remote-config'

/**
 * Initialize the Firebase Admin SDK exactly once.
 * Guards against re-initialization across hot-reloads in development.
 *
 * Credential resolution order (ADC — Application Default Credentials):
 *   1. FIREBASE_SERVICE_ACCOUNT_KEY env var — JSON string (App Hosting / Secret Manager)
 *   2. GOOGLE_APPLICATION_CREDENTIALS env var — path to a key file
 *   3. Metadata server on GCP (App Hosting production — automatic)
 *
 * We never read the key file into code; firebase-admin's ADC handles discovery.
 */
function initAdmin() {
  if (getApps().length > 0) {
    return getApp()
  }

  const serviceAccountKey = process.env.FIREBASE_SERVICE_ACCOUNT_KEY
  const projectId = process.env.FIREBASE_PROJECT_ID

  if (serviceAccountKey) {
    // Deployed environment: service-account JSON provided as a single-line env string
    // (set via App Hosting Secret Manager binding, never committed).
    let parsed: object
    try {
      parsed = JSON.parse(serviceAccountKey)
    } catch {
      throw new Error(
        'FIREBASE_SERVICE_ACCOUNT_KEY is set but is not valid JSON. ' +
          'Ensure the service-account JSON is stored as a single-line string.'
      )
    }
    return initializeApp({
      credential: cert(parsed as Parameters<typeof cert>[0]),
      projectId,
    })
  }

  // Local development with GOOGLE_APPLICATION_CREDENTIALS path,
  // or running on GCP (App Hosting) where ADC is provided automatically
  // via the metadata server — let the SDK discover credentials on its own.
  return initializeApp({ projectId })
}

initAdmin()

/**
 * The Admin Firestore instance.
 * Use for all server-side reads/writes: audit logging, ratelimit counters,
 * memory writes, RAG `findNearest`, KB ingestion.
 */
export const adminDb: Firestore = getFirestore()

/**
 * The Admin Auth instance.
 * Use for: verifying ID tokens, setting custom claims (role + tenantId),
 * creating users, revoking sessions.
 */
export const adminAuth: Auth = getAuth()

/**
 * Accessor for Firebase Remote Config.
 *
 * NOTE: model IDs are NO LONGER resolved via Remote Config — they live in the
 * Firestore doc `appConfig/modelConfig` (src/llm/provider.ts modelFor;
 * quick-kayinleong-017). Remote Config remains an allowed Firebase surface (TSD
 * C2) for any future non-model config, but is not used for model resolution.
 *
 * Returns a fresh accessor each call (cheap — no extra network round-trip).
 */
export function remoteConfig(): RemoteConfig {
  return getRemoteConfig()
}
