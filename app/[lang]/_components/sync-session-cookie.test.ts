/**
 * sync-session-cookie.test.ts — the __session cookie refresher (quick-kayinleong-059).
 *
 * The defect: /api/auth/session stores a raw Firebase ID token (1-hour lifetime) as a
 * cookie with a 14-day maxAge, and nothing ever refreshed it.
 */

import { describe, it, expect, vi } from 'vitest'
import { syncSessionCookie, type SyncState } from './sync-session-cookie'

const ok = () => new Response(null, { status: 200 })
const fresh = (): SyncState => ({ last: '' })
const userWith = (token: string) => ({ getIdToken: async () => token })

describe('syncSessionCookie', () => {
  it('posts the ID token to /api/auth/session', async () => {
    const doFetch = vi.fn(async () => ok())
    const state = fresh()

    expect(await syncSessionCookie(userWith('tok-1'), state, doFetch as never)).toBe('synced')
    expect(doFetch).toHaveBeenCalledTimes(1)
    const [url, init] = doFetch.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/auth/session')
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toEqual({ idToken: 'tok-1' })
  })

  it('does nothing when signed out — sign-out owns clearing the cookie', async () => {
    const doFetch = vi.fn(async () => ok())
    expect(await syncSessionCookie(null, fresh(), doFetch as never)).toBe('signed-out')
    expect(doFetch).not.toHaveBeenCalled()
  })

  it('skips a token already synced, but posts a REFRESHED one', async () => {
    const doFetch = vi.fn(async () => ok())
    const state = fresh()

    await syncSessionCookie(userWith('tok-1'), state, doFetch as never)
    expect(await syncSessionCookie(userWith('tok-1'), state, doFetch as never)).toBe('unchanged')
    expect(doFetch).toHaveBeenCalledTimes(1)

    // The hourly refresh — this is the whole point of the module.
    expect(await syncSessionCookie(userWith('tok-2'), state, doFetch as never)).toBe('synced')
    expect(doFetch).toHaveBeenCalledTimes(2)
  })

  it('retries on the next emission when the server rejected the write', async () => {
    // state.last must NOT advance on failure, or one 500 wedges the cookie until the tab
    // is reloaded.
    const doFetch = vi.fn(async () => new Response(null, { status: 500 }))
    const state = fresh()

    expect(await syncSessionCookie(userWith('tok-1'), state, doFetch as never)).toBe('failed')
    expect(state.last).toBe('')

    doFetch.mockImplementation(async () => ok())
    expect(await syncSessionCookie(userWith('tok-1'), state, doFetch as never)).toBe('synced')
  })

  it('swallows a network failure rather than throwing into the listener', async () => {
    const doFetch = vi.fn(async () => {
      throw new Error('offline')
    })
    expect(await syncSessionCookie(userWith('tok-1'), fresh(), doFetch as never)).toBe('failed')
  })

  it('does not post when the token cannot be read', async () => {
    const doFetch = vi.fn(async () => ok())
    const throwing = {
      getIdToken: async () => {
        throw new Error('token unavailable')
      },
    }
    expect(await syncSessionCookie(throwing, fresh(), doFetch as never)).toBe('failed')
    expect(doFetch).not.toHaveBeenCalled()
  })

  it('never puts the token in the URL', async () => {
    const doFetch = vi.fn(async () => ok())
    await syncSessionCookie(userWith('secret-token'), fresh(), doFetch as never)
    const [url] = doFetch.mock.calls[0] as unknown as [string]
    expect(url).not.toContain('secret-token')
  })
})
