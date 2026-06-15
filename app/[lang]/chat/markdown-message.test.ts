/**
 * Tests for app/[lang]/chat/markdown-message.tsx — assistant Markdown rendering.
 *
 * Uses react-dom/server renderToStaticMarkup (no DOM, no testing-library needed) so it
 * runs in the project's node vitest environment. Proves:
 *   1. Markdown formatting renders to real elements (bold, lists, links, inline code).
 *   2. Links are opened safely (rel="noopener noreferrer" target="_blank").
 *   3. Raw HTML is escaped, never emitted as live tags — XSS-safe (no rehype-raw).
 */

import { describe, it, expect } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MarkdownMessage } from './markdown-message'

function render(content: string): string {
  return renderToStaticMarkup(createElement(MarkdownMessage, { content }))
}

describe('MarkdownMessage', () => {
  it('renders **bold** as a <strong> element (not literal asterisks)', () => {
    const html = render('Welcome to **D2**!')
    expect(html).toContain('<strong')
    expect(html).toContain('D2')
    expect(html).not.toContain('**')
  })

  it('renders "- item" lines as a <ul> with <li> children', () => {
    const html = render('- first item\n- second item')
    expect(html).toContain('<ul')
    expect(html).toMatch(/<li[^>]*>first item<\/li>/)
    expect(html).toMatch(/<li[^>]*>second item<\/li>/)
    // The raw hyphen bullet must not survive as plain text.
    expect(html).not.toContain('- first item')
  })

  it('renders ordered lists as <ol>', () => {
    const html = render('1. one\n2. two')
    expect(html).toContain('<ol')
    expect(html).toMatch(/<li[^>]*>one<\/li>/)
  })

  it('renders inline `code` as a <code> element', () => {
    const html = render('run `npm test` now')
    expect(html).toMatch(/<code[^>]*>npm test<\/code>/)
  })

  it('opens links in a new tab with safe rel', () => {
    const html = render('see [the site](https://example.com)')
    expect(html).toContain('href="https://example.com"')
    expect(html).toContain('target="_blank"')
    expect(html).toContain('rel="noopener noreferrer"')
  })

  it('escapes raw HTML — no live tags emitted (XSS-safe, no rehype-raw)', () => {
    const html = render('<img src=x onerror="alert(1)"> and <script>alert(2)</script>')
    // No executable/live HTML tags from the model-supplied string.
    expect(html).not.toContain('<img')
    expect(html).not.toContain('<script>')
    // The dangerous markup is rendered as escaped, inert text instead.
    expect(html).toContain('&lt;script&gt;')
  })
})
