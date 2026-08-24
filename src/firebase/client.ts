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
 *
 * ─── ⚡ BUNDLE COST — READ BEFORE ADDING AN IMPORT OF THIS MODULE (quick-046) ──────
 *
 * The four `firebase/*` imports below all run at MODULE SCOPE, so any client component
 * that touches ANY export here drags app + auth + firestore + storage into its route as
 * a single ~461 KB (uncompressed) chunk — even when it only needs `signOut`.
 *
 * quick-kayinleong-046 removed the worst offender: the shared console shell
 * (sign-out-button → app-sidebar → console-shell, rendered by (admin)/layout.tsx,
 * (coach)/layout.tsx and [lang]/page.tsx) now imports this module DYNAMICALLY inside
 * its click handler, so ~19 console routes no longer pay 461 KB on first load.
 *
 * RULE: a component reachable from `console-shell.tsx` must NEVER import this module
 * at module scope. Use `await import('@/src/firebase/client')` inside the handler /
 * effect that needs it.
 *
 * STILL OUTSTANDING (deliberately NOT done in quick-046 — it changes this module's
 * public surface and therefore needs the three call sites migrated in the same commit,
 * which sit outside that claim's file ownership):
 *   Convert `clientDb` / `clientStorage` from eager consts into async accessors
 *   (`getClientDb()` / `getClientStorage()` that `await import('firebase/firestore')`
 *   / `await import('firebase/storage')`), leaving only `clientApp` + `clientAuth`
 *   eager. Call sites to migrate:
 *     - app/[lang]/chat/conversation-list.tsx           (clientDb)
 *     - app/[lang]/chat/load-conversation-messages.ts   (clientDb)
 *     - app/[lang]/(admin)/whatsapp-import/whatsapp-import-form.tsx (clientStorage)
 *   Expected further win: /[lang]/(auth)/sign-in stops shipping Firestore + Storage
 *   (it needs Auth only), /[lang]/chat stops shipping Storage, and whatsapp-import
 *   stops shipping Firestore.
 *
 * Persistence NOTE for whoever does that work: `clientAuth` MUST stay eagerly
 * initialized. LOCAL (IndexedDB) persistence rehydration starts when `getAuth()` runs,
 * and `clientAuth.currentUser` is read by the chat + whatsapp-import surfaces (AUTH-05).
 * Making Auth lazy would change auth-readiness timing that other code depends on.
 */

'use client'

import { getApps, initializeApp, getApp } from 'firebase/app'
import { getAuth, type Auth } from 'firebase/auth'
import { getFirestore, type Firestore } from 'firebase/firestore'
import { getStorage, type FirebaseStorage } from 'firebase/storage'

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

/**
 * Cloud Storage web SDK — client-side uploads/downloads.
 *
 * Used by admin surfaces that upload collateral (e.g. WhatsApp-import media) to
 * `collateral/{projectId}/…`. Writes are gated by Storage Security Rules
 * (see storage.rules): only users whose custom-claim `role == 'admin'` may write.
 * Bucket comes from NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET (already in firebaseConfig).
 */
export const clientStorage: FirebaseStorage = getStorage(clientApp)
