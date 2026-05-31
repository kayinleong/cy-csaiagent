/**
 * Firebase Web SDK (client) initializer.
 *
 * This file is safe to import in Client Components and browser code.
 * It reads ONLY NEXT_PUBLIC_* env vars — these are intentionally shipped
 * in the client bundle and contain no secrets.
 *
 * DO NOT import firebase-admin from this file (Admin SDK is server-only).
 *
 * Import pattern (always use the @/ alias):
 *   import { clientAuth, clientDb } from '@/src/firebase/client'
 */

'use client'

import { getApps, initializeApp, getApp } from 'firebase/app'
import { getAuth, type Auth } from 'firebase/auth'
import { getFirestore, type Firestore } from 'firebase/firestore'

/**
 * Public Firebase config — safe for the browser.
 * All values come from NEXT_PUBLIC_* env vars set in the App Hosting environment.
 * These are NOT secrets (Firebase API key is a project identifier, not a secret;
 * security is enforced by Firestore Security Rules and Auth).
 */
const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY!,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN!,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID!,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET!,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID!,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID!,
}

/**
 * Initialize the Firebase web app exactly once.
 * Guards against re-initialization across React hot-reloads.
 */
function initClient() {
  if (getApps().length > 0) {
    return getApp()
  }
  return initializeApp(firebaseConfig)
}

const clientApp = initClient()

/**
 * Firebase Auth (web SDK) — client-side authentication.
 *
 * Persistence defaults to LOCAL (IndexedDB) — the user stays signed in
 * across browser sessions and page refreshes (AUTH-05).
 *
 * Server-side ID-token verification uses `adminAuth.verifyIdToken()` in
 * Route Handlers / proxy.ts; never trust client-side auth state on the server.
 */
export const clientAuth: Auth = getAuth(clientApp)

/**
 * Firestore web SDK — client-side reads.
 *
 * Use for realtime subscriptions (onSnapshot) and reads that the Firestore
 * Security Rules permit. All client writes also go through Security Rules.
 *
 * For server-side writes (audit logs, admin SDK paths), use adminDb from
 * '@/src/firebase/admin' instead.
 */
export const clientDb: Firestore = getFirestore(clientApp)
