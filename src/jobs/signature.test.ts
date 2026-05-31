/**
 * SPIKE-CRON — QStash signature verification tests
 *
 * Proves:
 *   1. An unsigned (no upstash-signature header) request is rejected.
 *   2. A correctly-signed request verifies successfully.
 *
 * These are OFFLINE/PURE-LOGIC assertions — no real QStash keys are committed.
 * The Receiver class uses HMAC-SHA256 (HS256) JWT with the signing key as the
 * secret.  We derive a valid token using the same HMAC primitive to simulate
 * what QStash sends; this mirrors the QStash SDK's own test suite pattern.
 *
 * No real keys are committed.
 * Grep guard: grep -rIE "qstash_[A-Za-z0-9]{8,}" . → 0 matches.
 *
 * References:
 *   - SPIKE-CRON: verifySignatureAppRouter HMAC verify (01-RESEARCH.md lines 428–440)
 *   - T-01-23: forged QStash callback mitigation
 *   - TSD §3.4: QStash HMAC-signed /api/jobs/*, reject unsigned at 401
 */

import { describe, it, expect } from 'vitest'
import { Receiver, SignatureError } from '@upstash/qstash'
import crypto from 'crypto'

// ─── Test constants (NOT real keys — placeholder values for unit assertions) ──

/**
 * Synthetic test signing key.
 * Production keys look like "sig_XXXXXXXX" — this is intentionally
 * different so grep gates and secret scanners do not alert.
 * Real keys are sourced from QSTASH_CURRENT_SIGNING_KEY env var at runtime.
 */
const TEST_CURRENT_KEY = 'test-signing-key-current-placeholder'
const TEST_NEXT_KEY = 'test-signing-key-next-placeholder'
const TEST_URL = 'https://example.app/api/jobs/_spike-cron'
const TEST_BODY = JSON.stringify({ ping: 'spike-cron' })

// ─── JWT helper (mirrors QStash signing) ──────────────────────────────────────

/**
 * Build a minimal HS256 JWT that replicates the QStash signature format.
 * QStash signs a JWT whose body contains { body, iss, sub, nbf, exp, ... }.
 * We use the same structure so Receiver.verify() accepts the token.
 *
 * This is for TEST ONLY — never use this logic in production code.
 * Production signatures come from QStash; the Receiver validates them.
 */
