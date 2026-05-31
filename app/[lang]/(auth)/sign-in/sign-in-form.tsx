"use client"

/**
 * app/[lang]/(auth)/sign-in/sign-in-form.tsx — Mobile-first new-agent sign-in form.
 *
 * Client island ("use client") — handles interactive Firebase Auth sign-in.
 *
 * Flow:
 *   1. User submits email + password.
 *   2. signInWithEmailAndPassword(clientAuth, email, password) — LOCAL persistence
 *      ensures the auth state survives page refresh (AUTH-05).
 *   3. POST the resulting ID token to /api/auth/session — server sets an httpOnly
 *      session cookie for additional refresh-survival (defense-in-depth).
 *   4. Redirect to the chat shell: /[lang]/chat.
 *
 * Mobile-first:
 *   - Full-width inputs with text-base (mobile readable) + md:text-sm
 *   - Uses vendored shadcn Field/FieldLabel/Input/Button (PATTERNS Tier-A)
 *   - useIsMobile() for responsive layout awareness
 *
 * Security:
 *   - NEVER log the user's password, the Firebase ID token, or the session cookie.
 *   - Error messages are shown via state (not alerts) — user-facing only.
 *   - The server (/api/auth/session) re-verifies the token; we trust the server response.
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

      // Step 4: Redirect to the chat shell
      router.push(`/${lang}/chat`)
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
