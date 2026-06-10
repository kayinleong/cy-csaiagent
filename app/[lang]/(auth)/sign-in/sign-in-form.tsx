"use client"

/**
 * app/[lang]/(auth)/sign-in/sign-in-form.tsx — Mobile-first sign-in form (AUTH-02/03).
 *
 * Client island ("use client") — handles interactive Firebase Auth sign-in.
 *
 * Flow:
 *   1. User submits email + password.
 *   2. signInWithEmailAndPassword(clientAuth, email, password) — LOCAL persistence
 *      ensures the auth state survives page refresh (AUTH-05).
 *   3. POST the resulting ID token to /api/auth/session — server verifies token,
 *      sets an httpOnly session cookie, and returns { ok, role } in the response body.
 *   4. Redirect by role (access matrix):
 *        senior-coach → /[lang]/dashboard
 *        admin        → /[lang]/dashboard  (KB/Inventory reached via the sidebar)
 *        new-agent    → /[lang]/chat       (default)
 *
 * Security:
 *   - NEVER log the user's password, the Firebase ID token, or the session cookie.
 *   - Role is read ONLY from the server's verified /api/auth/session response — never
 *     from a client-set value. Redirect is UX only; Firestore reads are independently
 *     rules-gated (T-02-02 mitigation).
 *   - Error messages are shown via state (not alerts) — user-facing only.
 */

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { useRouter, useParams } from 'next/navigation'
import { signInWithEmailAndPassword } from 'firebase/auth'

import { clientAuth } from '@/src/firebase/client'
import { useIsMobile } from '@/hooks/use-mobile'
import { Field, FieldGroup, FieldLabel, FieldError } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

// ─── Component ───────────────────────────────────────────────────────────────

export function SignInForm() {
  const t = useTranslations('auth')
  const router = useRouter()
  const params = useParams()
  const lang = (params?.lang as string) ?? 'en'
  const isMobile = useIsMobile()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setIsLoading(true)

    try {
      // Step 1: Firebase client-side sign-in (LOCAL persistence — AUTH-05)
      // clientAuth uses LOCAL persistence (IndexedDB) from src/firebase/client.ts
      const credential = await signInWithEmailAndPassword(clientAuth, email, password)
      const user = credential.user

      // Step 2: Get the Firebase ID token to send to the session route
      // SECURITY: do NOT log the idToken (CLAUDE.md secrets hygiene)
      const idToken = await user.getIdToken()

      // Step 3: POST to /api/auth/session — server verifies token + sets httpOnly cookie
      const res = await fetch('/api/auth/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken }),
      })

      if (!res.ok) {
        // Server rejected the token (role missing, account issues)
        setError(t('unauthorised'))
        setIsLoading(false)
        return
      }

      // Step 4: Read verified role from server response and redirect accordingly.
      // SECURITY: role is derived from the server's verifyIdToken — never from
      // a client-supplied value. Every Firestore read is independently rules-gated (T-02-02).
      const { role } = (await res.json()) as { ok: boolean; role?: string }

      // Route by role (access matrix):
      //   read-only    → /[lang]/usage     (analytics landing — RO-01; Home in Wave 4)
      //   senior-coach → /[lang]/dashboard
      //   admin        → /[lang]/dashboard (lands on dashboard; KB/Inventory via sidebar)
      //   new-agent    → /[lang]/chat      (default)
      // SECURITY: this is UX-only routing — the server-side layout/page gates are the
      // real boundary. Read-only must never fall into chat (it is not a chat role).
      if (role === 'read-only') {
        router.push(`/${lang}/usage`)
      } else if (role === 'senior-coach' || role === 'admin') {
        router.push(`/${lang}/dashboard`)
      } else {
        router.push(`/${lang}/chat`)
      }
    } catch {
      // Firebase Auth errors (wrong password, user not found, etc.)
      // Do NOT include internal error details in the user-facing message
      setError(t('signInError'))
      setIsLoading(false)
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className={cn(
        'w-full space-y-4',
        // Mobile-first: slightly more padding on desktop
        isMobile ? 'px-0' : 'px-2'
      )}
      noValidate
    >
      <FieldGroup>
        {/* Email field */}
        <Field orientation="vertical">
          <FieldLabel htmlFor="email" className="text-sm font-medium">
            Email
          </FieldLabel>
          <Input
            id="email"
            type="email"
            name="email"
            autoComplete="email"
            autoCapitalize="none"
            autoCorrect="off"
            inputMode="email"
            required
            disabled={isLoading}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="alice@d2.com.my"
            // Mobile-first: text-base on mobile, text-sm on desktop (matches shadcn Input)
            className="h-11 text-base md:text-sm"
          />
        </Field>

        {/* Password field */}
        <Field orientation="vertical">
          <FieldLabel htmlFor="password" className="text-sm font-medium">
            Password
          </FieldLabel>
          <Input
            id="password"
            type="password"
            name="password"
            autoComplete="current-password"
            required
            disabled={isLoading}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="h-11 text-base md:text-sm"
          />
        </Field>

        {/* Error message */}
        {error && (
          <FieldError
            errors={[{ message: error }]}
            className="text-sm text-destructive"
          />
        )}
      </FieldGroup>

      {/* Submit button — full-width, mobile-first */}
      <Button
        type="submit"
        disabled={isLoading || !email || !password}
        className="w-full h-11 text-base md:text-sm"
      >
        {isLoading ? t('signingIn') : t('signIn')}
      </Button>
    </form>
  )
}