function buildTestJwt(params: {
  signingKey: string
  body: string
  url: string
  /** seconds from epoch for nbf; defaults to now */
  nbf?: number
  /** seconds for exp; defaults to nbf + 300 */
  exp?: number
}): string {
  const { signingKey, body, url, nbf: nbfParam, exp: expParam } = params
  const nbf = nbfParam ?? Math.floor(Date.now() / 1000)
  const exp = expParam ?? nbf + 300

  // QStash signs the SHA-256 hash of the body
  const bodyHash = crypto.createHash('sha256').update(body).digest('base64url')

  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
  const payload = Buffer.from(
    JSON.stringify({
      iss: 'Upstash',
      sub: url,
      nbf,
      exp,
      body: bodyHash,
    }),
  ).toString('base64url')

  const signingInput = `${header}.${payload}`
  const signature = crypto
    .createHmac('sha256', signingKey)
    .update(signingInput)
    .digest('base64url')

  return `${signingInput}.${signature}`
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('QStash Receiver — signature verification (SPIKE-CRON)', () => {
  it('rejects a request with no signature (unsigned) — returns SignatureError', async () => {
    const receiver = new Receiver({
      currentSigningKey: TEST_CURRENT_KEY,
      nextSigningKey: TEST_NEXT_KEY,
    })

    await expect(
      receiver.verify({
        signature: '',
        body: TEST_BODY,
        url: TEST_URL,
      }),
    ).rejects.toThrow(SignatureError)
  })

  it('rejects a request with a tampered/random signature', async () => {
    const receiver = new Receiver({
      currentSigningKey: TEST_CURRENT_KEY,
      nextSigningKey: TEST_NEXT_KEY,
    })

    const fakeSignature = 'eyJhbGciOiJIUzI1NiJ9.eyJpbnZhbGlkIjp0cnVlfQ.invalidsig'

    await expect(
      receiver.verify({
        signature: fakeSignature,
        body: TEST_BODY,
        url: TEST_URL,
      }),
    ).rejects.toThrow(SignatureError)
  })

  it('accepts a correctly-signed request (current key)', async () => {
    const receiver = new Receiver({
      currentSigningKey: TEST_CURRENT_KEY,
      nextSigningKey: TEST_NEXT_KEY,
    })

    const validToken = buildTestJwt({
      signingKey: TEST_CURRENT_KEY,
      body: TEST_BODY,
      url: TEST_URL,
    })

    const result = await receiver.verify({
      signature: validToken,
      body: TEST_BODY,
      url: TEST_URL,
    })
    expect(result).toBe(true)
  })

  it('accepts a request signed with the NEXT key (key rotation)', async () => {
    const receiver = new Receiver({
      currentSigningKey: TEST_CURRENT_KEY,
      nextSigningKey: TEST_NEXT_KEY,
    })

    // Sign with the NEXT key (simulates a post-rotation period where QStash
    // sends requests signed with the next key before the rotation completes)
    const tokenSignedWithNext = buildTestJwt({
      signingKey: TEST_NEXT_KEY,
      body: TEST_BODY,
      url: TEST_URL,
    })

    // Receiver should try current first, fail, then succeed with next
    const result = await receiver.verify({
      signature: tokenSignedWithNext,
      body: TEST_BODY,
      url: TEST_URL,
    })
    expect(result).toBe(true)
  })

  it('rejects a request signed with an entirely different key', async () => {
    const receiver = new Receiver({
      currentSigningKey: TEST_CURRENT_KEY,
      nextSigningKey: TEST_NEXT_KEY,
    })

    const wrongKeyToken = buildTestJwt({
      signingKey: 'completely-wrong-key-for-test',
      body: TEST_BODY,
      url: TEST_URL,
    })

    await expect(
      receiver.verify({
        signature: wrongKeyToken,
        body: TEST_BODY,
        url: TEST_URL,
      }),
    ).rejects.toThrow(SignatureError)
  })

  it('rejects an expired token (exp in the past)', async () => {
    const receiver = new Receiver({
      currentSigningKey: TEST_CURRENT_KEY,
      nextSigningKey: TEST_NEXT_KEY,
    })

    const expiredNbf = Math.floor(Date.now() / 1000) - 3600 // 1 hour ago
    const expiredExp = expiredNbf + 300 // expired 55 minutes ago

    const expiredToken = buildTestJwt({
      signingKey: TEST_CURRENT_KEY,
      body: TEST_BODY,
      url: TEST_URL,
      nbf: expiredNbf,
      exp: expiredExp,
    })

    await expect(
      receiver.verify({
        signature: expiredToken,
        body: TEST_BODY,
        url: TEST_URL,
      }),
    ).rejects.toThrow(SignatureError)
  })

  it('rejects a valid signature with tampered body (body hash mismatch)', async () => {
    const receiver = new Receiver({
      currentSigningKey: TEST_CURRENT_KEY,
      nextSigningKey: TEST_NEXT_KEY,
    })

    const validToken = buildTestJwt({
      signingKey: TEST_CURRENT_KEY,
      body: TEST_BODY,
      url: TEST_URL,
    })

    // Pass a different body — the hash in the JWT won't match
    await expect(
      receiver.verify({
        signature: validToken,
        body: TEST_BODY + '-tampered',
        url: TEST_URL,
      }),
    ).rejects.toThrow(SignatureError)
  })
})

// ─── Grep audit comment ───────────────────────────────────────────────────────
// Verify no real signing keys are committed:
// grep -rIE "qstash_[A-Za-z0-9]{8,}" . → 0 matches (CI assertion)
// All keys in this file are test placeholders only.
