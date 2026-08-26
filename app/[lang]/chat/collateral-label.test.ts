/**
 * collateral-label.test.ts — readable attachment names (quick-kayinleong-062).
 *
 * The reported card showed three chips all reading "whatsapp-media", because that is the
 * raw `type` on every WhatsApp-imported collateral doc. The filename was in the URL the
 * whole time.
 */

import { describe, it, expect } from 'vitest'
import { presentCollateral } from './collateral-label'

const fb = (path: string) =>
  `https://firebasestorage.googleapis.com/v0/b/cy-csaiagent.firebasestorage.app/o/${encodeURIComponent(
    path,
  )}?alt=media&token=3ef3222e-0552-47e2-a8fa-191e5561557f`

describe('presentCollateral', () => {
  it('recovers the filename from a Firebase download URL', () => {
    const out = presentCollateral({
      type: 'whatsapp-media',
      url: fb('collateral/QiQ/whatsapp/38 Bangsar(SALES KIT)-1.pdf'),
    })
    expect(out.label).toBe('38 Bangsar(SALES KIT)')
    expect(out.kind).toBe('pdf')
    expect(out.ext).toBe('PDF')
  })

  it('classifies images and videos, not just PDFs', () => {
    expect(presentCollateral({ type: 'whatsapp-media', url: fb('c/x/Facade view.jpg') }).kind).toBe('image')
    expect(presentCollateral({ type: 'whatsapp-media', url: fb('c/x/Site tour.mp4') }).kind).toBe('video')
    expect(presentCollateral({ type: 'whatsapp-media', url: fb('c/x/Pricing.xlsx') }).kind).toBe('sheet')
  })

  it('falls back to the TYPE when a WhatsApp export name carries no information', () => {
    // IMG-20250421-WA0051 is a date and a counter. "WhatsApp media" is at least honest.
    const out = presentCollateral({
      type: 'whatsapp-media',
      url: fb('collateral/QiQ/whatsapp/IMG-20250421-WA0051.jpg'),
    })
    expect(out.label).toBe('WhatsApp media')
    expect(out.kind).toBe('image')
    expect(out.ext).toBe('JPG')
  })

  it('labels a Drive folder from its type and marks it a folder', () => {
    const out = presentCollateral({
      type: 'project-info',
      url: 'https://drive.google.com/drive/folders/1auoNymTGsg_oBHV1zjHtgEuLWxO34i3L?usp=drive_link',
    })
    expect(out.label).toBe('Project info')
    expect(out.kind).toBe('folder')
    expect(out.ext).toBe('')
  })

  it('spells WhatsApp properly when it has to fall back', () => {
    expect(presentCollateral({ type: 'whatsapp-media', url: 'https://x.test/' }).label).toBe(
      'WhatsApp media',
    )
  })

  it('drops a duplicate-download suffix', () => {
    expect(presentCollateral({ type: 'doc', url: fb('c/x/Sales Kit-1.pdf') }).label).toBe('Sales Kit')
    expect(presentCollateral({ type: 'doc', url: fb('c/x/Sales Kit (2).pdf') }).label).toBe('Sales Kit')
  })

  it('never returns an empty label', () => {
    for (const url of ['https://x.test', 'not a url', '', 'https://x.test/?a=b']) {
      expect(presentCollateral({ type: 'brochure', url }).label.length).toBeGreaterThan(0)
    }
    // Even with an empty type there is still something to show.
    expect(presentCollateral({ type: '', url: 'https://x.test' }).label).toBe('Attachment')
  })

  it('ignores a query string when reading the extension', () => {
    const out = presentCollateral({ type: 'x', url: fb('c/x/Brochure.pdf') })
    expect(out.ext).toBe('PDF')
    expect(out.label).toBe('Brochure')
  })

  it('does not treat a long trailing dot-segment as an extension', () => {
    // "38 Bangsar. Final version" has a dot but no real extension.
    const out = presentCollateral({ type: 'brochure', url: fb('c/x/38 Bangsar. Final version') })
    expect(out.ext).toBe('')
    expect(out.kind).toBe('link')
  })
})
