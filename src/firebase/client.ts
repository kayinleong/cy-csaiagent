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
 * DONE in quick-046: `clientDb` / `clientStorage` are now async accessors
 * (`getClientDb()` / `getClientStorage()`), leaving only `clientApp` + `clientAuth`
 * eager. firebase/firestore + firebase/storage compile into ONE ~353 KB chunk, so as
 * eager consts they were pulled onto every route touching this module — including
 * /[lang]/chat (the most-visited surface, which needs Firestore only on history-drawer
 * open or transcript restore, and needs Storage never) and /[lang]/sign-in (Auth only).
 * Migrated call sites:
 *   - app/[lang]/chat/conversation-list.tsx                        (getClientDb)
 *   - app/[lang]/chat/load-conversation-messages.ts                (getClientDb)
 *   - app/[lang]/(admin)/whatsapp-import/whatsapp-import-form.tsx  (getClientStorage)
 *
 * Persistence NOTE: `clientAuth` MUST stay eagerly initialized. LOCAL (IndexedDB)
 * persistence rehydration starts when `getAuth()` runs, and `clientAuth.currentUser` is
 * read by the chat + whatsapp-import surfaces (AUTH-05). Making Auth lazy would change
 * auth-readiness timing that other code depends on — chat-input already has to
 * `await clientAuth.authStateReady()` before its first read for exactly this reason.
 */

'use client'

import { getApps, initializeApp, getApp } from 'firebase/app'
import { getAuth, type Auth } from 'firebase/auth'
// firebase/firestore and firebase/storage are deliberately NOT imported at module
// scope — see getClientDb() / getClientStorage() below. `import type` erases at
// compile time, so these cost nothing in the bundle.
import type { Firestore } from 'firebase/firestore'
import type { FirebaseStorage } from 'firebase/storage'

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
 * A CURRENT Firebase ID token for the signed-in user, for `Authorization: Bearer …` on a
 * Route Handler call (quick-kayinleong-058).
 *
 * Always call this immediately before the fetch — never capture the result and reuse it.
 * A Firebase ID token is valid for ONE HOUR. `getIdToken()` returns the cached token and
 * transparently refreshes it when it is close to expiring, so a per-request call is both
 * cheap and the only thing that stays correct across a long poll loop.
 *
 * This exists because the KB ingestion pollers took a token as a PROP: two call sites
 * passed nothing at all (so the header was literally "Bearer " and every poll 401'd), one
 * passed a value read on the server, and one read a real token but only once. A single
 * accessor removes the whole class.
 *
 * @throws Error('not-signed-in') when there is no client auth session — the caller should
 *         surface a sign-in prompt rather than fetch with an empty token.
 */
export async function getFreshIdToken(): Promise<string> {
  const user = clientAuth.currentUser
  if (!user) throw new Error('not-signed-in')
  return user.getIdToken()
}

/**
 * Firestore web SDK — client-side reads. **Async accessor, not a const**
 * (quick-kayinleong-046).
 *
 * Use for reads the Firestore Security Rules permit. All client writes also go
 * through Security Rules. For server-side writes (audit logs, admin SDK paths), use
 * adminDb from '@/src/firebase/admin' instead.
 *
 * Why async: `firebase/firestore` + `firebase/storage` compile into a single ~353 KB
 * chunk. As eager module-scope consts they were pulled onto every route that touched
 * this module — including /[lang]/chat, the most-visited surface in the app, which
 * needs Firestore only when the agent opens the history drawer or restores a
 * transcript, and needs Storage never. Callers await this at their call site, so the
 * chunk downloads off the critical path.
 *
 * `getFirestore()` is idempotent per app, so repeated calls return the same instance
 * and the dynamic import resolves from module cache after the first await.
 */
export async function getClientDb(): Promise<Firestore> {
  const { getFirestore } = await import('firebase/firestore')
  return getFirestore(clientApp)
}

/**
 * Cloud Storage web SDK — client-side uploads/downloads. **Async accessor** for the
 * same reason as getClientDb().
 *
 * Used by admin surfaces that upload collateral (e.g. WhatsApp-import media) to
 * `collateral/{projectId}/…`. Writes are gated by Storage Security Rules
 * (see storage.rules): only users whose custom-claim `role == 'admin'` may write.
 * Bucket comes from NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET (already in firebaseConfig).
 */
export async function getClientStorage(): Promise<FirebaseStorage> {
  const { getStorage } = await import('firebase/storage')
  return getStorage(clientApp)
}
