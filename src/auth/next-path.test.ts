/**
 * next-path.test.ts — the post-sign-in redirect validator (quick-kayinleong-073).
 *
 * `?next=` is read BEFORE the visitor is authenticated, so an unvalidated version is an
 * open redirect: a phishing link could send an agent off-origin the instant a REAL sign-in
 * succeeds, which is far more convincing than a fake login page.
 */

import { describe, it, expect } from 'vitest'
import { safeNextPath, signInUrlFor } from './next-path'

describe('safeNextPath — accepts in-app paths', () => {
  it.each([
    '/en/chat',
    '/ms/chat',
    '/zh/chat',
    '/en/dashboard',
    '/en/chat?cid=abc123',
    '/en/kb/some-doc-id',
  ])('accepts %s', (path) => {
    expect(safeNextPath(path)).toBe(path)
  })

  it('accepts a percent-encoded path and returns it decoded', () => {
    expect(safeNextPath('%2Fen%2Fchat')).toBe('/en/chat')
  })
})

describe('safeNextPath — refuses anything that could leave the origin', () => {
  it.each([
    ['absolute http', 'http://evil.test/login'],
    ['absolute https', 'https://evil.test/login'],
    ['protocol-relative', '//evil.test'],
    ['backslash protocol-relative', '/\\evil.test'],
    ['backslash anywhere', '/en/chat\\..\\evil'],
    ['javascript scheme', 'javascript:alert(1)'],
    ['data scheme', 'data:text/html,<script>'],
    ['relative', 'en/chat'],
    ['parent traversal', '../../etc/passwd'],
    ['empty', ''],
    ['bare slash', '/'],
  ])('refuses %s', (_label, path) => {
    expect(safeNextPath(path)).toBeNull()
  })

  it('refuses a control character used to smuggle a scheme past a URL parser', () => {
    expect(safeNextPath('/\tjavascript:alert(1)')).toBeNull()
    expect(safeNextPath('/en/chat\n')).toBeNull()
    // Percent-encoded, which is how it would actually arrive in a query string.
    expect(safeNextPath('%2F%09javascript:alert(1)')).toBeNull()
  })

  it('refuses a percent-encoded protocol-relative URL', () => {
    // The naive check runs on the RAW value, which starts with '/', so decoding first is
    // what makes this one fail.
    expect(safeNextPath('%2F%2Fevil.test')).toBeNull()
  })

  it('refuses a path outside the known locales', () => {
    expect(safeNextPath('/admin/secrets')).toBeNull()
    expect(safeNextPath('/fr/chat')).toBeNull()
  })

  it('refuses a redirect back to sign-in — that is a loop', () => {
    expect(safeNextPath('/en/sign-in')).toBeNull()
    expect(safeNextPath('/en/sign-in?next=/en/chat')).toBeNull()
  })

  it('refuses null, undefined and an over-long value', () => {
    expect(safeNextPath(null)).toBeNull()
    expect(safeNextPath(undefined)).toBeNull()
    expect(safeNextPath('/en/' + 'x'.repeat(600))).toBeNull()
  })

  it('refuses a malformed escape sequence rather than throwing', () => {
    expect(safeNextPath('/en/%E0%A4%A')).toBeNull()
  })
})

describe('signInUrlFor', () => {
  it('encodes the destination once so it survives as one parameter', () => {
    expect(signInUrlFor('en', '/en/chat')).toBe('/en/sign-in?next=%2Fen%2Fchat')
  })

  it('round-trips through safeNextPath', () => {
    const url = signInUrlFor('ms', '/ms/chat?cid=abc')
    const next = new URLSearchParams(url.split('?')[1]).get('next')
    expect(safeNextPath(next)).toBe('/ms/chat?cid=abc')
  })
})
